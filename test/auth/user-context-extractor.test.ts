import { describe, it, expect } from 'vitest';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { JWTPayload } from '../../src/auth/types.js';

describe('UserContextExtractorService', () => {
  const extractor = new UserContextExtractorService();

  describe('extractUserContext', () => {
    it('should extract basic user context from JWT payload', () => {
      const payload: JWTPayload = {
        sub: 'user-123',
        preferred_username: 'john.doe',
        email: 'john.doe@example.com',
        realm_access: {
          roles: ['user', 'admin']
        },
        resource_access: {
          'my-client': {
            roles: ['client-admin']
          }
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-123'
      };

      const context = extractor.extractUserContext(payload);

      expect(context.userId).toBe('user-123');
      expect(context.username).toBe('john.doe');
      expect(context.email).toBe('john.doe@example.com');
      expect(context.roles).toEqual(['user', 'admin']);
      expect(context.clientRoles).toEqual({
        'my-client': ['client-admin']
      });
      expect(context.realm).toBe('my-realm');
      expect(context.isServiceAccount).toBe(false);
      expect(context.tokenId).toBe('token-123');
      expect(context.expiresAt).toBeInstanceOf(Date);
    });

    it('should handle missing optional fields', () => {
      const payload: JWTPayload = {
        sub: 'user-456',
        preferred_username: 'jane.doe',
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: ''
      };

      const context = extractor.extractUserContext(payload);

      expect(context.userId).toBe('user-456');
      expect(context.username).toBe('jane.doe');
      expect(context.email).toBeUndefined();
      expect(context.roles).toEqual([]);
      expect(context.clientRoles).toEqual({});
      expect(context.realm).toBe('test-realm');
      expect(context.isServiceAccount).toBe(false);
      expect(context.tokenId).toBe('');
    });

    it('should fallback to sub for username when preferred_username is missing', () => {
      const payload: JWTPayload = {
        sub: 'user-789',
        preferred_username: '',
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-789'
      };

      const context = extractor.extractUserContext(payload);

      expect(context.username).toBe('user-789');
    });
  });

  describe('isServiceAccount', () => {
    it('should detect service account by explicit service_account claim', () => {
      const payload: JWTPayload = {
        sub: 'service-account-my-client',
        preferred_username: 'service-account-my-client',
        service_account: true,
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'service-token-123'
      };

      expect(extractor.isServiceAccount(payload)).toBe(true);
    });

    it('should detect service account by username pattern', () => {
      const payload: JWTPayload = {
        sub: 'abc-123',
        preferred_username: 'service-account-my-client',
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'service-token-456'
      };

      expect(extractor.isServiceAccount(payload)).toBe(true);
    });

    it('should detect service account by azp claim without email', () => {
      const payload: JWTPayload = {
        sub: 'client-123',
        preferred_username: 'client-123',
        azp: 'my-client',
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'service-token-789'
      };

      expect(extractor.isServiceAccount(payload)).toBe(true);
    });

    it('should return false for regular user accounts', () => {
      const payload: JWTPayload = {
        sub: 'user-123',
        preferred_username: 'john.doe',
        email: 'john.doe@example.com',
        realm_access: {
          roles: ['user']
        },
        iss: 'https://keycloak.example.com/realms/my-realm',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'user-token-123'
      };

      expect(extractor.isServiceAccount(payload)).toBe(false);
    });
  });

  describe('realm extraction', () => {
    it('should extract realm from standard Keycloak issuer URL', () => {
      const payload: JWTPayload = {
        sub: 'user-123',
        preferred_username: 'user-123',
        realm_access: {
          roles: []
        },
        iss: 'https://keycloak.example.com/realms/production',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-123'
      };

      const context = extractor.extractUserContext(payload);
      expect(context.realm).toBe('production');
    });

    it('should handle malformed issuer URL gracefully', () => {
      const payload: JWTPayload = {
        sub: 'user-123',
        preferred_username: 'user-123',
        realm_access: {
          roles: []
        },
        iss: 'invalid-url',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-123'
      };

      const context = extractor.extractUserContext(payload);
      expect(context.realm).toBe('unknown');
    });
  });
});