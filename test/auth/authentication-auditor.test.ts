import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { AuthEvent, SecurityAlert } from '../../src/auth/types.js';
import { logger } from '../../src/cli.js';

// Mock the logger
vi.mock('../../src/cli.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('AuthenticationAuditorService', () => {
  let auditor: AuthenticationAuditorService;
  const mockLogger = vi.mocked(logger);

  beforeEach(() => {
    vi.clearAllMocks();
    auditor = new AuthenticationAuditorService(true, false);
  });

  describe('logAuthSuccess', () => {
    it('should log successful authentication events', () => {
      // Arrange
      const authEvent: AuthEvent = {
        correlationId: 'test-correlation-id',
        timestamp: new Date('2025-01-13T10:30:00.000Z'),
        userId: 'user-123',
        username: 'testuser',
        sourceIp: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        endpoint: '/api/reports',
        method: 'GET',
        success: true
      };

      // Act
      auditor.logAuthSuccess(authEvent);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication Success',
        expect.stringContaining('"event_type":"AUTH_SUCCESS"')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Auth Success: testuser (user-123) from 192.168.1.100')
      );
    });

    it('should not log when audit is disabled', () => {
      // Arrange
      const disabledAuditor = new AuthenticationAuditorService(false, false);
      const authEvent: AuthEvent = {
        correlationId: 'test-correlation-id',
        timestamp: new Date(),
        userId: 'user-123',
        username: 'testuser',
        sourceIp: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        endpoint: '/api/reports',
        method: 'GET',
        success: true
      };

      // Act
      disabledAuditor.logAuthSuccess(authEvent);

      // Assert
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('logAuthFailure', () => {
    it('should log authentication failure events', () => {
      // Arrange
      const authEvent: AuthEvent = {
        correlationId: 'test-correlation-id',
        timestamp: new Date('2025-01-13T10:30:00.000Z'),
        sourceIp: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        endpoint: '/api/reports',
        method: 'GET',
        success: false,
        errorCode: 'invalid_token',
        errorMessage: 'JWT token is invalid'
      };

      // Act
      auditor.logAuthFailure(authEvent);

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication Failure',
        expect.stringContaining('"event_type":"AUTH_FAILURE"')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('❌ Auth Failure: invalid_token from 192.168.1.100')
      );
    });
  });

  describe('logTokenExpiration', () => {
    it('should log token expiration events', () => {
      // Arrange
      const authEvent: AuthEvent = {
        correlationId: 'test-correlation-id',
        timestamp: new Date('2025-01-13T10:30:00.000Z'),
        userId: 'user-123',
        username: 'testuser',
        sourceIp: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        endpoint: '/api/reports',
        method: 'GET',
        success: false
      };

      // Act
      auditor.logTokenExpiration(authEvent);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Token Expiration',
        expect.stringContaining('"event_type":"TOKEN_EXPIRED"')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('⏰ Token Expired: testuser (user-123) from 192.168.1.100')
      );
    });
  });

  describe('logSecurityAlert', () => {
    it('should log security alerts with appropriate severity', () => {
      // Arrange
      const securityAlert: SecurityAlert = {
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'MEDIUM',
        details: {
          clientId: '192.168.1.100',
          userAgent: 'curl/7.68.0',
          endpoint: '/api/reports',
          method: 'GET'
        },
        sourceIp: '192.168.1.100',
        timestamp: new Date('2025-01-13T10:30:00.000Z')
      };

      // Act
      auditor.logSecurityAlert(securityAlert);

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security Alert',
        expect.stringContaining('"event_type":"SECURITY_ALERT"')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '🟡 Security Alert [MEDIUM]: RATE_LIMIT_EXCEEDED from 192.168.1.100',
        expect.objectContaining({
          clientId: '192.168.1.100',
          userAgent: 'curl/7.68.0'
        })
      );
    });

    it('should log high severity alerts as errors', () => {
      // Arrange
      const securityAlert: SecurityAlert = {
        type: 'SUSPICIOUS_PATTERN',
        severity: 'HIGH',
        details: {
          pattern_type: 'HIGH_FREQUENCY_FAILURES',
          failure_count: 10
        },
        sourceIp: '192.168.1.100',
        timestamp: new Date('2025-01-13T10:30:00.000Z')
      };

      // Act
      auditor.logSecurityAlert(securityAlert);

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        '🚨 HIGH SEVERITY SECURITY ALERT: SUSPICIOUS_PATTERN from 192.168.1.100',
        expect.objectContaining({
          pattern_type: 'HIGH_FREQUENCY_FAILURES',
          failure_count: 10
        })
      );
    });
  });

  describe('audit configuration', () => {
    it('should allow enabling and disabling audit logging', () => {
      // Arrange
      const authEvent: AuthEvent = {
        correlationId: 'test-correlation-id',
        timestamp: new Date(),
        userId: 'user-123',
        username: 'testuser',
        sourceIp: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        endpoint: '/api/reports',
        method: 'GET',
        success: true
      };

      // Act - disable audit logging
      auditor.setAuditEnabled(false);
      auditor.logAuthSuccess(authEvent);

      // Assert - no logs should be generated
      expect(mockLogger.info).toHaveBeenCalledWith('Audit logging disabled');

      // Act - re-enable audit logging
      vi.clearAllMocks();
      auditor.setAuditEnabled(true);
      auditor.logAuthSuccess(authEvent);

      // Assert - logs should be generated again
      expect(mockLogger.info).toHaveBeenCalledWith('Audit logging enabled');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication Success',
        expect.stringContaining('"event_type":"AUTH_SUCCESS"')
      );
    });

    it('should report audit status correctly', () => {
      // Assert
      expect(auditor.isAuditEnabled()).toBe(true);

      // Act
      auditor.setAuditEnabled(false);

      // Assert
      expect(auditor.isAuditEnabled()).toBe(false);
    });
  });
});