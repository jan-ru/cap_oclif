import { KeycloakAuthConfig, RealmConfig } from './types.js';

/**
 * Load authentication configuration from environment variables
 * Validates configuration at startup and throws errors for missing required values
 * Supports multiple realm configurations for multi-tenant deployments
 */
export class AuthConfigLoader {
  private static cachedConfig: KeycloakAuthConfig | null = null;
  private static configWatchers: Array<(config: KeycloakAuthConfig) => void> = [];

  /**
   * Load and validate authentication configuration from environment
   * Supports both single realm and multi-realm configurations
   */
  static loadConfig(): KeycloakAuthConfig {
    // Return cached config if available and not in development mode
    if (this.cachedConfig && process.env.NODE_ENV !== 'development') {
      return this.cachedConfig;
    }

    const keycloakConfig: any = {
      url: this.getRequiredEnv('KEYCLOAK_URL'),
      realm: this.getRequiredEnv('KEYCLOAK_REALM'),
    };

    // Only add optional properties if they exist
    if (process.env.KEYCLOAK_CLIENT_ID) {
      keycloakConfig.clientId = process.env.KEYCLOAK_CLIENT_ID;
    }
    if (process.env.KEYCLOAK_CLIENT_SECRET) {
      keycloakConfig.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
    }

    // Load multiple realm configurations if provided
    const multiRealmConfig = this.loadMultiRealmConfig();
    if (multiRealmConfig.length > 0) {
      keycloakConfig.realms = multiRealmConfig;
    }

    const jwtConfig: any = {
      issuer: this.getRequiredEnv('JWT_ISSUER'),
      algorithms: this.parseAlgorithms(process.env.JWT_ALGORITHMS || 'RS256'),
      clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE || '30', 10),
    };

    // Only add audience if it exists
    if (process.env.JWT_AUDIENCE) {
      jwtConfig.audience = process.env.JWT_AUDIENCE;
    }

    const securityConfig: any = {
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      requireHttps: process.env.REQUIRE_HTTPS !== 'false',
    };

    // Only add allowedOrigins if it exists
    const allowedOrigins = this.parseOrigins(process.env.ALLOWED_ORIGINS);
    if (allowedOrigins) {
      securityConfig.allowedOrigins = allowedOrigins;
    }

    const config: KeycloakAuthConfig = {
      keycloak: keycloakConfig,
      jwt: jwtConfig,
      jwks: {
        cacheTimeout: parseInt(process.env.JWKS_CACHE_TIMEOUT || '3600000', 10), // 1 hour default
        rateLimit: parseInt(process.env.JWKS_RATE_LIMIT || '10', 10),
        requestsPerMinute: parseInt(process.env.JWKS_REQUESTS_PER_MINUTE || '5', 10),
      },
      security: securityConfig,
      logging: {
        level: this.parseLogLevel(process.env.LOG_LEVEL || 'info'),
        auditEnabled: process.env.AUDIT_ENABLED !== 'false',
        includeTokenClaims: process.env.INCLUDE_TOKEN_CLAIMS === 'true',
      },
    };

