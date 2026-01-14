import { Request, Response, NextFunction } from 'express';
import { ClientCredentialsService, ServiceAccountCredentials } from './client-credentials-service.js';
import { JWTValidatorService } from './jwt-validator.js';
import { UserContextExtractorService } from './user-context-extractor.js';
import { AuthenticatedRequest, UserContext, KeycloakAuthConfig } from './types.js';
import { AuthConfigLoader } from './config.js';

/**
 * Helper service for integrating service account authentication with existing middleware
 * Provides utilities for automated workflows to authenticate using client credentials
 * 
 * Requirements implemented:
 * - 4.5: Support service account authentication for automated workflows
 * - 4.5: Handle service account token refresh
 */

export interface ServiceAccountAuthResult {
  success: boolean;
  userContext?: UserContext;
  token?: string;
  error?: string;
}

/**
 * Service Account Authentication Helper
 * Integrates client credentials flow with existing JWT validation pipeline
 */
export class ServiceAccountHelper {
  private clientCredentialsService: ClientCredentialsService;
  private jwtValidator: JWTValidatorService;
  private userContextExtractor: UserContextExtractorService;
  private config: KeycloakAuthConfig;

  constructor(
    clientCredentialsService?: ClientCredentialsService,
    jwtValidator?: JWTValidatorService,
    userContextExtractor?: UserContextExtractorService,
    config?: KeycloakAuthConfig
  ) {
    this.config = config || AuthConfigLoader.loadConfig();
    this.clientCredentialsService = clientCredentialsService || new ClientCredentialsService(this.config);
    
    // Create JWT validator if not provided
    if (!jwtValidator) {
      // We'll need to create a JWKS client for the JWT validator
      // For now, we'll assume it's provided or create a minimal one
      throw new Error('JWTValidator must be provided to ServiceAccountHelper');
    }

    this.jwtValidator = jwtValidator;
    
    this.userContextExtractor = userContextExtractor || new UserContextExtractorService();
  }

  /**
   * Authenticate service account and return user context
   * This method handles the full flow: acquire token -> validate -> extract context
   */
  async authenticateServiceAccount(credentials: ServiceAccountCredentials): Promise<ServiceAccountAuthResult> {
    try {
      // Validate credentials format
      this.clientCredentialsService.validateCredentials(credentials);

      // Step 1: Acquire or refresh service account token
      const tokenResponse = await this.clientCredentialsService.authenticateServiceAccount(credentials);

      // Step 2: Validate the acquired token using existing JWT validation
      const jwtPayload = await this.jwtValidator.validateToken(tokenResponse.access_token);

      // Step 3: Extract user context from validated token
      const userContext = this.userContextExtractor.extractUserContext(jwtPayload);

      // Verify this is actually a service account
      if (!userContext.isServiceAccount) {
        return {
          success: false,
          error: 'Acquired token is not for a service account'
        };
      }

      return {
        success: true,
        userContext,
        token: tokenResponse.access_token
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown authentication error'
      };
    }
  }

  /**
   * Create Express middleware for service account authentication
   * This middleware can be used to protect routes that should only be accessible by service accounts
   */
  createServiceAccountMiddleware(credentials: ServiceAccountCredentials) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const authResult = await this.authenticateServiceAccount(credentials);
        
        if (!authResult.success || !authResult.userContext) {
          res.status(401).json({
            error: 'service_account_authentication_failed',
            error_description: authResult.error || 'Service account authentication failed',
            correlation_id: req.headers['x-correlation-id'] || 'unknown',
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Attach service account context to request
        const authenticatedReq = req as AuthenticatedRequest;
        authenticatedReq.user = authResult.userContext;
        authenticatedReq.correlationId = req.headers['x-correlation-id'] as string || `sa_${Date.now()}`;
        authenticatedReq.authTimestamp = new Date();

        next();
      } catch {
        res.status(500).json({
          error: 'internal_server_error',
          error_description: 'Internal authentication error',
          correlation_id: req.headers['x-correlation-id'] || 'unknown',
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Get service account token for making authenticated API calls
   * Useful for automated workflows that need to call other services
   */
  async getServiceAccountToken(credentials: ServiceAccountCredentials): Promise<string> {
    const tokenResponse = await this.clientCredentialsService.authenticateServiceAccount(credentials);
    return tokenResponse.access_token;
  }

  /**
   * Refresh service account token if possible
   */
  async refreshServiceAccountToken(credentials: ServiceAccountCredentials): Promise<string> {
    // Get current cached token info
    const tokenInfo = this.clientCredentialsService.getTokenInfo(credentials);
    
    if (!tokenInfo.hasToken) {
      throw new Error('No cached token found to refresh');
    }

    if (!tokenInfo.canRefresh) {
      throw new Error('Token cannot be refreshed (no refresh token or refresh token expired)');
    }

    // Force a new authentication which will use refresh if available
    const tokenResponse = await this.clientCredentialsService.authenticateServiceAccount(credentials);
    return tokenResponse.access_token;
  }

  /**
   * Check if service account has valid token
   */
  hasValidToken(credentials: ServiceAccountCredentials): boolean {
    const tokenInfo = this.clientCredentialsService.getTokenInfo(credentials);
    return tokenInfo.hasToken;
  }

  /**
   * Get token expiration information
   */
  getTokenExpiration(credentials: ServiceAccountCredentials): Date | null {
    const tokenInfo = this.clientCredentialsService.getTokenInfo(credentials);
    return tokenInfo.expiresAt || null;
  }

  /**
   * Clear cached token for service account
   */
  clearToken(credentials: ServiceAccountCredentials): void {
    this.clientCredentialsService.clearCachedToken(credentials);
  }

  /**
   * Create service account credentials from environment variables
   */
  static createCredentialsFromEnv(serviceAccountName?: string): ServiceAccountCredentials {
    return ClientCredentialsService.createCredentialsFromEnv(serviceAccountName);
  }

  /**
   * Validate that a user context represents a service account
   */
  static validateServiceAccount(userContext: UserContext): void {
    if (!userContext.isServiceAccount) {
      throw new Error('User context does not represent a service account');
    }

    if (!userContext.userId || !userContext.username) {
      throw new Error('Service account context missing required identity information');
    }
  }

  /**
   * Create authorization header for service account
   */
  async createAuthorizationHeader(credentials: ServiceAccountCredentials): Promise<string> {
    const token = await this.getServiceAccountToken(credentials);
    return `Bearer ${token}`;
  }

  /**
   * Update configuration and clear cached tokens
   */
  updateConfig(config: KeycloakAuthConfig): void {
    this.config = config;
    this.clientCredentialsService.updateConfig(config);
  }
}

/**
 * Factory function to create ServiceAccountHelper with proper dependencies
 */
export async function createServiceAccountHelper(
  config?: KeycloakAuthConfig,
  jwtValidator?: JWTValidatorService
): Promise<ServiceAccountHelper> {
  const authConfig = config || AuthConfigLoader.loadConfig();
  
  if (!jwtValidator) {
    throw new Error('JWTValidator is required to create ServiceAccountHelper. Please provide a configured JWTValidator instance.');
  }

  const clientCredentialsService = new ClientCredentialsService(authConfig);
  const userContextExtractor = new UserContextExtractorService();

  return new ServiceAccountHelper(
    clientCredentialsService,
    jwtValidator,
    userContextExtractor,
    authConfig
  );
}