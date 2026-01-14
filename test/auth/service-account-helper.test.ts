import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ServiceAccountHelper } from '../../src/auth/service-account-helper.js';
import { ClientCredentialsService, ServiceAccountCredentials, ClientCredentialsToken } from '../../src/auth/client-credentials-service.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { KeycloakAuthConfig, JWTPayload, UserContext } from '../../src/auth/types.js';

describe('ServiceAccountHelper - Automated Workflow Authentication', () => {
  let helper: ServiceAccountHelper;
  let mockClientCredentialsService: ClientCredentialsService;
  let mockJWTValidator: JWTValidatorService;
  let mockUserContextExtractor: UserContextExtractorService;
  let mockConfig: KeycloakAuthConfig;
  let testCredentials: ServiceAccountCredentials;

  beforeEach(() => {
    mockConfig = {
      keycloak: {
        url: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client'
      },
      jwt: {
        issuer: 'https://keycloak.example.com/realms/test-realm',
        algorithms: ['RS256'],
        clockTolerance: 30
      },
      jwks: {
        cacheTimeout: 3_600_000,
        rateLimit: 10,
        requestsPerMinute: 5
      },
      security: {
        rateLimitWindowMs: 900_000,
        rateLimitMaxRequests: 100,
        requireHttps: true
      },
      logging: {
        level: 'info',
        auditEnabled: true,
        includeTokenClaims: false
      }
    };

    testCredentials = {
      clientId: 'service-account-client',
      clientSecret: 'service-account-secret'
    };

    // Create mocks
    mockClientCredentialsService = {
      authenticateServiceAccount: vi.fn(),
      refreshServiceAccountToken: vi.fn(),
      validateCredentials: vi.fn(),
      getTokenInfo: vi.fn(),
      clearCachedToken: vi.fn(),
      clearAllCachedTokens: vi.fn(),
      updateConfig: vi.fn()
    } as any;

    mockJWTValidator = {
      validateToken: vi.fn()
    } as any;

    mockUserContextExtractor = {
      extractUserContext: vi.fn(),
      isServiceAccount: vi.fn()
    } as any;

    helper = new ServiceAccountHelper(
      mockClientCredentialsService,
      mockJWTValidator,
      mockUserContextExtractor,
      mockConfig
    );

    vi.clearAllMocks();
  });

  describe('Service Account Authentication', () => {
    it('should authenticate service account successfully', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'service-account-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      const mockJWTPayload: JWTPayload = {
        sub: 'service-account-id',
        preferred_username: 'service-account-reports',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id',
        realm_access: { roles: ['service-account'] },
        azp: 'service-account-client',
        typ: 'Bearer'
      };

      const mockUserContext: UserContext = {
        userId: 'service-account-id',
        username: 'service-account-reports',
        roles: ['service-account'],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date(Date.now() + 3_600_000)
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);
      vi.mocked(mockJWTValidator.validateToken).mockResolvedValue(mockJWTPayload);
      vi.mocked(mockUserContextExtractor.extractUserContext).mockReturnValue(mockUserContext);

      const result = await helper.authenticateServiceAccount(testCredentials);

      expect(result.success).toBe(true);
      expect(result.userContext).toEqual(mockUserContext);
      expect(result.token).toBe('service-account-token');
      expect(mockClientCredentialsService.validateCredentials).toHaveBeenCalledWith(testCredentials);
      expect(mockClientCredentialsService.authenticateServiceAccount).toHaveBeenCalledWith(testCredentials);
      expect(mockJWTValidator.validateToken).toHaveBeenCalledWith('service-account-token');
      expect(mockUserContextExtractor.extractUserContext).toHaveBeenCalledWith(mockJWTPayload);
    });

    it('should handle authentication failure', async () => {
      vi.mocked(mockClientCredentialsService.authenticateServiceAccount)
        .mockRejectedValue(new Error('Authentication failed'));

      const result = await helper.authenticateServiceAccount(testCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed');
      expect(result.userContext).toBeUndefined();
      expect(result.token).toBeUndefined();
    });

    it('should reject non-service account tokens', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'user-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      const mockJWTPayload: JWTPayload = {
        sub: 'user-id',
        preferred_username: 'regular-user',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id',
        realm_access: { roles: ['user'] }
      };

      const mockUserContext: UserContext = {
        userId: 'user-id',
        username: 'regular-user',
        roles: ['user'],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: false, // Not a service account
        tokenId: 'token-id',
        expiresAt: new Date(Date.now() + 3_600_000)
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);
      vi.mocked(mockJWTValidator.validateToken).mockResolvedValue(mockJWTPayload);
      vi.mocked(mockUserContextExtractor.extractUserContext).mockReturnValue(mockUserContext);

      const result = await helper.authenticateServiceAccount(testCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Acquired token is not for a service account');
    });

    it('should handle JWT validation errors', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'invalid-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);
      vi.mocked(mockJWTValidator.validateToken).mockRejectedValue(new Error('Invalid token signature'));

      const result = await helper.authenticateServiceAccount(testCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token signature');
    });

    it('should handle credentials validation errors', async () => {
      vi.mocked(mockClientCredentialsService.validateCredentials)
        .mockImplementation(() => { throw new Error('Invalid credentials format'); });

      const result = await helper.authenticateServiceAccount(testCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials format');
    });
  });

  describe('Express Middleware Integration', () => {
    it('should create middleware that authenticates service accounts', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'service-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      const mockJWTPayload: JWTPayload = {
        sub: 'service-account-id',
        preferred_username: 'service-account',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id',
        realm_access: { roles: [] }
      };

      const mockUserContext: UserContext = {
        userId: 'service-account-id',
        username: 'service-account',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date(Date.now() + 3_600_000)
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);
      vi.mocked(mockJWTValidator.validateToken).mockResolvedValue(mockJWTPayload);
      vi.mocked(mockUserContextExtractor.extractUserContext).mockReturnValue(mockUserContext);

      const middleware = helper.createServiceAccountMiddleware(testCredentials);
      
      const mockReq = {
        headers: {
          'x-correlation-id': 'test-correlation-id'
        }
      } as Request;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      
      const mockNext = vi.fn() as NextFunction;

      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as any).user).toEqual(mockUserContext);
      expect((mockReq as any).correlationId).toBe('test-correlation-id');
      expect((mockReq as any).authTimestamp).toBeInstanceOf(Date);
    });

    it('should return 401 when service account authentication fails', async () => {
      vi.mocked(mockClientCredentialsService.authenticateServiceAccount)
        .mockRejectedValue(new Error('Authentication failed'));

      const middleware = helper.createServiceAccountMiddleware(testCredentials);
      
      const mockReq = {
        headers: {}
      } as Request;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      
      const mockNext = vi.fn() as NextFunction;

      await middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'service_account_authentication_failed'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should generate correlation ID when not provided', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'service-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      const mockJWTPayload: JWTPayload = {
        sub: 'service-account-id',
        preferred_username: 'service-account',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id',
        realm_access: { roles: [] }
      };

      const mockUserContext: UserContext = {
        userId: 'service-account-id',
        username: 'service-account',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date(Date.now() + 3_600_000)
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);
      vi.mocked(mockJWTValidator.validateToken).mockResolvedValue(mockJWTPayload);
      vi.mocked(mockUserContextExtractor.extractUserContext).mockReturnValue(mockUserContext);

      const middleware = helper.createServiceAccountMiddleware(testCredentials);
      
      const mockReq = {
        headers: {}
      } as Request;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      
      const mockNext = vi.fn() as NextFunction;

      await middleware(mockReq, mockRes, mockNext);

      expect((mockReq as any).correlationId).toMatch(/^sa_\d+$/);
    });

    it('should handle internal errors with 401 status', async () => {
      vi.mocked(mockClientCredentialsService.validateCredentials)
        .mockImplementation(() => { throw new Error('Unexpected error'); });

      const middleware = helper.createServiceAccountMiddleware(testCredentials);
      
      const mockReq = {
        headers: {}
      } as Request;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as unknown as Response;
      
      const mockNext = vi.fn() as NextFunction;

      await middleware(mockReq, mockRes, mockNext);

      // The middleware catches errors and returns 401 for authentication failures
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'service_account_authentication_failed'
        })
      );
    });
  });

  describe('Token Management for Automated Workflows', () => {
    it('should get service account token for API calls', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'workflow-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);

      const token = await helper.getServiceAccountToken(testCredentials);

      expect(token).toBe('workflow-token');
      expect(mockClientCredentialsService.authenticateServiceAccount).toHaveBeenCalledWith(testCredentials);
    });

    it('should refresh service account token', async () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: true,
        expiresAt: new Date(Date.now() + 1000),
        canRefresh: true,
        refreshExpiresAt: new Date(Date.now() + 3_600_000)
      });

      const mockToken: ClientCredentialsToken = {
        access_token: 'refreshed-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);

      const token = await helper.refreshServiceAccountToken(testCredentials);

      expect(token).toBe('refreshed-token');
    });

    it('should throw error when no cached token to refresh', async () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: false,
        canRefresh: false
      });

      await expect(helper.refreshServiceAccountToken(testCredentials))
        .rejects.toThrow('No cached token found to refresh');
    });

    it('should throw error when token cannot be refreshed', async () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: true,
        expiresAt: new Date(Date.now() + 1000),
        canRefresh: false
      });

      await expect(helper.refreshServiceAccountToken(testCredentials))
        .rejects.toThrow('Token cannot be refreshed');
    });

    it('should check if service account has valid token', () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: true,
        expiresAt: new Date(Date.now() + 3_600_000),
        canRefresh: false
      });

      const hasToken = helper.hasValidToken(testCredentials);

      expect(hasToken).toBe(true);
    });

    it('should return false when no valid token exists', () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: false,
        canRefresh: false
      });

      const hasToken = helper.hasValidToken(testCredentials);

      expect(hasToken).toBe(false);
    });

    it('should get token expiration information', () => {
      const expirationDate = new Date(Date.now() + 3_600_000);
      
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: true,
        expiresAt: expirationDate,
        canRefresh: false
      });

      const expiration = helper.getTokenExpiration(testCredentials);

      expect(expiration).toEqual(expirationDate);
    });

    it('should return null when no token expiration available', () => {
      vi.mocked(mockClientCredentialsService.getTokenInfo).mockReturnValue({
        hasToken: false,
        canRefresh: false
      });

      const expiration = helper.getTokenExpiration(testCredentials);

      expect(expiration).toBeNull();
    });

    it('should clear cached token', () => {
      helper.clearToken(testCredentials);

      expect(mockClientCredentialsService.clearCachedToken).toHaveBeenCalledWith(testCredentials);
    });
  });

  describe('Authorization Header Creation', () => {
    it('should create authorization header with Bearer token', async () => {
      const mockToken: ClientCredentialsToken = {
        access_token: 'auth-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      vi.mocked(mockClientCredentialsService.authenticateServiceAccount).mockResolvedValue(mockToken);

      const authHeader = await helper.createAuthorizationHeader(testCredentials);

      expect(authHeader).toBe('Bearer auth-token');
    });
  });

  describe('Service Account Validation', () => {
    it('should validate service account user context', () => {
      const serviceAccountContext: UserContext = {
        userId: 'sa-id',
        username: 'service-account',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date()
      };

      expect(() => ServiceAccountHelper.validateServiceAccount(serviceAccountContext)).not.toThrow();
    });

    it('should reject non-service account context', () => {
      const userContext: UserContext = {
        userId: 'user-id',
        username: 'regular-user',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: false,
        tokenId: 'token-id',
        expiresAt: new Date()
      };

      expect(() => ServiceAccountHelper.validateServiceAccount(userContext))
        .toThrow('User context does not represent a service account');
    });

    it('should reject service account context without userId', () => {
      const invalidContext: UserContext = {
        userId: '',
        username: 'service-account',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date()
      };

      expect(() => ServiceAccountHelper.validateServiceAccount(invalidContext))
        .toThrow('Service account context missing required identity information');
    });

    it('should reject service account context without username', () => {
      const invalidContext: UserContext = {
        userId: 'sa-id',
        username: '',
        roles: [],
        clientRoles: {},
        realm: 'test-realm',
        isServiceAccount: true,
        tokenId: 'token-id',
        expiresAt: new Date()
      };

      expect(() => ServiceAccountHelper.validateServiceAccount(invalidContext))
        .toThrow('Service account context missing required identity information');
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration', () => {
      const newConfig = { ...mockConfig };
      newConfig.keycloak.url = 'https://new-keycloak.example.com';

      helper.updateConfig(newConfig);

      expect(mockClientCredentialsService.updateConfig).toHaveBeenCalledWith(newConfig);
    });
  });

  describe('Environment Variable Integration', () => {
    beforeEach(() => {
      delete process.env.SERVICE_ACCOUNT_CLIENT_ID;
      delete process.env.SERVICE_ACCOUNT_CLIENT_SECRET;
    });

    it('should create credentials from environment variables', () => {
      process.env.SERVICE_ACCOUNT_CLIENT_ID = 'env-client';
      process.env.SERVICE_ACCOUNT_CLIENT_SECRET = 'env-secret';

      const credentials = ServiceAccountHelper.createCredentialsFromEnv();

      expect(credentials.clientId).toBe('env-client');
      expect(credentials.clientSecret).toBe('env-secret');
    });

    it('should create named service account credentials from environment', () => {
      process.env.SERVICE_ACCOUNT_AUTOMATION_CLIENT_ID = 'automation-client';
      process.env.SERVICE_ACCOUNT_AUTOMATION_CLIENT_SECRET = 'automation-secret';

      const credentials = ServiceAccountHelper.createCredentialsFromEnv('automation');

      expect(credentials.clientId).toBe('automation-client');
      expect(credentials.clientSecret).toBe('automation-secret');
    });
  });
});
