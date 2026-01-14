import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthConfigLoader } from '../../src/auth/config.js';
import { KeycloakAuthConfig } from '../../src/auth/types.js';

describe('AuthConfigLoader - Property Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment and cache before each test
    process.env = { ...originalEnv };
    (AuthConfigLoader as any).cachedConfig = null;
    (AuthConfigLoader as any).configWatchers = [];
  });

  /**
   * Feature: keycloak-authentication, Property 11: Configuration flexibility
   * Validates: Requirements 6.1, 6.2, 6.3
   * 
   * For any valid configuration parameters (URLs, timeouts, validation settings), 
   * the Authentication_Service should apply them correctly
   */
  describe('Property 11: Configuration flexibility', () => {
    it('should correctly apply any valid Keycloak URL configuration', () => {
      fc.assert(
        fc.property(
          // Generate random valid URLs with different schemes, domains, and ports
          fc.webUrl({ validSchemes: ['https'] }),
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), // Valid realm name
          (keycloakUrl, realm) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange - Set up environment with generated values
            process.env.KEYCLOAK_URL = keycloakUrl;
            process.env.KEYCLOAK_REALM = realm;
            process.env.JWT_ISSUER = `${keycloakUrl}/realms/${realm}`;

            // Act - Load configuration
            const config = AuthConfigLoader.loadConfig();

            // Assert - Requirement 6.1: Should support environment-based configuration for Keycloak URLs
            expect(config.keycloak.url).toBe(keycloakUrl);
            expect(config.keycloak.realm).toBe(realm);
            expect(config.jwt.issuer).toBe(`${keycloakUrl}/realms/${realm}`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply any valid JWT validation parameters', () => {
      fc.assert(
        fc.property(
          // Generate random JWT validation parameters
          fc.webUrl({ validSchemes: ['https'] }),
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          fc.constantFrom('RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'),
          fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          fc.integer({ min: 0, max: 300 }),
          (keycloakUrl, realm, algorithm, audience, clockTolerance) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = keycloakUrl;
            process.env.KEYCLOAK_REALM = realm;
            process.env.JWT_ISSUER = `${keycloakUrl}/realms/${realm}`;
            process.env.JWT_ALGORITHMS = algorithm;
            process.env.JWT_CLOCK_TOLERANCE = clockTolerance.toString();
            
            if (audience) {
              process.env.JWT_AUDIENCE = audience;
            } else {
              delete process.env.JWT_AUDIENCE;
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Requirement 6.2: Should support configurable JWT validation parameters
            expect(config.jwt.algorithms).toContain(algorithm);
            expect(config.jwt.clockTolerance).toBe(clockTolerance);
            
            if (audience) {
              expect(config.jwt.audience).toBe(audience);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply any valid JWKS cache timeout settings', () => {
      fc.assert(
        fc.property(
          // Generate random cache timeout values (1 second to 24 hours)
          fc.integer({ min: 1000, max: 86_400_000 }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 60 }),
          (cacheTimeout, rateLimit, requestsPerMinute) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
            process.env.KEYCLOAK_REALM = 'test-realm';
            process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
            process.env.JWKS_CACHE_TIMEOUT = cacheTimeout.toString();
            process.env.JWKS_RATE_LIMIT = rateLimit.toString();
            process.env.JWKS_REQUESTS_PER_MINUTE = requestsPerMinute.toString();

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Requirement 6.3: Should support configurable JWKS cache timeout settings
            expect(config.jwks.cacheTimeout).toBe(cacheTimeout);
            expect(config.jwks.rateLimit).toBe(rateLimit);
            expect(config.jwks.requestsPerMinute).toBe(requestsPerMinute);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply multiple JWT algorithms configuration', () => {
      fc.assert(
        fc.property(
          // Generate random combinations of valid algorithms
          fc.subarray(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'], { minLength: 1, maxLength: 6 }),
          (algorithms) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
            process.env.KEYCLOAK_REALM = 'test-realm';
            process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
            process.env.JWT_ALGORITHMS = algorithms.join(',');

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Requirement 6.2: Should support multiple JWT algorithms
            expect(config.jwt.algorithms).toEqual(algorithms);
            expect(config.jwt.algorithms.length).toBe(algorithms.length);
            
            // Verify all algorithms are present
            for (const alg of algorithms) {
              expect(config.jwt.algorithms).toContain(alg);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply security configuration parameters', () => {
      fc.assert(
        fc.property(
          // Generate random security parameters
          fc.integer({ min: 60_000, max: 3_600_000 }), // 1 minute to 1 hour
          fc.integer({ min: 10, max: 1000 }),
          fc.boolean(),
          fc.option(
            fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 5 })
              .filter(urls => urls.every(url => !url.includes(','))), // Filter out URLs with commas
            { nil: undefined }
          ),
          (windowMs, maxRequests, requireHttps, allowedOrigins) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
            process.env.KEYCLOAK_REALM = 'test-realm';
            process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
            process.env.RATE_LIMIT_WINDOW_MS = windowMs.toString();
            process.env.RATE_LIMIT_MAX_REQUESTS = maxRequests.toString();
            process.env.REQUIRE_HTTPS = requireHttps.toString();
            
            if (allowedOrigins) {
              process.env.ALLOWED_ORIGINS = allowedOrigins.join(',');
            } else {
              delete process.env.ALLOWED_ORIGINS;
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Should apply all security configuration correctly
            expect(config.security.rateLimitWindowMs).toBe(windowMs);
            expect(config.security.rateLimitMaxRequests).toBe(maxRequests);
            expect(config.security.requireHttps).toBe(requireHttps);
            
            if (allowedOrigins) {
              expect(config.security.allowedOrigins).toEqual(allowedOrigins);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply logging configuration parameters', () => {
      fc.assert(
        fc.property(
          // Generate random logging parameters
          fc.constantFrom('debug', 'info', 'warn', 'error'),
          fc.boolean(),
          fc.boolean(),
          (logLevel, auditEnabled, includeTokenClaims) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
            process.env.KEYCLOAK_REALM = 'test-realm';
            process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
            process.env.LOG_LEVEL = logLevel;
            process.env.AUDIT_ENABLED = auditEnabled.toString();
            process.env.INCLUDE_TOKEN_CLAIMS = includeTokenClaims.toString();

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Should apply all logging configuration correctly
            expect(config.logging.level).toBe(logLevel);
            expect(config.logging.auditEnabled).toBe(auditEnabled);
            expect(config.logging.includeTokenClaims).toBe(includeTokenClaims);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly apply optional client credentials configuration', () => {
      fc.assert(
        fc.property(
          // Generate random client credentials
          fc.option(fc.string({ minLength: 5, maxLength: 50 }), { nil: undefined }),
          fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
          (clientId, clientSecret) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
            process.env.KEYCLOAK_REALM = 'test-realm';
            process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
            
            if (clientId) {
              process.env.KEYCLOAK_CLIENT_ID = clientId;
            } else {
              delete process.env.KEYCLOAK_CLIENT_ID;
            }

            if (clientSecret) {
              process.env.KEYCLOAK_CLIENT_SECRET = clientSecret;
            } else {
              delete process.env.KEYCLOAK_CLIENT_SECRET;
            }

            // Act
            const config = AuthConfigLoader.loadConfig();

            // Assert - Should apply optional client credentials correctly
            if (clientId) {
              expect(config.keycloak.clientId).toBe(clientId);
            } else {
              expect(config.keycloak.clientId).toBeUndefined();
            }
            
            if (clientSecret) {
              expect(config.keycloak.clientSecret).toBe(clientSecret);
            } else {
              expect(config.keycloak.clientSecret).toBeUndefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate correct JWKS URI from any valid configuration', () => {
      fc.assert(
        fc.property(
          // Generate random URL and realm combinations
          fc.webUrl({ validSchemes: ['https'] }),
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          (keycloakUrl, realm) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = keycloakUrl;
            process.env.KEYCLOAK_REALM = realm;
            process.env.JWT_ISSUER = `${keycloakUrl}/realms/${realm}`;

            // Act
            const config = AuthConfigLoader.loadConfig();
            const jwksUri = AuthConfigLoader.getJwksUri(config);

            // Assert - Should generate correct JWKS URI from configuration
            const expectedBaseUrl = keycloakUrl.endsWith('/') 
              ? keycloakUrl.slice(0, -1) 
              : keycloakUrl;
            const expectedUri = `${expectedBaseUrl}/realms/${realm}/protocol/openid_connect/certs`;
            
            expect(jwksUri).toBe(expectedUri);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate correct token endpoint from any valid configuration', () => {
      fc.assert(
        fc.property(
          // Generate random URL and realm combinations
          fc.webUrl({ validSchemes: ['https'] }),
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          (keycloakUrl, realm) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = keycloakUrl;
            process.env.KEYCLOAK_REALM = realm;
            process.env.JWT_ISSUER = `${keycloakUrl}/realms/${realm}`;

            // Act
            const config = AuthConfigLoader.loadConfig();
            const tokenEndpoint = AuthConfigLoader.getTokenEndpoint(config);

            // Assert - Should generate correct token endpoint from configuration
            const expectedBaseUrl = keycloakUrl.endsWith('/') 
              ? keycloakUrl.slice(0, -1) 
              : keycloakUrl;
            const expectedEndpoint = `${expectedBaseUrl}/realms/${realm}/protocol/openid_connect/token`;
            
            expect(tokenEndpoint).toBe(expectedEndpoint);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain configuration consistency across reloads', () => {
      fc.assert(
        fc.property(
          // Generate random configuration values
          fc.webUrl({ validSchemes: ['https'] }),
          fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
          fc.integer({ min: 1000, max: 86_400_000 }),
          (keycloakUrl, realm, cacheTimeout) => {
            // Clear cache before each iteration
            (AuthConfigLoader as any).cachedConfig = null;
            
            // Arrange
            process.env.KEYCLOAK_URL = keycloakUrl;
            process.env.KEYCLOAK_REALM = realm;
            process.env.JWT_ISSUER = `${keycloakUrl}/realms/${realm}`;
            process.env.JWKS_CACHE_TIMEOUT = cacheTimeout.toString();

            // Act - Load configuration multiple times
            const config1 = AuthConfigLoader.loadConfig();
            const config2 = AuthConfigLoader.reloadConfig();
            const config3 = AuthConfigLoader.loadConfig();

            // Assert - All configurations should be identical
            expect(config2.keycloak.url).toBe(config1.keycloak.url);
            expect(config2.keycloak.realm).toBe(config1.keycloak.realm);
            expect(config2.jwks.cacheTimeout).toBe(config1.jwks.cacheTimeout);
            
            expect(config3.keycloak.url).toBe(config1.keycloak.url);
            expect(config3.keycloak.realm).toBe(config1.keycloak.realm);
            expect(config3.jwks.cacheTimeout).toBe(config1.jwks.cacheTimeout);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