    this.validateConfig(config);
    this.cachedConfig = config;
    return config;
  }

  /**
   * Load multiple realm configurations from environment variables
   * Supports KEYCLOAK_REALMS_CONFIG as JSON string or individual realm environment variables
   */
  private static loadMultiRealmConfig(): RealmConfig[] {
    const realms: RealmConfig[] = [];

    // Try to load from JSON configuration first
    const realmsConfigJson = process.env.KEYCLOAK_REALMS_CONFIG;
    if (realmsConfigJson) {
      try {
        const parsedRealms = JSON.parse(realmsConfigJson);
        if (Array.isArray(parsedRealms)) {
          for (const realm of parsedRealms) {
            this.validateRealmConfig(realm);
            realms.push(realm);
          }
        }
      } catch (error) {
        throw new Error(`Invalid KEYCLOAK_REALMS_CONFIG JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Load individual realm configurations (REALM_1_NAME, REALM_1_URL, etc.)
    let realmIndex = 1;
    while (process.env[`REALM_${realmIndex}_NAME`]) {
      const realmName = process.env[`REALM_${realmIndex}_NAME`];
      const realmUrl = process.env[`REALM_${realmIndex}_URL`];
      const realmIssuer = process.env[`REALM_${realmIndex}_ISSUER`];

      if (!realmName || !realmUrl || !realmIssuer) {
        throw new Error(`Incomplete realm configuration for REALM_${realmIndex}. Required: NAME, URL, ISSUER`);
      }

      const realmConfig: RealmConfig = {
        name: realmName,
        url: realmUrl,
        issuer: realmIssuer,
      };

      // Optional properties
      if (process.env[`REALM_${realmIndex}_CLIENT_ID`]) {
        realmConfig.clientId = process.env[`REALM_${realmIndex}_CLIENT_ID`]!;
      }
      if (process.env[`REALM_${realmIndex}_CLIENT_SECRET`]) {
        realmConfig.clientSecret = process.env[`REALM_${realmIndex}_CLIENT_SECRET`]!;
      }
      if (process.env[`REALM_${realmIndex}_AUDIENCE`]) {
        realmConfig.audience = process.env[`REALM_${realmIndex}_AUDIENCE`]!;
      }

      this.validateRealmConfig(realmConfig);
      realms.push(realmConfig);
      realmIndex++;
    }

    return realms;
  }

  /**
   * Validate individual realm configuration
   */
  private static validateRealmConfig(realm: any): void {
    if (!realm.name || typeof realm.name !== 'string') {
      throw new Error('Realm configuration must have a valid name');
    }
    if (!realm.url || typeof realm.url !== 'string') {
      throw new Error(`Realm ${realm.name} must have a valid URL`);
    }
    if (!realm.issuer || typeof realm.issuer !== 'string') {
      throw new Error(`Realm ${realm.name} must have a valid issuer`);
    }

    // Validate URL formats
    try {
      new URL(realm.url);
    } catch {
      throw new Error(`Invalid URL for realm ${realm.name}: ${realm.url}`);
    }

    try {
      new URL(realm.issuer);
    } catch {
      throw new Error(`Invalid issuer URL for realm ${realm.name}: ${realm.issuer}`);
    }
  }

  /**
   * Reload configuration from environment variables
   * Supports runtime configuration updates (Requirement 6.5)
   */
  static reloadConfig(): KeycloakAuthConfig {
    this.cachedConfig = null;
    const newConfig = this.loadConfig();
    
    // Notify all watchers of configuration change
    this.configWatchers.forEach(watcher => {
      try {
        watcher(newConfig);
      } catch (error) {
        console.error('Error in configuration watcher:', error);
      }
    });

    return newConfig;
  }

  /**
   * Register a callback to be notified when configuration changes
   */
  static onConfigChange(callback: (config: KeycloakAuthConfig) => void): void {
    this.configWatchers.push(callback);
  }

  /**
   * Remove a configuration change callback
   */
  static removeConfigWatcher(callback: (config: KeycloakAuthConfig) => void): void {
    const index = this.configWatchers.indexOf(callback);
    if (index > -1) {
      this.configWatchers.splice(index, 1);
    }
  }

  /**
   * Get configuration for a specific realm
   */
  static getRealmConfig(realmName: string, config?: KeycloakAuthConfig): RealmConfig | null {
    const authConfig = config || this.loadConfig();
    
    // Check if it's the default realm
    if (authConfig.keycloak.realm === realmName) {
      const realmConfig: RealmConfig = {
        name: authConfig.keycloak.realm,
        url: authConfig.keycloak.url,
        issuer: authConfig.jwt.issuer,
      };
      
      if (authConfig.keycloak.clientId) {
        realmConfig.clientId = authConfig.keycloak.clientId;
      }
      if (authConfig.keycloak.clientSecret) {
        realmConfig.clientSecret = authConfig.keycloak.clientSecret;
      }
      if (authConfig.jwt.audience) {
        realmConfig.audience = authConfig.jwt.audience;
      }
      
      return realmConfig;
    }

    // Check configured realms
    if (authConfig.keycloak.realms) {
      return authConfig.keycloak.realms.find(realm => realm.name === realmName) || null;
    }

    return null;
  }

  /**
   * Get all available realm names
   */
  static getAvailableRealms(config?: KeycloakAuthConfig): string[] {
    const authConfig = config || this.loadConfig();
    const realms = [authConfig.keycloak.realm];
    
    if (authConfig.keycloak.realms) {
      realms.push(...authConfig.keycloak.realms.map(realm => realm.name));
    }

    return [...new Set(realms)]; // Remove duplicates
  }

  /**
   * Get required environment variable or throw error
   */
  private static getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
  }

  /**
   * Parse JWT algorithms from comma-separated string
   */
  private static parseAlgorithms(algorithms: string): string[] {
    return algorithms.split(',').map(alg => alg.trim());
  }

  /**
   * Parse allowed origins from comma-separated string
   */
  private static parseOrigins(origins?: string): string[] | undefined {
    if (!origins) return undefined;
    return origins.split(',').map(origin => origin.trim());
  }

  /**
   * Parse and validate log level
   */
  private static parseLogLevel(level: string): 'debug' | 'info' | 'warn' | 'error' {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLevels.includes(level)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${validLevels.join(', ')}`);
    }
    return level as 'debug' | 'info' | 'warn' | 'error';
  }

  /**
   * Validate the loaded configuration
   */
  private static validateConfig(config: KeycloakAuthConfig): void {
    // Validate Keycloak URL format
    try {
      new URL(config.keycloak.url);
    } catch {
      throw new Error(`Invalid Keycloak URL: ${config.keycloak.url}`);
    }

    // Validate JWT issuer format
    try {
      new URL(config.jwt.issuer);
    } catch {
      throw new Error(`Invalid JWT issuer URL: ${config.jwt.issuer}`);
    }

    // Validate numeric values
    if (config.jwks.cacheTimeout < 0) {
      throw new Error('JWKS cache timeout must be non-negative');
    }

    if (config.security.rateLimitMaxRequests <= 0) {
      throw new Error('Rate limit max requests must be positive');
    }

    if (config.security.rateLimitWindowMs <= 0) {
      throw new Error('Rate limit window must be positive');
    }

    // Validate JWT algorithms
    const supportedAlgorithms = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
    for (const alg of config.jwt.algorithms) {
      if (!supportedAlgorithms.includes(alg)) {
        throw new Error(`Unsupported JWT algorithm: ${alg}. Supported: ${supportedAlgorithms.join(', ')}`);
      }
    }

    // Validate realm configurations if present
    if (config.keycloak.realms) {
      for (const realm of config.keycloak.realms) {
        this.validateRealmConfig(realm);
      }
    }
  }

  /**
   * Get JWKS URI from Keycloak configuration for a specific realm
   */
  static getJwksUri(config: KeycloakAuthConfig, realmName?: string): string {
    const realmConfig = realmName ? this.getRealmConfig(realmName, config) : null;
    
    if (realmConfig) {
      const baseUrl = realmConfig.url.endsWith('/') 
        ? realmConfig.url.slice(0, -1) 
        : realmConfig.url;
      return `${baseUrl}/realms/${realmConfig.name}/protocol/openid_connect/certs`;
    }

    // Default realm
    const baseUrl = config.keycloak.url.endsWith('/') 
      ? config.keycloak.url.slice(0, -1) 
      : config.keycloak.url;
    
    return `${baseUrl}/realms/${config.keycloak.realm}/protocol/openid_connect/certs`;
  }

  /**
   * Get token endpoint from Keycloak configuration for a specific realm
   */
  static getTokenEndpoint(config: KeycloakAuthConfig, realmName?: string): string {
    const realmConfig = realmName ? this.getRealmConfig(realmName, config) : null;
    
    if (realmConfig) {
      const baseUrl = realmConfig.url.endsWith('/') 
        ? realmConfig.url.slice(0, -1) 
        : realmConfig.url;
      return `${baseUrl}/realms/${realmConfig.name}/protocol/openid_connect/token`;
    }

    // Default realm
    const baseUrl = config.keycloak.url.endsWith('/') 
      ? config.keycloak.url.slice(0, -1) 
      : config.keycloak.url;
    
    return `${baseUrl}/realms/${config.keycloak.realm}/protocol/openid_connect/token`;
  }

  /**
   * Create a simple AuthConfig from KeycloakAuthConfig for middleware
   */
  static createAuthConfig(keycloakConfig: KeycloakAuthConfig): import('./types.js').AuthConfig {
    const authConfig: any = {
      keycloakUrl: keycloakConfig.keycloak.url,
      realm: keycloakConfig.keycloak.realm,
      jwksUri: this.getJwksUri(keycloakConfig),
      cacheTimeout: keycloakConfig.jwks.cacheTimeout,
      rateLimitConfig: {
        windowMs: keycloakConfig.security.rateLimitWindowMs,
        maxRequests: keycloakConfig.security.rateLimitMaxRequests,
      },
    };

    // Only add clientId if it exists
    if (keycloakConfig.keycloak.clientId) {
      authConfig.clientId = keycloakConfig.keycloak.clientId;
    }

    return authConfig;
  }
}