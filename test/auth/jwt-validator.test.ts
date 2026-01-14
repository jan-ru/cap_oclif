import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { JWTValidatorService } from '../../src/auth/jwt-validator.js';
import { JWKSClient, JWKS, JWK } from '../../src/auth/types.js';

// Mock JWKS client
class MockJWKSClient implements JWKSClient {
  private mockJWKS: JWKS = {
    keys: [
      {
        kty: 'RSA',
        use: 'sig',
        kid: 'test-key-id',
        x5t: 'test-thumbprint',
        n: 'test-modulus',
        e: 'AQAB',
        x5c: ['test-cert']
      }
    ]
  };

  async fetchJWKS(): Promise<JWKS> {
    return this.mockJWKS;
  }

  getCachedJWKS(): JWKS | null {
    return this.mockJWKS;
  }

  jwkToPem(_jwk: JWK): string {
    // Return a mock PEM for testing
    return '-----BEGIN CERTIFICATE-----\nMOCK_CERT\n-----END CERTIFICATE-----';
  }

  async getSigningKey(_kid: string): Promise<string> {
    return this.jwkToPem(this.mockJWKS.keys[0]!);
  }

  async getAvailableKeyIds(): Promise<string[]> {
    return this.mockJWKS.keys.map(key => key.kid);
  }

  async hasKey(kid: string): Promise<boolean> {
    return this.mockJWKS.keys.some(key => key.kid === kid);
  }
}

