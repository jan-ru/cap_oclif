import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { JWTPayload } from '../../src/auth/types.js';

describe('UserContextExtractorService - Property Tests', () => {
  const extractor = new UserContextExtractorService();

  /**
   * Feature: keycloak-authentication, Property 5: Comprehensive claim extraction
   * Validates: Requirements 2.1, 2.2, 2.3, 2.4
   * 
   * For any valid JWT token, the Authentication_Service should extract all required claims 
   * (user ID, username, roles, realm) and make them available in user context
   */
  describe('Property 5: Comprehensive claim extraction', () => {
    it('should extract all required claims from any valid JWT payload', () => {
      fc.assert(
        fc.property(
          // Generate random JWT payloads with all required fields
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ maxLength: 50, minLength: 3 }),
            email: fc.option(fc.emailAddress(), { nil: undefined }),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('user', 'admin', 'viewer', 'editor', 'manager', 'developer'),
                { minLength: 0, maxLength: 5 }
              )
            }),
            resource_access: fc.option(
              fc.dictionary(
                fc.constantFrom('client-1', 'client-2', 'my-app', 'api-service'),
                fc.record({
                  roles: fc.array(
                    fc.constantFrom('client-admin', 'client-user', 'api-access', 'read-only'),
                    { minLength: 0, maxLength: 3 }
                  )
                })
              ).filter(dict => {
                // Filter out dangerous prototype pollution keys
                const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
                return !Object.keys(dict).some(key => dangerousKeys.includes(key));
              }),
              { nil: undefined }
            ),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging',
              'https://sso.domain.org/realms/development',
              'https://keycloak.local/realms/test-realm'
            ),
            aud: fc.constantFrom('my-client', 'api-service', 'web-app'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - Requirement 2.1: Extract user ID from token claims
            expect(context.userId).toBe(payload.sub);
            expect(context.userId).toBeDefined();
            expect(typeof context.userId).toBe('string');
            expect(context.userId.length).toBeGreaterThan(0);

            // Assert - Requirement 2.2: Extract username from token claims
            expect(context.username).toBe(payload.preferred_username);
            expect(context.username).toBeDefined();
            expect(typeof context.username).toBe('string');
            expect(context.username.length).toBeGreaterThan(0);

            // Assert - Requirement 2.3: Extract user roles from token claims
            expect(context.roles).toEqual(payload.realm_access.roles);
            expect(Array.isArray(context.roles)).toBe(true);
            
            // Verify client roles are extracted correctly
            if (payload.resource_access) {
              expect(context.clientRoles).toBeDefined();
              expect(typeof context.clientRoles).toBe('object');
              
              // Verify each client's roles are extracted
              for (const [clientId, access] of Object.entries(payload.resource_access)) {
                expect(context.clientRoles[clientId]).toEqual(access.roles);
              }
            } else {
              expect(context.clientRoles).toEqual({});
            }

            // Assert - Requirement 2.4: Extract realm information from token claims
            expect(context.realm).toBeDefined();
            expect(typeof context.realm).toBe('string');
            expect(context.realm.length).toBeGreaterThan(0);
            
            // Verify realm is extracted from issuer URL
            const expectedRealm = payload.iss.split('/realms/')[1];
            expect(context.realm).toBe(expectedRealm);

            // Verify email is extracted when present
            if (payload.email) {
              expect(context.email).toBe(payload.email);
            } else {
              expect(context.email).toBeUndefined();
            }

            // Verify token metadata is extracted
            expect(context.tokenId).toBe(payload.jti);
            expect(context.expiresAt).toBeInstanceOf(Date);
            expect(context.expiresAt.getTime()).toBe(payload.exp * 1000);

            // Verify service account detection
            expect(typeof context.isServiceAccount).toBe('boolean');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle missing optional fields gracefully', () => {
      fc.assert(
        fc.property(
          // Generate JWT payloads with minimal required fields
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ maxLength: 50, minLength: 3 }),
            realm_access: fc.record({
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 0, maxLength: 3 })
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/test',
              'https://auth.company.com/realms/prod'
            ),
            aud: fc.string({ maxLength: 20, minLength: 3 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - all required fields should still be present
            expect(context.userId).toBe(payload.sub);
            expect(context.username).toBe(payload.preferred_username);
            expect(context.roles).toEqual(payload.realm_access.roles);
            expect(context.realm).toBeDefined();
            expect(context.tokenId).toBe(payload.jti);
            expect(context.expiresAt).toBeInstanceOf(Date);

            // Optional fields should be undefined or empty
            expect(context.email).toBeUndefined();
            expect(context.clientRoles).toEqual({});
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fallback to sub for username when preferred_username is empty', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.constant(''),
            realm_access: fc.record({
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 0, maxLength: 3 })
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/test',
              'https://auth.company.com/realms/prod'
            ),
            aud: fc.string({ maxLength: 20, minLength: 3 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - username should fallback to sub when preferred_username is empty
            expect(context.username).toBe(payload.sub);
            expect(context.username).not.toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly extract multiple client roles from resource_access', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ maxLength: 50, minLength: 3 }),
            realm_access: fc.record({
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 0, maxLength: 3 })
            }),
            resource_access: fc.dictionary(
              fc.string({ maxLength: 20, minLength: 3 }),
              fc.record({
                roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 1, maxLength: 5 })
              }),
              { minKeys: 1, maxKeys: 4 }
            ).filter(dict => {
              // Filter out dangerous prototype pollution keys
              const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
              return !Object.keys(dict).some(key => dangerousKeys.includes(key));
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/test',
              'https://auth.company.com/realms/prod'
            ),
            aud: fc.string({ maxLength: 20, minLength: 3 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - all client roles should be extracted
            expect(Object.keys(context.clientRoles).length).toBe(Object.keys(payload.resource_access!).length);
            
            for (const [clientId, access] of Object.entries(payload.resource_access!)) {
              expect(context.clientRoles[clientId]).toEqual(access.roles);
              expect(context.clientRoles[clientId].length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract realm from various Keycloak issuer URL formats', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9-_]{2,19}$/),
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ maxLength: 50, minLength: 3 }),
            realm_access: fc.record({
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 0, maxLength: 3 })
            }),
            aud: fc.string({ maxLength: 20, minLength: 3 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (realmName, basePayload) => {
            // Create payload with realm in issuer URL
            const payload: JWTPayload = {
              ...basePayload,
              iss: `https://keycloak.example.com/realms/${realmName}`
            };

            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - realm should be extracted from issuer URL
            expect(context.realm).toBe(realmName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all claim data without loss or corruption', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ maxLength: 50, minLength: 3 }),
            email: fc.emailAddress(),
            realm_access: fc.record({
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 1, maxLength: 5 })
            }),
            resource_access: fc.dictionary(
              fc.string({ maxLength: 20, minLength: 3 }),
              fc.record({
                roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { minLength: 1, maxLength: 3 })
              }),
              { minKeys: 1, maxKeys: 3 }
            ).filter(dict => {
              // Filter out dangerous prototype pollution keys
              const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
              return !Object.keys(dict).some(key => dangerousKeys.includes(key));
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.string({ maxLength: 20, minLength: 3 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - verify no data loss or corruption
            // User ID should match exactly
            expect(context.userId).toBe(payload.sub);
            
            // Username should match exactly
            expect(context.username).toBe(payload.preferred_username);
            
            // Email should match exactly
            expect(context.email).toBe(payload.email);
            
            // Roles array should have same length and content
            expect(context.roles.length).toBe(payload.realm_access.roles.length);
            expect(context.roles).toEqual(payload.realm_access.roles);
            
            // Client roles should have same structure
            const payloadClientCount = Object.keys(payload.resource_access!).length;
            const contextClientCount = Object.keys(context.clientRoles).length;
            expect(contextClientCount).toBe(payloadClientCount);
            
            // Token ID should match exactly
            expect(context.tokenId).toBe(payload.jti);
            
            // Expiration timestamp should be correctly converted
            const expectedExpiration = new Date(payload.exp * 1000);
            expect(context.expiresAt.getTime()).toBe(expectedExpiration.getTime());
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
