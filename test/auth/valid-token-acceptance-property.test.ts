import { NextFunction, Request, Response } from 'express';
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { AuthConfig, AuthenticatedRequest, JWK, JWKS, JWKSClient } from '../../src/auth/types.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';

// Generate a real RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {
    format: 'pem',
    type: 'pkcs8'
  },
  publicKeyEncoding: {
    format: 'pem',
    type: 'spki'
  }
});

// Mock JWKS client that returns the real public key
class MockJWKSClient implements JWKSClient {
  private mockJWKS: JWKS = {
    keys: [
      {
        e: 'AQAB',
        kid: 'test-key-id',
        kty: 'RSA',
        n: 'test-modulus',
        use: 'sig',
        x5c: ['test-cert'],
        x5t: 'test-thumbprint'
      }
    ]
  };

  async fetchJWKS(): Promise<JWKS> {
    return this.mockJWKS;
  }

  async getAvailableKeyIds(): Promise<string[]> {
    return this.mockJWKS.keys.map(key => key.kid);
  }

  getCachedJWKS(): JWKS | null {
    return this.mockJWKS;
  }

  async getSigningKey(_kid: string): Promise<string> {
    return publicKey;
  }

  async hasKey(kid: string): Promise<boolean> {
    return this.mockJWKS.keys.some(key => key.kid === kid);
  }

  jwkToPem(_jwk: JWK): string {
    return publicKey;
  }
}

