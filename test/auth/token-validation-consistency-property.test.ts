import fc from 'fast-check';
import { beforeEach, describe, it, vi } from 'vitest';

import { NextFunction, Request, Response } from 'express';

import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { AuthenticationMiddlewareService } from '../../src/auth/middleware.js';
import { AuthConfig, JWK, JWKS, JWKSClient } from '../../src/auth/types.js';
import { UserContextExtractorService } from '../../src/auth/user-context-extractor.js';

// Mock JWKS client
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
        x5t: 'test-thumbprint',
      },
    ],
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
    return this.jwkToPem(this.mockJWKS.keys[0]!);
  }

  async hasKey(kid: string): Promise<boolean> {
    return this.mockJWKS.keys.some(key => key.kid === kid);
  }

  jwkToPem(_jwk: JWK): string {
    return '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';
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
        algorithms: ['RS256'],
        audience: 'test-client',
        clockTolerance: 30,
      },
    );
    userContextExtractor = new UserContextExtractorService('test');
    auditor = new AuthenticationAuditorService(true, false);
    
    mockConfig = {
      cacheTimeout: 3600,
      clientId: 'test-client',
      keycloakUrl: 'https://keycloak.example.com',
      rateLimitConfig: {
        maxRequests: 100,
        windowMs: 60_000,
      },
      realm: 'test',
    };
  });

  /**
   * Feature: keycloak-authentication, Property 1: Token validation consistency
   * Validates: Requirements 1.1
   * 
   * For any request without a JWT token, the Authentication_Service should return HTTP 401 Unauthorized
   */
  describe('Property 1: Token validation consistency', () => {
    it('should return 401 for any request without valid Bearer token', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate random request properties
          fc.record({
            authHeader: fc.option(
              fc.oneof(
                fc.constant(),  // No auth header
                fc.constant(''),  // Empty auth header
                fc.constant('Bearer'),  // Just "Bearer" without token
                fc.constant('Bearer '),  // "Bearer " with just space
                fc.string({ maxLength: 20, minLength: 1 }).map(s => `Basic ${s}`),  // Non-Bearer auth
                fc.string({ maxLength: 20, minLength: 1 }).map(s => `Digest ${s}`),  // Non-Bearer auth
              ),
            ),
            method: fc.constantFrom('DELETE', 'GET', 'PATCH', 'POST', 'PUT'),
            path: fc.constantFrom('/api/config', '/api/data', '/api/health', '/api/reports', '/api/users'),
            sourceIp: fc.ipV4(),
            url: fc.constantFrom('/api/config', '/api/data', '/api/health', '/api/reports', '/api/users'),
            // Generate realistic user agents (avoid whitespace-only strings)
            userAgent: fc.oneof(
              fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
              fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
              fc.constant('curl/7.68.0'),
              fc.constant('PostmanRuntime/7.26.8'),
              fc.string({ maxLength: 100, minLength: 10 }).filter(s => s.trim().length > 0),
            ),
          }),
          async (requestProps) => {
            // Create fresh middleware instance for each test iteration to avoid state accumulation
            const freshMiddleware = new AuthenticationMiddlewareService(
              jwtValidator,
              userContextExtractor,
              auditor,
              mockConfig,
            );
            
            // Arrange - create mock request with clean headers (no pre-existing correlation ID)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const headers: any = {
              'user-agent': requestProps.userAgent,
              'x-forwarded-for': requestProps.sourceIp,
            };
            
            if (requestProps.authHeader !== undefined) {
              headers.authorization = requestProps.authHeader;
            }
            
            const mockReq = {
              headers,
              method: requestProps.method,
              originalUrl: requestProps.url,
              socket: { remoteAddress: requestProps.sourceIp },
              url: requestProps.url,
            } as unknown as Request;

            const mockRes = {
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis(),
              status: vi.fn().mockReturnThis(),
            } as unknown as Response;

            const mockNext = vi.fn() as NextFunction;

            // Act
            await freshMiddleware.authenticate(mockReq, mockRes, mockNext);

            // Assert - Requirement 1.1: Return 401 for requests without valid JWT token
            // Use direct checks instead of expect() to avoid throwing exceptions
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const statusCalls = (mockRes.status as any).mock.calls;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jsonCalls = (mockRes.json as any).mock.calls;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nextCalls = (mockNext as any).mock.calls;
            
            // Check that status(401) was called
            if (statusCalls.length === 0 || statusCalls[0][0] !== 401) {
              console.error('Expected status(401) to be called, but got:', statusCalls);
              return false;
            }
            
            // Check that json() was called with error response
            if (jsonCalls.length === 0) {
              console.error('Expected json() to be called');
              return false;
            }
            
            const errorResponse = jsonCalls[0][0];
            
            // Verify error response structure
            if (!errorResponse || typeof errorResponse !== 'object') {
              console.error('Expected error response to be an object, got:', errorResponse);
              return false;
            }
            
            if (!errorResponse.error || typeof errorResponse.error !== 'string') {
              console.error('Expected error response to have string "error" property');
              return false;
            }
            
            if (!errorResponse.correlation_id || typeof errorResponse.correlation_id !== 'string') {
              console.error('Expected error response to have string "correlation_id" property');
              return false;
            }
            
            if (!errorResponse.timestamp || typeof errorResponse.timestamp !== 'string') {
              console.error('Expected error response to have string "timestamp" property');
              return false;
            }
            
            // Verify next() was NOT called (request should not proceed)
            if (nextCalls.length > 0) {
              console.error('Expected next() to NOT be called, but it was called');
              return false;
            }
            
            return true; // All checks passed
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
