import { AuthenticationAuditor, AuthEvent, SecurityAlert } from './types.js';
import { logger } from '../cli.js';

/**
 * Service for logging authentication events and security alerts
 * Provides comprehensive audit logging for compliance requirements
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.3
 */
export class AuthenticationAuditorService implements AuthenticationAuditor {
  private readonly auditEnabled: boolean;
  private readonly includeTokenClaims: boolean;

  constructor(auditEnabled: boolean = true, includeTokenClaims: boolean = false) {
    this.auditEnabled = auditEnabled;
    this.includeTokenClaims = includeTokenClaims;
  }

  /**
   * Log successful authentication events with user context
   * Requirements: 5.1
   */
  logAuthSuccess(context: AuthEvent): void {
    if (!this.auditEnabled) return;

    const auditLog: any = {
      event_type: 'AUTH_SUCCESS',
      correlation_id: context.correlationId,
      timestamp: context.timestamp.toISOString(),
      user_id: context.userId,
      username: context.username,
      source_ip: context.sourceIp,
      user_agent: context.userAgent,
      endpoint: context.endpoint,
      method: context.method,
      success: context.success,
      message: 'Authentication successful'
    };

    // Include token claims if configured to do so
    if (this.includeTokenClaims && (context as any).tokenClaims) {
      auditLog.token_claims = (context as any).tokenClaims;
    }

    // Log structured JSON for analysis
    logger.info('Authentication Success', JSON.stringify(auditLog));
    
    // Also log human-readable format for monitoring
    logger.info(`✅ Auth Success: ${context.username} (${context.userId}) from ${context.sourceIp} - ${context.method} ${context.endpoint} [${context.correlationId}]`);
  }

  /**
   * Log authentication failures with error details
   * Requirements: 5.2
   */
  logAuthFailure(context: AuthEvent): void {
    if (!this.auditEnabled) return;

    const auditLog = {
      event_type: 'AUTH_FAILURE',
      correlation_id: context.correlationId,
      timestamp: context.timestamp.toISOString(),
      user_id: context.userId || 'unknown',
      username: context.username || 'unknown',
      source_ip: context.sourceIp,
      user_agent: context.userAgent,
      endpoint: context.endpoint,
      method: context.method,
      success: context.success,
      error_code: context.errorCode,
      error_message: context.errorMessage,
      message: 'Authentication failed'
    };

    // Log structured JSON for analysis
    logger.warn('Authentication Failure', JSON.stringify(auditLog));
    
    // Also log human-readable format for monitoring
    logger.warn(`❌ Auth Failure: ${context.errorCode} from ${context.sourceIp} - ${context.method} ${context.endpoint}: ${context.errorMessage} [${context.correlationId}]`);
  }

  /**
   * Log token expiration events
   * Requirements: 5.3
   */
  logTokenExpiration(context: AuthEvent): void {
    if (!this.auditEnabled) return;

    const auditLog = {
      event_type: 'TOKEN_EXPIRED',
      correlation_id: context.correlationId,
      timestamp: context.timestamp.toISOString(),
      user_id: context.userId,
      username: context.username,
      source_ip: context.sourceIp,
      user_agent: context.userAgent,
      endpoint: context.endpoint,
      method: context.method,
      success: false,
      message: 'JWT token expired during session'
    };

    // Log structured JSON for analysis
    logger.info('Token Expiration', JSON.stringify(auditLog));
    
    // Also log human-readable format for monitoring
    logger.info(`⏰ Token Expired: ${context.username} (${context.userId}) from ${context.sourceIp} - ${context.method} ${context.endpoint} [${context.correlationId}]`);
  }

  /**
   * Log security alerts for suspicious patterns and violations
   * Requirements: 7.3
   */
  logSecurityAlert(context: SecurityAlert): void {
    if (!this.auditEnabled) return;

    const securityLog = {
      event_type: 'SECURITY_ALERT',
      alert_type: context.type,
      severity: context.severity,
      timestamp: context.timestamp.toISOString(),
      source_ip: context.sourceIp,
      details: context.details,
      message: this.getSecurityAlertMessage(context.type)
    };

    // Log structured JSON for analysis
    logger.warn('Security Alert', JSON.stringify(securityLog));
    
    // Also log human-readable format for immediate attention
    const severityIcon = this.getSeverityIcon(context.severity);
    logger.warn(`${severityIcon} Security Alert [${context.severity}]: ${context.type} from ${context.sourceIp}`, context.details);

    // For high severity alerts, also log as error for immediate attention
    if (context.severity === 'HIGH') {
      logger.error(`🚨 HIGH SEVERITY SECURITY ALERT: ${context.type} from ${context.sourceIp}`, context.details);
    }
  }

  /**
   * Log authentication events with correlation IDs for request tracing
   * Requirements: 5.4, 5.5
   */
  logAuthEvent(eventType: string, context: Partial<AuthEvent>, additionalData?: Record<string, any>): void {
    if (!this.auditEnabled) return;

    const baseLog = {
      event_type: eventType,
      correlation_id: context.correlationId || 'unknown',
      timestamp: (context.timestamp || new Date()).toISOString(),
      source_ip: context.sourceIp || 'unknown',
      user_agent: context.userAgent || 'unknown',
      endpoint: context.endpoint || 'unknown',
      method: context.method || 'unknown',
      ...additionalData
    };

    // Log structured JSON format for analysis
    logger.info(`Auth Event: ${eventType}`, JSON.stringify(baseLog));
  }

  /**
   * Get human-readable message for security alert types
   */
  private getSecurityAlertMessage(alertType: SecurityAlert['type']): string {
    const messages = {
      'RATE_LIMIT_EXCEEDED': 'Rate limit exceeded - potential brute force attack',
      'SUSPICIOUS_PATTERN': 'Suspicious authentication pattern detected',
      'INVALID_TOKEN_STRUCTURE': 'Malformed JWT token structure detected'
    };
    return messages[alertType] || 'Unknown security alert';
  }

  /**
   * Get icon for security alert severity
   */
  private getSeverityIcon(severity: SecurityAlert['severity']): string {
    const icons = {
      'LOW': '🔵',
      'MEDIUM': '🟡', 
      'HIGH': '🔴'
    };
    return icons[severity] || '⚪';
  }

  /**
   * Enable or disable audit logging
   */
  setAuditEnabled(enabled: boolean): void {
    (this as any).auditEnabled = enabled;
    logger.info(`Audit logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if audit logging is enabled
   */
  isAuditEnabled(): boolean {
    return this.auditEnabled;
  }
}