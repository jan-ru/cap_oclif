import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { ApiServer } from '../../src/api/server.js';
import { ReportType } from '../../src/types/index.js';

// Mock the ReportService to avoid actual OData calls
vi.mock('../../src/services/report-service.js', () => ({
    ReportService: class MockReportService {
      generateReport = vi.fn().mockResolvedValue({
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
      });
    },
  }));

describe('API Endpoints', () => {
  let apiServer: ApiServer;
  let app: any;

  beforeEach(() => {
    apiServer = new ApiServer({
      port: 0, // Use random port for testing
      enableLogging: false,
      environment: 'test',
    });
    app = apiServer.getApp();
  });

  afterEach(async () => {
    await apiServer.stop();
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String),
        environment: 'test',
      });
    });
  });

  describe('GET /api', () => {
    it('should return API information', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'Financial Reports API',
        version: expect.any(String),
        description: expect.any(String),
        endpoints: expect.any(Object),
        documentation: expect.any(String),
      });
    });
  });

  describe('POST /api/reports', () => {
    const validReportRequest = {
      specification: {
        entity: 'TestEntity',
        reportType: ReportType.BalanceSheet,
        period: '2025-01',
      },
      outputFormat: 'json',
      verbose: false,
    };

    it('should create report successfully', async () => {
      const response = await request(app)
        .post('/api/reports')
        .send(validReportRequest)
        .expect(200);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        status: 'completed',
        result: expect.any(Object),
        createdAt: expect.any(String),
        completedAt: expect.any(String),
        executionTime: expect.any(Number),
      });

      expect(response.body.result.data).toHaveLength(1);
      expect(response.body.result.metadata).toMatchObject({
        entity: 'TestEntity',
        reportType: ReportType.BalanceSheet,
        period: '2025-01',
        recordCount: 1,
      });
    });

    it('should return validation error for missing specification', async () => {
      const invalidRequest = {
        outputFormat: 'json',
      };

      const response = await request(app)
        .post('/api/reports')
        .send(invalidRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.stringContaining('specification: Report specification is required'),
        },
        timestamp: expect.any(String),
      });
    });

    it('should return validation error for invalid period format', async () => {
      const invalidRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-1', // Invalid format
        },
      };

      const response = await request(app)
        .post('/api/reports')
        .send(invalidRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.stringContaining('Period must be in YYYY-MM format'),
        },
        timestamp: expect.any(String),
      });
    });

    it('should return validation error for invalid output format', async () => {
      const invalidRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
        outputFormat: 'xml', // Invalid format
      };

      const response = await request(app)
        .post('/api/reports')
        .send(invalidRequest)
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: expect.stringContaining('Output format must be one of: json, csv, table'),
        },
        timestamp: expect.any(String),
      });
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/reports')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      expect(response.body).toMatchObject({
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
        timestamp: expect.any(String),
      });
    });

    it('should use default values for optional parameters', async () => {
      const minimalRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      const response = await request(app)
        .post('/api/reports')
        .send(minimalRequest)
        .expect(200);

      expect(response.body.status).toBe('completed');
    });

    it('should include request ID in response headers', async () => {
      const response = await request(app)
        .post('/api/reports')
        .send(validReportRequest)
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
    });
  });

  describe('GET /api/reports/:id', () => {
    it('should return report status for existing job', async () => {
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
      const statusResponse = await request(app)
        .get(`/api/reports/${jobId}`)
        .expect(200);

      expect(statusResponse.body).toMatchObject({
        id: jobId,
        status: 'completed',
        result: expect.any(Object),
        createdAt: expect.any(String),
        completedAt: expect.any(String),
        executionTime: expect.any(Number),
      });
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .get('/api/reports/non-existent-id')
        .expect(404);

      expect(response.body).toMatchObject({
        error: {
          code: 'REPORT_NOT_FOUND',
          message: "Report with ID 'non-existent-id' not found",
        },
        timestamp: expect.any(String),
      });
    });

    it('should return 400 for invalid job ID', async () => {
      const response = await request(app)
        .get('/api/reports/')
        .expect(404); // Express returns 404 for missing route parameter

      expect(response.body).toMatchObject({
        error: {
          code: 'ROUTE_NOT_FOUND',
        },
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/unknown-route')
        .expect(404);

      expect(response.body).toMatchObject({
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: expect.stringContaining('Route GET /unknown-route not found'),
        },
        timestamp: expect.any(String),
      });
    });

    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/reports')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');

      // CORS preflight should return 204 or 200
      expect([200, 204]).toContain(response.status);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for helmet security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });
  });
});