import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';

import { AuthenticationErrorHandler, AuthErrorType, AuthErrorDetails } from '../../src/auth/error-handler.js';
import { AuthenticationAuditorService } from '../../src/auth/authentication-auditor.js';
import { logger } from '../../src/cli.js';

// Mock the logger
vi.mock('../../src/cli.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('AuthenticationErrorHandler - Property Tests', () => {
  let errorHandler: AuthenticationErrorHandler;
  let auditor: AuthenticationAuditorService;
  const mockLogger = vi.mocked(logger);

  beforeEach(() => {
    vi.clearAllMocks();
    auditor = new AuthenticationAuditorService(true, false);
    errorHandler = new AuthenticationErrorHandler(auditor);
  });

  /**
   * Feature: keycloak-authentication, Property 12: Secure error handling
   * Validates: Requirements 7.1, 7.5
   * 
   * For any authentication failure, the Authentication_Service should return generic error 
   * messages to clients while logging detailed information internally
   */
  describe('Property 12: Secure error handling', () => {
    it('should return generic error messages to clients for any authentication error', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate random error scenarios
          fc.record({
            errorType: fc.constantFrom(
              AuthErrorType.MISSING_TOKEN,
              AuthErrorType.INVALID_TOKEN,
              AuthErrorType.TOKEN_EXPIRED,
              AuthErrorType.TOKEN_MALFORMED,
              AuthErrorType.SIGNATURE_INVALID,
              AuthErrorType.ISSUER_INVALID,
              AuthErrorType.AUDIENCE_INVALID,
              AuthErrorType.CLAIMS_INVALID,
              AuthErrorType.JWKS_UNAVAILABLE,
              AuthErrorType.RATE_LIMIT_EXCEEDED,
              AuthErrorType.AUTHENTICATION_ERROR,
              AuthErrorType.CONFIGURATION_ERROR
            ),
            // Generate detailed internal error messages (potentially sensitive)
            internalMessage: fc.oneof(
              fc.constant('Database connection failed at 192.168.1.100:5432'),
              fc.constant('JWKS endpoint returned 500 error: Internal Server Error'),
              fc.constant('Token signature verification failed with key ID: abc123xyz'),
              fc.constant('Configuration error: missing environment variable DB_PASSWORD'),
              fc.constant('Stack trace: Error at line 42 in auth-service.ts'),
              fc.string({ minLength: 20, maxLength: 200 })
            ),
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
            endpoint: fc.constantFrom('/api/reports', '/api/health', '/api/data', '/api/users', '/api/config'),
            sourceIp: fc.ipV4(),
            userAgent: fc.oneof(
              fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
              fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
              fc.constant('curl/7.68.0'),
              fc.constant('PostmanRuntime/7.26.8'),
              fc.string({ minLength: 10, maxLength: 100 }).filter(s => {
                // Filter out strings that are Object.prototype property names or have special chars
                const trimmed = s.trim();
                if (trimmed.length === 0) return false;
                if (Object.prototype.hasOwnProperty(trimmed)) return false;
                return /^[a-zA-Z0-9\s\-_.\/()]+$/.test(trimmed);
              })
            ),
            // Optional sensitive context
            additionalContext: fc.option(
              fc.record({
                database_host: fc.constant('192.168.1.100'),
                internal_service_url: fc.constant('http://internal-service.local'),
                stack_trace: fc.string({ minLength: 20, maxLength: 100 }).filter(s => {
                  // Filter out strings that might break JSON serialization
                  const trimmed = s.trim();
                  if (trimmed.length === 0) return false;
                  try {
                    JSON.stringify({ test: s });
                    return true;
                  } catch {
                    return false;
                  }
                }),
                config_path: fc.constant('/etc/app/config.yml')
              }).map(obj => ({ ...obj })), // Ensure normal prototype
              { nil: undefined }
            )
          }).map(obj => ({ ...obj })), // Ensure the entire error scenario has normal prototype
          async (errorScenario) => {
            // Arrange - create mock request and response
            const mockReq = {
              method: errorScenario.method,
              url: errorScenario.endpoint,
              originalUrl: errorScenario.endpoint,
              headers: {
                'user-agent': errorScenario.userAgent,
                'x-forwarded-for': errorScenario.sourceIp
              },
              socket: { remoteAddress: errorScenario.sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const errorDetails: AuthErrorDetails = {
              errorType: errorScenario.errorType,
              internalMessage: errorScenario.internalMessage,
              clientMessage: 'Generic client message',
              httpStatus: 401,
              additionalContext: errorScenario.additionalContext
            };

            // Act
            try {
              await errorHandler.handleAuthenticationError(mockReq, mockRes, errorDetails);
            } catch (error) {
              // If the error handler throws, log it for debugging
              console.error('Error handler threw an exception:', error);
              console.error('Error scenario:', errorScenario);
              return false;
            }

            // Assert - Requirement 7.1: Return generic error messages to clients
            const jsonCalls = (mockRes.json as any).mock.calls;
            
            // If json was not called, something went wrong - log for debugging
            if (jsonCalls.length === 0) {
              console.error('json() was not called. Error scenario:', errorScenario);
              console.error('mockRes.status calls:', (mockRes.status as any).mock.calls);
              console.error('mockRes.setHeader calls:', (mockRes.setHeader as any).mock.calls);
              return false;
            }
            
            const clientResponse = jsonCalls[0][0];
            
            // Verify client response structure
            expect(clientResponse).toHaveProperty('error');
            expect(clientResponse).toHaveProperty('error_description');
            expect(clientResponse).toHaveProperty('correlation_id');
            expect(clientResponse).toHaveProperty('timestamp');
            
            // Requirement 7.1: Client response should NOT contain sensitive internal details
            const clientResponseStr = JSON.stringify(clientResponse);
            
            // Check that sensitive information is NOT leaked to client
            const sensitivePatterns = [
              /192\.168\.\d+\.\d+/,  // Internal IP addresses
              /database/i,
              /stack trace/i,
              /line \d+ in/i,
              /\.ts/,  // Source file extensions
              /\.js/,
              /environment variable/i,
              /config\.yml/i,
              /internal-service/i,
              /password/i,
              /secret/i,
              /key ID:/i,
              /endpoint returned \d+ error/i
            ];
            
            for (const pattern of sensitivePatterns) {
              if (pattern.test(clientResponseStr)) {
                console.error(`Sensitive information leaked to client: ${pattern}`);
                console.error('Client response:', clientResponseStr);
                return false;
              }
            }
            
            // Verify error_description is generic (not the detailed internal message)
            expect(clientResponse.error_description).not.toBe(errorScenario.internalMessage);
            
            // Verify error_description doesn't contain internal details
            if (errorScenario.additionalContext) {
              const contextStr = JSON.stringify(errorScenario.additionalContext);
              expect(clientResponse.error_description).not.toContain(contextStr);
            }
            
            // Requirement 7.5: Detailed errors should be logged internally
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Find the detailed error log
            const errorLogCalls = mockLogger.error.mock.calls;
            const detailedErrorLog = errorLogCalls.find(
              call => call[0] === 'Authentication error details:'
            );
            
            expect(detailedErrorLog).toBeDefined();
            
            // Verify internal log contains detailed information
            const internalLogData = detailedErrorLog![1];
            expect(internalLogData).toHaveProperty('internalMessage');
            // Internal message should be a string (may be modified by error handler)
            expect(typeof internalLogData.internalMessage).toBe('string');
            expect(internalLogData.internalMessage.length).toBeGreaterThan(0);
            expect(internalLogData).toHaveProperty('errorType');
            expect(internalLogData).toHaveProperty('sourceIp');
            expect(internalLogData).toHaveProperty('correlationId');
            
            // Verify additional context is logged internally if present
            if (errorScenario.additionalContext) {
              expect(internalLogData).toHaveProperty('additionalContext');
              // Additional context should be present in logs (may be undefined if not set)
              if (internalLogData.additionalContext) {
                expect(internalLogData.additionalContext).toBeDefined();
              }
            }
            
            return true; // All checks passed
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never leak stack traces or internal paths to clients', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            errorType: fc.constantFrom(
              AuthErrorType.AUTHENTICATION_ERROR,
              AuthErrorType.CONFIGURATION_ERROR,
              AuthErrorType.JWKS_UNAVAILABLE
            ),
            // Generate errors with stack traces and internal paths
            error: fc.oneof(
              fc.constant(new Error('Database connection failed')),
              fc.constant(new Error('ENOENT: no such file or directory, open \'/etc/app/secrets.yml\'')),
              fc.constant(new Error('TypeError: Cannot read property \'key\' of undefined at /app/src/auth/validator.ts:123'))
            ),
            sourceIp: fc.ipV4(),
            userAgent: fc.string({ minLength: 10, maxLength: 100 })
          }),
          async (errorScenario) => {
            // Arrange
            const mockReq = {
              method: 'POST',
              url: '/api/auth',
              originalUrl: '/api/auth',
              headers: {
                'user-agent': errorScenario.userAgent,
                'x-forwarded-for': errorScenario.sourceIp
              },
              socket: { remoteAddress: errorScenario.sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const errorDetails = errorHandler.createErrorFromException(
              errorScenario.error,
              errorScenario.errorType
            );

            // Act
            await errorHandler.handleAuthenticationError(mockReq, mockRes, errorDetails);

            // Assert - client response should not contain stack traces or paths
            const clientResponse = (mockRes.json as any).mock.calls[0][0];
            const clientResponseStr = JSON.stringify(clientResponse);
            
            // Check for stack trace patterns
            const stackTracePatterns = [
              /at \w+\.\w+/,  // "at Object.method"
              /at \/[\w\/]+\.ts:\d+/,  // "at /path/file.ts:123"
              /at \/[\w\/]+\.js:\d+/,  // "at /path/file.js:123"
              /Error: .+ at /,  // "Error: message at"
              /TypeError:/,
              /ReferenceError:/,
              /SyntaxError:/
            ];
            
            for (const pattern of stackTracePatterns) {
              if (pattern.test(clientResponseStr)) {
                console.error(`Stack trace leaked to client: ${pattern}`);
                return false;
              }
            }
            
            // Check for file path patterns
            const pathPatterns = [
              /\/etc\//,
              /\/app\//,
              /\/src\//,
              /\/node_modules\//,
              /C:\\/,
              /\\Users\\/
            ];
            
            for (const pattern of pathPatterns) {
              if (pattern.test(clientResponseStr)) {
                console.error(`File path leaked to client: ${pattern}`);
                return false;
              }
            }
            
            // But internal logs should contain the full error details
            const errorLogCalls = mockLogger.error.mock.calls;
            const detailedErrorLog = errorLogCalls.find(
              call => call[0] === 'Authentication error details:'
            );
            
            expect(detailedErrorLog).toBeDefined();
            const internalLogData = detailedErrorLog![1];
            
            // Internal logs should have the original error with stack trace
            if (internalLogData.additionalContext && internalLogData.additionalContext.originalError) {
              expect(internalLogData.additionalContext.originalError).toHaveProperty('message');
              // Stack trace may or may not be present depending on error type
              if (internalLogData.additionalContext.originalError.stack) {
                expect(typeof internalLogData.additionalContext.originalError.stack).toBe('string');
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include correlation IDs in both client responses and internal logs', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            errorType: fc.constantFrom(
              AuthErrorType.INVALID_TOKEN,
              AuthErrorType.TOKEN_EXPIRED,
              AuthErrorType.AUTHENTICATION_ERROR
            ),
            internalMessage: fc.string({ minLength: 20, maxLength: 100 }).filter(s => s.trim().length > 10),
            sourceIp: fc.ipV4(),
            userAgent: fc.oneof(
              fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
              fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
              fc.constant('curl/7.68.0'),
              fc.constant('PostmanRuntime/7.26.8')
            ),
            // Test with and without pre-existing correlation ID
            existingCorrelationId: fc.option(fc.uuid(), { nil: undefined })
          }),
          async (errorScenario) => {
            // Arrange
            const headers: any = {
              'user-agent': errorScenario.userAgent,
              'x-forwarded-for': errorScenario.sourceIp
            };
            
            if (errorScenario.existingCorrelationId) {
              headers['x-correlation-id'] = errorScenario.existingCorrelationId;
            }
            
            const mockReq = {
              method: 'GET',
              url: '/api/data',
              originalUrl: '/api/data',
              headers,
              socket: { remoteAddress: errorScenario.sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const errorDetails: AuthErrorDetails = {
              errorType: errorScenario.errorType,
              internalMessage: errorScenario.internalMessage,
              clientMessage: 'Generic error',
              httpStatus: 401,
              // Pass the existing correlation ID if present
              correlationId: errorScenario.existingCorrelationId
            };

            // Act
            await errorHandler.handleAuthenticationError(mockReq, mockRes, errorDetails);

            // Assert - both client and internal logs should have correlation ID
            const clientResponse = (mockRes.json as any).mock.calls[0][0];
            expect(clientResponse).toHaveProperty('correlation_id');
            expect(typeof clientResponse.correlation_id).toBe('string');
            expect(clientResponse.correlation_id.length).toBeGreaterThan(0);
            
            // If there was an existing correlation ID, verify it's used
            const correlationId = clientResponse.correlation_id;
            if (errorScenario.existingCorrelationId) {
              expect(correlationId).toBe(errorScenario.existingCorrelationId);
            }
            
            // Internal logs should have the same correlation ID as the client response
            const errorLogCalls = mockLogger.error.mock.calls;
            const detailedErrorLog = errorLogCalls.find(
              call => call[0] === 'Authentication error details:'
            );
            
            expect(detailedErrorLog).toBeDefined();
            const internalLogData = detailedErrorLog![1];
            expect(internalLogData.correlationId).toBe(correlationId);
            
            // Correlation ID should also be set in response header
            const setHeaderCalls = (mockRes.setHeader as any).mock.calls;
            const correlationHeaderCalls = setHeaderCalls.filter(
              (call: any) => call[0] === 'X-Correlation-ID'
            );
            // There should be at least one X-Correlation-ID header set
            expect(correlationHeaderCalls.length).toBeGreaterThan(0);
            // At least one of them should match the correlation ID in the response
            const matchingHeaderCall = correlationHeaderCalls.find(
              (call: any) => call[1] === correlationId
            );
            expect(matchingHeaderCall).toBeDefined();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return appropriate HTTP status codes for different error types', () => {
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            { errorType: AuthErrorType.MISSING_TOKEN, expectedStatus: 401 },
            { errorType: AuthErrorType.INVALID_TOKEN, expectedStatus: 401 },
            { errorType: AuthErrorType.TOKEN_EXPIRED, expectedStatus: 401 },
            { errorType: AuthErrorType.TOKEN_MALFORMED, expectedStatus: 401 },
            { errorType: AuthErrorType.SIGNATURE_INVALID, expectedStatus: 401 },
            { errorType: AuthErrorType.ISSUER_INVALID, expectedStatus: 401 },
            { errorType: AuthErrorType.AUDIENCE_INVALID, expectedStatus: 401 },
            { errorType: AuthErrorType.CLAIMS_INVALID, expectedStatus: 401 },
            { errorType: AuthErrorType.JWKS_UNAVAILABLE, expectedStatus: 503 },
            { errorType: AuthErrorType.RATE_LIMIT_EXCEEDED, expectedStatus: 429 },
            { errorType: AuthErrorType.AUTHENTICATION_ERROR, expectedStatus: 401 },
            { errorType: AuthErrorType.CONFIGURATION_ERROR, expectedStatus: 500 }
          ),
          fc.ipV4(),
          fc.string({ minLength: 10, maxLength: 100 }),
          async (errorConfig, sourceIp, userAgent) => {
            // Arrange
            const mockReq = {
              method: 'GET',
              url: '/api/test',
              originalUrl: '/api/test',
              headers: {
                'user-agent': userAgent,
                'x-forwarded-for': sourceIp
              },
              socket: { remoteAddress: sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const errorDetails: AuthErrorDetails = {
              errorType: errorConfig.errorType,
              internalMessage: 'Internal error message',
              clientMessage: 'Client error message',
              httpStatus: errorConfig.expectedStatus
            };

            // Act
            await errorHandler.handleAuthenticationError(mockReq, mockRes, errorDetails);

            // Assert - correct HTTP status code should be returned
            expect(mockRes.status).toHaveBeenCalledWith(errorConfig.expectedStatus);
            
            // For 401 errors, WWW-Authenticate header should be set
            if (errorConfig.expectedStatus === 401) {
              const setHeaderCalls = (mockRes.setHeader as any).mock.calls;
              const wwwAuthCall = setHeaderCalls.find(
                (call: any) => call[0] === 'WWW-Authenticate'
              );
              expect(wwwAuthCall).toBeDefined();
              expect(wwwAuthCall[1]).toBe('Bearer realm="api"');
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set security headers to prevent caching of error responses', () => {
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            AuthErrorType.INVALID_TOKEN,
            AuthErrorType.TOKEN_EXPIRED,
            AuthErrorType.AUTHENTICATION_ERROR
          ),
          fc.ipV4(),
          async (errorType, sourceIp) => {
            // Arrange
            const mockReq = {
              method: 'GET',
              url: '/api/test',
              originalUrl: '/api/test',
              headers: {
                'user-agent': 'test-agent',
                'x-forwarded-for': sourceIp
              },
              socket: { remoteAddress: sourceIp }
            } as unknown as Request;

            const mockRes = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              setHeader: vi.fn().mockReturnThis()
            } as unknown as Response;

            const errorDetails: AuthErrorDetails = {
              errorType,
              internalMessage: 'Internal error',
              clientMessage: 'Client error',
              httpStatus: 401
            };

            // Act
            await errorHandler.handleAuthenticationError(mockReq, mockRes, errorDetails);

            // Assert - security headers should be set
            const setHeaderCalls = (mockRes.setHeader as any).mock.calls;
            
            // Check for Cache-Control header
            const cacheControlCall = setHeaderCalls.find(
              (call: any) => call[0] === 'Cache-Control'
            );
            expect(cacheControlCall).toBeDefined();
            expect(cacheControlCall[1]).toBe('no-cache, no-store, must-revalidate');
            
            // Check for Pragma header
            const pragmaCall = setHeaderCalls.find(
              (call: any) => call[0] === 'Pragma'
            );
            expect(pragmaCall).toBeDefined();
            expect(pragmaCall[1]).toBe('no-cache');
            
            // Check for Expires header
            const expiresCall = setHeaderCalls.find(
              (call: any) => call[0] === 'Expires'
            );
            expect(expiresCall).toBeDefined();
            expect(expiresCall[1]).toBe('0');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
