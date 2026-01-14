import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ApiServer } from '../../src/api/server.js';

// Mock fetch globally for health checks
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock the ReportService to avoid actual OData calls
vi.mock('../../src/services/report-service.js', () => ({
    ReportService: class MockReportService {
      generateReport = vi.fn().mockResolvedValue({
        data: [],
        metadata: {
          entity: 'TestEntity',
          reportType: 'BalanceSheet',
          period: '2025-01',
          recordCount: 0,
          executionTime: 100,
          generatedAt: new Date(),
        },
      });
    },
  }));

describe('Health Check Endpoints', () => {
  let apiServer: ApiServer;
  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    apiServer = new ApiServer({
      port: 0,
      enableLogging: false,
      environment: 'test',
      healthCheck: {
        timeout: 1000,
        enableServiceChecks: false, // Disable by default for basic tests
      },
    });
    app = apiServer.getApp();
  });

  afterEach(async () => {
    if (apiServer) {
      await apiServer.stop();
    }
  });

  describe('GET /health', () => {
    it('should return health status with basic information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        timestamp: expect.any(String),
        environment: 'test',
        services: {},
        uptime: expect.any(Number),
      });
    });

    it('should return healthy status when no services configured', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toEqual({});
    });
  });

  describe('GET /health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(app)
        .get('/health/live')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        timestamp: expect.any(String),
        environment: 'test',
        services: {},
        uptime: expect.any(Number),
      });
    });

    it('should always return healthy for liveness check', async () => {
      const response = await request(app)
        .get('/health/live')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });
  });

  describe('GET /health/ready', () => {
    it('should return readiness status', async () => {
      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        timestamp: expect.any(String),
        environment: 'test',
        services: {},
        uptime: expect.any(Number),
      });
    });

    it('should return healthy when no services configured', async () => {
      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Health checks with service dependencies', () => {
    beforeEach(() => {
      apiServer = new ApiServer({
        port: 0,
        enableLogging: false,
        environment: 'test',
        healthCheck: {
          timeout: 1000,
          enableServiceChecks: true,
          odataServiceUrl: 'http://localhost:4004/odata/v4/financial',
          keycloakServiceUrl: 'http://localhost:8080',
        },
      });
      app = apiServer.getApp();
    });

    it('should return healthy when all services are healthy', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services).toHaveProperty('odata');
      expect(response.body.services).toHaveProperty('keycloak');
      expect(response.body.services.odata.status).toBe('healthy');
      expect(response.body.services.keycloak.status).toBe('healthy');
    });

    it('should return degraded when services have issues', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.odata.status).toBe('healthy');
      expect(response.body.services.keycloak.status).toBe('degraded');
    });

    it('should return 503 when services are unhealthy', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.services.odata.status).toBe('unhealthy');
      expect(response.body.services.keycloak.status).toBe('unhealthy');
    });

    it('should return 503 for readiness when any service is unhealthy', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app)
        .get('/health/ready')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });

    it('should include response times in service checks', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.services.odata.responseTime).toBeGreaterThanOrEqual(0);
      expect(response.body.services.keycloak.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should include error details when services fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.services.odata.error).toBe('Connection refused');
      expect(response.body.services.keycloak.status).toBe('healthy'); // Should fallback to realm endpoint
    });
  });

  describe('API info endpoint updates', () => {
    it('should include health endpoints in API info', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      // Check that health endpoints are present (authentication note may vary)
      expect(response.body.endpoints.health).toContain('GET /health');
      expect(response.body.endpoints.healthLive).toContain('GET /health/live');
      expect(response.body.endpoints.healthReady).toContain('GET /health/ready');
      expect(response.body.endpoints.reports).toContain('POST /api/reports');
      expect(response.body.endpoints.reportStatus).toContain('GET /api/reports/:id');
    });
  });

  describe('Error handling', () => {
    it('should handle health check errors gracefully', async () => {
      // Create a server with invalid configuration that might cause errors
      const errorServer = new ApiServer({
        port: 0,
        enableLogging: false,
        environment: 'test',
        healthCheck: {
          timeout: 1,
          enableServiceChecks: true,
          odataServiceUrl: 'invalid-url',
        },
      });

      const errorApp = errorServer.getApp();

      try {
        const response = await request(errorApp)
          .get('/health')
          .expect(503);

        expect(response.body.status).toBe('unhealthy');
        expect(response.body.services.odata.error).toBeDefined();
      } finally {
        await errorServer.stop();
      }
    });
  });
});