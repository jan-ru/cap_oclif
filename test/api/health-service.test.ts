import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HealthService, HealthStatus, type HealthCheckConfig } from '../../src/api/health-service.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('HealthService', () => {
  let healthService: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    healthService = new HealthService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('performLivenessCheck', () => {
    it('should always return healthy status for liveness check', async () => {
      const result = await healthService.performLivenessCheck();

      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.version).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.environment).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.services).toEqual({});
    });

    it('should include correct uptime calculation', async () => {
      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      const result = await healthService.performLivenessCheck();

      expect(result.uptime).toBe(5);
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when no services configured', async () => {
      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.Healthy);
      expect(result.services).toEqual({});
    });

    it('should check OData service when configured', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.odata).toBeDefined();
      expect(result.services.odata.status).toBe(HealthStatus.Healthy);
      expect(result.services.odata.responseTime).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4004/odata/v4/financial',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        })
      );
    });

    it('should check Keycloak service when configured', async () => {
      const config: Partial<HealthCheckConfig> = {
        keycloakServiceUrl: 'http://localhost:8080',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.keycloak).toBeDefined();
      expect(result.services.keycloak.status).toBe(HealthStatus.Healthy);
      expect(result.services.keycloak.responseTime).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/health',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        })
      );
    });

    it('should handle service check disabled', async () => {
      const config: Partial<HealthCheckConfig> = {
        enableServiceChecks: false,
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
      };

      healthService = new HealthService(config);

      const result = await healthService.performHealthCheck();

      expect(result.services).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('OData service checks', () => {
    beforeEach(() => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        enableServiceChecks: true,
        timeout: 1000,
      };
      healthService = new HealthService(config);
    });

    it('should handle successful OData response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.odata.status).toBe(HealthStatus.Healthy);
      expect(result.services.odata.responseTime).toBeDefined();
      expect(result.services.odata.error).toBeUndefined();
    });

    it('should handle 401 unauthorized as healthy (service running)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.odata.status).toBe(HealthStatus.Healthy);
      expect(result.services.odata.responseTime).toBeDefined();
    });

    it('should handle HTTP errors as degraded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.odata.status).toBe(HealthStatus.Degraded);
      expect(result.services.odata.error).toBe('HTTP 500: Internal Server Error');
    });

    it('should handle network errors as unhealthy', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await healthService.performHealthCheck();

      expect(result.services.odata.status).toBe(HealthStatus.Unhealthy);
      expect(result.services.odata.error).toBe('Network error');
    });

    it('should handle timeout as unhealthy', async () => {
      const abortError = new Error('Timeout');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await healthService.performHealthCheck();

      expect(result.services.odata.status).toBe(HealthStatus.Unhealthy);
      expect(result.services.odata.error).toBe('Timeout after 1000ms');
    });

    it('should handle missing URL configuration', async () => {
      healthService = new HealthService({
        enableServiceChecks: true,
        // odataServiceUrl not provided
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.odata).toBeUndefined();
    });
  });

  describe('Keycloak service checks', () => {
    beforeEach(() => {
      const config: Partial<HealthCheckConfig> = {
        keycloakServiceUrl: 'http://localhost:8080',
        enableServiceChecks: true,
        timeout: 1000,
      };
      healthService = new HealthService(config);
    });

    it('should handle successful Keycloak health response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.keycloak.status).toBe(HealthStatus.Healthy);
      expect(result.services.keycloak.responseTime).toBeDefined();
    });

    it('should fallback to realm endpoint when health endpoint returns 404', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

      const result = await healthService.performHealthCheck();

      expect(result.services.keycloak.status).toBe(HealthStatus.Healthy);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://localhost:8080/health', expect.any(Object));
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost:8080/realms/master', expect.any(Object));
    });

    it('should handle Keycloak service errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await healthService.performHealthCheck();

      expect(result.services.keycloak.status).toBe(HealthStatus.Degraded);
      expect(result.services.keycloak.error).toBe('HTTP 500: Internal Server Error');
    });
  });

  describe('overall status determination', () => {
    it('should return healthy when all services are healthy', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        keycloakServiceUrl: 'http://localhost:8080',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.Healthy);
    });

    it('should return degraded when any service is degraded', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        keycloakServiceUrl: 'http://localhost:8080',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.Degraded);
    });

    it('should return unhealthy when any service is unhealthy', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        keycloakServiceUrl: 'http://localhost:8080',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await healthService.performHealthCheck();

      expect(result.status).toBe(HealthStatus.Unhealthy);
    });
  });

  describe('readiness checks', () => {
    it('should be unhealthy for readiness when any service is unhealthy', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await healthService.performReadinessCheck();

      expect(result.status).toBe(HealthStatus.Unhealthy);
    });

    it('should be healthy for readiness when all services are healthy or degraded', async () => {
      const config: Partial<HealthCheckConfig> = {
        odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
        enableServiceChecks: true,
      };

      healthService = new HealthService(config);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });

      const result = await healthService.performReadinessCheck();

      expect(result.status).toBe(HealthStatus.Degraded);
    });
  });

  describe('configuration management', () => {
    it('should update configuration', () => {
      const newConfig: Partial<HealthCheckConfig> = {
        timeout: 10_000,
        odataServiceUrl: 'http://new-url:4004',
      };

      healthService.updateConfig(newConfig);
      const currentConfig = healthService.getConfig();

      expect(currentConfig.timeout).toBe(10_000);
      expect(currentConfig.odataServiceUrl).toBe('http://new-url:4004');
    });

    it('should return current configuration', () => {
      const config = healthService.getConfig();

      expect(config).toHaveProperty('timeout');
      expect(config).toHaveProperty('enableServiceChecks');
    });
  });
});