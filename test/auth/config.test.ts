import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthConfigLoader } from '../../src/auth/config.js';

describe('AuthConfigLoader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment and cache before each test
    process.env = { ...originalEnv };
    // Clear the cached config
    (AuthConfigLoader as any).cachedConfig = null;
    (AuthConfigLoader as any).configWatchers = [];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load basic configuration from environment variables', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';

      const config = AuthConfigLoader.loadConfig();

      expect(config.keycloak.url).toBe('https://keycloak.example.com');
      expect(config.keycloak.realm).toBe('test-realm');
      expect(config.jwt.issuer).toBe('https://keycloak.example.com/realms/test-realm');
      expect(config.jwt.algorithms).toEqual(['RS256']);
      expect(config.jwt.clockTolerance).toBe(30);
    });

    it('should load optional configuration parameters', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.KEYCLOAK_CLIENT_ID = 'test-client';
      process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
      process.env.JWT_AUDIENCE = 'test-audience';
      process.env.JWT_ALGORITHMS = 'RS256,RS384';
      process.env.ALLOWED_ORIGINS = 'https://app1.com,https://app2.com';

      const config = AuthConfigLoader.loadConfig();

      expect(config.keycloak.clientId).toBe('test-client');
      expect(config.keycloak.clientSecret).toBe('test-secret');
      expect(config.jwt.audience).toBe('test-audience');
      expect(config.jwt.algorithms).toEqual(['RS256', 'RS384']);
      expect(config.security.allowedOrigins).toEqual(['https://app1.com', 'https://app2.com']);
    });

    it('should throw error for missing required environment variables', () => {
      expect(() => AuthConfigLoader.loadConfig()).toThrow('Required environment variable KEYCLOAK_URL is not set');

      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      expect(() => AuthConfigLoader.loadConfig()).toThrow('Required environment variable KEYCLOAK_REALM is not set');

      process.env.KEYCLOAK_REALM = 'test-realm';
      expect(() => AuthConfigLoader.loadConfig()).toThrow('Required environment variable JWT_ISSUER is not set');
    });

    it('should validate URL formats', () => {
      process.env.KEYCLOAK_URL = 'invalid-url';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';

      expect(() => AuthConfigLoader.loadConfig()).toThrow('Invalid Keycloak URL: invalid-url');
    });

    it('should validate JWT algorithms', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';
      process.env.JWT_ALGORITHMS = 'INVALID_ALG';

      expect(() => AuthConfigLoader.loadConfig()).toThrow('Unsupported JWT algorithm: INVALID_ALG');
    });
  });

  describe('multi-realm support', () => {
    beforeEach(() => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';
    });

    it('should load multiple realms from JSON configuration', () => {
      const realmsConfig = JSON.stringify([
        {
          name: 'tenant1',
          url: 'https://keycloak.example.com',
          issuer: 'https://keycloak.example.com/realms/tenant1',
          clientId: 'tenant1-client'
        },
        {
          name: 'tenant2',
          url: 'https://keycloak2.example.com',
          issuer: 'https://keycloak2.example.com/realms/tenant2'
        }
      ]);
      process.env.KEYCLOAK_REALMS_CONFIG = realmsConfig;

      const config = AuthConfigLoader.loadConfig();

      expect(config.keycloak.realms).toHaveLength(2);
      expect(config.keycloak.realms![0].name).toBe('tenant1');
      expect(config.keycloak.realms![0].clientId).toBe('tenant1-client');
      expect(config.keycloak.realms![1].name).toBe('tenant2');
    });

    it('should load multiple realms from individual environment variables', () => {
      process.env.REALM_1_NAME = 'tenant1';
      process.env.REALM_1_URL = 'https://keycloak.example.com';
      process.env.REALM_1_ISSUER = 'https://keycloak.example.com/realms/tenant1';
      process.env.REALM_1_CLIENT_ID = 'tenant1-client';

      process.env.REALM_2_NAME = 'tenant2';
      process.env.REALM_2_URL = 'https://keycloak2.example.com';
      process.env.REALM_2_ISSUER = 'https://keycloak2.example.com/realms/tenant2';

      const config = AuthConfigLoader.loadConfig();

      expect(config.keycloak.realms).toHaveLength(2);
      expect(config.keycloak.realms![0].name).toBe('tenant1');
      expect(config.keycloak.realms![0].clientId).toBe('tenant1-client');
      expect(config.keycloak.realms![1].name).toBe('tenant2');
    });

    it('should throw error for incomplete realm configuration', () => {
      process.env.REALM_1_NAME = 'tenant1';
      process.env.REALM_1_URL = 'https://keycloak.example.com';
      // Missing REALM_1_ISSUER

      expect(() => AuthConfigLoader.loadConfig()).toThrow('Incomplete realm configuration for REALM_1');
    });

    it('should validate realm configuration URLs', () => {
      const realmsConfig = JSON.stringify([
        {
          name: 'tenant1',
          url: 'invalid-url',
          issuer: 'https://keycloak.example.com/realms/tenant1'
        }
      ]);
      process.env.KEYCLOAK_REALMS_CONFIG = realmsConfig;

      expect(() => AuthConfigLoader.loadConfig()).toThrow('Invalid URL for realm tenant1');
    });
  });

  describe('getRealmConfig', () => {
    beforeEach(() => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';
      process.env.KEYCLOAK_CLIENT_ID = 'default-client';
    });

    it('should return default realm configuration', () => {
      const config = AuthConfigLoader.loadConfig();
      const realmConfig = AuthConfigLoader.getRealmConfig('default-realm', config);

      expect(realmConfig).not.toBeNull();
      expect(realmConfig!.name).toBe('default-realm');
      expect(realmConfig!.url).toBe('https://keycloak.example.com');
      expect(realmConfig!.clientId).toBe('default-client');
    });

    it('should return specific realm configuration', () => {
      const realmsConfig = JSON.stringify([
        {
          name: 'tenant1',
          url: 'https://keycloak.example.com',
          issuer: 'https://keycloak.example.com/realms/tenant1',
          clientId: 'tenant1-client'
        }
      ]);
      process.env.KEYCLOAK_REALMS_CONFIG = realmsConfig;

      const config = AuthConfigLoader.loadConfig();
      const realmConfig = AuthConfigLoader.getRealmConfig('tenant1', config);

      expect(realmConfig).not.toBeNull();
      expect(realmConfig!.name).toBe('tenant1');
      expect(realmConfig!.clientId).toBe('tenant1-client');
    });

    it('should return null for non-existent realm', () => {
      const config = AuthConfigLoader.loadConfig();
      const realmConfig = AuthConfigLoader.getRealmConfig('non-existent', config);

      expect(realmConfig).toBeNull();
    });
  });

  describe('getAvailableRealms', () => {
    it('should return default realm when no additional realms configured', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';

      const config = AuthConfigLoader.loadConfig();
      const realms = AuthConfigLoader.getAvailableRealms(config);

      expect(realms).toEqual(['default-realm']);
    });

    it('should return all configured realms', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';

      const realmsConfig = JSON.stringify([
        { name: 'tenant1', url: 'https://keycloak.example.com', issuer: 'https://keycloak.example.com/realms/tenant1' },
        { name: 'tenant2', url: 'https://keycloak.example.com', issuer: 'https://keycloak.example.com/realms/tenant2' }
      ]);
      process.env.KEYCLOAK_REALMS_CONFIG = realmsConfig;

      const config = AuthConfigLoader.loadConfig();
      const realms = AuthConfigLoader.getAvailableRealms(config);

      expect(realms).toEqual(['default-realm', 'tenant1', 'tenant2']);
    });
  });

  describe('getJwksUri', () => {
    it('should generate JWKS URI for default realm', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';

      const config = AuthConfigLoader.loadConfig();
      const jwksUri = AuthConfigLoader.getJwksUri(config);

      expect(jwksUri).toBe('https://keycloak.example.com/realms/default-realm/protocol/openid_connect/certs');
    });

    it('should generate JWKS URI for specific realm', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'default-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/default-realm';

      const realmsConfig = JSON.stringify([
        { name: 'tenant1', url: 'https://keycloak2.example.com', issuer: 'https://keycloak2.example.com/realms/tenant1' }
      ]);
      process.env.KEYCLOAK_REALMS_CONFIG = realmsConfig;

      const config = AuthConfigLoader.loadConfig();
      const jwksUri = AuthConfigLoader.getJwksUri(config, 'tenant1');

      expect(jwksUri).toBe('https://keycloak2.example.com/realms/tenant1/protocol/openid_connect/certs');
    });
  });

  describe('reloadConfig', () => {
    it('should reload configuration and notify watchers', () => {
      process.env.KEYCLOAK_URL = 'https://keycloak.example.com';
      process.env.KEYCLOAK_REALM = 'test-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/test-realm';

      // Load initial config
      const initialConfig = AuthConfigLoader.loadConfig();
      expect(initialConfig.keycloak.realm).toBe('test-realm');

      // Set up watcher
      let watcherCalled = false;
      let watcherConfig: any = null;
      const watcher = (config: any) => {
        watcherCalled = true;
        watcherConfig = config;
      };
      AuthConfigLoader.onConfigChange(watcher);

      // Change environment and reload
      process.env.KEYCLOAK_REALM = 'new-realm';
      process.env.JWT_ISSUER = 'https://keycloak.example.com/realms/new-realm';
      
      const reloadedConfig = AuthConfigLoader.reloadConfig();

      expect(reloadedConfig.keycloak.realm).toBe('new-realm');
      expect(watcherCalled).toBe(true);
      expect(watcherConfig.keycloak.realm).toBe('new-realm');
    });
  });
});