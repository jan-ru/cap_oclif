import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { 
  AuthErrorResponse, 
  AuthEvent, 
  SecurityAlert, 
  AuthenticationAuditor 
} from './types.js';
import { logger } from '../cli.js';

/**
 * Authentication Error Types
 * Maps internal error conditions to standardized error codes
 */
export enum AuthErrorType {
  MISSING_TOKEN = 'missing_token',
  INVALID_TOKEN = 'invalid_token', 
  TOKEN_EXPIRED = 'token_expired',
  TOKEN_MALFORMED = 'token_malformed',
  SIGNATURE_INVALID = 'signature_invalid',
  ISSUER_INVALID = 'issuer_invalid',
  AUDIENCE_INVALID = 'audience_invalid',
  CLAIMS_INVALID = 'claims_invalid',
  JWKS_UNAVAILABLE = 'jwks_unavailable',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  AUTHENTICATION_ERROR = 'authentication_error',
  CONFIGURATION_ERROR = 'configuration_error'
}

/**
 * Internal authentication error details
 * Contains detailed information for logging but not exposed to clients
 */
export interface AuthErrorDetails {
  errorType: AuthErrorType;
  internalMessage: string;
  clientMessage: string;
  httpStatus: number;
  correlationId?: string;
  sourceIp?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  tokenId?: string;
  userId?: string;
  username?: string;
  additionalContext?: Record<string, any>;
}

/**
 * Authentication Error Handler
 * 
 * Implements secure error handling for authentication failures:
 * - Returns generic error messages to clients (Requirement 7.1)
 * - Logs detailed error information internally (Requirement 7.5)
 * - Includes correlation IDs in error responses
 * 
 * Requirements implemented:
 * - 7.1: Return generic error messages that don't reveal system internals
 * - 7.5: Log detailed errors internally while returning generic errors to clients
 */
export class AuthenticationErrorHandler {
  private auditor: AuthenticationAuditor;
  
  // Error message mappings - generic messages for clients
  private readonly CLIENT_ERROR_MESSAGES: Record<AuthErrorType, string> = {
    [AuthErrorType.MISSING_TOKEN]: 'Authorization header with Bearer token is required',
    [AuthErrorType.INVALID_TOKEN]: 'The provided token is invalid',
    [AuthErrorType.TOKEN_EXPIRED]: 'The access token has expired',
    [AuthErrorType.TOKEN_MALFORMED]: 'The token format is invalid',
    [AuthErrorType.SIGNATURE_INVALID]: 'The token signature is invalid',
    [AuthErrorType.ISSUER_INVALID]: 'The token issuer is not trusted',
    [AuthErrorType.AUDIENCE_INVALID]: 'The token audience is invalid',
    [AuthErrorType.CLAIMS_INVALID]: 'The token claims are invalid',
    [AuthErrorType.JWKS_UNAVAILABLE]: 'Authentication service temporarily unavailable',
    [AuthErrorType.RATE_LIMIT_EXCEEDED]: 'Too many authentication requests. Please try again later',
    [AuthErrorType.AUTHENTICATION_ERROR]: 'Authentication failed',
    [AuthErrorType.CONFIGURATION_ERROR]: 'Authentication service configuration error'
  };

  // HTTP status codes for different error types
  private readonly HTTP_STATUS_CODES: Record<AuthErrorType, number> = {
    [AuthErrorType.MISSING_TOKEN]: 401,
    [AuthErrorType.INVALID_TOKEN]: 401,
    [AuthErrorType.TOKEN_EXPIRED]: 401,
    [AuthErrorType.TOKEN_MALFORMED]: 401,
    [AuthErrorType.SIGNATURE_INVALID]: 401,
    [AuthErrorType.ISSUER_INVALID]: 401,
    [AuthErrorType.AUDIENCE_INVALID]: 401,
    [AuthErrorType.CLAIMS_INVALID]: 401,
    [AuthErrorType.JWKS_UNAVAILABLE]: 503,
    [AuthErrorType.RATE_LIMIT_EXCEEDED]: 429,
    [AuthErrorType.AUTHENTICATION_ERROR]: 401,
    [AuthErrorType.CONFIGURATION_ERROR]: 500
  };

  constructor(auditor: AuthenticationAuditor) {
    this.auditor = auditor;
  }

  /**
   * Handle authentication error with secure error response
   * 
   * @param req Express request object
   * @param res Express response object  
   * @param errorDetails Detailed error information
   * @returns Promise<void>
   */
  async handleAuthenticationError(
    req: Request,
    res: Response,
    errorDetails: AuthErrorDetails
  ): Promise<void> {
    // Ensure correlation ID exists
    const correlationId = errorDetails.correlationId || this.generateCorrelationId(req);
    
    // Extract request context
    const requestContext = this.extractRequestContext(req, correlationId);
    
    // Create complete error details with request context
    const completeErrorDetails: AuthErrorDetails = {
      ...errorDetails,
      correlationId,
      sourceIp: requestContext.sourceIp,
      userAgent: requestContext.userAgent,
      endpoint: requestContext.endpoint,
      method: requestContext.method
    };

    // Log detailed error information internally (Requirement 7.5)
    await this.logDetailedError(completeErrorDetails);

    // Check for security alert conditions
    await this.checkForSecurityAlerts(completeErrorDetails);

    // Return generic error message to client (Requirement 7.1)
    await this.sendSecureErrorResponse(res, completeErrorDetails);
  }

