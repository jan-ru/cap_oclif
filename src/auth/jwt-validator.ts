import jwt, { Algorithm } from 'jsonwebtoken';
import { JWTValidator, JWTPayload, JWK, JWKSClient, AuthenticationAuditor, SecurityAlert } from './types.js';

/**
 * JWT token validation service
 * Validates JWT tokens using JWKS keys from Keycloak
 * Implements signature verification, structure validation, and timing validation
 */
export class JWTValidatorService implements JWTValidator {
  private jwksClient: JWKSClient;
  private issuer: string;
  private audience: string | undefined;
  private clockTolerance: number;
  private algorithms: Algorithm[];
  private auditor: AuthenticationAuditor | undefined;

  constructor(
    jwksClient: JWKSClient,
    issuer: string,
    options: {
      audience?: string;
      clockTolerance?: number;
      algorithms?: Algorithm[];
      auditor?: AuthenticationAuditor;
    } = {}
  ) {
    this.jwksClient = jwksClient;
    this.issuer = issuer;
    this.audience = options.audience;
    this.clockTolerance = options.clockTolerance || 30; // 30 seconds default
    this.algorithms = options.algorithms || ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
    this.auditor = options.auditor;
  }

  /**
   * Validate JWT token signature and claims
   * Requirements: 1.2, 1.3, 1.4, 1.5, 7.4
   */
  async validateToken(token: string, sourceIp?: string): Promise<JWTPayload> {
    try {
      // Step 1: Validate token structure before signature verification (Requirement 7.4)
      this.validateTokenStructure(token, sourceIp);

      // Step 2: Decode token header to get key ID
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader || typeof decodedHeader === 'string') {
        throw new Error('Invalid token: unable to decode header');
      }

      const { kid } = decodedHeader.header;
      if (!kid) {
        throw new Error('Invalid token: missing key ID in header');
      }

      // Step 3: Get signing key from JWKS (Requirement 1.5)
      const signingKey = await this.jwksClient.getSigningKey(kid);

      // Step 4: Verify token signature and claims
      const verifyOptions: jwt.VerifyOptions = {
        issuer: this.issuer,
        algorithms: this.algorithms,
        clockTolerance: this.clockTolerance,
        complete: false
      };

      if (this.audience) {
        verifyOptions.audience = this.audience;
      }

      const payload = jwt.verify(token, signingKey, verifyOptions) as jwt.JwtPayload;

      // Step 5: Additional payload validation and type conversion
      this.validatePayloadStructure(payload);
      
      return this.convertToJWTPayload(payload);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        // Requirement 1.3: Handle expired tokens
        throw new Error(`Token expired: ${error.message}`);
      } else if (error instanceof jwt.JsonWebTokenError) {
        // Requirement 1.2: Handle invalid tokens
        throw new Error(`Invalid token: ${error.message}`);
      } else if (error instanceof jwt.NotBeforeError) {
        // Handle tokens that are not yet valid
        throw new Error(`Token not yet valid: ${error.message}`);
      } else {
        // Re-throw other errors (including our custom validation errors)
        throw error;
      }
    }
  }

  /**
   * Get public keys from JWKS endpoint
   */
  async getPublicKeys(): Promise<JWK[]> {
    const jwks = await this.jwksClient.fetchJWKS();
    return jwks.keys;
  }

  /**
   * Refresh JWKS cache
   */
  async refreshKeys(): Promise<void> {
    // Force refresh by fetching new JWKS
    await this.jwksClient.fetchJWKS();
  }

  /**
   * Validate JWT token structure before signature verification
   * Requirement 7.4: Token structure validation
   * Requirement 7.3: Log security alerts for malformed tokens
   */
  private validateTokenStructure(token: string, sourceIp?: string): void {
    if (!token || typeof token !== 'string') {
      this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'Token must be a non-empty string', sourceIp);
      throw new Error('Token must be a non-empty string');
    }

    // JWT should have exactly 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) {
      this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'JWT must have exactly 3 parts', sourceIp);
      throw new Error('Invalid token structure: JWT must have exactly 3 parts');
    }

    // Each part should be valid base64url
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part.length === 0) {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', `JWT part ${i + 1} is empty`, sourceIp);
        throw new Error(`Invalid token structure: part ${i + 1} is empty`);
      }
      
      // Check if it's valid base64url (basic check)
      if (!/^[A-Za-z0-9_-]+$/.test(part)) {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', `JWT part ${i + 1} contains invalid characters`, sourceIp);
        throw new Error(`Invalid token structure: part ${i + 1} contains invalid characters`);
      }
    }

    // Try to decode header and payload to ensure they're valid JSON
    try {
      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
      
      // Basic header validation
      if (!header.alg || !header.typ) {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'JWT header missing required fields (alg, typ)', sourceIp);
        throw new Error('Invalid token header: missing required fields (alg, typ)');
      }
      
      if (header.typ !== 'JWT') {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'JWT header typ must be JWT', sourceIp);
        throw new Error('Invalid token header: typ must be JWT');
      }

      // Basic payload validation
      if (!payload.iss || !payload.sub || !payload.exp) {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'JWT payload missing required claims (iss, sub, exp)', sourceIp);
        throw new Error('Invalid token payload: missing required claims (iss, sub, exp)');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.logSecurityAlert('INVALID_TOKEN_STRUCTURE', 'Malformed JSON in JWT header or payload', sourceIp);
        throw new Error('Invalid token structure: malformed JSON in header or payload');
      }
      // Re-throw our custom errors as-is
      throw error;
    }
  }

  /**
   * Validate JWT payload structure and required claims
   */
  private validatePayloadStructure(payload: any): void {
    // Ensure required fields are present and have correct types
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Invalid payload: missing or invalid subject (sub)');
    }

    if (!payload.iss || typeof payload.iss !== 'string') {
      throw new Error('Invalid payload: missing or invalid issuer (iss)');
    }

    if (!payload.exp || typeof payload.exp !== 'number') {
      throw new Error('Invalid payload: missing or invalid expiration (exp)');
    }

    if (!payload.iat || typeof payload.iat !== 'number') {
      throw new Error('Invalid payload: missing or invalid issued at (iat)');
    }

    // Validate realm_access structure if present
    if (payload.realm_access && typeof payload.realm_access === 'object') {
      if (!Array.isArray(payload.realm_access.roles)) {
        throw new Error('Invalid payload: realm_access.roles must be an array');
      }
    }

    // Validate resource_access structure if present
    if (payload.resource_access && typeof payload.resource_access === 'object') {
      for (const [clientId, access] of Object.entries(payload.resource_access)) {
        if (typeof access !== 'object' || access === null) {
          throw new Error(`Invalid payload: resource_access.${clientId} must be an object`);
        }
        
        const accessObj = access as any;
        if (!Array.isArray(accessObj.roles)) {
          throw new Error(`Invalid payload: resource_access.${clientId}.roles must be an array`);
        }
      }
    }

    // Validate preferred_username if present
    if (payload.preferred_username && typeof payload.preferred_username !== 'string') {
      throw new Error('Invalid payload: preferred_username must be a string');
    }

    // Validate email if present
    if (payload.email && typeof payload.email !== 'string') {
      throw new Error('Invalid payload: email must be a string');
    }

    // Validate jti if present
    if (payload.jti && typeof payload.jti !== 'string') {
      throw new Error('Invalid payload: jti must be a string');
    }
  }

  /**
   * Convert jwt.JwtPayload to our JWTPayload interface
   */
  private convertToJWTPayload(payload: jwt.JwtPayload): JWTPayload {
    // Ensure required fields are present
    if (!payload.sub || !payload.iss || !payload.exp || !payload.iat) {
      throw new Error('Invalid payload: missing required claims');
    }

    return {
      sub: payload.sub,
      preferred_username: payload.preferred_username || payload.sub,
      email: payload.email,
      realm_access: payload.realm_access || { roles: [] },
      resource_access: payload.resource_access,
      iss: payload.iss,
      aud: Array.isArray(payload.aud) ? payload.aud[0] || '' : (payload.aud || ''),
      exp: payload.exp,
      iat: payload.iat,
      jti: payload.jti || ''
    };
  }

  /**
   * Log security alert for invalid token structures
   * Requirement 7.3: Log security alerts for suspicious patterns
   */
  private logSecurityAlert(alertType: 'INVALID_TOKEN_STRUCTURE', details: string, sourceIp?: string): void {
    if (!this.auditor) {
      return; // No auditor configured, skip logging
    }

    const securityAlert: SecurityAlert = {
      type: alertType,
      severity: 'MEDIUM',
      details: {
        validation_error: details,
        timestamp: new Date().toISOString(),
        component: 'JWTValidator'
      },
      sourceIp: sourceIp || 'unknown',
      timestamp: new Date()
    };

    this.auditor.logSecurityAlert(securityAlert);
  }

  /**
   * Set the authentication auditor for security alert logging
   */
  setAuditor(auditor: AuthenticationAuditor): void {
    this.auditor = auditor;
  }
}