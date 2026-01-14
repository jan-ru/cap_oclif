import { KeycloakAuthConfig } from './types.js';
import { AuthConfigLoader } from './config.js';

/**
 * Service account authentication using OAuth 2.0 Client Credentials flow
 * Handles service account token acquisition and refresh for automated workflows
 * 
 * Requirements implemented:
 * - 4.5: Support client credentials flow for service account authentication
 * - 4.5: Handle service account token refresh
 */

export interface ClientCredentialsToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in?: number;
  refresh_token?: string;
  not_before_policy?: number;
  session_state?: string;
  scope?: string;
}

export interface ServiceAccountCredentials {
  clientId: string;
  clientSecret: string;
  realm?: string;
  scope?: string;
}

export interface CachedToken {
  token: ClientCredentialsToken;
  expiresAt: Date;
  refreshExpiresAt?: Date;
}

/**
 * Client Credentials Flow Service for Service Account Authentication
 * Implements OAuth 2.0 Client Credentials grant type for machine-to-machine authentication
 */
export class ClientCredentialsService {
  private config: KeycloakAuthConfig;
  private tokenCache: Map<string, CachedToken> = new Map();
  private readonly REFRESH_BUFFER_SECONDS = 30; // Refresh token 30 seconds before expiry

  constructor(config?: KeycloakAuthConfig) {
    this.config = config || AuthConfigLoader.loadConfig();
  }

  /**
   * Authenticate service account using client credentials flow
   * Requirements: 4.5 - Support service account authentication for automated workflows
   */
  async authenticateServiceAccount(credentials: ServiceAccountCredentials): Promise<ClientCredentialsToken> {
    const cacheKey = this.getCacheKey(credentials);
    
    // Check if we have a valid cached token
    const cachedToken = this.getCachedToken(cacheKey);
    if (cachedToken && this.isTokenValid(cachedToken)) {
      return cachedToken.token;
    }

    // Check if we can refresh the token instead of getting a new one
    if (cachedToken && cachedToken.token.refresh_token && this.canRefreshToken(cachedToken)) {
      try {
        const refreshedToken = await this.refreshServiceAccountToken(credentials, cachedToken.token.refresh_token);
        return refreshedToken;
      } catch (error) {
        // If refresh fails, fall back to getting a new token
        console.warn('Token refresh failed, acquiring new token:', error);
      }
    }

    // Acquire new token using client credentials flow
    return this.acquireNewToken(credentials);
  }