  /**
   * Create authentication error from exception
   * 
   * @param error Error object or string
   * @param errorType Authentication error type
   * @param additionalContext Optional additional context
   * @returns AuthErrorDetails
   */
  createErrorFromException(
    error: Error | string,
    errorType: AuthErrorType,
    additionalContext?: Record<string, any>
  ): AuthErrorDetails {
    const errorMessage = error instanceof Error ? error.message : error;
    
    return {
      errorType,
      internalMessage: errorMessage,
      clientMessage: this.CLIENT_ERROR_MESSAGES[errorType],
      httpStatus: this.HTTP_STATUS_CODES[errorType],
      additionalContext: {
        ...additionalContext,
        originalError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error
      }
    };
  }

  /**
   * Create authentication error from validation failure
   * 
   * @param validationError Validation error details
   * @param errorType Authentication error type
   * @returns AuthErrorDetails
   */
  createValidationError(
    validationError: string,
    errorType: AuthErrorType
  ): AuthErrorDetails {
    return {
      errorType,
      internalMessage: `Token validation failed: ${validationError}`,
      clientMessage: this.CLIENT_ERROR_MESSAGES[errorType],
      httpStatus: this.HTTP_STATUS_CODES[errorType],
      additionalContext: {
        validation_error: validationError
      }
    };
  }

  /**
   * Generate correlation ID for request tracing
   */
  private generateCorrelationId(req: Request): string {
    // Check if correlation ID already exists in headers
    const existingId = req.headers['x-correlation-id'] || req.headers['x-request-id'];
    
    if (existingId && typeof existingId === 'string') {
      return existingId;
    }

    // Generate new correlation ID
    const correlationId = `auth_error_${Date.now()}_${randomUUID().slice(0, 8)}`;
    
    // Set it in request headers for downstream use
    req.headers['x-correlation-id'] = correlationId;
    
    return correlationId;
  }

  /**
   * Extract request context for logging
   */
  private extractRequestContext(req: Request, correlationId: string) {
    return {
      correlationId,
      sourceIp: this.getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      endpoint: req.originalUrl || req.url,
      method: req.method,
      timestamp: new Date()
    };
  }

