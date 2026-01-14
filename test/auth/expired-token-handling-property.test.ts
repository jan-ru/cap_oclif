import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { AuthConfig, JWKSClient, JWKS, JWK } from '../../src/auth/types.js';

// Generate a real RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Mock JWKS client that returns the real public key
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
    return publicKey;
  }

  async getSigningKey(_kid: string): Promise<string> {
    return publicKey;
  }

  async getAvailableKeyIds(): Promise<string[]> {
    return this.mockJWKS.keys.map(key => key.kid);
  }

  async hasKey(kid: string): Promise<boolean> {
    return this.mockJWKS.keys.some(key => key.kid === kid);
  }
}

describe('AuthenticationMiddleware - Expired Token Property Tests', () => {
  let mockJWKSClient: MockJWKSClient;
  let jwtValidator: JWTValidatorService;
  let userContextExtractor: UserContextExtractorService;
  let auditor: AuthenticationAuditorService;
  let mockConfig: AuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockJWKSClient = new MockJWKSClient();
    jwtValidator = new JWTValidatorService(
      mockJWKSClient,
      'https://keycloak.example.com/realms/test',
      {
        audience: 'test-client',
        clockTolerance: 30,
        algorithms: ['RS256']
      }
    );
    userContextExtractor = new UserContextExtractorService();
    auditor = new AuthenticationAuditorService(true, false);
    
    mockConfig = {
      keycloakUrl: 'https://keycloak.example.com',
      realm: 'test',
      clientId: 'test-client',
      cacheTimeout: 3600,
      rateLimitConfig: {
        windowMs: 60_000,
        maxRequests: 100
      }
    };
  });

  /**
   * Feature: keycloak-authentication, Property 3: Expired token handling
   * Validates: Requirements 1.3
   * 
   * For any request with an expired JWT token, the Authentication_Service should return 
   * HTTP 401 Unauthorized with expiration information
   */
  describe('Property 3: Expired token handling', () => {
    it('should return 401 with expiration information for any expired JWT token', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate random request properties with expired tokens
          fc.record({
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
            url: fc.constantFrom('/api/reports', '/api/health', '/api/data', '/api/users', '/api/config'),
            userAgent: fc.string({ minLength: 10, maxLength: 100 }),
            sourceIp: fc.ipV4(),
            // Generate expired tokens with various expiration times in the past
            expiredToken: fc.record({
              // Generate expiration times from 31 seconds (beyond clock tolerance) to 1 year in the past
              secondsExpired: fc.integer({ min: 31, max: 31_536_000 }), // 31 seconds to 1 year
              userId: fc.string({ minLength: 5, maxLength: 20 }),
              username: fc.string({ minLength: 3, maxLength: 20 }),
              email: fc.option(fc.emailAddress()),
              roles: fc.array(fc.string({ minLength: 3, maxLength: 15 }), { minLength: 0, maxLength: 5 })
            }).map(tokenData => {
              const now = Math.floor(Date.now() / 1000);
              const exp = now - tokenData.secondsExpired; // Expired in the past (beyond clock tolerance)
              const iat = exp - 3600; // Issued 1 hour before expiration
              
              // Create a properly structured JWT payload
              const payload = {
                sub: tokenData.userId,
                preferred_username: tokenData.username,
                email: tokenData.email,
                realm_access: {
                  roles: tokenData.roles
                },
                iss: 'https://keycloak.example.com/realms/test',
                aud: 'test-client',
                exp, // Expired timestamp
                iat,
                jti: `jti-${tokenData.userId}-${exp}`
              };
              
              // Sign the token with the real private key
              const token = jwt.sign(payload, privateKey, {
                algorithm: 'RS256',
                keyid: 'test-key-id'
              });
              
              return {
                token,
                expiredBy: tokenData.secondsExpired,
                userId: tokenData.userId
              };
            })
          }),
          async (requestProps) => {
            // Create fresh middleware instance for each test iteration
            const freshMiddleware = new AuthenticationMiddlewareService(
              jwtValidator,
              userContextExtractor,
              auditor,
              mockConfig
            );
            
            // Arrange - create mock request with expired token
            const mockReq = {
              method: requestProps.method,
              url: requestProps.url,
              originalUrl: requestProps.url,
              headers: {
                'authorization': `Bearer ${requestProps.expiredToken.token}`,
                'user-agent': requestProps.userAgent,
                'x-forwarded-for': requestProps.sourceIp
              },
              socket: { remoteAddress: requestProps.sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const mockNext = vi.fn() as NextFunction;

            // Act
            await freshMiddleware.authenticate(mockReq, mockRes, mockNext);

            // Assert - Requirement 1.3: Return 401 for expired JWT tokens with expiration information
            try {
              expect(mockRes.status).toHaveBeenCalledWith(401);
              expect(mockRes.json).toHaveBeenCalled();
              
              // Verify error response structure includes expiration information
              const errorResponse = (mockRes.json as any).mock.calls[0][0];
              expect(errorResponse).toHaveProperty('error');
              expect(errorResponse).toHaveProperty('correlation_id');
              expect(errorResponse).toHaveProperty('timestamp');
              
              // Verify error field contains expiration-related information
              expect(typeof errorResponse.error).toBe('string');
              expect(errorResponse.error.length).toBeGreaterThan(0);
              
              // The error message should indicate token expiration
              // It should contain words like "expired", "expiration", or similar
              const errorLower = errorResponse.error.toLowerCase();
              const hasExpirationInfo = 
                errorLower.includes('expired') || 
                errorLower.includes('expiration') ||
                errorLower.includes('expire');
              
              expect(hasExpirationInfo).toBe(true);
              
              // Verify correlation_id is present for tracing
              expect(typeof errorResponse.correlation_id).toBe('string');
              expect(errorResponse.correlation_id.length).toBeGreaterThan(0);
              
              // Verify timestamp is a valid ISO string
              expect(typeof errorResponse.timestamp).toBe('string');
              expect(() => new Date(errorResponse.timestamp)).not.toThrow();
              
              // Verify next() was NOT called (request should not proceed)
              expect(mockNext).not.toHaveBeenCalled();
              
              return true; // All assertions passed
            } catch (error) {
              console.error('Assertion failed for expired token (expired by', requestProps.expiredToken.expiredBy, 'seconds)');
              console.error('User ID:', requestProps.expiredToken.userId);
              console.error('Error:', error);
              return false; // Assertion failed
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
