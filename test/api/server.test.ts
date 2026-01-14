import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { ApiServer } from '../../src/api/server.js';
import { ReportType } from '../../src/types/index.js';

// Mock the entire ReportApiService instead of ReportService
vi.mock('../../src/api/report-api-service.js', () => ({
    ReportApiService: class MockReportApiService {
      validateCreateReportRequest = vi.fn().mockReturnValue([]);
      createReport = vi.fn().mockResolvedValue({
        id: 'test-job-id',
        status: 'completed',
        result: {
          data: [{
            entity: 'TestEntity',
            reportType: ReportType.BalanceSheet,
            period: '2025-01',
            lineItems: [
              {
                account: 'Assets',
                amount: 100_000,
                currency: 'USD',
              },
            ],
          }],
          metadata: {
            entity: 'TestEntity',
            reportType: ReportType.BalanceSheet,
            period: '2025-01',
            recordCount: 1,
            executionTime: 100,
            generatedAt: new Date('2025-01-13T10:00:00Z'),
          },
        },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionTime: 100,
      });
      getReportStatus = vi.fn().mockReturnValue({
        id: 'test-job-id',
        status: 'completed',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionTime: 100,
      });
    },
  }));

describe('API Server Tests', () => {
  let server: ApiServer;
  let app: any;

  beforeAll(() => {
    server = new ApiServer({
      port: 0, // Use random port for testing
      enableLogging: false, // Disable logging in tests
      environment: 'test',
    });
    app = server.getApp();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Health Check Endpoints', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment', 'test');
    });
  });

  describe('API Info Endpoints', () => {
    test('should return API information', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      expect(response.body).toHaveProperty('name', 'Financial Reports API');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body.endpoints).toHaveProperty('health');
      expect(response.body.endpoints).toHaveProperty('reports');
    });
  });

  describe('Report Endpoints', () => {
    test('should handle POST /api/reports with valid data', async () => {
      const validRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
        outputFormat: 'json',
      };

      const response = await request(app)
        .post('/api/reports')
        .send(validRequest)
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status', 'completed');
      expect(response.body).toHaveProperty('result');
    });

    test('should handle GET /api/reports/:id for existing job', async () => {
      // First create a report
      const createResponse = await request(app)
        .post('/api/reports')
        .send({
          specification: {
            entity: 'TestEntity',
            reportType: ReportType.BalanceSheet,
            period: '2025-01',
          },
        })
        .expect(200);

      const jobId = createResponse.body.id;

      // Then get its status
      const response = await request(app)
        .get(`/api/reports/${jobId}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', jobId);
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', 'ROUTE_NOT_FOUND');
      expect(response.body.error.message).toContain('GET /nonexistent not found');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('should handle invalid JSON in request body', async () => {
      const response = await request(app)
        .post('/api/reports')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code', 'INVALID_JSON');
    });
  });

  describe('CORS Headers', () => {
    test('should include CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      // CORS middleware should add credentials header
      expect(response.headers).toHaveProperty('access-control-allow-credentials');
    });

    test('should handle OPTIONS requests', async () => {
      await request(app)
        .options('/api/reports')
        .expect(204);
    });
  });

  describe('Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });
  });
});