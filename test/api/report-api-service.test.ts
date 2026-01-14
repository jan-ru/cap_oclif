import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { ReportApiService } from '../../src/api/report-api-service.js';
import { ReportService } from '../../src/services/report-service.js';
import { CreateReportRequest } from '../../src/api/types.js';
import { ReportResult, ReportSpecification, ReportType } from '../../src/types/index.js';

// Mock the ReportService
vi.mock('../../src/services/report-service.js', () => ({
    ReportService: vi.fn().mockImplementation(() => ({
      generateReport: vi.fn(),
    })),
  }));

describe('ReportApiService', () => {
  let reportApiService: ReportApiService;
  let mockReportService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a mock ReportService instance
    mockReportService = {
      generateReport: vi.fn(),
    };
    
    reportApiService = new ReportApiService(mockReportService);
  });

  describe('validateCreateReportRequest', () => {
    it('should return no errors for valid request', () => {
      const validRequest: CreateReportRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
        outputFormat: 'json',
        verbose: false,
      };

      const errors = reportApiService.validateCreateReportRequest(validRequest);
      expect(errors).toHaveLength(0);
    });

    it('should return error for missing request body', () => {
      const errors = reportApiService.validateCreateReportRequest(null);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('request');
      expect(errors[0].message).toBe('Request body must be a valid JSON object');
    });

    it('should return error for missing specification', () => {
      const invalidRequest = {
        outputFormat: 'json',
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('specification');
      expect(errors[0].message).toBe('Report specification is required');
    });

    it('should return error for missing entity', () => {
      const invalidRequest = {
        specification: {
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('specification.entity');
      expect(errors[0].message).toBe('Entity is required and must be a string');
    });

    it('should return error for missing reportType', () => {
      const invalidRequest = {
        specification: {
          entity: 'TestEntity',
          period: '2025-01',
        },
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('specification.reportType');
      expect(errors[0].message).toBe('Report type is required and must be a string');
    });

    it('should return error for invalid period format', () => {
      const invalidRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-1', // Invalid format
        },
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('specification.period');
      expect(errors[0].message).toBe('Period must be in YYYY-MM format (e.g., "2025-01")');
    });

    it('should return error for invalid output format', () => {
      const invalidRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
        outputFormat: 'xml', // Invalid format
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('outputFormat');
      expect(errors[0].message).toBe('Output format must be one of: json, csv, table');
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const invalidRequest = {
        specification: {
          // Missing entity, reportType, period
        },
        outputFormat: 'xml',
        verbose: 'not-boolean',
      };

      const errors = reportApiService.validateCreateReportRequest(invalidRequest);
      expect(errors.length).toBeGreaterThan(1);
      
      const fieldNames = errors.map(e => e.field);
      expect(fieldNames).toContain('specification.entity');
      expect(fieldNames).toContain('specification.reportType');
      expect(fieldNames).toContain('specification.period');
      expect(fieldNames).toContain('outputFormat');
      expect(fieldNames).toContain('verbose');
    });
  });

  describe('createReport', () => {
    const validRequest: CreateReportRequest = {
      specification: {
        entity: 'TestEntity',
        reportType: ReportType.BalanceSheet,
        period: '2025-01',
      },
      outputFormat: 'json',
      verbose: false,
    };

    const mockReportResult: ReportResult = {
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
    };

    it('should successfully create report', async () => {
      mockReportService.generateReport = vi.fn().mockResolvedValue(mockReportResult);

      const response = await reportApiService.createReport(validRequest);

      expect(response.status).toBe('completed');
      expect(response.result).toEqual(mockReportResult);
      expect(response.id).toBeDefined();
      expect(response.createdAt).toBeDefined();
      expect(response.completedAt).toBeDefined();
      expect(response.executionTime).toBeGreaterThan(0);
    });

    it('should handle report generation error', async () => {
      const errorResponse = {
        error: {
          code: 'DATA_RETRIEVAL_ERROR',
          message: 'Failed to retrieve data',
        },
        timestamp: new Date(),
      };

      mockReportService.generateReport = vi.fn().mockRejectedValue(errorResponse);

      const response = await reportApiService.createReport(validRequest);

      expect(response.status).toBe('failed');
      expect(response.error).toEqual({
        code: 'DATA_RETRIEVAL_ERROR',
        message: 'Failed to retrieve data',
      });
      expect(response.id).toBeDefined();
      expect(response.createdAt).toBeDefined();
      expect(response.completedAt).toBeDefined();
      expect(response.executionTime).toBeGreaterThan(0);
    });

    it('should handle unexpected error', async () => {
      const unexpectedError = new Error('Unexpected error occurred');
      mockReportService.generateReport = vi.fn().mockRejectedValue(unexpectedError);

      const response = await reportApiService.createReport(validRequest);

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('REPORT_GENERATION_ERROR');
      expect(response.error?.message).toBe('Unexpected error occurred');
    });

    it('should handle unknown error type', async () => {
      mockReportService.generateReport = vi.fn().mockRejectedValue('string error');

      const response = await reportApiService.createReport(validRequest);

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('UNKNOWN_ERROR');
      expect(response.error?.message).toBe('An unexpected error occurred during report generation');
    });

    it('should use default values for optional parameters', async () => {
      mockReportService.generateReport = vi.fn().mockResolvedValue(mockReportResult);

      const minimalRequest: CreateReportRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      await reportApiService.createReport(minimalRequest);

      expect(mockReportService.generateReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          outputFormat: 'json',
          verbose: false,
        })
      );
    });
  });

  describe('getReportStatus', () => {
    it('should return null for non-existent job', () => {
      const status = reportApiService.getReportStatus('non-existent-id');
      expect(status).toBeNull();
    });

    it('should return job status for existing job', async () => {
      const validRequest: CreateReportRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      const mockReportResult: ReportResult = {
        data: [],
        metadata: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
          recordCount: 0,
          executionTime: 100,
          generatedAt: new Date(),
        },
      };

      mockReportService.generateReport = vi.fn().mockResolvedValue(mockReportResult);

      const createResponse = await reportApiService.createReport(validRequest);
      const status = reportApiService.getReportStatus(createResponse.id);

      expect(status).toBeDefined();
      expect(status?.id).toBe(createResponse.id);
      expect(status?.status).toBe('completed');
      expect(status?.result).toEqual(mockReportResult);
    });
  });

  describe('getAllJobs', () => {
    it('should return empty array when no jobs exist', () => {
      const jobs = reportApiService.getAllJobs();
      expect(jobs).toEqual([]);
    });

    it('should return all jobs', async () => {
      const validRequest: CreateReportRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      const mockReportResult: ReportResult = {
        data: [],
        metadata: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
          recordCount: 0,
          executionTime: 100,
          generatedAt: new Date(),
        },
      };

      mockReportService.generateReport = vi.fn().mockResolvedValue(mockReportResult);

      // Create two jobs
      await reportApiService.createReport(validRequest);
      await reportApiService.createReport(validRequest);

      const jobs = reportApiService.getAllJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].status).toBe('completed');
      expect(jobs[1].status).toBe('completed');
    });
  });

  describe('cleanupOldJobs', () => {
    it('should not clean up recent jobs', async () => {
      const validRequest: CreateReportRequest = {
        specification: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
        },
      };

      const mockReportResult: ReportResult = {
        data: [],
        metadata: {
          entity: 'TestEntity',
          reportType: ReportType.BalanceSheet,
          period: '2025-01',
          recordCount: 0,
          executionTime: 100,
          generatedAt: new Date(),
        },
      };

      mockReportService.generateReport = vi.fn().mockResolvedValue(mockReportResult);

      await reportApiService.createReport(validRequest);
      
      const cleanedCount = reportApiService.cleanupOldJobs();
      expect(cleanedCount).toBe(0);
      
      const jobs = reportApiService.getAllJobs();
      expect(jobs).toHaveLength(1);
    });
  });
});