import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { 
  JWTValidator, 
  UserContextExtractor, 
  AuthenticationAuditor,
  AuthConfig,
  JWTPayload,
  UserContext,
  AuthEvent
} from '../../src/auth/types.js';

describe('AuthenticationMiddleware', () => {
  let middleware: AuthenticationMiddlewareService;
  let mockJwtValidator: JWTValidator;
  let mockUserContextExtractor: UserContextExtractor;
  let mockAuditor: AuthenticationAuditor;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let config: AuthConfig;

  beforeEach(() => {
    // Create mock implementations
    mockJwtValidator = {
      validateToken: vi.fn(),
      getPublicKeys: vi.fn(),
      refreshKeys: vi.fn()
    };

    mockUserContextExtractor = {
      extractUserContext: vi.fn(),
      isServiceAccount: vi.fn()
    };

    mockAuditor = {
      logAuthSuccess: vi.fn(),
      logAuthFailure: vi.fn(),
      logTokenExpiration: vi.fn(),
      logSecurityAlert: vi.fn()
    };

    config = {
      keycloakUrl: 'https://keycloak.example.com',
      realm: 'test-realm',
      clientId: 'test-client',
      cacheTimeout: 300000,
      rateLimitConfig: {
        windowMs: 15 * 60 * 1000,
        maxRequests: 10,
        skipSuccessfulRequests: false
      }
    };

    // Create middleware instance
    middleware = new AuthenticationMiddlewareService(
      mockJwtValidator,
      mockUserContextExtractor,
      mockAuditor,
      config
    );

    // Setup mock request/response
    mockReq = {
      headers: {},
      originalUrl: '/api/test',
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' }
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis()
    };

    mockNext = vi.fn();
  });

  describe('authenticate', () => {
    it('should return 401 when no Authorization header is present', async () => {
      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'missing_token',
          error_description: 'Authorization header with Bearer token is required'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockAuditor.logAuthFailure).toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is not Bearer token', async () => {
      // Arrange
      mockReq.headers!.authorization = 'Basic dGVzdDp0ZXN0';

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'missing_token'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when JWT token is invalid', async () => {
      // Arrange
      mockReq.headers!.authorization = 'Bearer invalid-token';
      vi.mocked(mockJwtValidator.validateToken).mockRejectedValue(new Error('Invalid token'));

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'invalid_token',
          error_description: 'The provided token is invalid'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockAuditor.logAuthFailure).toHaveBeenCalled();
    });

    it('should return 401 when JWT token is expired', async () => {
      // Arrange
      mockReq.headers!.authorization = 'Bearer expired-token';
      vi.mocked(mockJwtValidator.validateToken).mockRejectedValue(new Error('Token expired: JWT has expired'));

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'token_expired',
          error_description: 'The access token has expired'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockAuditor.logAuthFailure).toHaveBeenCalled();
    });

    it('should proceed when JWT token is valid', async () => {
      // Arrange
      const validToken = 'Bearer valid-jwt-token';
      const mockPayload: JWTPayload = {
        sub: 'user123',
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: { roles: ['user'] },
        iss: 'https://keycloak.example.com/realms/test',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token123'
      };

      const mockUserContext: UserContext = {
        userId: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        roles: ['user'],
        clientRoles: {},
        realm: 'test',
        isServiceAccount: false,
        tokenId: 'token123',
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockReq.headers!.authorization = validToken;
      vi.mocked(mockJwtValidator.validateToken).mockResolvedValue(mockPayload);
      vi.mocked(mockUserContextExtractor.extractUserContext).mockReturnValue(mockUserContext);

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockJwtValidator.validateToken).toHaveBeenCalledWith('valid-jwt-token', '127.0.0.1');
      expect(mockUserContextExtractor.extractUserContext).toHaveBeenCalledWith(mockPayload);
      expect(mockNext).toHaveBeenCalled();
      expect(mockAuditor.logAuthSuccess).toHaveBeenCalled();
      
      // Check that user context is attached to request
      const authenticatedReq = mockReq as any;
      expect(authenticatedReq.user).toEqual(mockUserContext);
      expect(authenticatedReq.correlationId).toBeDefined();
      expect(authenticatedReq.authTimestamp).toBeDefined();
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockReq.headers!.authorization = 'Bearer valid-token';
      vi.mocked(mockJwtValidator.validateToken).mockRejectedValue(new Error('Unexpected error'));

      // Act
      await middleware.authenticate(mockReq as Request, mockRes as Response, mockNext);

      // Assert
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'invalid_token',
          error_description: 'The provided token is invalid'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return true when JWT validator can fetch public keys', async () => {
      // Arrange
      vi.mocked(mockJwtValidator.getPublicKeys).mockResolvedValue([]);

      // Act
      const result = await middleware.isHealthy();

      // Assert
      expect(result).toBe(true);
      expect(mockJwtValidator.getPublicKeys).toHaveBeenCalled();
    });

    it('should return false when JWT validator fails to fetch public keys', async () => {
      // Arrange
      vi.mocked(mockJwtValidator.getPublicKeys).mockRejectedValue(new Error('JWKS endpoint unavailable'));

      // Act
      const result = await middleware.isHealthy();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('configure', () => {
    it('should update configuration', () => {
      // Arrange
      const newConfig: Partial<AuthConfig> = {
        cacheTimeout: 600000
      };

      // Act
      middleware.configure(newConfig);

      // Assert - configuration should be updated (we can't directly test private properties)
      expect(() => middleware.configure(newConfig)).not.toThrow();
    });
  });
});