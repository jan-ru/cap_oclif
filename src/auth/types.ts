import { Request, Response, NextFunction } from 'express';

// Configuration interfaces
export interface AppConfig {
  keycloak?: {
    serverUrl: string;
    realm: string;
    clientId: string;
    clientSecret?: string;
  };
  server?: {
    port: number;
    host: string;
  };
  logging?: {
    level: string;
    format: string;
  };
  [key: string]: unknown;
}

export interface AuthConfig {
  keycloakUrl: string;
  realm: string;
  clientId?: string;
  jwksUri?: string;
  cacheTimeout: number;
  rateLimitConfig: RateLimitConfig;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
}

export interface RealmConfig {
  name: string;
  url: string;
  clientId?: string;
  clientSecret?: string;
  issuer: string;
  audience?: string;
}

export interface KeycloakAuthConfig {
  // Keycloak server configuration - supports multiple realms
  keycloak: {
    url: string;
    realm: string;  // Default realm for backward compatibility
    clientId?: string;
    clientSecret?: string;
    // Multi-realm support
    realms?: RealmConfig[];
  };
  
  // JWT validation settings
  jwt: {
    issuer: string;
    audience?: string;
    algorithms: string[];
    clockTolerance: number;
  };
  
  // JWKS caching configuration
  jwks: {
    cacheTimeout: number;
    rateLimit: number;
    requestsPerMinute: number;
  };
  
  // Security settings
  security: {
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    requireHttps: boolean;
    allowedOrigins?: string[];
  };
  
  // Logging configuration
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    auditEnabled: boolean;
    includeTokenClaims: boolean;
  };
}

// OAuth2 token interfaces
export interface OAuth2TokenRequest {
  grant_type: 'client_credentials' | 'refresh_token' | 'authorization_code';
  client_id: string;
  client_secret: string;
  refresh_token?: string;
  code?: string;
  redirect_uri?: string;
  scope?: string;
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

// JWT and JWKS interfaces
export interface JWTTokenClaims {
  sub: string;          // Subject (user ID)
  iss: string;          // Issuer
  aud: string | string[];  // Audience (can be string or array)
  exp: number;          // Expiration time
  iat: number;          // Issued at time
  azp?: string;         // Authorized party (client ID)
  scope?: string;       // OAuth scopes
  realm_access?: {
    roles: string[];
  };
  resource_access?: Record<string, { roles: string[] }>;
  [key: string]: unknown;  // Additional claims (using unknown instead of any)
}

export interface JWTPayload {
  sub: string;          // Subject (user ID)
  preferred_username: string;
  email?: string;
  realm_access: {
    roles: string[];
  };
  resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };
  iss: string;          // Issuer
  aud: string;          // Audience
  exp: number;          // Expiration time
  iat: number;          // Issued at time
  jti: string;          // JWT ID
  
  // Service account specific claims
  service_account?: boolean;  // Explicit service account flag
  azp?: string;              // Authorized party (client ID)
  typ?: string;              // Token type
  
  // Additional claims that might be present
  [key: string]: unknown;    // Changed from any to unknown
}

export interface JWKS {
  keys: JWK[];
}

export interface JWK {
  kty: string;          // Key type
  use: string;          // Public key use
  kid: string;          // Key ID
  x5t: string;          // X.509 thumbprint
  n: string;            // Modulus (RSA)
  e: string;            // Exponent (RSA)
  x5c: string[];        // X.509 certificate chain
  // EC key properties
  x?: string;           // X coordinate (EC)
  y?: string;           // Y coordinate (EC)
  crv?: string;         // Curve (EC)
}

// User context interfaces
export interface UserContext {
  userId: string;
  username: string;
  email?: string;
  roles: string[];
  clientRoles: { [clientId: string]: string[] };
  realm: string;
  isServiceAccount: boolean;
  tokenId: string;
  expiresAt: Date;
}

// Extended Express Request with authentication context
export interface AuthenticatedRequest extends Request {
  user: UserContext;
  correlationId: string;
  authTimestamp: Date;
}

// Audit logging interfaces
export interface AuditEvent {
  event_type: string;
  correlation_id: string;
  timestamp: string;
  user_id?: string | undefined;
  username?: string | undefined;
  source_ip?: string | undefined;
  user_agent?: string | undefined;
  resource?: string | undefined;
  action?: string | undefined;
  result?: 'success' | 'failure' | undefined;
  error_code?: string | undefined;
  error_message?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuthEvent {
  correlationId: string;
  timestamp: Date;
  userId?: string;
  username?: string;
  sourceIp: string;
  userAgent: string;
  endpoint: string;
  method: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface SecurityAlert {
  type: 'RATE_LIMIT_EXCEEDED' | 'SUSPICIOUS_PATTERN' | 'INVALID_TOKEN_STRUCTURE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  details: Record<string, unknown>;  // Changed from any to unknown
  sourceIp: string;
  timestamp: Date;
}

// Error response interface
export interface ErrorResponse {
  error: string;
  error_description?: string;
  error_code?: string;
  status: number;
  timestamp: string;
}

export interface AuthErrorResponse {
  error: string;
  error_description?: string;
  correlation_id: string;
  timestamp: string;
}

// Component interfaces
export interface AuthenticationMiddleware {
  // Main middleware function
  authenticate(req: Request, res: Response, next: NextFunction): Promise<void>;
  
  // Configuration
  configure(config: AuthConfig): void;
  
  // Health check for monitoring
  isHealthy(): Promise<boolean>;
}

export interface JWTValidator {
  // Validate JWT token signature and claims
  validateToken(token: string, sourceIp?: string): Promise<JWTPayload>;
  
  // Get public keys from JWKS endpoint
  getPublicKeys(): Promise<JWK[]>;
  
  // Refresh JWKS cache
  refreshKeys(): Promise<void>;
}

export interface JWKSClient {
  // Fetch JWKS from Keycloak
  fetchJWKS(): Promise<JWKS>;
  
  // Get cached JWKS
  getCachedJWKS(): JWKS | null;
  
  // Convert JWK to PEM format for verification
  jwkToPem(jwk: JWK): string;
  
  // Get signing key by kid (key ID)
  getSigningKey(kid: string): Promise<string>;
  
  // Get all available key IDs
  getAvailableKeyIds(): Promise<string[]>;
  
  // Check if a specific key ID is available
  hasKey(kid: string): Promise<boolean>;
}

export interface UserContextExtractor {
  // Extract user context from JWT payload
  extractUserContext(payload: JWTPayload): UserContext;
  
  // Check if token represents a service account
  isServiceAccount(payload: JWTPayload): boolean;
}

export interface AuthenticationAuditor {
  // Log successful authentication
  logAuthSuccess(context: AuthEvent): void;
  
  // Log authentication failure
  logAuthFailure(context: AuthEvent): void;
  
  // Log token expiration
  logTokenExpiration(context: AuthEvent): void;
  
  // Log security alerts
  logSecurityAlert(context: SecurityAlert): void;
}