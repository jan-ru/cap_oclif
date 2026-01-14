import { JWKSClient, JWKS, JWK } from './types.js';
import crypto from 'node:crypto';

interface CachedJWKS {
  jwks: JWKS;
  timestamp: number;
}

/**
 * JWKS client for fetching and caching Keycloak public keys
 * Implements caching with configurable timeout and fallback to cached keys
 */
export class JWKSClientService implements JWKSClient {
  private cache: CachedJWKS | null = null;
  private cacheTimeout: number;
  private jwksUri: string;

  constructor(jwksUri: string, cacheTimeout: number = 300_000) { // Default 5 minutes
    this.jwksUri = jwksUri;
    this.cacheTimeout = cacheTimeout;
  }

  /**
   * Fetch JWKS from Keycloak endpoint
   * Implements caching and fallback to cached keys on failure
   */
  async fetchJWKS(): Promise<JWKS> {
    try {
      // Check if we have valid cached JWKS
      if (this.cache && this.isCacheValid()) {
        return this.cache.jwks;
      }

      // Fetch fresh JWKS from endpoint
      const response = await fetch(this.jwksUri);
      if (!response.ok) {
        throw new Error(`JWKS endpoint returned ${response.status}: ${response.statusText}`);
      }

      const jwks = await response.json() as JWKS;
      
      // Validate JWKS structure
      if (!jwks.keys || !Array.isArray(jwks.keys)) {
        throw new Error('Invalid JWKS response: missing or invalid keys array');
      }

      // Update cache
      this.cache = {
        jwks,
        timestamp: Date.now()
      };

      return jwks;
    } catch (error) {
      // If we have cached JWKS, use them as fallback
      if (this.cache) {
        console.warn('JWKS endpoint unavailable, using cached keys:', error);
        return this.cache.jwks;
      }
      
      // No cache available, re-throw error
      throw new Error(`Failed to fetch JWKS and no cache available: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get cached JWKS if available and valid
   */
  getCachedJWKS(): JWKS | null {
    if (this.cache && this.isCacheValid()) {
      return this.cache.jwks;
    }

    return null;
  }

  /**
   * Convert JWK to PEM format for JWT signature verification
   * Handles RSA and EC key types
   */
  jwkToPem(jwk: JWK): string {
    try {
      if (jwk.kty === 'RSA') {
        return this.rsaJwkToPem(jwk);
      }

 if (jwk.kty === 'EC') {
        return this.ecJwkToPem(jwk);
      }
 
        throw new Error(`Unsupported key type: ${jwk.kty}`);
      
    } catch (error) {
      throw new Error(`Failed to convert JWK to PEM: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get signing key by kid (key ID)
   */
  async getSigningKey(kid: string): Promise<string> {
    const jwks = await this.fetchJWKS();
    const jwk = jwks.keys.find(key => key.kid === kid);
    
    if (!jwk) {
      throw new Error(`Key with kid '${kid}' not found in JWKS`);
    }
    
    return this.jwkToPem(jwk);
  }

  /**
   * Check if cached JWKS is still valid
   */
  private isCacheValid(): boolean {
    if (!this.cache) {
      return false;
    }
    
    const age = Date.now() - this.cache.timestamp;
    return age < this.cacheTimeout;
  }

  /**
   * Convert RSA JWK to PEM format
   */
  private rsaJwkToPem(jwk: JWK): string {
    if (!jwk.n || !jwk.e) {
      throw new Error('RSA JWK missing required parameters (n, e)');
    }

    // Use x5c certificate if available (most reliable approach)
    if (jwk.x5c && jwk.x5c.length > 0) {
      const cert = jwk.x5c[0];
      return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
    }

    // Convert JWK to PEM using Node.js crypto module
    try {
      const keyObject = crypto.createPublicKey({
        key: {
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e,
        },
        format: 'jwk'
      });

      return keyObject.export({ type: 'spki', format: 'pem' }) as string;
    } catch (error) {
      throw new Error(`Failed to convert RSA JWK to PEM: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert EC JWK to PEM format
   */
  private ecJwkToPem(jwk: JWK): string {
    if (!jwk.x || !jwk.y || !jwk.crv) {
      throw new Error('EC JWK missing required parameters (x, y, crv)');
    }

    // Use x5c certificate if available (most reliable approach)
    if (jwk.x5c && jwk.x5c.length > 0) {
      const cert = jwk.x5c[0];
      return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
    }

    // Convert JWK to PEM using Node.js crypto module
    try {
      const keyObject = crypto.createPublicKey({
        key: {
          kty: jwk.kty,
          crv: jwk.crv,
          x: jwk.x,
          y: jwk.y,
        },
        format: 'jwk'
      });

      return keyObject.export({ type: 'spki', format: 'pem' }) as string;
    } catch (error) {
      throw new Error(`Failed to convert EC JWK to PEM: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all available key IDs from cached or fresh JWKS
   */
  async getAvailableKeyIds(): Promise<string[]> {
    const jwks = await this.fetchJWKS();
    return jwks.keys.map(key => key.kid);
  }

  /**
   * Check if a specific key ID is available
   */
  async hasKey(kid: string): Promise<boolean> {
    const keyIds = await this.getAvailableKeyIds();
    return keyIds.includes(kid);
  }
}