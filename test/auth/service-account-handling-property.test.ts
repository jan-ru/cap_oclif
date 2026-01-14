import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { JWTPayload } from '../../src/auth/types.js';

describe('UserContextExtractorService - Service Account Property Tests', () => {
  const extractor = new UserContextExtractorService();

  /**
   * Feature: keycloak-authentication, Property 9: Service account handling
   * Validates: Requirements 4.1, 4.2
   * 
   * For any service account JWT token, the Authentication_Service should correctly identify it 
   * as a service account and extract appropriate identity information
   */
  describe('Property 9: Service account handling', () => {
    it('should identify service accounts by explicit service_account claim', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.oneof(
              fc.string({ minLength: 10, maxLength: 50 }),
              fc.uuid()
            ),
            preferred_username: fc.oneof(
              fc.constant('service-account-').chain(prefix =>
                fc.string({ minLength: 5, maxLength: 30 }).map(suffix => prefix + suffix)
              ),
              fc.string({ minLength: 5, maxLength: 50 })
            ),
            service_account: fc.constant(true),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('service', 'api-access', 'system', 'automation'),
                { minLength: 0, maxLength: 5 }
              )
            }),
            resource_access: fc.option(
              fc.dictionary(
                fc.constantFrom('api-service', 'backend', 'integration'),
                fc.record({
                  roles: fc.array(
                    fc.constantFrom('service-role', 'api-client', 'system-access'),
                    { minLength: 0, maxLength: 3 }
                  )
                })
              ),
              { nil: undefined }
            ),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging',
              'https://sso.domain.org/realms/development'
            ),
            aud: fc.constantFrom('api-service', 'backend-api', 'integration-service'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const isServiceAccount = extractor.isServiceAccount(payload);
            const context = extractor.extractUserContext(payload);

            // Assert - Requirement 4.1: Accept JWT tokens issued for service accounts
            expect(isServiceAccount).toBe(true);
            expect(context.isServiceAccount).toBe(true);

            // Assert - Requirement 4.2: Extract service account identity
            expect(context.userId).toBe(payload.sub);
            expect(context.userId).toBeDefined();
            expect(typeof context.userId).toBe('string');
            expect(context.userId.length).toBeGreaterThan(0);

            expect(context.username).toBeDefined();
            expect(typeof context.username).toBe('string');
            expect(context.username.length).toBeGreaterThan(0);

            // Service accounts should have roles extracted
            expect(Array.isArray(context.roles)).toBe(true);
            expect(context.roles).toEqual(payload.realm_access.roles);

            // Verify realm is extracted
            expect(context.realm).toBeDefined();
            expect(typeof context.realm).toBe('string');

            // Verify token metadata
            expect(context.tokenId).toBe(payload.jti);
            expect(context.expiresAt).toBeInstanceOf(Date);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify service accounts by username pattern', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 30 }).map(
              suffix => `service-account-${suffix}`
            ),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('service', 'api-access', 'system', 'automation'),
                { minLength: 0, maxLength: 5 }
              )
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.constantFrom('api-service', 'backend-api'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const isServiceAccount = extractor.isServiceAccount(payload);
            const context = extractor.extractUserContext(payload);

            // Assert - Requirement 4.1: Accept JWT tokens issued for service accounts
            expect(isServiceAccount).toBe(true);
            expect(context.isServiceAccount).toBe(true);

            // Assert - Requirement 4.2: Extract service account identity
            expect(context.userId).toBe(payload.sub);
            expect(context.username).toBe(payload.preferred_username);
            expect(context.username).toMatch(/^service-account-/);

            // Verify all identity information is extracted
            expect(context.roles).toEqual(payload.realm_access.roles);
            expect(context.realm).toBeDefined();
            expect(context.tokenId).toBe(payload.jti);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify service accounts by azp claim without email', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 50 }),
            azp: fc.constantFrom('my-client', 'api-service', 'backend-app', 'integration-client'),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('service', 'api-access', 'system'),
                { minLength: 0, maxLength: 5 }
              )
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.constantFrom('api-service', 'backend-api'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Ensure no email is present (service accounts typically don't have emails)
            const payloadWithoutEmail = { ...payload };
            delete payloadWithoutEmail.email;

            // Act
            const isServiceAccount = extractor.isServiceAccount(payloadWithoutEmail);
            const context = extractor.extractUserContext(payloadWithoutEmail);

            // Assert - Requirement 4.1: Accept JWT tokens issued for service accounts
            expect(isServiceAccount).toBe(true);
            expect(context.isServiceAccount).toBe(true);

            // Assert - Requirement 4.2: Extract service account identity
            expect(context.userId).toBe(payloadWithoutEmail.sub);
            expect(context.username).toBe(payloadWithoutEmail.preferred_username);
            expect(context.email).toBeUndefined();

            // Verify identity extraction
            expect(context.roles).toEqual(payloadWithoutEmail.realm_access.roles);
            expect(context.realm).toBeDefined();
            expect(context.tokenId).toBe(payloadWithoutEmail.jti);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should distinguish service accounts from user accounts', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 50 }).filter(
              name => !name.startsWith('service-account-')
            ),
            email: fc.emailAddress(),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('user', 'admin', 'viewer', 'editor'),
                { minLength: 0, maxLength: 5 }
              )
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.constantFrom('web-app', 'mobile-app'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Ensure this is a user account (no service account indicators)
            const userPayload = { ...payload };
            delete userPayload.service_account;
            delete userPayload.azp;

            // Act
            const isServiceAccount = extractor.isServiceAccount(userPayload);
            const context = extractor.extractUserContext(userPayload);

            // Assert - Regular user accounts should NOT be identified as service accounts
            expect(isServiceAccount).toBe(false);
            expect(context.isServiceAccount).toBe(false);

            // Assert - User identity should still be extracted correctly
            expect(context.userId).toBe(userPayload.sub);
            expect(context.username).toBe(userPayload.preferred_username);
            expect(context.email).toBe(userPayload.email);
            expect(context.roles).toEqual(userPayload.realm_access.roles);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract service account identity with client roles', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 30 }).map(
              suffix => `service-account-${suffix}`
            ),
            service_account: fc.constant(true),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('service', 'api-access', 'system'),
                { minLength: 1, maxLength: 5 }
              )
            }),
            resource_access: fc.dictionary(
              fc.constantFrom('api-service', 'backend', 'integration'),
              fc.record({
                roles: fc.array(
                  fc.constantFrom('service-role', 'api-client', 'system-access'),
                  { minLength: 1, maxLength: 3 }
                )
              }),
              { minKeys: 1, maxKeys: 3 }
            ),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.constantFrom('api-service', 'backend-api'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - Requirement 4.1: Accept JWT tokens issued for service accounts
            expect(context.isServiceAccount).toBe(true);

            // Assert - Requirement 4.2: Extract service account identity including client roles
            expect(context.userId).toBe(payload.sub);
            expect(context.username).toBe(payload.preferred_username);
            expect(context.roles).toEqual(payload.realm_access.roles);

            // Verify client roles are extracted for service accounts
            expect(Object.keys(context.clientRoles).length).toBe(Object.keys(payload.resource_access!).length);
            
            for (const [clientId, access] of Object.entries(payload.resource_access!)) {
              expect(context.clientRoles[clientId]).toEqual(access.roles);
              expect(context.clientRoles[clientId].length).toBeGreaterThan(0);
            }

            // Verify realm and token metadata
            expect(context.realm).toBeDefined();
            expect(context.tokenId).toBe(payload.jti);
            expect(context.expiresAt).toBeInstanceOf(Date);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle service accounts with minimal claims', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 30 }).map(
              suffix => `service-account-${suffix}`
            ),
            realm_access: fc.record({
              roles: fc.array(fc.string({ minLength: 3, maxLength: 20 }), { minLength: 0, maxLength: 3 })
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/test',
              'https://auth.company.com/realms/prod'
            ),
            aud: fc.string({ minLength: 5, maxLength: 20 }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act
            const context = extractor.extractUserContext(payload);

            // Assert - Service account should be identified even with minimal claims
            expect(context.isServiceAccount).toBe(true);

            // Assert - Required identity fields should be present
            expect(context.userId).toBe(payload.sub);
            expect(context.username).toBe(payload.preferred_username);
            expect(context.roles).toEqual(payload.realm_access.roles);
            expect(context.realm).toBeDefined();
            expect(context.tokenId).toBe(payload.jti);

            // Optional fields should be undefined or empty
            expect(context.email).toBeUndefined();
            expect(context.clientRoles).toEqual({});
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve service account identity across multiple extractions', () => {
      fc.assert(
        fc.property(
          fc.record({
            sub: fc.uuid(),
            preferred_username: fc.string({ minLength: 5, maxLength: 30 }).map(
              suffix => `service-account-${suffix}`
            ),
            service_account: fc.constant(true),
            realm_access: fc.record({
              roles: fc.array(
                fc.constantFrom('service', 'api-access', 'system'),
                { minLength: 1, maxLength: 5 }
              )
            }),
            iss: fc.constantFrom(
              'https://keycloak.example.com/realms/production',
              'https://auth.company.com/realms/staging'
            ),
            aud: fc.constantFrom('api-service', 'backend-api'),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
            jti: fc.uuid()
          }),
          (payload: JWTPayload) => {
            // Act - Extract context multiple times
            const context1 = extractor.extractUserContext(payload);
            const context2 = extractor.extractUserContext(payload);
            const context3 = extractor.extractUserContext(payload);

            // Assert - All extractions should produce identical results
            expect(context1.isServiceAccount).toBe(true);
            expect(context2.isServiceAccount).toBe(true);
            expect(context3.isServiceAccount).toBe(true);

            expect(context1.userId).toBe(context2.userId);
            expect(context2.userId).toBe(context3.userId);

            expect(context1.username).toBe(context2.username);
            expect(context2.username).toBe(context3.username);

            expect(context1.roles).toEqual(context2.roles);
            expect(context2.roles).toEqual(context3.roles);

            expect(context1.realm).toBe(context2.realm);
            expect(context2.realm).toBe(context3.realm);

            expect(context1.tokenId).toBe(context2.tokenId);
            expect(context2.tokenId).toBe(context3.tokenId);

            // Expiration times should be identical
            expect(context1.expiresAt.getTime()).toBe(context2.expiresAt.getTime());
            expect(context2.expiresAt.getTime()).toBe(context3.expiresAt.getTime());
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
