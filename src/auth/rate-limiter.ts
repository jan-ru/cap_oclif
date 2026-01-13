import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { RateLimitConfig, SecurityAlert, AuthenticationAuditor } from './types.js';
import { logger } from '../cli.js';

/**
 * Rate limiting service for authentication attempts
 * Implements per-IP request limits to prevent brute force attacks
 * 
 * Requirements implemented:
 * - 7.2: Implement rate limiting for authentication attempts
 * - 7.3: Log security alerts when suspicious patterns detected
 */
export class AuthenticationRateLimiter {
  private rateLimitMiddleware: ReturnType<typeof rateLimit>;
  private auditor: AuthenticationAuditor;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig, auditor: AuthenticationAuditor) {
    this.config = config;
    this.auditor = auditor;
    this.rateLimitMiddleware = this.createRateLimitMiddleware();
  }

  /**
   * Get the Express rate limiting middleware
   */
  getMiddleware() {
    return this.rateLimitMiddleware;
  }

  /**
   * Create the rate limiting middleware with custom configuration
   * Requirement 7.2: Configure per-IP request limits
   */
  private createRateLimitMiddleware() {
    return rateLimit({
      windowMs: this.config.windowMs, // Time window in milliseconds
      max: this.config.maxRequests,   // Maximum requests per window
      
      // Skip successful requests if configured (only count failures)
      skip: (_req: Request) => {
        if (this.config.skipSuccessfulRequests) {
          // We'll determine this in the handler based on authentication result
          return false; // For now, count all requests
        }
        return false;
      },

      // Custom key generator to identify clients
      keyGenerator: (req: Request): string => {
        return this.getClientIdentifier(req);
      },

      // Custom handler for when rate limit is exceeded
      handler: (req: Request, res: Response, _next: NextFunction) => {
        const clientId = this.getClientIdentifier(req);
        const userAgent = req.headers['user-agent'] || 'unknown';
        
        // Log security alert for rate limit violation (Requirement 7.3)
        const securityAlert: SecurityAlert = {
          type: 'RATE_LIMIT_EXCEEDED',
          severity: 'MEDIUM',
          details: {
            clientId,
            userAgent,
            endpoint: req.originalUrl,
            method: req.method,
            windowMs: this.config.windowMs,
            maxRequests: this.config.maxRequests,
            timestamp: new Date().toISOString()
          },
          sourceIp: this.getClientIp(req),
          timestamp: new Date()
        };

        this.auditor.logSecurityAlert(securityAlert);

        // Log the rate limit violation
        logger.warn(`Rate limit exceeded for ${clientId} on ${req.method} ${req.originalUrl}`);

        // Return rate limit error response
        res.status(429).json({
          error: 'too_many_requests',
          error_description: 'Too many authentication attempts. Please try again later.',
          retry_after: Math.ceil(this.config.windowMs / 1000), // Convert to seconds
          timestamp: new Date().toISOString()
        });
      },

      // Headers to include in response
      standardHeaders: true, // Include standard rate limit headers
      legacyHeaders: false,  // Disable legacy X-RateLimit-* headers

      // Custom message for rate limit responses
      message: {
        error: 'too_many_requests',
        error_description: 'Too many authentication attempts. Please try again later.'
      }
    });
  }

  /**
   * Generate a unique identifier for the client
   * Uses IP address as primary identifier with fallbacks
   */
  private getClientIdentifier(req: Request): string {
    const ip = this.getClientIp(req);
    
    // For additional security, we could also consider:
    // - User-Agent string (but this can be spoofed)
    // - X-Forwarded-For chain analysis
    // - Combination of IP + User-Agent hash
    
    return ip;
  }

  /**
   * Extract client IP address from request
   * Handles various proxy headers to get the real client IP
   */
  private getClientIp(req: Request): string {
    // Check various headers for the real client IP
    const xForwardedFor = req.headers['x-forwarded-for'];
    const xRealIp = req.headers['x-real-ip'];
    const xClientIp = req.headers['x-client-ip'];
    
    if (xForwardedFor && typeof xForwardedFor === 'string') {
      // X-Forwarded-For can contain multiple IPs, take the first one (original client)
      const firstIp = xForwardedFor.split(',')[0]?.trim();
      if (firstIp) {
        return firstIp;
      }
    }
    
    if (xRealIp && typeof xRealIp === 'string') {
      return xRealIp;
    }
    
    if (xClientIp && typeof xClientIp === 'string') {
      return xClientIp;
    }
    
    // Fallback to socket remote address
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Update rate limiting configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    // Note: Updating config requires recreating the middleware
    // This would typically be done during application restart
    logger.info('Rate limiting configuration updated. Restart required for changes to take effect.');
  }

  /**
   * Get current rate limiting statistics (for monitoring)
   */
  getStats(): { config: RateLimitConfig } {
    return {
      config: { ...this.config }
    };
  }
}

/**
 * Factory function to create authentication rate limiter with default config
 */
export function createAuthenticationRateLimiter(
  auditor: AuthenticationAuditor,
  customConfig?: Partial<RateLimitConfig>
): AuthenticationRateLimiter {
  const defaultConfig: RateLimitConfig = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,           // 10 attempts per window
    skipSuccessfulRequests: false // Count all requests by default
  };

  const config = { ...defaultConfig, ...customConfig };
  
  return new AuthenticationRateLimiter(config, auditor);
}