describe('JWTValidatorService', () => {
  let jwtValidator: JWTValidatorService;
  let mockJWKSClient: MockJWKSClient;

  beforeEach(() => {
    mockJWKSClient = new MockJWKSClient();
    jwtValidator = new JWTValidatorService(
      mockJWKSClient,
      'https://keycloak.example.com/realms/test',
      {
        audience: 'test-client',
        clockTolerance: 30,
        algorithms: ['RS256']
      }
    );
  });

  describe('Token Structure Validation', () => {
    it('should reject empty token', async () => {
      await expect(jwtValidator.validateToken('')).rejects.toThrow('Token must be a non-empty string');
    });

    it('should reject token with wrong number of parts', async () => {
      await expect(jwtValidator.validateToken('invalid.token')).rejects.toThrow('JWT must have exactly 3 parts');
    });

    it('should reject token with empty parts', async () => {
      await expect(jwtValidator.validateToken('..signature')).rejects.toThrow('part 1 is empty');
    });

    it('should reject token with invalid base64url characters', async () => {
      await expect(jwtValidator.validateToken('invalid@chars.valid.signature')).rejects.toThrow('contains invalid characters');
    });

    it('should reject token with malformed JSON', async () => {
      // Create a token with invalid JSON in header
      const invalidHeader = Buffer.from('invalid-json', 'utf8').toString('base64url');
      const validPayload = Buffer.from(JSON.stringify({ iss: 'test', sub: 'test', exp: Date.now() / 1000 + 3600 }), 'utf8').toString('base64url');
      const token = `${invalidHeader}.${validPayload}.signature`;
      
      await expect(jwtValidator.validateToken(token)).rejects.toThrow('malformed JSON');
    });

    it('should reject token with missing required header fields', async () => {
      const invalidHeader = Buffer.from(JSON.stringify({ typ: 'JWT' }), 'utf8').toString('base64url'); // missing alg
      const validPayload = Buffer.from(JSON.stringify({ iss: 'test', sub: 'test', exp: Date.now() / 1000 + 3600 }), 'utf8').toString('base64url');
      const token = `${invalidHeader}.${validPayload}.signature`;
      
      await expect(jwtValidator.validateToken(token)).rejects.toThrow('missing required fields');
    });

    it('should reject token with wrong typ field', async () => {
      const invalidHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'NOT_JWT' }), 'utf8').toString('base64url');
      const validPayload = Buffer.from(JSON.stringify({ iss: 'test', sub: 'test', exp: Date.now() / 1000 + 3600 }), 'utf8').toString('base64url');
      const token = `${invalidHeader}.${validPayload}.signature`;
      
      await expect(jwtValidator.validateToken(token)).rejects.toThrow('typ must be JWT');
    });

    it('should reject token with missing required payload claims', async () => {
      const validHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key-id' }), 'utf8').toString('base64url');
      const invalidPayload = Buffer.from(JSON.stringify({ iss: 'test' }), 'utf8').toString('base64url'); // missing sub, exp
      const token = `${validHeader}.${invalidPayload}.signature`;
      
      await expect(jwtValidator.validateToken(token)).rejects.toThrow('missing required claims');
    });
  });

  describe('Payload Validation', () => {
    it('should validate required payload fields', () => {
      const invalidPayloads = [
        { iss: 'test', exp: 123, iat: 123 }, // missing sub
        { sub: 'test', exp: 123, iat: 123 }, // missing iss
        { sub: 'test', iss: 'test', iat: 123 }, // missing exp
        { sub: 'test', iss: 'test', exp: 123 }, // missing iat
      ];

      for (const payload of invalidPayloads) {
        expect(() => (jwtValidator as any).validatePayloadStructure(payload)).toThrow();
      }
    });

    it('should validate realm_access structure', () => {
      const invalidPayload = {
        sub: 'test',
        iss: 'test',
        exp: 123,
        iat: 123,
        realm_access: { roles: 'not-an-array' }
      };

      expect(() => (jwtValidator as any).validatePayloadStructure(invalidPayload)).toThrow('realm_access.roles must be an array');
    });

    it('should validate resource_access structure', () => {
      const invalidPayload = {
        sub: 'test',
        iss: 'test',
        exp: 123,
        iat: 123,
        resource_access: {
          'test-client': { roles: 'not-an-array' }
        }
      };

      expect(() => (jwtValidator as any).validatePayloadStructure(invalidPayload)).toThrow('resource_access.test-client.roles must be an array');
    });
  });

  describe('JWKS Integration', () => {
    it('should get public keys from JWKS client', async () => {
      const keys = await jwtValidator.getPublicKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]?.kid).toBe('test-key-id');
    });

    it('should refresh JWKS cache', async () => {
      const fetchSpy = vi.spyOn(mockJWKSClient, 'fetchJWKS');
      await jwtValidator.refreshKeys();
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing key ID in token header', async () => {
      const headerWithoutKid = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf8').toString('base64url');
      const validPayload = Buffer.from(JSON.stringify({ 
        iss: 'https://keycloak.example.com/realms/test', 
        sub: 'test', 
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      }), 'utf8').toString('base64url');
      const token = `${headerWithoutKid}.${validPayload}.signature`;
      
      await expect(jwtValidator.validateToken(token)).rejects.toThrow('missing key ID in header');
    });

    it('should handle JWKS client errors', async () => {
      const errorJWKSClient = {
        ...mockJWKSClient,
        getSigningKey: vi.fn().mockRejectedValue(new Error('JWKS error'))
      };
      
      const errorValidator = new JWTValidatorService(
        errorJWKSClient,
        'https://keycloak.example.com/realms/test'
      );

      const validHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key-id' }), 'utf8').toString('base64url');
      const validPayload = Buffer.from(JSON.stringify({ 
        iss: 'https://keycloak.example.com/realms/test', 
        sub: 'test', 
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      }), 'utf8').toString('base64url');
      const token = `${validHeader}.${validPayload}.signature`;
      
      await expect(errorValidator.validateToken(token)).rejects.toThrow('JWKS error');
    });
  });

  describe('Payload Conversion', () => {
    it('should convert jwt payload to JWTPayload interface', () => {
      const jwtPayload = {
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test',
        exp: 1_234_567_890,
        iat: 1_234_567_800,
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: { roles: ['user'] },
        resource_access: { 'test-client': { roles: ['read'] } },
        jti: 'token-123'
      };

      const result = (jwtValidator as any).convertToJWTPayload(jwtPayload);
      
      expect(result.sub).toBe('user-123');
      expect(result.preferred_username).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      expect(result.realm_access.roles).toEqual(['user']);
      expect(result.resource_access?.['test-client']?.roles).toEqual(['read']);
      expect(result.iss).toBe('https://keycloak.example.com/realms/test');
      expect(result.exp).toBe(1_234_567_890);
      expect(result.iat).toBe(1_234_567_800);
      expect(result.jti).toBe('token-123');
    });

    it('should handle missing optional fields in payload conversion', () => {
      const minimalPayload = {
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test',
        exp: 1_234_567_890,
        iat: 1_234_567_800
      };

      const result = (jwtValidator as any).convertToJWTPayload(minimalPayload);
      
      expect(result.sub).toBe('user-123');
      expect(result.preferred_username).toBe('user-123'); // Falls back to sub
      expect(result.email).toBeUndefined();
      expect(result.realm_access.roles).toEqual([]);
      expect(result.jti).toBe('');
    });

    it('should throw error for missing required fields in conversion', () => {
      const incompletePayload = {
        sub: 'user-123',
        // missing iss, exp, iat
      };

      expect(() => (jwtValidator as any).convertToJWTPayload(incompletePayload)).toThrow('missing required claims');
    });
  });
});