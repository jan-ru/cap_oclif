import type { NextFunction, Request, Response } from 'express';

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationAuditor, RateLimitConfig, SecurityAlert } from '../../src/auth/types.js';

import { createAuthenticationRateLimiter } from '../../src/auth/rate-limiter.js';

// Mock the logger
vi.mock('../../src/cli.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

describe('AuthenticationRateLimiter - Property Tests', () => {
  let mockAuditor: AuthenticationAuditor;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock auditor
    mockAuditor = {
      logAuthFailure: vi.fn(),
      logAuthSuccess: vi.fn(),
      logSecurityAlert: vi.fn(),
      logTokenExpiration: vi.fn()
    };
  });

  /**
   * Feature: keycloak-authentication, Property 13: Rate limiting protection
   * Validates: Requirements 7.2, 7.3
   * 
   * For any source IP making excessive authentication requests, the Authentication_Service 
   * should apply rate limiting and log security alerts
   */
  describe('Property 13: Rate limiting protection', () => {
    it('should enforce rate limits and log security alerts when exceeded', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random rate limit configurations
          fc.record({
            maxRequests: fc.integer({ max: 10, min: 2 }),
            skipSuccessfulRequests: fc.boolean(),
            windowMs: fc.integer({ max: 60_000, min: 10_000 })
          }),
          fc.ipV4().filter(ip => ip !== '0.0.0.0'),
          fc.string({ maxLength: 100, minLength: 10 }),
          fc.constantFrom('/api/reports', '/api/health'),
          async (config: RateLimitConfig, sourceIp: string, userAgent: string, endpoint: string) => {
            // Arrange
            vi.clearAllMocks();
            const rateLimiter = createAuthenticationRateLimiter(mockAuditor, config);
            const middleware = rateLimiter.getMiddleware();

            // Act - Make requests up to and beyond the limit
            const requestsToMake = config.maxRequests + 2;
            let rateLimitExceeded = false;
            let securityAlertLogged = false;

             
            for (let i = 0; i < requestsToMake; i++) {
              const mockReq: Partial<Request> = {
                headers: { 'user-agent': userAgent },
                ip: sourceIp,
                method: 'GET',
                originalUrl: endpoint,
                socket: { remoteAddress: sourceIp } as never
              };

              const mockRes: Partial<Response> = {
                get: vi.fn(),
                getHeader: vi.fn(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis()
              };

              const mockNext: NextFunction = vi.fn();

              // eslint-disable-next-line no-await-in-loop
              await new Promise<void>((resolve) => {
                const next = () => {
                  mockNext();
                  resolve();
                };

                const res = mockRes as Response;
                res.status = vi.fn().mockImplementation((code: number) => {
                  if (code === 429) {
                    rateLimitExceeded = true;
                  }

                  resolve();
                  return res;
                });
                
                middleware(mockReq as Request, res, next);
              });

              if (vi.mocked(mockAuditor.logSecurityAlert).mock.calls.length > 0) {
                securityAlertLogged = true;
                
                const securityAlert = vi.mocked(mockAuditor.logSecurityAlert).mock.calls[0]?.[0];
                expect(securityAlert).toBeDefined();
                expect(securityAlert?.type).toBe('RATE_LIMIT_EXCEEDED');
                expect(securityAlert?.severity).toBe('MEDIUM');
                expect(securityAlert?.sourceIp).toBe(sourceIp);
              }
            }

            // Assert
            expect(rateLimitExceeded).toBe(true);
            expect(securityAlertLogged).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should isolate rate limits per source IP', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            maxRequests: fc.integer({ max: 5, min: 3 }),
            skipSuccessfulRequests: fc.boolean(),
            windowMs: fc.integer({ max: 30_000, min: 10_000 })
          }),
          fc.array(fc.ipV4().filter(ip => ip !== '0.0.0.0'), { maxLength: 3, minLength: 2 }).map(ips => [...new Set(ips)]),
          fc.string({ maxLength: 100, minLength: 10 }),
          async (config: RateLimitConfig, sourceIps: string[], userAgent: string) => {
            // Arrange
            vi.clearAllMocks();
            const rateLimiter = createAuthenticationRateLimiter(mockAuditor, config);
            const middleware = rateLimiter.getMiddleware();

            const endpoint = '/api/reports';
            const method = 'GET';

            // Act
            const ipResults = new Map<string, boolean>();

             
            for (const ip of sourceIps) {
              let wasRateLimited = false;
              
               
              for (let i = 0; i <= config.maxRequests; i++) {
                const mockReq: Partial<Request> = {
                  headers: { 'user-agent': userAgent },
                  ip,
                  method,
                  originalUrl: endpoint,
                  socket: { remoteAddress: ip } as never
                };

                const mockRes: Partial<Response> = {
                  get: vi.fn(),
                  getHeader: vi.fn(),
                  json: vi.fn().mockReturnThis(),
                  setHeader: vi.fn().mockReturnThis(),
                  status: vi.fn().mockReturnThis()
                };

                const mockNext: NextFunction = vi.fn();

                // eslint-disable-next-line no-await-in-loop
                await new Promise<void>((resolve) => {
                  const next = () => {
                    mockNext();
                    resolve();
                  };

                  const res = mockRes as Response;
                  res.status = vi.fn().mockImplementation((code: number) => {
                    if (code === 429) {
                      wasRateLimited = true;
                    }

                    resolve();
                    return res;
                  });
                  
                  middleware(mockReq as Request, res, next);
                });
              }

              ipResults.set(ip, wasRateLimited);
            }

            // Assert
            for (const [, wasRateLimited] of ipResults.entries()) {
              expect(wasRateLimited).toBe(true);
            }

            const alertCalls = vi.mocked(mockAuditor.logSecurityAlert).mock.calls;
            expect(alertCalls.length).toBeGreaterThanOrEqual(sourceIps.length);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should include retry_after information in rate limit responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            maxRequests: fc.integer({ max: 5, min: 2 }),
            skipSuccessfulRequests: fc.boolean(),
            windowMs: fc.integer({ max: 60_000, min: 10_000 })
          }),
          fc.ipV4().filter(ip => ip !== '0.0.0.0'),
          async (config: RateLimitConfig, sourceIp: string) => {
            // Arrange
            vi.clearAllMocks();
            const rateLimiter = createAuthenticationRateLimiter(mockAuditor, config);
            const middleware = rateLimiter.getMiddleware();

            // Act
             
            for (let i = 0; i <= config.maxRequests; i++) {
              const mockReq: Partial<Request> = {
                headers: { 'user-agent': 'test-agent' },
                ip: sourceIp,
                method: 'POST',
                originalUrl: '/api/test',
                socket: { remoteAddress: sourceIp } as never
              };

              let responseData: null | Record<string, unknown> = null;
              const mockRes: Partial<Response> = {
                get: vi.fn(),
                getHeader: vi.fn(),
                json: vi.fn().mockImplementation((data: Record<string, unknown>) => {
                  responseData = data;
                  return mockRes;
                }),
                setHeader: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis()
              };

              const mockNext: NextFunction = vi.fn();

              // eslint-disable-next-line no-await-in-loop
              await new Promise<void>((resolve) => {
                const next = () => {
                  mockNext();
                  resolve();
                };

                const res = mockRes as Response;
                res.status = vi.fn().mockImplementation((code: number) => {
                  if (code === 429 && responseData) {
                    expect(responseData).toHaveProperty('retry_after');
                    expect(responseData.retry_after).toBeGreaterThan(0);
                    expect(responseData.retry_after).toBe(Math.ceil(config.windowMs / 1000));
                    expect(responseData).toHaveProperty('timestamp');
                  }

                  resolve();
                  return res;
                });
                
                middleware(mockReq as Request, res, next);
              });
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should log detailed information in security alerts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            maxRequests: fc.integer({ max: 3, min: 2 }),
            skipSuccessfulRequests: fc.boolean(),
            windowMs: fc.integer({ max: 30_000, min: 10_000 })
          }),
          fc.ipV4().filter(ip => ip !== '0.0.0.0'),
          fc.string({ maxLength: 100, minLength: 10 }),
          fc.constantFrom('/api/reports', '/api/health'),
          async (config: RateLimitConfig, sourceIp: string, userAgent: string, endpoint: string) => {
            // Arrange
            vi.clearAllMocks();
            const rateLimiter = createAuthenticationRateLimiter(mockAuditor, config);
            const middleware = rateLimiter.getMiddleware();

            // Act
             
            for (let i = 0; i <= config.maxRequests; i++) {
              const mockReq: Partial<Request> = {
                headers: { 'user-agent': userAgent },
                ip: sourceIp,
                method: 'GET',
                originalUrl: endpoint,
                socket: { remoteAddress: sourceIp } as never
              };

              const mockRes: Partial<Response> = {
                get: vi.fn(),
                getHeader: vi.fn(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis()
              };

              const mockNext: NextFunction = vi.fn();

              // eslint-disable-next-line no-await-in-loop
              await new Promise<void>((resolve) => {
                const next = () => {
                  mockNext();
                  resolve();
                };
                
                middleware(mockReq as Request, mockRes as Response, next);
                setTimeout(resolve, 10);
              });
            }

            // Assert
            const alertCalls = vi.mocked(mockAuditor.logSecurityAlert).mock.calls;
            expect(alertCalls.length).toBeGreaterThan(0);

            const securityAlert = alertCalls[0]?.[0] as SecurityAlert;
            expect(securityAlert).toBeDefined();
            expect(securityAlert.type).toBe('RATE_LIMIT_EXCEEDED');
            expect(securityAlert.severity).toBe('MEDIUM');
            expect(securityAlert.sourceIp).toBe(sourceIp);
            expect(securityAlert.timestamp).toBeInstanceOf(Date);
            
            expect(securityAlert.details).toBeDefined();
            expect(securityAlert.details.userAgent).toBe(userAgent);
            expect(securityAlert.details.endpoint).toBe(endpoint);
            expect(securityAlert.details.method).toBe('GET');
            expect(securityAlert.details.windowMs).toBe(config.windowMs);
            expect(securityAlert.details.maxRequests).toBe(config.maxRequests);
            expect(securityAlert.details.timestamp).toBeDefined();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle different client identification methods correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            maxRequests: fc.integer({ max: 5, min: 3 }),
            skipSuccessfulRequests: fc.boolean(),
            windowMs: fc.integer({ max: 30_000, min: 10_000 })
          }),
          fc.ipV4().filter(ip => ip !== '0.0.0.0'),
          fc.ipV4().filter(ip => ip !== '0.0.0.0'),
          async (config: RateLimitConfig, realIp: string, proxyIp: string) => {
            if (realIp === proxyIp) return;
            
            // Arrange
            vi.clearAllMocks();
            const rateLimiter = createAuthenticationRateLimiter(mockAuditor, config);
            const middleware = rateLimiter.getMiddleware();

            // Act
            let rateLimitTriggered = false;
             
            for (let i = 0; i <= config.maxRequests; i++) {
              const mockReqWithProxy: Partial<Request> = {
                headers: {
                  'user-agent': 'test-agent',
                  'x-forwarded-for': `${realIp}, ${proxyIp}`
                },
                ip: proxyIp,
                method: 'GET',
                originalUrl: '/api/test',
                socket: { remoteAddress: proxyIp } as never
              };

              const mockRes: Partial<Response> = {
                get: vi.fn(),
                getHeader: vi.fn(),
                json: vi.fn().mockReturnThis(),
                setHeader: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis()
              };

              const mockNext: NextFunction = vi.fn();

              // eslint-disable-next-line no-await-in-loop
              await new Promise<void>((resolve) => {
                const next = () => {
                  mockNext();
                  resolve();
                };

                const res = mockRes as Response;
                res.status = vi.fn().mockImplementation((code: number) => {
                  if (code === 429) {
                    rateLimitTriggered = true;
                    
                    const alertCalls = vi.mocked(mockAuditor.logSecurityAlert).mock.calls;
                    if (alertCalls.length > 0) {
                      const alert = alertCalls[0]?.[0];
                      expect(alert?.sourceIp).toBe(realIp);
                    }
                  }

                  resolve();
                  return res;
                });
                
                middleware(mockReqWithProxy as Request, res, next);
              });
            }

            expect(rateLimitTriggered).toBe(true);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
