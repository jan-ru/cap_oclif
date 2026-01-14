import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { AuthConfig, JWKSClient, JWTPayload, UserContext } from '../../src/auth/types.js';
import { logger } from '../../src/cli.js';

// Mock the logger
vi.mock('../../src/cli.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('Audit Logging Integration', () => {
  let middleware: AuthenticationMiddlewareService;
  let auditor: AuthenticationAuditorService;
  let mockJwtValidator: JWTValidatorService;
  let mockUserContextExtractor: UserContextExtractorService;
  let mockJwksClient: JWKSClient;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const mockLogger = vi.mocked(logger);

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock JWKS client
    mockJwksClient = {
      fetchJWKS: vi.fn(),
      getCachedJWKS: vi.fn(),
      jwkToPem: vi.fn(),
      getSigningKey: vi.fn(),
      getAvailableKeyIds: vi.fn(),
      hasKey: vi.fn()
    };

    // Create auditor
    auditor = new AuthenticationAuditorService(true, false);

    // Create JWT validator with auditor
    mockJwtValidator = new JWTValidatorService(
      mockJwksClient,
      'https://keycloak.example.com/realms/test',
      { auditor }
    );

    // Create user context extractor
    mockUserContextExtractor = new UserContextExtractorService();

    // Create middleware with all components
    const config: AuthConfig = {
      keycloakUrl: 'https://keycloak.example.com',
      realm: 'test',
      cacheTimeout: 300_000,
      rateLimitConfig: {
        windowMs: 900_000,
        maxRequests: 10
      }
    };

    middleware = new AuthenticationMiddlewareService(
      mockJwtValidator,
      mockUserContextExtractor,
      auditor,
      config
    );

    // Setup mock request and response
    mockReq = {
      headers: {},
      originalUrl: '/api/reports',
      method: 'GET',
      socket: {
        remoteAddress: '192.168.1.100'
      }
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis()
    };

    mockNext = vi.fn();
  });

  describe('successful authentication flow', () => {
    it('should log successful authentication with all required details', async () => {
      // Arrange
      const mockPayload: JWTPayload = {
        sub: 'user-123',
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: { roles: ['user'] },
        iss: 'https://keycloak.example.com/realms/test',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-123'
      };

      const mockUserContext: UserContext = {
        userId: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        roles: ['user'],
        clientRoles: {},
        realm: 'test',
        isServiceAccount: false,
        tokenId: 'token-123',
        expiresAt: new Date(Date.now() + 3_600_000)
      };

      mockReq.headers!.authorization = 'Bearer valid-jwt-token';
      
      // Mock JWT validation to succeed
      vi.spyOn(mockJwtValidator, 'validateToken').mockResolvedValue(mockPayload);
      vi.spyOn(mockUserContextExtractor, 'extractUserContext').mockReturnValue(mockUserContext);

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert - middleware should proceed
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();

      // Assert - audit logging should capture success
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication Success',
        expect.stringContaining('"event_type":"AUTH_SUCCESS"')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Auth Success: testuser (user-123) from 192.168.1.100')
      );
    });
  });

  describe('authentication failure flow', () => {
    it('should log authentication failure with error details', async () => {
      // Arrange
      mockReq.headers!.authorization = 'Bearer invalid-jwt-token';
      
      // Mock JWT validation to fail
      vi.spyOn(mockJwtValidator, 'validateToken').mockRejectedValue(
        new Error('Invalid token: signature verification failed')
      );

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert - middleware should return 401
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'signature_invalid',
          error_description: 'The token signature is invalid'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();

      // Assert - audit logging should capture failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication Failure',
        expect.stringContaining('"event_type":"AUTH_FAILURE"')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('❌ Auth Failure: signature_invalid from 192.168.1.100')
      );
    });
  });

  describe('security alert integration', () => {
    it('should log security alerts for malformed tokens', async () => {
      // Arrange - provide a malformed token (not 3 parts)
      mockReq.headers!.authorization = 'Bearer malformed.token';

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert - middleware should return 401
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();

      // Assert - security alert should be logged for invalid token structure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security Alert',
        expect.stringContaining('"alert_type":"INVALID_TOKEN_STRUCTURE"')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '🟡 Security Alert [MEDIUM]: INVALID_TOKEN_STRUCTURE from 192.168.1.100',
        expect.objectContaining({
          validation_error: 'JWT must have exactly 3 parts',
          component: 'JWTValidator'
        })
      );
    });
  });

  describe('correlation ID tracking', () => {
    it('should include correlation IDs in all audit logs', async () => {
      // Arrange
      mockReq.headers!['x-correlation-id'] = 'test-correlation-123';
      mockReq.headers!.authorization = 'Bearer invalid-token';
      
      vi.spyOn(mockJwtValidator, 'validateToken').mockRejectedValue(
        new Error('Token expired')
      );

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert - correlation ID should be in audit logs
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication Failure',
        expect.stringContaining('"correlation_id":"test-correlation-123"')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[test-correlation-123]')
      );
    });
  });
});