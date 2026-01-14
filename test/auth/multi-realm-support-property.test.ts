import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthConfigLoader } from '../../src/auth/config.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { JWTPayload, RealmConfig } from '../../src/auth/types.js';

describe('Multi-Realm Support - Property Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment and cache before each test
    process.env = { ...originalEnv };
    (AuthConfigLoader as any).cachedConfig = null;
    (AuthConfigLoader as any).configWatchers = [];
  });

  /**
   * Feature: keycloak-authentication, Property 8: Multi-realm support
   * Validates: Requirements 3.4
   * 
   * For any valid JWT token from any configured realm, the Authentication_Service 
   * should correctly validate and extract realm-specific information
   */
  describe('Property 8: Multi-realm support', () => {
    it('should correctly extract realm information from tokens of any configured realm', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with unique names
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange - Set up base configuration
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            // Configure additional realms if present
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act - Load configuration
            const config = AuthConfigLoader.loadConfig();
            const availableRealms = AuthConfigLoader.getAvailableRealms(config);

            // Assert - Requirement 3.4: Should support multiple Keycloak realms through configuration
            expect(availableRealms.length).toBeGreaterThanOrEqual(1);
            
            // Verify each realm is accessible
            for (const realm of realms) {
              const realmConfig = AuthConfigLoader.getRealmConfig(realm.name, config);
              expect(realmConfig).not.toBeNull();
              expect(realmConfig?.name).toBe(realm.name);
              expect(realmConfig?.url).toBe(realm.url);
              expect(realmConfig?.issuer).toBe(realm.issuer);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate correct JWKS URIs for any configured realm', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with unique names
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Each realm should have correct JWKS URI
            for (const realm of realms) {
              const jwksUri = AuthConfigLoader.getJwksUri(config, realm.name);
              const expectedBaseUrl = realm.url.endsWith('/') 
                ? realm.url.slice(0, -1) 
                : realm.url;
              const expectedUri = `${expectedBaseUrl}/realms/${realm.name}/protocol/openid_connect/certs`;
              
              expect(jwksUri).toBe(expectedUri);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate correct token endpoints for any configured realm', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with unique names
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Each realm should have correct token endpoint
            for (const realm of realms) {
              const tokenEndpoint = AuthConfigLoader.getTokenEndpoint(config, realm.name);
              const expectedBaseUrl = realm.url.endsWith('/') 
                ? realm.url.slice(0, -1) 
                : realm.url;
              const expectedEndpoint = `${expectedBaseUrl}/realms/${realm.name}/protocol/openid_connect/token`;
              
              expect(tokenEndpoint).toBe(expectedEndpoint);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly extract realm from issuer URL for any realm', () => {
      fc.assert(
        fc.property(
          // Generate random realm name and base URL
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          fc.webUrl({ validSchemes: ['https'] }),
          (realmName, baseUrl) => {
            // Arrange - Create JWT payload with realm-specific issuer
            const issuer = `${baseUrl}/realms/${realmName}`;
            const payload: JWTPayload = {
              sub: 'test-user-123',
              preferred_username: 'testuser',
              realm_access: { roles: ['user'] },
              iss: issuer,
              aud: 'test-client',
              exp: Math.floor(Date.now() / 1000) + 3600,
              iat: Math.floor(Date.now() / 1000),
              jti: 'test-jti-123'
            };

            // Act - Extract user context
            const extractor = new UserContextExtractorService();
            const userContext = extractor.extractUserContext(payload);

            // Assert - Requirement 3.4: Should correctly extract realm from any issuer
            expect(userContext.realm).toBe(realmName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle realm-specific client credentials in multi-realm configuration', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with optional client credentials (non-whitespace)
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] }),
              clientId: fc.option(fc.stringMatching(/^[a-zA-Z0-9_-]{5,50}$/), { nil: undefined }),
              clientSecret: fc.option(fc.stringMatching(/^[a-zA-Z0-9_-]{10,100}$/), { nil: undefined })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            // Add base realm credentials if present
            if (baseRealm.clientId) {
              process.env.KEYCLOAK_CLIENT_ID = baseRealm.clientId;
            }

            if (baseRealm.clientSecret) {
              process.env.KEYCLOAK_CLIENT_SECRET = baseRealm.clientSecret;
            }
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Each realm should preserve its client credentials
            for (const realm of realms) {
              const realmConfig = AuthConfigLoader.getRealmConfig(realm.name, config);
              expect(realmConfig).not.toBeNull();
              
              // Only check if both clientId and clientSecret are present or neither
              if (realm.clientId) {
                expect(realmConfig?.clientId).toBe(realm.clientId);
              } else {
                // If no clientId in test data, config may or may not have one (from base config)
                // So we don't assert anything
              }
              
              if (realm.clientSecret) {
                expect(realmConfig?.clientSecret).toBe(realm.clientSecret);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle realm-specific audience configuration', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with optional audience (non-whitespace)
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] }),
              audience: fc.option(fc.stringMatching(/^[a-zA-Z0-9_-]{5,50}$/), { nil: undefined })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            // Add base realm audience if present
            if (baseRealm.audience) {
              process.env.JWT_AUDIENCE = baseRealm.audience;
            }
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Each realm should preserve its audience configuration
            for (const realm of realms) {
              const realmConfig = AuthConfigLoader.getRealmConfig(realm.name, config);
              expect(realmConfig).not.toBeNull();
              
              if (realm.audience) {
                expect(realmConfig?.audience).toBe(realm.audience);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should support loading realms via individual environment variables', () => {
      fc.assert(
        fc.property(
          // Generate 1-3 realm configurations with unique names
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 3 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange - Set up base realm
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            // Set up additional realms via individual environment variables
            for (const [index, realm] of realms.entries()) {
              if (index > 0) { // Skip first realm as it's the base
                const realmIndex = index;
                process.env[`REALM_${realmIndex}_NAME`] = realm.name;
                process.env[`REALM_${realmIndex}_URL`] = realm.url;
                process.env[`REALM_${realmIndex}_ISSUER`] = realm.issuer;
              }
            }

            // Act
            const config = AuthConfigLoader.loadConfig();
            const availableRealms = AuthConfigLoader.getAvailableRealms(config);

            // Assert - All realms should be available (at least the ones we configured)
            expect(availableRealms.length).toBeGreaterThanOrEqual(1);
            
            // Verify each realm is accessible
            for (const realm of realms) {
              const realmConfig = AuthConfigLoader.getRealmConfig(realm.name, config);
              expect(realmConfig).not.toBeNull();
              expect(realmConfig?.name).toBe(realm.name);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain realm isolation - tokens from one realm should identify correct realm', () => {
      fc.assert(
        fc.property(
          // Generate multiple realms and pick one for token
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] }),
              issuer: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 2, maxLength: 5 }
          ),
          fc.integer({ min: 0, max: 4 }),
          (realms, tokenRealmIndex) => {
            // Ensure we have a valid index
            const actualIndex = tokenRealmIndex % realms.length;
            const tokenRealm = realms[actualIndex]!;
            
            // Arrange - Create JWT payload from specific realm
            const issuer = `${tokenRealm.url}/realms/${tokenRealm.name}`;
            const payload: JWTPayload = {
              sub: 'test-user-123',
              preferred_username: 'testuser',
              realm_access: { roles: ['user'] },
              iss: issuer,
              aud: 'test-client',
              exp: Math.floor(Date.now() / 1000) + 3600,
              iat: Math.floor(Date.now() / 1000),
              jti: 'test-jti-123'
            };

            // Act - Extract user context
            const extractor = new UserContextExtractorService();
            const userContext = extractor.extractUserContext(payload);

            // Assert - Requirement 3.4: Token should identify its specific realm
            expect(userContext.realm).toBe(tokenRealm.name);
            
            // Verify it doesn't match other realms
            for (const [i, realm] of realms.entries()) {
              if (i !== actualIndex) {
                expect(userContext.realm).not.toBe(realm!.name);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for non-existent realm configurations', () => {
      fc.assert(
        fc.property(
          // Generate valid realms and a non-existent realm name
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] }),
              issuer: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 3 }
          ),
          fc.stringMatching(/^nonexistent-[a-z0-9-]{5,15}$/),
          (realms, nonExistentRealm) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Ensure non-existent realm is actually not in the list
            const realmNames = realms.map(r => r.name);
            if (realmNames.includes(nonExistentRealm)) {
              return; // Skip this iteration if collision occurs
            }
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = `${baseRealm.url}/realms/${baseRealm.name}`;
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();
            const realmConfig = AuthConfigLoader.getRealmConfig(nonExistentRealm, config);

            // Assert - Non-existent realm should return null
            expect(realmConfig).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should list all available realms including default and configured realms', () => {
      fc.assert(
        fc.property(
          // Generate random realm configurations with unique names
          fc.array(
            fc.record({
              name: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
              url: fc.webUrl({ validSchemes: ['https'] })
            }),
            { minLength: 1, maxLength: 5 }
          ).map(realms => {
            // Ensure unique realm names
            const uniqueRealms = new Map<string, typeof realms[0]>();
            for (const realm of realms) {
              if (!uniqueRealms.has(realm.name)) {
                uniqueRealms.set(realm.name, realm);
              }
            }

            return [...uniqueRealms.values()].map(realm => ({
              ...realm,
              issuer: `${realm.url}/realms/${realm.name}`
            }));
          }),
          (realms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            const baseRealm = realms[0]!;
            process.env.KEYCLOAK_URL = baseRealm.url;
            process.env.KEYCLOAK_REALM = baseRealm.name;
            process.env.JWT_ISSUER = baseRealm.issuer;
            
            if (realms.length > 1) {
              process.env.KEYCLOAK_REALMS_CONFIG = JSON.stringify(realms);
            }

            // Act
            const config = AuthConfigLoader.loadConfig();
            const availableRealms = AuthConfigLoader.getAvailableRealms(config);

            // Assert - Should include all configured realms
            expect(availableRealms.length).toBeGreaterThanOrEqual(1);
            
            // Verify all realm names are present
            for (const realm of realms) {
              expect(availableRealms).toContain(realm.name);
            }
            
            // Verify no duplicates
            const uniqueRealms = new Set(availableRealms);
            expect(uniqueRealms.size).toBe(availableRealms.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
