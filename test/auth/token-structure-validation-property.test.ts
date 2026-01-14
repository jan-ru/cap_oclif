import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { JWKSClient, JWKS, JWK } from '../../src/auth/types.js';

// Mock JWKS client
class MockJWKSClient implements JWKSClient {
  private mockJWKS: JWKS = {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        kid: 'test-key-id',
        x5t: 'test-thumbprint',
        n: 'test-modulus',
        e: 'AQAB',
        x5c: ['test-cert']
      }
    ]
  };

  async fetchJWKS(): Promise<JWKS> {
    return this.mockJWKS;
  }

  getCachedJWKS(): JWKS | null {
    return this.mockJWKS;
  }

  jwkToPem(_jwk: JWK): string {
    return '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';
  }

  async getSigningKey(_kid: string): Promise<string> {
    return this.jwkToPem(this.mockJWKS.keys[0]!);
  }

  async getAvailableKeyIds(): Promise<string[]> {
    return this.mockJWKS.keys.map(key => key.kid);
  }

  async hasKey(kid: string): Promise<boolean> {
    return this.mockJWKS.keys.some(key => key.kid === kid);
  }
}

describe('JWTValidator - Property Tests', () => {
  let mockJWKSClient: MockJWKSClient;
  let jwtValidator: JWTValidatorService;
  let auditor: AuthenticationAuditorService;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockJWKSClient = new MockJWKSClient();
    auditor = new AuthenticationAuditorService(true, false);
    jwtValidator = new JWTValidatorService(
      mockJWKSClient,
      'https://keycloak.example.com/realms/test',
      {
        audience: 'test-client',
        clockTolerance: 30,
        algorithms: ['RS256'],
        auditor
      }
    );
  });

  /**
   * Feature: keycloak-authentication, Property 14: Token structure validation
   * Validates: Requirements 7.4
   * 
   * For any malformed JWT token, the Authentication_Service should reject it before 
   * attempting signature verification
   */
  describe('Property 14: Token structure validation', () => {
    it('should reject any malformed JWT token before signature verification', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate various types of malformed JWT tokens
          fc.oneof(
            // Non-string tokens
            fc.constant(null as any),
            fc.constant(undefined as any),
            fc.constant(123 as any),
            fc.constant({} as any),
            fc.constant([] as any),
            
            // Empty or whitespace-only strings
            fc.constant(''),
            fc.constant('   '),
            fc.constant('\t\n'),
            
            // Wrong number of parts (not exactly 3)
            fc.string({ minLength: 5, maxLength: 50 }).map(s => s), // No dots
            fc.string({ minLength: 5, maxLength: 50 }).map(s => `${s}.`), // 1 dot
            fc.string({ minLength: 5, maxLength: 50 }).map(s => `${s}.${s}`), // 2 parts
            fc.string({ minLength: 5, maxLength: 50 }).map(s => `${s}.${s}.${s}.${s}`), // 4 parts
            fc.string({ minLength: 5, maxLength: 50 }).map(s => `${s}.${s}.${s}.${s}.${s}`), // 5 parts
            
            // Empty parts
            fc.constant('..'),
            fc.constant('.payload.signature'),
            fc.constant('header..signature'),
            fc.constant('header.payload.'),
            fc.constant('.payload.'),
            fc.constant('..signature'),
            
            // Invalid base64url characters (contains special chars not allowed in base64url)
            fc.string({ minLength: 10, maxLength: 30 }).map(s => `${s}!@#$%^&*().${s}.${s}`),
            fc.string({ minLength: 10, maxLength: 30 }).map(s => `${s}.${s}+/=.${s}`),
            fc.string({ minLength: 10, maxLength: 30 }).map(s => `${s}.${s}.${s} with spaces`),
            
            // Valid base64url but invalid JSON in header
            fc.constant('aW52YWxpZEpzb24.eyJzdWIiOiJ0ZXN0In0.signature'), // "invalidJson" decoded
            fc.constant('bm90anNvbg.eyJzdWIiOiJ0ZXN0In0.signature'), // "notjson" decoded
            
            // Valid JSON but missing required header fields (alg)
            fc.constant(
              Buffer.from(JSON.stringify({ typ: 'JWT' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Valid JSON but missing required header fields (typ)
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Valid JSON but wrong typ value
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'WRONG' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWE' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Valid header but invalid JSON in payload
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
              'aW52YWxpZEpzb24' + '.' + // "invalidJson" in base64url
              'signature'
            ),
            
            // Valid header and JSON payload but missing required claims (sub)
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Valid header and JSON payload but missing required claims (iss)
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Valid header and JSON payload but missing required claims (exp)
            fc.constant(
              Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
              Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer' })).toString('base64url') + '.' +
              'signature'
            ),
            
            // Random combinations of invalid characters and structures
            fc.tuple(
              fc.string({ minLength: 5, maxLength: 20 }),
              fc.string({ minLength: 5, maxLength: 20 }),
              fc.string({ minLength: 5, maxLength: 20 })
            ).map(([a, b, c]) => `${a}@#$.${b}!&*.${c}%^&`)
          ),
          async (malformedToken) => {
            // Act - attempt to validate the malformed token
            try {
              await jwtValidator.validateToken(malformedToken, '192.168.1.1');
              
              // If we reach here, the token was not rejected (test failure)
              return false;
            } catch (error) {
              // Assert - Requirement 7.4: Token should be rejected before signature verification
              // The error should be about token structure, not signature verification
              const errorMessage = error instanceof Error ? error.message : String(error);
              
              // Verify the error is related to token structure validation
              const isStructureError = 
                errorMessage.includes('Token must be a non-empty string') ||
                errorMessage.includes('JWT must have exactly 3 parts') ||
                errorMessage.includes('is empty') ||
                errorMessage.includes('contains invalid characters') ||
                errorMessage.includes('malformed JSON') ||
                errorMessage.includes('missing required fields') ||
                errorMessage.includes('typ must be JWT') ||
                errorMessage.includes('missing required claims') ||
                errorMessage.includes('Invalid token structure') ||
                errorMessage.includes('Invalid token header') ||
                errorMessage.includes('Invalid token payload');
              
              // The error should be a structure validation error, not a signature verification error
              // This proves we're validating structure BEFORE attempting signature verification
              expect(isStructureError).toBe(true);
              
              // Verify error is thrown (not just logged)
              expect(error).toBeDefined();
              
              return true; // Test passed - malformed token was rejected
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should log security alerts for malformed tokens', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate malformed tokens that should trigger security alerts
          fc.record({
            token: fc.oneof(
              fc.constant(''),
              fc.constant('invalid.token'),
              fc.constant('..'),
              fc.constant('invalid@chars.payload.signature'),
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'WRONG' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
                'signature'
              )
            ),
            sourceIp: fc.ipV4()
          }),
          async ({ token, sourceIp }) => {
            // Create fresh auditor for each test iteration to avoid state pollution
            const freshAuditor = new AuthenticationAuditorService(true, false);
            const freshValidator = new JWTValidatorService(
              mockJWKSClient,
              'https://keycloak.example.com/realms/test',
              {
                audience: 'test-client',
                clockTolerance: 30,
                algorithms: ['RS256'],
                auditor: freshAuditor
              }
            );
            
            // Spy on the auditor's logSecurityAlert method
            const logSecurityAlertSpy = vi.spyOn(freshAuditor, 'logSecurityAlert');
            
            // Act - attempt to validate the malformed token
            try {
              await freshValidator.validateToken(token, sourceIp);
            } catch {
              // Expected to throw
            }
            
            // Assert - Requirement 7.3: Security alerts should be logged for malformed tokens
            // Verify that a security alert was logged
            expect(logSecurityAlertSpy).toHaveBeenCalled();
            
            // Verify the alert has the correct type
            const alertCall = logSecurityAlertSpy.mock.calls[0];
            if (alertCall) {
              const alert = alertCall[0];
              expect(alert.type).toBe('INVALID_TOKEN_STRUCTURE');
              expect(alert.sourceIp).toBe(sourceIp);
              expect(alert.severity).toBe('MEDIUM');
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
