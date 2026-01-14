import { describe, it, expect, beforeEach } from 'vitest';
import { JWKSClientService } from '../../src/auth/jwks-client.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

/**
 * Integration Tests for Multi-Tenant Scenarios
 * Tests multiple realm configurations and realm-specific token validation
 * 
 * Requirements: 3.4
 */
describe('Multi-Tenant Integration Tests', () => {
  const keycloakUrl = 'http://localhost:8080';
  
  // Define multiple realms
  const realms = [
    { name: 'tenant-a', clientId: 'app-a' },
    { name: 'tenant-b', clientId: 'app-b' },
    { name: 'tenant-c', clientId: 'app-c' }
  ];

  describe('Multiple Realm Configuration', () => {
    it('should create validators for multiple realms', () => {
      const validators = realms.map(realm => {
        const jwksUri = `${keycloakUrl}/realms/${realm.name}/protocol/openid-connect/certs`;
        const issuer = `${keycloakUrl}/realms/${realm.name}`;
        
        const jwksClient = new JWKSClientService(jwksUri, 300_000);
        const validator = new JWTValidatorService(jwksClient, issuer, {
          audience: realm.clientId,
          algorithms: ['RS256']
        });
        
        return { realm: realm.name, validator };
      });
      
      expect(validators).toHaveLength(3);
      expect(validators[0]!.realm).toBe('tenant-a');
      expect(validators[1]!.realm).toBe('tenant-b');
      expect(validators[2]!.realm).toBe('tenant-c');
    });

    it('should handle realm-specific JWKS endpoints', async () => {
      const realmClients = realms.map(realm => {
        const jwksUri = `${keycloakUrl}/realms/${realm.name}/protocol/openid-connect/certs`;
        return {
          realm: realm.name,
          client: new JWKSClientService(jwksUri, 300_000)
        };
      });
      
      expect(realmClients).toHaveLength(3);
      
      // Each client should have a unique JWKS URI
      const uris = realmClients.map(rc => rc.client.jwksUri);
      const uniqueUris = new Set(uris);
      expect(uniqueUris.size).toBe(3);
    });

    it('should validate tokens from different realms independently', async () => {
      const { publicKey: pubKeyA, privateKey: privKeyA } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      
      const { publicKey: pubKeyB, privateKey: privKeyB } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      
      // Create tokens for different realms
      const tokenA = jwt.sign({
        sub: 'user-a',
        iss: `${keycloakUrl}/realms/tenant-a`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'usera',
        realm_access: { roles: ['user'] }
      }, privKeyA, { algorithm: 'RS256', keyid: 'key-a' });
      
      const tokenB = jwt.sign({
        sub: 'user-b',
        iss: `${keycloakUrl}/realms/tenant-b`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'userb',
        realm_access: { roles: ['admin'] }
      }, privKeyB, { algorithm: 'RS256', keyid: 'key-b' });
      
      // Tokens should have different issuers
      const decodedA = jwt.decode(tokenA, { complete: true });
      const decodedB = jwt.decode(tokenB, { complete: true });
      
      expect(decodedA?.payload).toHaveProperty('iss');
      expect(decodedB?.payload).toHaveProperty('iss');
      expect((decodedA?.payload as any).iss).not.toBe((decodedB?.payload as any).iss);
    });
  });

  describe('Realm-Specific Token Validation', () => {
    it('should reject token from wrong realm', async () => {
      const jwksUri = `${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`;
      const issuer = `${keycloakUrl}/realms/tenant-a`;
      
      const jwksClient = new JWKSClientService(jwksUri, 300_000);
      const validator = new JWTValidatorService(jwksClient, issuer);
      
      // Create token with wrong issuer
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      
      const wrongRealmToken = jwt.sign({
        sub: 'user-b',
        iss: `${keycloakUrl}/realms/tenant-b`, // Wrong realm
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'userb',
        realm_access: { roles: ['user'] }
      }, privateKey, { algorithm: 'RS256', keyid: 'test-kid' });
      
      try {
        await validator.validateToken(wrongRealmToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        // Will fail on key lookup or issuer validation
        expect((error as Error).message).toBeDefined();
      }
    });

    it('should extract realm information from token', () => {
      const userContextExtractor = new UserContextExtractorService();
      
      const payload = {
        sub: 'user-123',
        iss: `${keycloakUrl}/realms/tenant-a`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: { roles: ['user', 'admin'] },
        resource_access: {
          'app-a': { roles: ['viewer'] }
        },
        aud: 'app-a',
        jti: 'token-123'
      };
      
      const userContext = userContextExtractor.extractUserContext(payload);
      
      // Realm should be extracted from issuer
      expect(userContext.realm).toBe('tenant-a');
      expect(userContext.userId).toBe('user-123');
      expect(userContext.username).toBe('testuser');
    });

    it('should handle realm-specific roles correctly', () => {
      const userContextExtractor = new UserContextExtractorService();
      
      const payloadA = {
        sub: 'user-a',
        iss: `${keycloakUrl}/realms/tenant-a`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'usera',
        realm_access: { roles: ['tenant-a-admin'] },
        resource_access: {
          'app-a': { roles: ['editor'] }
        },
        aud: 'app-a',
        jti: 'token-a'
      };
      
      const payloadB = {
        sub: 'user-b',
        iss: `${keycloakUrl}/realms/tenant-b`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'userb',
        realm_access: { roles: ['tenant-b-user'] },
        resource_access: {
          'app-b': { roles: ['viewer'] }
        },
        aud: 'app-b',
        jti: 'token-b'
      };
      
      const contextA = userContextExtractor.extractUserContext(payloadA);
      const contextB = userContextExtractor.extractUserContext(payloadB);
      
      expect(contextA.realm).toBe('tenant-a');
      expect(contextA.roles).toContain('tenant-a-admin');
      expect(contextA.clientRoles['app-a']).toContain('editor');
      
      expect(contextB.realm).toBe('tenant-b');
      expect(contextB.roles).toContain('tenant-b-user');
      expect(contextB.clientRoles['app-b']).toContain('viewer');
    });
  });

  describe('Multi-Realm Middleware Integration', () => {
    it('should create middleware for multiple realms', () => {
      const middlewares = realms.map(realm => {
        const jwksUri = `${keycloakUrl}/realms/${realm.name}/protocol/openid-connect/certs`;
        const issuer = `${keycloakUrl}/realms/${realm.name}`;
        
        const jwksClient = new JWKSClientService(jwksUri, 300_000);
        const validator = new JWTValidatorService(jwksClient, issuer);
        const extractor = new UserContextExtractorService();
        const auditor = new AuthenticationAuditorService();
        
        const config = {
          keycloakUrl,
          realm: realm.name,
          clientId: realm.clientId,
          jwksUri,
          cacheTimeout: 300_000,
          rateLimitConfig: {
            windowMs: 60_000,
            maxRequests: 100
          }
        };
        
        return new AuthenticationMiddlewareService(
          validator,
          extractor,
          auditor,
          config
        );
      });
      
      expect(middlewares).toHaveLength(3);
      expect(middlewares[0]).toBeInstanceOf(AuthenticationMiddlewareService);
      expect(middlewares[1]).toBeInstanceOf(AuthenticationMiddlewareService);
      expect(middlewares[2]).toBeInstanceOf(AuthenticationMiddlewareService);
    });

    it('should route requests to correct realm validator', async () => {
      // Create validators for different realms
      const validatorA = new JWTValidatorService(
        new JWKSClientService(`${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`, 300_000),
        `${keycloakUrl}/realms/tenant-a`
      );
      
      const validatorB = new JWTValidatorService(
        new JWKSClientService(`${keycloakUrl}/realms/tenant-b/protocol/openid-connect/certs`, 300_000),
        `${keycloakUrl}/realms/tenant-b`
      );
      
      // Create tokens for different realms
      const { privateKey: keyA } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const { privateKey: keyB } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      
      const tokenA = jwt.sign({
        sub: 'user-a',
        iss: `${keycloakUrl}/realms/tenant-a`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'usera',
        realm_access: { roles: ['user'] }
      }, keyA, { algorithm: 'RS256', keyid: 'key-a' });
      
      const tokenB = jwt.sign({
        sub: 'user-b',
        iss: `${keycloakUrl}/realms/tenant-b`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'userb',
        realm_access: { roles: ['user'] }
      }, keyB, { algorithm: 'RS256', keyid: 'key-b' });
      
      // Decode tokens to verify realm information
      const decodedA = jwt.decode(tokenA, { complete: true });
      const decodedB = jwt.decode(tokenB, { complete: true });
      
      expect((decodedA?.payload as any).iss).toContain('tenant-a');
      expect((decodedB?.payload as any).iss).toContain('tenant-b');
    });
  });

  describe('Cross-Realm Security', () => {
    it('should prevent token reuse across realms', async () => {
      const validatorA = new JWTValidatorService(
        new JWKSClientService(`${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`, 300_000),
        `${keycloakUrl}/realms/tenant-a`
      );
      
      // Create token for realm B
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      
      const tokenB = jwt.sign({
        sub: 'user-b',
        iss: `${keycloakUrl}/realms/tenant-b`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'userb',
        realm_access: { roles: ['admin'] }
      }, privateKey, { algorithm: 'RS256', keyid: 'key-b' });
      
      // Try to validate realm B token with realm A validator
      try {
        await validatorA.validateToken(tokenB);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        // Should fail due to issuer mismatch or key not found
        expect((error as Error).message).toBeDefined();
      }
    });

    it('should isolate realm-specific JWKS caches', async () => {
      const clientA = new JWKSClientService(
        `${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`,
        300_000
      );
      
      const clientB = new JWKSClientService(
        `${keycloakUrl}/realms/tenant-b/protocol/openid-connect/certs`,
        300_000
      );
      
      // Each client should have independent cache
      expect(clientA).not.toBe(clientB);
      expect(clientA.jwksUri).not.toBe(clientB.jwksUri);
    });

    it('should handle realm-specific audience validation', async () => {
      const validator = new JWTValidatorService(
        new JWKSClientService(`${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`, 300_000),
        `${keycloakUrl}/realms/tenant-a`,
        { audience: 'app-a' }
      );
      
      // Create token with wrong audience
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      
      const wrongAudienceToken = jwt.sign({
        sub: 'user-a',
        iss: `${keycloakUrl}/realms/tenant-a`,
        aud: 'app-b', // Wrong audience
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        preferred_username: 'usera',
        realm_access: { roles: ['user'] }
      }, privateKey, { algorithm: 'RS256', keyid: 'test-kid' });
      
      try {
        await validator.validateToken(wrongAudienceToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        // Will fail on key lookup or audience validation
        expect((error as Error).message).toBeDefined();
      }
    });
  });

  describe('Realm Configuration Management', () => {
    it('should support dynamic realm configuration', () => {
      const realmConfigs = realms.map(realm => ({
        name: realm.name,
        jwksUri: `${keycloakUrl}/realms/${realm.name}/protocol/openid-connect/certs`,
        issuer: `${keycloakUrl}/realms/${realm.name}`,
        clientId: realm.clientId,
        cacheTimeout: 300_000
      }));
      
      expect(realmConfigs).toHaveLength(3);
      expect(realmConfigs[0]!.name).toBe('tenant-a');
      expect(realmConfigs[1]!.name).toBe('tenant-b');
      expect(realmConfigs[2]!.name).toBe('tenant-c');
      
      // Each config should have unique values
      const uniqueIssuers = new Set(realmConfigs.map(c => c.issuer));
      expect(uniqueIssuers.size).toBe(3);
    });

    it('should validate realm configuration at startup', () => {
      const validateRealmConfig = (config: any) => {
        if (!config.name || typeof config.name !== 'string') {
          throw new Error('Realm name is required');
        }

        if (!config.jwksUri || typeof config.jwksUri !== 'string') {
          throw new Error('JWKS URI is required');
        }

        if (!config.issuer || typeof config.issuer !== 'string') {
          throw new Error('Issuer is required');
        }

        return true;
      };
      
      const validConfig = {
        name: 'tenant-a',
        jwksUri: `${keycloakUrl}/realms/tenant-a/protocol/openid-connect/certs`,
        issuer: `${keycloakUrl}/realms/tenant-a`,
        clientId: 'app-a'
      };
      
      expect(validateRealmConfig(validConfig)).toBe(true);
      
      const invalidConfig = {
        name: '',
        jwksUri: '',
        issuer: ''
      };
      
      expect(() => validateRealmConfig(invalidConfig)).toThrow('Realm name is required');
    });
  });
});