  /**
   * Extract client IP address from request
   */
  private getClientIp(req: Request): string {
    // Check various headers for the real client IP
    const xForwardedFor = req.headers['x-forwarded-for'];
    const xRealIp = req.headers['x-real-ip'];
    const xClientIp = req.headers['x-client-ip'];
    
    if (xForwardedFor && typeof xForwardedFor === 'string') {
      // X-Forwarded-For can contain multiple IPs, take the first one
      return xForwardedFor.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    }
    
    if (xRealIp && typeof xRealIp === 'string') {
      return xRealIp;
    }
    
    if (xClientIp && typeof xClientIp === 'string') {
      return xClientIp;
    }
    
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Log detailed error information internally (Requirement 7.5)
   */
  private async logDetailedError(errorDetails: AuthErrorDetails): Promise<void> {
    // Create audit event for authentication failure
    const authEvent: AuthEvent = {
      correlationId: errorDetails.correlationId!,
      timestamp: new Date(),
      sourceIp: errorDetails.sourceIp!,
      userAgent: errorDetails.userAgent!,
      endpoint: errorDetails.endpoint!,
      method: errorDetails.method!,
      success: false,
      errorCode: errorDetails.errorType,
      errorMessage: errorDetails.internalMessage
    };

    // Add optional fields if they exist
    if (errorDetails.userId) {
      authEvent.userId = errorDetails.userId;
    }
    if (errorDetails.username) {
      authEvent.username = errorDetails.username;
    }

    // Log through auditor
    this.auditor.logAuthFailure(authEvent);

    // Also log detailed error for debugging
    logger.error('Authentication error details:', {
      correlationId: errorDetails.correlationId,
      errorType: errorDetails.errorType,
      internalMessage: errorDetails.internalMessage,
      httpStatus: errorDetails.httpStatus,
      sourceIp: errorDetails.sourceIp,
      userAgent: errorDetails.userAgent,
      endpoint: errorDetails.endpoint,
      method: errorDetails.method,
      tokenId: errorDetails.tokenId,
      userId: errorDetails.userId,
      username: errorDetails.username,
      additionalContext: errorDetails.additionalContext
    });
  }

  /**
   * Check for security alert conditions and log if necessary
   */
  private async checkForSecurityAlerts(errorDetails: AuthErrorDetails): Promise<void> {
    const securityAlertConditions: Array<{
      condition: boolean;
      alertType: SecurityAlert['type'];
      severity: SecurityAlert['severity'];
      details: Record<string, any>;
    }> = [
      // Alert for malformed tokens (potential attack)
      {
        condition: errorDetails.errorType === AuthErrorType.TOKEN_MALFORMED,
        alertType: 'INVALID_TOKEN_STRUCTURE',
        severity: 'MEDIUM',
        details: {
          error_type: errorDetails.errorType,
          description: 'Malformed token structure detected'
        }
      },
      
      // Alert for rate limit exceeded
      {
        condition: errorDetails.errorType === AuthErrorType.RATE_LIMIT_EXCEEDED,
        alertType: 'RATE_LIMIT_EXCEEDED',
        severity: 'HIGH',
        details: {
          error_type: errorDetails.errorType,
          description: 'Rate limit exceeded for authentication requests'
        }
      },
      
      // Alert for suspicious user agents
      {
        condition: this.isSuspiciousUserAgent(errorDetails.userAgent || ''),
        alertType: 'SUSPICIOUS_PATTERN',
        severity: 'LOW',
        details: {
          user_agent: errorDetails.userAgent,
          description: 'Suspicious user agent detected in authentication failure'
        }
      }
    ];

    // Log security alerts for matching conditions
    for (const alertCondition of securityAlertConditions) {
      if (alertCondition.condition) {
        const securityAlert: SecurityAlert = {
          type: alertCondition.alertType,
          severity: alertCondition.severity,
          details: {
            ...alertCondition.details,
            correlation_id: errorDetails.correlationId,
            endpoint: errorDetails.endpoint,
            method: errorDetails.method,
            error_type: errorDetails.errorType,
            internal_message: errorDetails.internalMessage
          },
          sourceIp: errorDetails.sourceIp!,
          timestamp: new Date()
        };

        this.auditor.logSecurityAlert(securityAlert);
      }
    }
  }

  /**
   * Check if User-Agent string suggests suspicious activity
   */
  private isSuspiciousUserAgent(userAgent: string): boolean {
    const suspiciousPatterns = [
      /curl/i,
      /wget/i,
      /python/i,
      /bot/i,
      /crawler/i,
      /scanner/i,
      /test/i,
      /^$/,  // Empty user agent
      /postman/i,
      /insomnia/i,
      /nikto/i,
      /sqlmap/i,
      /nmap/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  /**
   * Send secure error response to client (Requirement 7.1)
   */
  private async sendSecureErrorResponse(
    res: Response,
    errorDetails: AuthErrorDetails
  ): Promise<void> {
    // Create generic error response for client
    const errorResponse: AuthErrorResponse = {
      error: errorDetails.errorType,
      error_description: errorDetails.clientMessage,
      correlation_id: errorDetails.correlationId!,
      timestamp: new Date().toISOString()
    };

    // Set security headers
    res.setHeader('X-Correlation-ID', errorDetails.correlationId!);
    
    // Set WWW-Authenticate header for 401 responses
    if (errorDetails.httpStatus === 401) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="api"');
    }

    // Set cache control to prevent caching of error responses
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Send error response
    res.status(errorDetails.httpStatus).json(errorResponse);
  }

  /**
   * Get error type from error message (for backward compatibility)
   */
  static getErrorTypeFromMessage(errorMessage: string): AuthErrorType {
    const errorMessage_lower = errorMessage.toLowerCase();
    
    if (errorMessage_lower.includes('expired')) {
      return AuthErrorType.TOKEN_EXPIRED;
    }
    
    if (errorMessage_lower.includes('malformed') || errorMessage_lower.includes('invalid format')) {
      return AuthErrorType.TOKEN_MALFORMED;
    }
    
    if (errorMessage_lower.includes('signature')) {
      return AuthErrorType.SIGNATURE_INVALID;
    }
    
    if (errorMessage_lower.includes('issuer')) {
      return AuthErrorType.ISSUER_INVALID;
    }
    
    if (errorMessage_lower.includes('audience')) {
      return AuthErrorType.AUDIENCE_INVALID;
    }
    
    if (errorMessage_lower.includes('claims')) {
      return AuthErrorType.CLAIMS_INVALID;
    }
    
    if (errorMessage_lower.includes('jwks') || errorMessage_lower.includes('keys')) {
      return AuthErrorType.JWKS_UNAVAILABLE;
    }
    
    if (errorMessage_lower.includes('rate limit')) {
      return AuthErrorType.RATE_LIMIT_EXCEEDED;
    }
    
    if (errorMessage_lower.includes('configuration')) {
      return AuthErrorType.CONFIGURATION_ERROR;
    }
    
    // Default to invalid token
    return AuthErrorType.INVALID_TOKEN;
  }
}