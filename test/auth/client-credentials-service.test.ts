import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClientCredentialsService, ServiceAccountCredentials, ClientCredentialsToken } from '../../src/auth/client-credentials-service.js';
import { KeycloakAuthConfig } from '../../src/auth/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

describe('ClientCredentialsService - Service Account Token Handling', () => {
  let service: ClientCredentialsService;
  let mockConfig: KeycloakAuthConfig;
  let testCredentials: ServiceAccountCredentials;

  beforeEach(() => {
    // Create mock configuration
    mockConfig = {
      keycloak: {
        url: 'https://keycloak.example.com',
        realm: 'test-realm',
        clientId: 'test-client',
        clientSecret: 'test-secret'
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

    service = new ClientCredentialsService(mockConfig);

    testCredentials = {
      clientId: 'service-account-client',
      clientSecret: 'service-account-secret',
      realm: 'test-realm'
    };

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    service.clearAllCachedTokens();
  });

  describe('Token Acquisition', () => {
    it('should acquire new token using client credentials flow', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      const token = await service.authenticateServiceAccount(testCredentials);

      expect(token).toEqual(mockTokenResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify the request was made correctly
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/protocol/openid_connect/token');
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('should include scope in token request when provided', async () => {
      const credentialsWithScope: ServiceAccountCredentials = {
        ...testCredentials,
        scope: 'custom-scope'
      };

      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'custom-scope'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      await service.authenticateServiceAccount(credentialsWithScope);

      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('scope=custom-scope');
    });

    it('should handle token acquisition failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid credentials'
      });

      await expect(service.authenticateServiceAccount(testCredentials))
        .rejects.toThrow('Failed to acquire service account token');
    });

    it('should handle network errors during token acquisition', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.authenticateServiceAccount(testCredentials))
        .rejects.toThrow('Failed to acquire service account token');
    });
  });

  describe('Token Caching', () => {
    it('should cache acquired tokens', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      // First call - should fetch
      await service.authenticateServiceAccount(testCredentials);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const cachedToken = await service.authenticateServiceAccount(testCredentials);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(cachedToken.access_token).toBe('mock-access-token');
    });

    it('should return cached token if still valid', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'cached-token',
        token_type: 'Bearer',
        expires_in: 3600 // 1 hour
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      const token1 = await service.authenticateServiceAccount(testCredentials);
      const token2 = await service.authenticateServiceAccount(testCredentials);

      expect(token1).toEqual(token2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should acquire new token when cached token is expired', async () => {
      const expiredTokenResponse: ClientCredentialsToken = {
        access_token: 'expired-token',
        token_type: 'Bearer',
        expires_in: 0 // Already expired
      };

      const newTokenResponse: ClientCredentialsToken = {
        access_token: 'new-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => expiredTokenResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => newTokenResponse
        });

      await service.authenticateServiceAccount(testCredentials);
      
      // Wait a bit to ensure token is considered expired
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const token = await service.authenticateServiceAccount(testCredentials);

      expect(token.access_token).toBe('new-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should clear cached token for specific credentials', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse
      });

      await service.authenticateServiceAccount(testCredentials);
      service.clearCachedToken(testCredentials);

      // Should fetch again after clearing cache
      await service.authenticateServiceAccount(testCredentials);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should clear all cached tokens', async () => {
      const credentials1: ServiceAccountCredentials = {
        clientId: 'client1',
        clientSecret: 'secret1'
      };

      const credentials2: ServiceAccountCredentials = {
        clientId: 'client2',
        clientSecret: 'secret2'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      await service.authenticateServiceAccount(credentials1);
      await service.authenticateServiceAccount(credentials2);
      
      service.clearAllCachedTokens();

      // Both should fetch again
      await service.authenticateServiceAccount(credentials1);
      await service.authenticateServiceAccount(credentials2);
      
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Token Refresh', () => {
    it('should refresh token using refresh token', async () => {
      const refreshToken = 'mock-refresh-token';
      const refreshedTokenResponse: ClientCredentialsToken = {
        access_token: 'refreshed-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => refreshedTokenResponse
      });

      const token = await service.refreshServiceAccountToken(testCredentials, refreshToken);

      expect(token.access_token).toBe('refreshed-access-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      const requestBody = mockFetch.mock.calls[0][1].body;
      expect(requestBody).toContain('grant_type=refresh_token');
      expect(requestBody).toContain(`refresh_token=${refreshToken}`);
    });

    it('should handle refresh token failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid refresh token'
      });

      await expect(service.refreshServiceAccountToken(testCredentials, 'invalid-refresh-token'))
        .rejects.toThrow('Failed to refresh service account token');
    });

    it('should use refresh token when available and token is expiring', async () => {
      const initialTokenResponse: ClientCredentialsToken = {
        access_token: 'initial-token',
        token_type: 'Bearer',
        expires_in: 1, // Expires in 1 second
        refresh_token: 'refresh-token',
        refresh_expires_in: 3600
      };

      const refreshedTokenResponse: ClientCredentialsToken = {
        access_token: 'refreshed-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        refresh_expires_in: 3600
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => initialTokenResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => refreshedTokenResponse
        });

      await service.authenticateServiceAccount(testCredentials);
      
      // Wait for token to be near expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const token = await service.authenticateServiceAccount(testCredentials);

      expect(token.access_token).toBe('refreshed-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fall back to new token if refresh fails', async () => {
      const initialTokenResponse: ClientCredentialsToken = {
        access_token: 'initial-token',
        token_type: 'Bearer',
        expires_in: 1,
        refresh_token: 'refresh-token',
        refresh_expires_in: 3600
      };

      const newTokenResponse: ClientCredentialsToken = {
        access_token: 'new-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => initialTokenResponse
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid refresh token'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => newTokenResponse
        });

      await service.authenticateServiceAccount(testCredentials);
      
      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const token = await service.authenticateServiceAccount(testCredentials);

      expect(token.access_token).toBe('new-token');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Token Information', () => {
    it('should return token info for cached token', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        refresh_expires_in: 7200
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      await service.authenticateServiceAccount(testCredentials);
      const tokenInfo = service.getTokenInfo(testCredentials);

      expect(tokenInfo.hasToken).toBe(true);
      expect(tokenInfo.expiresAt).toBeInstanceOf(Date);
      expect(tokenInfo.canRefresh).toBe(true);
      expect(tokenInfo.refreshExpiresAt).toBeInstanceOf(Date);
    });

    it('should return no token info when no cached token exists', () => {
      const tokenInfo = service.getTokenInfo(testCredentials);

      expect(tokenInfo.hasToken).toBe(false);
      expect(tokenInfo.expiresAt).toBeUndefined();
      expect(tokenInfo.canRefresh).toBe(false);
    });

    it('should indicate token cannot be refreshed when no refresh token', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'mock-token',
        token_type: 'Bearer',
        expires_in: 3600
        // No refresh_token
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      });

      await service.authenticateServiceAccount(testCredentials);
      const tokenInfo = service.getTokenInfo(testCredentials);

      expect(tokenInfo.hasToken).toBe(true);
      expect(tokenInfo.canRefresh).toBe(false);
    });
  });

  describe('Credentials Validation', () => {
    it('should validate credentials with required fields', () => {
      const validCredentials: ServiceAccountCredentials = {
        clientId: 'valid-client',
        clientSecret: 'valid-secret'
      };

      expect(() => service.validateCredentials(validCredentials)).not.toThrow();
    });

    it('should reject credentials without clientId', () => {
      const invalidCredentials = {
        clientSecret: 'secret'
      } as ServiceAccountCredentials;

      expect(() => service.validateCredentials(invalidCredentials))
        .toThrow('Service account credentials must include a valid clientId');
    });

    it('should reject credentials without clientSecret', () => {
      const invalidCredentials = {
        clientId: 'client'
      } as ServiceAccountCredentials;

      expect(() => service.validateCredentials(invalidCredentials))
        .toThrow('Service account credentials must include a valid clientSecret');
    });

    it('should reject credentials with invalid realm', () => {
      const invalidCredentials: ServiceAccountCredentials = {
        clientId: 'client',
        clientSecret: 'secret',
        realm: 'non-existent-realm'
      };

      expect(() => service.validateCredentials(invalidCredentials))
        .toThrow('Invalid realm');
    });

    it('should reject credentials with invalid scope type', () => {
      const invalidCredentials = {
        clientId: 'client',
        clientSecret: 'secret',
        scope: 123
      } as any;

      expect(() => service.validateCredentials(invalidCredentials))
        .toThrow('Service account scope must be a string');
    });
  });

  describe('Environment Variable Loading', () => {
    beforeEach(() => {
      // Clear environment variables
      delete process.env.SERVICE_ACCOUNT_CLIENT_ID;
      delete process.env.SERVICE_ACCOUNT_CLIENT_SECRET;
      delete process.env.SERVICE_ACCOUNT_REALM;
      delete process.env.SERVICE_ACCOUNT_SCOPE;
    });

    it('should create credentials from default environment variables', () => {
      process.env.SERVICE_ACCOUNT_CLIENT_ID = 'env-client-id';
      process.env.SERVICE_ACCOUNT_CLIENT_SECRET = 'env-client-secret';
      process.env.SERVICE_ACCOUNT_REALM = 'env-realm';
      process.env.SERVICE_ACCOUNT_SCOPE = 'env-scope';

      const credentials = ClientCredentialsService.createCredentialsFromEnv();

      expect(credentials.clientId).toBe('env-client-id');
      expect(credentials.clientSecret).toBe('env-client-secret');
      expect(credentials.realm).toBe('env-realm');
      expect(credentials.scope).toBe('env-scope');
    });

    it('should create credentials from named service account', () => {
      process.env.SERVICE_ACCOUNT_REPORTS_CLIENT_ID = 'reports-client';
      process.env.SERVICE_ACCOUNT_REPORTS_CLIENT_SECRET = 'reports-secret';

      const credentials = ClientCredentialsService.createCredentialsFromEnv('reports');

      expect(credentials.clientId).toBe('reports-client');
      expect(credentials.clientSecret).toBe('reports-secret');
    });

    it('should throw error when environment variables are missing', () => {
      expect(() => ClientCredentialsService.createCredentialsFromEnv())
        .toThrow('Service account credentials not found');
    });

    it('should handle optional environment variables', () => {
      process.env.SERVICE_ACCOUNT_CLIENT_ID = 'client-id';
      process.env.SERVICE_ACCOUNT_CLIENT_SECRET = 'client-secret';
      // No realm or scope

      const credentials = ClientCredentialsService.createCredentialsFromEnv();

      expect(credentials.clientId).toBe('client-id');
      expect(credentials.clientSecret).toBe('client-secret');
      expect(credentials.realm).toBeUndefined();
      expect(credentials.scope).toBeUndefined();
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration and clear cache', async () => {
      const mockTokenResponse: ClientCredentialsToken = {
        access_token: 'old-token',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse
      });

      await service.authenticateServiceAccount(testCredentials);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Update configuration
      const newConfig = { ...mockConfig };
      newConfig.keycloak.url = 'https://new-keycloak.example.com';
      service.updateConfig(newConfig);

      // Should fetch again after config update
      await service.authenticateServiceAccount(testCredentials);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multi-Realm Support', () => {
    it('should use correct realm from credentials', async () => {
      const realmCredentials: ServiceAccountCredentials = {
        clientId: 'client',
        clientSecret: 'secret',
        realm: 'test-realm' // Use test-realm which is configured in mockConfig
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      await service.authenticateServiceAccount(realmCredentials);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/realms/test-realm/');
    });

    it('should use default realm when not specified in credentials', async () => {
      const defaultRealmCredentials: ServiceAccountCredentials = {
        clientId: 'client',
        clientSecret: 'secret'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      });

      await service.authenticateServiceAccount(defaultRealmCredentials);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('/realms/test-realm/');
    });
  });
});
