import { UserContextExtractor, JWTPayload, UserContext } from './types.js';

/**
 * Service for extracting user context from JWT tokens
 * Extracts user identity, roles, and determines account type from validated JWT payloads
 * 
 * Requirements implemented:
 * - 2.1: Extract user ID from token claims
 * - 2.2: Extract username from token claims  
 * - 2.3: Extract user roles from token claims
 * - 2.4: Extract realm information from token claims
 * - 4.1: Accept JWT tokens issued for service accounts
 * - 4.2: Extract service account identity
 */
export class UserContextExtractorService implements UserContextExtractor {
  
  /**
   * Extract comprehensive user context from validated JWT payload
   * Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2
   */
  extractUserContext(payload: JWTPayload): UserContext {
    // Extract user ID (Requirement 2.1)
    const userId = payload.sub;
    
    // Extract username (Requirement 2.2)
    // Use preferred_username if available, fallback to sub
    const username = payload.preferred_username || payload.sub;
    
    // Extract realm from issuer (Requirement 2.4)
    const realm = this.extractRealmFromIssuer(payload.iss);
    
    // Extract roles from realm_access (Requirement 2.3)
    const roles = payload.realm_access?.roles || [];
    
    // Extract client-specific roles from resource_access (Requirement 2.3)
    const clientRoles: { [clientId: string]: string[] } = {};
    if (payload.resource_access) {
      for (const [clientId, access] of Object.entries(payload.resource_access)) {
        clientRoles[clientId] = access.roles || [];
      }
    }
    
    // Determine if this is a service account (Requirements 4.1, 4.2)
    const isServiceAccount = this.isServiceAccount(payload);
    
    // Extract token metadata
    const tokenId = payload.jti || '';
    const expiresAt = new Date(payload.exp * 1000); // Convert Unix timestamp to Date
    
    // Build the user context object
    const userContext: UserContext = {
      userId,
      username,
      roles,
      clientRoles,
      realm,
      isServiceAccount,
      tokenId,
      expiresAt
    };
    
    // Add email only if it exists
    if (payload.email) {
      userContext.email = payload.email;
    }
    
    return userContext;
  }

  /**
   * Determine if the JWT token represents a service account
   * Requirements: 4.1, 4.2
   * 
   * Service accounts in Keycloak typically have:
   * 1. A 'service-account-' prefix in the preferred_username
   * 2. A 'service_account' claim set to true
   * 3. Different claim structure compared to user accounts
   */
  isServiceAccount(payload: JWTPayload): boolean {
    // Method 1: Check for explicit service_account claim
    if ('service_account' in payload && payload.service_account === true) {
      return true;
    }
    
    // Method 2: Check for service account username pattern
    // Keycloak service accounts typically have usernames like 'service-account-{client-id}'
    const username = payload.preferred_username || payload.sub;
    if (username.startsWith('service-account-')) {
      return true;
    }
    
    // Method 3: Check for client credentials flow indicators
    // Service accounts often have 'azp' (authorized party) claim and specific audience
    if ('azp' in payload && payload.azp && !payload.email) {
      // Has authorized party but no email - likely a service account
      return true;
    }
    
    // Method 4: Check token type claim if present
    if ('typ' in payload && payload.typ === 'Bearer' && !payload.email && !payload.preferred_username) {
      // Bearer token without user-specific claims
      return true;
    }
    
    // Default to user account if no service account indicators found
    return false;
  }
  
  /**
   * Extract realm name from Keycloak issuer URL
   * Keycloak issuer format: https://keycloak.example.com/realms/{realm-name}
   */
  private extractRealmFromIssuer(issuer: string): string {
    try {
      const url = new URL(issuer);
      const pathParts = url.pathname.split('/');
      
      // Find 'realms' in the path and get the next part
      const realmsIndex = pathParts.indexOf('realms');
      if (realmsIndex !== -1 && realmsIndex + 1 < pathParts.length) {
        const realm = pathParts[realmsIndex + 1];
        if (realm) {
          return realm;
        }
      }
      
      // Fallback: if we can't parse the realm from URL, return a default
      return 'unknown';
    } catch {
      // If issuer is not a valid URL, return unknown
      return 'unknown';
    }
  }
}