describe('AuthenticationMiddleware - Valid Token Acceptance Property Tests', () => {
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
        algorithms: ['RS256'],
        audience: 'test-client',
        clockTolerance: 30
      }
    );
    userContextExtractor = new UserContextExtractorService('test');
    auditor = new AuthenticationAuditorService(true, false);
    
    mockConfig = {
      cacheTimeout: 3600,
      clientId: 'test-client',
      keycloakUrl: 'https://keycloak.example.com',
      rateLimitConfig: {
        maxRequests: 100,
        windowMs: 60_000
      },
      realm: 'test'
    };
  });

  /**
   * Feature: keycloak-authentication, Property 4: Valid token acceptance
   * Validates: Requirements 1.4, 2.5
   * 
   * For any request with a valid JWT token, the Authentication_Service should allow 
   * the request to proceed and extract user context
   */
  describe('Property 4: Valid token acceptance', () => {
    it('should allow request to proceed and extract user context for any valid JWT token', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate random request properties with valid tokens
          fc.record({
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
            sourceIp: fc.ipV4(),
            url: fc.constantFrom('/api/reports', '/api/health', '/api/data', '/api/users', '/api/config'),
            userAgent: fc.string({ maxLength: 100, minLength: 10 }),
            // Generate valid tokens with various user data
            validToken: fc.record({
              clientRoles: fc.option(
                fc.dictionary(
                  fc.string({ maxLength: 20, minLength: 3 }),
                  fc.array(fc.string({ maxLength: 20, minLength: 3 }), { maxLength: 5, minLength: 1 })
                )
              ),
              email: fc.option(fc.emailAddress()),
              roles: fc.array(fc.string({ maxLength: 20, minLength: 3 }), { maxLength: 10, minLength: 0 }),
              userId: fc.string({ maxLength: 36, minLength: 5 }),
              username: fc.string({ maxLength: 30, minLength: 3 }),
              // Token valid for 1 hour to 24 hours in the future
              validForSeconds: fc.integer({ max: 86_400, min: 3600 })
            }).map(tokenData => {
              const now = Math.floor(Date.now() / 1000);
              const exp = now + tokenData.validForSeconds; // Valid in the future
              const iat = now;
              
              // Create a properly structured JWT payload
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const payload: any = {
                aud: 'test-client',
                exp,
                iat,
                iss: 'https://keycloak.example.com/realms/test',
                jti: `jti-${tokenData.userId}-${iat}`,
                // eslint-disable-next-line camelcase
                preferred_username: tokenData.username,
                // eslint-disable-next-line camelcase
                realm_access: {
                  roles: tokenData.roles
                },
                sub: tokenData.userId
              };
              
              // Add optional email
              if (tokenData.email) {
                payload.email = tokenData.email;
              }
              
              // Add optional client roles
              if (tokenData.clientRoles) {
                // eslint-disable-next-line camelcase
                payload.resource_access = {};
                for (const [clientId, roles] of Object.entries(tokenData.clientRoles)) {
                  payload.resource_access[clientId] = { roles };
                }
              }
              
              // Sign the token with the real private key
              const token = jwt.sign(payload, privateKey, {
                algorithm: 'RS256',
                keyid: 'test-key-id'
              });
              
              return {
                expectedClientRoles: tokenData.clientRoles || {},
                expectedEmail: tokenData.email,
                expectedRoles: tokenData.roles,
                expectedUserId: tokenData.userId,
                expectedUsername: tokenData.username,
                expiresAt: new Date(exp * 1000),
                token
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
            
            // Arrange - create mock request with valid token
            const mockReq = {
              headers: {
                'authorization': `Bearer ${requestProps.validToken.token}`,
                'user-agent': requestProps.userAgent,
                'x-forwarded-for': requestProps.sourceIp
              },
              method: requestProps.method,
              originalUrl: requestProps.url,
              socket: { remoteAddress: requestProps.sourceIp },
              url: requestProps.url
            } as unknown as Request;

            const mockRes = {
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis(),
              status: vi.fn().mockReturnThis()
            } as unknown as Response;

            const mockNext = vi.fn() as NextFunction;

            // Act
            await freshMiddleware.authenticate(mockReq, mockRes, mockNext);

            // Assert - Requirement 1.4: Allow valid JWT tokens to proceed
            // Requirement 2.5: Make user context available to downstream handlers
            try {
              // Verify next() was called (request should proceed)
              expect(mockNext).toHaveBeenCalledOnce();
              
              // Verify status() and json() were NOT called (no error response)
              expect(mockRes.status).not.toHaveBeenCalled();
              expect(mockRes.json).not.toHaveBeenCalled();
              
              // Verify user context was attached to request (Requirement 2.5)
              const authenticatedReq = mockReq as AuthenticatedRequest;
              expect(authenticatedReq.user).toBeDefined();
              
              // Verify user context contains expected user information
              expect(authenticatedReq.user.userId).toBe(requestProps.validToken.expectedUserId);
              expect(authenticatedReq.user.username).toBe(requestProps.validToken.expectedUsername);
              
              // Verify email if present
              if (requestProps.validToken.expectedEmail) {
                expect(authenticatedReq.user.email).toBe(requestProps.validToken.expectedEmail);
              }
              
              // Verify roles are extracted
              expect(authenticatedReq.user.roles).toEqual(requestProps.validToken.expectedRoles);
              
              // Verify realm is set
              expect(authenticatedReq.user.realm).toBe('test');
              
              // Verify token ID is present
              expect(authenticatedReq.user.tokenId).toBeDefined();
              expect(typeof authenticatedReq.user.tokenId).toBe('string');
              
              // Verify expiration date is set correctly
              expect(authenticatedReq.user.expiresAt).toBeInstanceOf(Date);
              expect(authenticatedReq.user.expiresAt.getTime()).toBe(requestProps.validToken.expiresAt.getTime());
              
              // Verify correlation ID was set
              expect(authenticatedReq.correlationId).toBeDefined();
              expect(typeof authenticatedReq.correlationId).toBe('string');
              
              // Verify auth timestamp was set
              expect(authenticatedReq.authTimestamp).toBeInstanceOf(Date);
              
              return true; // All assertions passed
            } catch (error) {
              console.error('Assertion failed for valid token');
              console.error('User ID:', requestProps.validToken.expectedUserId);
              console.error('Username:', requestProps.validToken.expectedUsername);
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
