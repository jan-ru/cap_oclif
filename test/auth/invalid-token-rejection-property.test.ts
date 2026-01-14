import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { AuthConfig, JWKSClient, JWKS, JWK } from '../../src/auth/types.js';

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

describe('AuthenticationMiddleware - Property Tests', () => {
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
   * Feature: keycloak-authentication, Property 2: Invalid token rejection
   * Validates: Requirements 1.2
   * 
   * For any request with an invalid JWT token, the Authentication_Service should return 
   * HTTP 401 Unauthorized with appropriate error details
   */
  describe('Property 2: Invalid token rejection', () => {
    it('should return 401 with error details for any invalid JWT token', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate random request properties with various invalid tokens
          fc.record({
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
            url: fc.constantFrom('/api/reports', '/api/health', '/api/data', '/api/users', '/api/config'),
            userAgent: fc.string({ minLength: 10, maxLength: 100 }),
            sourceIp: fc.ipV4(),
            // Generate various types of invalid JWT tokens
            invalidToken: fc.oneof(
              // Malformed structure - not 3 parts
              fc.string({ minLength: 10, maxLength: 50 }),
              fc.string({ minLength: 10, maxLength: 50 }).map(s => `${s}.${s}`),  // Only 2 parts
              fc.string({ minLength: 10, maxLength: 50 }).map(s => `${s}.${s}.${s}.${s}`),  // 4 parts
              
              // Invalid base64url encoding
              fc.string({ minLength: 10, maxLength: 50 }).map(s => `${s}!@#.${s}!@#.${s}!@#`),
              
              // Valid structure but invalid JSON in header/payload
              fc.constant('aW52YWxpZA.aW52YWxpZA.signature'),  // "invalid" base64 decoded
              
              // Valid JSON but missing required fields
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url') + '.' +
                'invalid_signature'
              ),
              
              // Missing typ in header
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
                'invalid_signature'
              ),
              
              // Wrong typ in header
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'WRONG' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ sub: 'user', iss: 'issuer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.' +
                'invalid_signature'
              ),
              
              // Missing required claims (sub, iss, exp)
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64url') + '.' +
                'invalid_signature'
              ),
              
              // Valid structure but invalid signature
              fc.constant(
                Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key-id' })).toString('base64url') + '.' +
                Buffer.from(JSON.stringify({ 
                  sub: 'user123', 
                  iss: 'https://keycloak.example.com/realms/test',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  iat: Math.floor(Date.now() / 1000),
                  preferred_username: 'testuser'
                })).toString('base64url') + '.' +
                'invalid_signature_that_wont_verify'
              ),
              
              // Empty parts
              fc.constant('..'),
              fc.constant('.payload.signature'),
              fc.constant('header..signature'),
              fc.constant('header.payload.')
            )
          }),
          async (requestProps) => {
            // Create fresh middleware instance for each test iteration
            const freshMiddleware = new AuthenticationMiddlewareService(
              jwtValidator,
              userContextExtractor,
              auditor,
              mockConfig
            );
            
            // Arrange - create mock request with invalid token
            const mockReq = {
              method: requestProps.method,
              url: requestProps.url,
              originalUrl: requestProps.url,
              headers: {
                'authorization': `Bearer ${requestProps.invalidToken}`,
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

            // Assert - Requirement 1.2: Return 401 for invalid JWT tokens with error details
            try {
              expect(mockRes.status).toHaveBeenCalledWith(401);
              expect(mockRes.json).toHaveBeenCalled();
              
              // Verify error response structure includes appropriate error details
              const errorResponse = (mockRes.json as any).mock.calls[0][0];
              expect(errorResponse).toHaveProperty('error');
              expect(errorResponse).toHaveProperty('correlation_id');
              expect(errorResponse).toHaveProperty('timestamp');
              
              // Verify error field is a non-empty string
              expect(typeof errorResponse.error).toBe('string');
              expect(errorResponse.error.length).toBeGreaterThan(0);
              
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
              console.error('Assertion failed for token:', requestProps.invalidToken.slice(0, 50));
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
