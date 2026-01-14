import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { 
  AuthenticationMiddleware, 
  AuthConfig, 
  AuthenticatedRequest, 
  JWTValidator,
  UserContextExtractor,
  AuthenticationAuditor,
  AuthEvent,
  SecurityAlert
} from './types.js';
import { AuthenticationRateLimiter } from './rate-limiter.js';
import { 
  AuthenticationErrorHandler, 
  AuthErrorType, 
  AuthErrorDetails 
} from './error-handler.js';
import { logger } from '../cli.js';

/**
 * Express middleware for JWT-based authentication
 * Integrates JWT validation with Express middleware pattern
 * 
 * Requirements implemented:
 * - 1.1: Return 401 for requests without JWT token
 * - 1.2: Return 401 for requests with invalid JWT token  
 * - 1.3: Return 401 for requests with expired JWT token
 * - 1.4: Allow valid JWT tokens to proceed
 * - 2.5: Make user context available to downstream handlers
 * - 7.3: Detect and log suspicious authentication patterns
 */
export class AuthenticationMiddlewareService implements AuthenticationMiddleware {
  private jwtValidator: JWTValidator;
  private userContextExtractor: UserContextExtractor;
  private auditor: AuthenticationAuditor;
  private config: AuthConfig;
  private rateLimiter: AuthenticationRateLimiter | undefined;
  private errorHandler: AuthenticationErrorHandler;
// Track authentication patterns for suspicious activity detection
  private failureTracker: Map<string, { count: number; lastFailure: Date; patterns: string[] }> = new Map();
  private readonly SUSPICIOUS_FAILURE_THRESHOLD = 5;
  private readonly SUSPICIOUS_PATTERN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    jwtValidator: JWTValidator,
    userContextExtractor: UserContextExtractor,
    auditor: AuthenticationAuditor,
    config: AuthConfig,
    rateLimiter?: AuthenticationRateLimiter | undefined
  ) {
    this.jwtValidator = jwtValidator;
    this.userContextExtractor = userContextExtractor;
    this.auditor = auditor;
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.errorHandler = new AuthenticationErrorHandler(auditor);
  }

  /**
   * Get rate limiting middleware for authentication endpoints
   * Requirement 7.2: Add rate limiting middleware for authentication endpoints
   */
  getRateLimitMiddleware() {
    if (!this.rateLimiter) {
      throw new Error('Rate limiter not configured. Please provide a rate limiter instance.');
    }

    return this.rateLimiter.getMiddleware();
  }

  /**
   * Configure rate limiter
   */
  setRateLimiter(rateLimiter: AuthenticationRateLimiter | undefined): void {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Main authentication middleware function
   * Requirements: 1.1, 1.2, 1.3, 1.4, 2.5
   */
  async authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const correlationId = this.getOrCreateCorrelationId(req);
    const authTimestamp = new Date();

    try {
      // Step 1: Extract Bearer token from Authorization header
      const token = this.extractBearerToken(req);
      
      if (!token) {
        // Requirement 1.1: Return 401 for requests without JWT token
        
        // Track authentication failure for suspicious pattern detection
        this.trackAuthenticationFailure(this.getClientIp(req), AuthErrorType.MISSING_TOKEN, req);
        
        const errorDetails: AuthErrorDetails = {
          errorType: AuthErrorType.MISSING_TOKEN,
          internalMessage: 'No Bearer token found in Authorization header',
          clientMessage: 'Authorization header with Bearer token is required',
          httpStatus: 401,
          correlationId
        };
        
        await this.errorHandler.handleAuthenticationError(req, res, errorDetails);
        return;
      }

      // Step 2: Validate JWT token
      let jwtPayload;
      try {
        jwtPayload = await this.jwtValidator.validateToken(token, this.getClientIp(req));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Token validation failed';
        const errorType = AuthenticationErrorHandler.getErrorTypeFromMessage(errorMessage);
        
        // Track authentication failure for suspicious pattern detection
        this.trackAuthenticationFailure(this.getClientIp(req), errorType, req);
        
        const errorDetails = this.errorHandler.createErrorFromException(
          error instanceof Error ? error : errorMessage,
          errorType,
          {
            token_id: this.extractTokenId(token),
            validation_step: 'token_validation'
          }
        );
        errorDetails.correlationId = correlationId;
        
        await this.errorHandler.handleAuthenticationError(req, res, errorDetails);
        return;
      }

      // Step 3: Extract user context from validated token
      const userContext = this.userContextExtractor.extractUserContext(jwtPayload);

      // Step 4: Attach user context to request object (Requirement 2.5)
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = userContext;
      authenticatedReq.correlationId = correlationId;
      authenticatedReq.authTimestamp = authTimestamp;

      // Step 5: Log successful authentication
      await this.logAuthenticationSuccess(req, userContext, correlationId, authTimestamp);

      // Step 6: Allow request to proceed (Requirement 1.4)
      next();

    } catch (error) {
      // Handle unexpected errors during authentication
      const errorDetails = this.errorHandler.createErrorFromException(
        error instanceof Error ? error : 'Authentication processing failed',
        AuthErrorType.AUTHENTICATION_ERROR,
        {
          processing_step: 'authentication_middleware',
          unexpected_error: true
        }
      );
      errorDetails.correlationId = correlationId;
      
      await this.errorHandler.handleAuthenticationError(req, res, errorDetails);
    }
  }

  /**
   * Configure the middleware with new settings
   */
  configure(config: AuthConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Health check for monitoring authentication service status
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if JWT validator can fetch public keys
      await this.jwtValidator.getPublicKeys();
      return true;
    } catch (error) {
      logger.warn('Authentication middleware health check failed:', error);
      return false;
    }
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    // Check for Bearer token format
    const bearerPrefix = 'Bearer ';
    if (!authHeader.startsWith(bearerPrefix)) {
      return null;
    }

    const token = authHeader.slice(bearerPrefix.length).trim();
    
    // Basic validation - token should not be empty
    if (!token || token.length === 0) {
      return null;
    }

    return token;
  }

  /**
   * Get or create correlation ID for request tracing
   */
  private getOrCreateCorrelationId(req: Request): string {
    // Check if correlation ID already exists in headers
    const existingId = req.headers['x-correlation-id'] || req.headers['x-request-id'];
    
    if (existingId && typeof existingId === 'string') {
      return existingId;
    }

    // Generate new correlation ID
    const correlationId = `auth_${Date.now()}_${randomUUID().slice(0, 8)}`;
    
    // Set it in request headers for downstream use
    req.headers['x-correlation-id'] = correlationId;
    
    return correlationId;
  }

  /**
   * Log successful authentication events
   */
  private async logAuthenticationSuccess(
    req: Request,
    userContext: any,
    correlationId: string,
    authTimestamp: Date
  ): Promise<void> {
    const authEvent: AuthEvent = {
      correlationId,
      timestamp: authTimestamp,
      userId: userContext.userId,
      username: userContext.username,
      sourceIp: this.getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      endpoint: req.originalUrl,
      method: req.method,
      success: true
    };

    this.auditor.logAuthSuccess(authEvent);
  }

  /**
   * Track authentication failures for suspicious pattern detection
   * Requirement 7.3: Detect and log suspicious authentication patterns
   */
  private trackAuthenticationFailure(clientIp: string, errorCode: string, req: Request): void {
    const now = new Date();
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Get or create failure tracking for this IP
    let tracker = this.failureTracker.get(clientIp);
    if (!tracker) {
      tracker = { count: 0, lastFailure: now, patterns: [] };
      this.failureTracker.set(clientIp, tracker);
    }

    // Clean up old entries (older than the suspicious pattern window)
    if (now.getTime() - tracker.lastFailure.getTime() > this.SUSPICIOUS_PATTERN_WINDOW_MS) {
      tracker.count = 0;
      tracker.patterns = [];
    }

    // Update failure tracking
    tracker.count++;
    tracker.lastFailure = now;
    tracker.patterns.push(`${errorCode}:${req.method}:${req.originalUrl}`);

    // Check for suspicious patterns
    this.detectSuspiciousPatterns(clientIp, tracker, userAgent, req);

    // Clean up old entries periodically
    this.cleanupFailureTracker();
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
   * Extract token ID from JWT token for logging (without validation)
   */
  private extractTokenId(token: string): string | undefined {
    try {
      // Simple base64 decode of JWT payload to get jti claim
      const parts = token.split('.');
      if (parts.length !== 3) {
        return undefined;
      }
      
      const payloadPart = parts[1];
      if (!payloadPart) {
        return undefined;
      }
      
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64').toString());
      return payload.jti;
    } catch {
      return undefined;
    }
  }

  /**
   * Detect suspicious authentication patterns and log security alerts
   * Requirement 7.3: Log security alerts for suspicious patterns
   */
  private detectSuspiciousPatterns(
    clientIp: string, 
    tracker: { count: number; lastFailure: Date; patterns: string[] },
    userAgent: string,
    req: Request
  ): void {
    const suspiciousPatterns: Array<{ type: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; details: any }> = [];

    // Pattern 1: High frequency of failures
    if (tracker.count >= this.SUSPICIOUS_FAILURE_THRESHOLD) {
      suspiciousPatterns.push({
        type: 'HIGH_FREQUENCY_FAILURES',
        severity: 'HIGH',
        details: {
          failure_count: tracker.count,
          time_window_minutes: this.SUSPICIOUS_PATTERN_WINDOW_MS / (60 * 1000),
          patterns: tracker.patterns.slice(-10) // Last 10 patterns
        }
      });
    }

    // Pattern 2: Rapid successive failures (more than 3 in 30 seconds)
    const recentFailures = tracker.patterns.filter((_, index) => 
      index >= tracker.patterns.length - 3
    );
    if (recentFailures.length >= 3) {
      suspiciousPatterns.push({
        type: 'RAPID_SUCCESSIVE_FAILURES',
        severity: 'MEDIUM',
        details: {
          recent_failures: recentFailures,
          failure_rate: 'More than 3 failures in rapid succession'
        }
      });
    }

    // Pattern 3: Multiple different error types (potential probing)
    const uniqueErrorTypes = new Set(tracker.patterns.map(p => p.split(':')[0]));
    if (uniqueErrorTypes.size >= 3) {
      suspiciousPatterns.push({
        type: 'MULTIPLE_ERROR_TYPES',
        severity: 'MEDIUM',
        details: {
          error_types: [...uniqueErrorTypes],
          total_patterns: tracker.patterns.length,
          description: 'Multiple different authentication error types suggest probing'
        }
      });
    }

    // Pattern 4: Suspicious User-Agent patterns
    if (this.isSuspiciousUserAgent(userAgent)) {
      suspiciousPatterns.push({
        type: 'SUSPICIOUS_USER_AGENT',
        severity: 'LOW',
        details: {
          user_agent: userAgent,
          description: 'User-Agent suggests automated tool or bot'
        }
      });
    }

    // Pattern 5: Targeting multiple endpoints rapidly
    const uniqueEndpoints = new Set(tracker.patterns.map(p => p.split(':')[2]));
    if (uniqueEndpoints.size >= 5) {
      suspiciousPatterns.push({
        type: 'ENDPOINT_SCANNING',
        severity: 'HIGH',
        details: {
          endpoints: [...uniqueEndpoints],
          description: 'Rapid access to multiple endpoints suggests scanning'
        }
      });
    }

    // Log security alerts for detected patterns
    for (const pattern of suspiciousPatterns) {
      const securityAlert: SecurityAlert = {
        type: 'SUSPICIOUS_PATTERN',
        severity: pattern.severity,
        details: {
          pattern_type: pattern.type,
          client_ip: clientIp,
          user_agent: userAgent,
          endpoint: req.originalUrl,
          method: req.method,
          ...pattern.details
        },
        sourceIp: clientIp,
        timestamp: new Date()
      };

      this.auditor.logSecurityAlert(securityAlert);
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
      /insomnia/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
  }

  /**
   * Clean up old failure tracking entries
   */
  private cleanupFailureTracker(): void {
    const now = new Date();
    const cutoffTime = now.getTime() - (this.SUSPICIOUS_PATTERN_WINDOW_MS * 2); // Keep data for 2x the window

    for (const [clientIp, tracker] of this.failureTracker.entries()) {
      if (tracker.lastFailure.getTime() < cutoffTime) {
        this.failureTracker.delete(clientIp);
      }
    }
  }

  /**
   * Get current failure tracking statistics (for monitoring)
   */
  getFailureTrackingStats(): { totalTrackedIps: number; recentFailures: number } {
    const now = new Date();
    const recentCutoff = now.getTime() - this.SUSPICIOUS_PATTERN_WINDOW_MS;
    
    let recentFailures = 0;
    for (const tracker of this.failureTracker.values()) {
      if (tracker.lastFailure.getTime() > recentCutoff) {
        recentFailures += tracker.count;
      }
    }

    return {
      totalTrackedIps: this.failureTracker.size,
      recentFailures
    };
  }
}