  /**
   * Refresh service account token using refresh token
   * Requirements: 4.5 - Handle service account token refresh
   */
  async refreshServiceAccountToken(credentials: ServiceAccountCredentials, refreshToken: string): Promise<ClientCredentialsToken> {
    const tokenEndpoint = this.getTokenEndpoint(credentials.realm);
    
    const requestBody = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken
    });

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: requestBody.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const tokenResponse: ClientCredentialsToken = await response.json();
      
      // Cache the refreshed token
      const cacheKey = this.getCacheKey(credentials);
      this.cacheToken(cacheKey, tokenResponse);
      
      return tokenResponse;
    } catch (error) {
      throw new Error(`Failed to refresh service account token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Acquire new token using client credentials flow
   */
  private async acquireNewToken(credentials: ServiceAccountCredentials): Promise<ClientCredentialsToken> {
    const tokenEndpoint = this.getTokenEndpoint(credentials.realm);
    
    const requestBody = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret
    });

    // Add scope if provided
    if (credentials.scope) {
      requestBody.append('scope', credentials.scope);
    }

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: requestBody.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token acquisition failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const tokenResponse: ClientCredentialsToken = await response.json();
      
      // Cache the new token
      const cacheKey = this.getCacheKey(credentials);
      this.cacheToken(cacheKey, tokenResponse);
      
      return tokenResponse;
    } catch (error) {
      throw new Error(`Failed to acquire service account token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get token endpoint URL for the specified realm
   */
  private getTokenEndpoint(realmName?: string): string {
    return AuthConfigLoader.getTokenEndpoint(this.config, realmName);
  }

  /**
   * Generate cache key for token storage
   */
  private getCacheKey(credentials: ServiceAccountCredentials): string {
    const realm = credentials.realm || this.config.keycloak.realm;
    return `${realm}:${credentials.clientId}`;
  }

  /**
   * Cache token with expiration information
   */
  private cacheToken(cacheKey: string, token: ClientCredentialsToken): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (token.expires_in * 1000));
    
    const cachedToken: CachedToken = {
      token,
      expiresAt
    };

    // Add refresh token expiration if available
    if (token.refresh_expires_in) {
      cachedToken.refreshExpiresAt = new Date(now.getTime() + (token.refresh_expires_in * 1000));
    }

    this.tokenCache.set(cacheKey, cachedToken);
  }

  /**
   * Get cached token if available
   */
  private getCachedToken(cacheKey: string): CachedToken | null {
    return this.tokenCache.get(cacheKey) || null;
  }

  /**
   * Check if cached token is still valid (not expired)
   */
  private isTokenValid(cachedToken: CachedToken): boolean {
    const now = new Date();
    const bufferTime = new Date(cachedToken.expiresAt.getTime() - (this.REFRESH_BUFFER_SECONDS * 1000));
    return now < bufferTime;
  }

  /**
   * Check if token can be refreshed (refresh token exists and not expired)
   */
  private canRefreshToken(cachedToken: CachedToken): boolean {
    if (!cachedToken.token.refresh_token || !cachedToken.refreshExpiresAt) {
      return false;
    }
    
    const now = new Date();
    return now < cachedToken.refreshExpiresAt;
  }

  /**
   * Clear cached token for specific credentials
   */
  clearCachedToken(credentials: ServiceAccountCredentials): void {
    const cacheKey = this.getCacheKey(credentials);
    this.tokenCache.delete(cacheKey);
  }

  /**
   * Clear all cached tokens
   */
  clearAllCachedTokens(): void {
    this.tokenCache.clear();
  }

  /**
   * Get token expiration information for monitoring
   */
  getTokenInfo(credentials: ServiceAccountCredentials): { 
    hasToken: boolean; 
    expiresAt?: Date | undefined; 
    canRefresh: boolean;
    refreshExpiresAt?: Date | undefined;
  } {
    const cacheKey = this.getCacheKey(credentials);
    const cachedToken = this.getCachedToken(cacheKey);
    
    if (!cachedToken) {
      return { hasToken: false, canRefresh: false };
    }

    return {
      hasToken: true,
      expiresAt: cachedToken.expiresAt,
      canRefresh: this.canRefreshToken(cachedToken),
      refreshExpiresAt: cachedToken.refreshExpiresAt
    };
  }

  /**
   * Validate service account credentials format
   */
  validateCredentials(credentials: ServiceAccountCredentials): void {
    if (!credentials.clientId || typeof credentials.clientId !== 'string') {
      throw new Error('Service account credentials must include a valid clientId');
    }

    if (!credentials.clientSecret || typeof credentials.clientSecret !== 'string') {
      throw new Error('Service account credentials must include a valid clientSecret');
    }

    // Validate realm if provided
    if (credentials.realm) {
      const availableRealms = AuthConfigLoader.getAvailableRealms(this.config);
      if (!availableRealms.includes(credentials.realm)) {
        throw new Error(`Invalid realm: ${credentials.realm}. Available realms: ${availableRealms.join(', ')}`);
      }
    }

    // Validate scope format if provided
    if (credentials.scope && typeof credentials.scope !== 'string') {
      throw new Error('Service account scope must be a string');
    }
  }

  /**
   * Create service account credentials from environment variables
   * Supports multiple service accounts with indexed environment variables
   */
  static createCredentialsFromEnv(serviceAccountName?: string): ServiceAccountCredentials {
    let clientId: string;
    let clientSecret: string;
    let realm: string | undefined;
    let scope: string | undefined;

    if (serviceAccountName) {
      // Load specific service account by name
      const envPrefix = `SERVICE_ACCOUNT_${serviceAccountName.toUpperCase()}`;
      clientId = process.env[`${envPrefix}_CLIENT_ID`] || '';
      clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`] || '';
      realm = process.env[`${envPrefix}_REALM`];
      scope = process.env[`${envPrefix}_SCOPE`];
    } else {
      // Load default service account
      clientId = process.env.SERVICE_ACCOUNT_CLIENT_ID || '';
      clientSecret = process.env.SERVICE_ACCOUNT_CLIENT_SECRET || '';
      realm = process.env.SERVICE_ACCOUNT_REALM;
      scope = process.env.SERVICE_ACCOUNT_SCOPE;
    }

    if (!clientId || !clientSecret) {
      const prefix = serviceAccountName ? `SERVICE_ACCOUNT_${serviceAccountName.toUpperCase()}_` : 'SERVICE_ACCOUNT_';
      throw new Error(`Service account credentials not found. Set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET environment variables.`);
    }

    const credentials: ServiceAccountCredentials = {
      clientId,
      clientSecret
    };

    if (realm) {
      credentials.realm = realm;
    }

    if (scope) {
      credentials.scope = scope;
    }

    return credentials;
  }

  /**
   * Update configuration (useful for runtime config changes)
   */
  updateConfig(config: KeycloakAuthConfig): void {
    this.config = config;
    // Clear cache when config changes as endpoints might have changed
    this.clearAllCachedTokens();
  }
}