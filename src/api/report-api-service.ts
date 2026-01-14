import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReportService } from '../services/report-service.js';
import { 
  ReportOptions, 
  ErrorResponse 
} from '../types/index.js';
import { 
  ReportJob, 
  CreateReportRequest, 
  CreateReportResponse, 
  GetReportStatusResponse,
  ApiValidationError 
} from './types.js';
import { UserContext } from '../auth/types.js';

/**
 * API service for handling report generation requests
 * Manages report jobs and provides async processing capabilities
 */
export class ReportApiService {
  private reportService: ReportService;
  private jobs: Map<string, ReportJob> = new Map();

  constructor(reportService?: ReportService) {
    this.reportService = reportService || new ReportService();
  }

  /**
   * Validates a report creation request
   */
  validateCreateReportRequest(request: unknown): ApiValidationError[] {
    const errors: ApiValidationError[] = [];

    if (!request || typeof request !== 'object') {
      errors.push({
        field: 'request',
        message: 'Request body must be a valid JSON object',
        value: request,
      });
      return errors;
    }

    const req = request as Partial<CreateReportRequest>;

    // Validate specification
    if (!req.specification) {
      errors.push({
        field: 'specification',
        message: 'Report specification is required',
      });
    } else if (typeof req.specification === 'object') {
      // Validate required specification fields
      const spec = req.specification;
      
      if (!spec.entity || typeof spec.entity !== 'string') {
        errors.push({
          field: 'specification.entity',
          message: 'Entity is required and must be a string',
          value: spec.entity,
        });
      }

      if (!spec.reportType || typeof spec.reportType !== 'string') {
        errors.push({
          field: 'specification.reportType',
          message: 'Report type is required and must be a string',
          value: spec.reportType,
        });
      }

      if (!spec.period || typeof spec.period !== 'string') {
        errors.push({
          field: 'specification.period',
          message: 'Period is required and must be a string in YYYY-MM format',
          value: spec.period,
        });
      } else if (!/^\d{4}-\d{2}$/.test(spec.period)) {
        errors.push({
          field: 'specification.period',
          message: 'Period must be in YYYY-MM format (e.g., "2025-01")',
          value: spec.period,
        });
      }
    } else {
      errors.push({
        field: 'specification',
        message: 'Report specification must be an object',
        value: req.specification,
      });
    }

    // Validate output format if provided
    if (req.outputFormat && !['json', 'csv', 'table'].includes(req.outputFormat)) {
      errors.push({
        field: 'outputFormat',
        message: 'Output format must be one of: json, csv, table',
        value: req.outputFormat,
      });
    }

    // Validate verbose if provided
    if (req.verbose !== undefined && typeof req.verbose !== 'boolean') {
      errors.push({
        field: 'verbose',
        message: 'Verbose must be a boolean',
        value: req.verbose,
      });
    }

    return errors;
  }

  /**
   * Creates and processes a report generation request
   * Requirement 2.5: Access user context in route handlers
   */
  async createReport(request: CreateReportRequest, userContext?: UserContext): Promise<CreateReportResponse> {
    const jobId = randomUUID();
    const createdAt = new Date();

    // Create job with user context
    const job: ReportJob = {
      id: jobId,
      specification: request.specification,
      outputFormat: request.outputFormat || 'json',
      verbose: request.verbose || false,
      status: 'processing',
      createdAt,
      progress: {
        step: 'Starting report generation',
        percentage: 0,
      },
    };

    // Add user context for audit trail if available
    if (userContext) {
      job.userContext = {
        userId: userContext.userId,
        username: userContext.username,
        realm: userContext.realm,
        isServiceAccount: userContext.isServiceAccount
      };
    }

    this.jobs.set(jobId, job);

    try {
      // Create temporary file for the specification
      const tempDir = tmpdir();
      const specFile = join(tempDir, `spec-${jobId}.json`);
      
      await writeFile(specFile, JSON.stringify(request.specification, null, 2));

      // Update progress
      job.progress = {
        step: 'Processing specification',
        percentage: 25,
      };

      // Generate report using existing ReportService
      const options: ReportOptions = {
        outputFormat: job.outputFormat,
        verbose: job.verbose,
      };

      job.progress = {
        step: 'Generating report',
        percentage: 50,
      };

      const result = await this.reportService.generateReport(specFile, options);

      // Update job with success
      job.status = 'completed';
      job.result = result;
      job.completedAt = new Date();
      job.progress = {
        step: 'Report generation completed',
        percentage: 100,
      };

      // Clean up temp file (fire and forget)
      import('node:fs/promises').then(fs => fs.unlink(specFile).catch(() => {}));

      return {
        id: jobId,
        status: 'completed',
        result,
        createdAt: createdAt.toISOString(),
        completedAt: job.completedAt.toISOString(),
        executionTime: job.completedAt.getTime() - createdAt.getTime(),
      };

    } catch (error) {
      // Update job with failure
      job.status = 'failed';
      job.completedAt = new Date();

      let errorResponse: { code: string; message: string; details?: string };

      if (this.isErrorResponse(error)) {
        errorResponse = {
          code: error.error.code,
          message: error.error.message,
          ...(error.error.details && { details: error.error.details }),
        };
      } else if (error instanceof Error) {
        errorResponse = {
          code: 'REPORT_GENERATION_ERROR',
          message: error.message,
        };
      } else {
        errorResponse = {
          code: 'UNKNOWN_ERROR',
          message: 'An unexpected error occurred during report generation',
        };
      }

      job.error = errorResponse;

      return {
        id: jobId,
        status: 'failed',
        error: errorResponse,
        createdAt: createdAt.toISOString(),
        completedAt: job.completedAt.toISOString(),
        executionTime: job.completedAt.getTime() - createdAt.getTime(),
      };
    }
  }

  /**
   * Gets the status of a report generation job
   * Implements basic access control - users can only see their own jobs unless they have admin role
   */
  getReportStatus(jobId: string, userContext?: UserContext): GetReportStatusResponse | null {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return null;
    }

    // Implement role-based access control
    if (userContext && job.userContext) {
      const hasAdminRole = this.hasRole(userContext, 'admin') || this.hasRole(userContext, 'report-admin');
      const isOwner = job.userContext.userId === userContext.userId;
      
      if (!hasAdminRole && !isOwner) {
        // User doesn't have permission to view this job
        return null;
      }
    }

    const response: GetReportStatusResponse = {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
    };

    if (job.result) {
      response.result = job.result;
    }

    if (job.error) {
      response.error = job.error;
    }

    if (job.completedAt) {
      response.completedAt = job.completedAt.toISOString();
      response.executionTime = job.completedAt.getTime() - job.createdAt.getTime();
    }

    if (job.progress) {
      response.progress = job.progress;
    }

    return response;
  }

  /**
   * Gets all jobs (for debugging/admin purposes)
   * Requires admin role for access
   */
  getAllJobs(userContext?: UserContext): GetReportStatusResponse[] {
    // Implement role-based access control - only admins can see all jobs
    if (userContext && !this.hasRole(userContext, 'admin') && !this.hasRole(userContext, 'report-admin')) {
      // Non-admin users can only see their own jobs
      return [...this.jobs.values()]
        .filter(job => job.userContext?.userId === userContext.userId)
        .map(job => this.mapJobToResponse(job));
    }

    return [...this.jobs.values()].map(job => this.mapJobToResponse(job));
  }

  /**
   * Helper method to check if user has a specific role
   */
  private hasRole(userContext: UserContext, roleName: string): boolean {
    // Check realm roles
    if (userContext.roles.includes(roleName)) {
      return true;
    }

    // Check client roles across all clients
    for (const clientRoles of Object.values(userContext.clientRoles)) {
      if (clientRoles.includes(roleName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Helper method to map job to response
   */
  private mapJobToResponse(job: ReportJob): GetReportStatusResponse {
    const response: GetReportStatusResponse = {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
    };

    if (job.result) {
      response.result = job.result;
    }

    if (job.error) {
      response.error = job.error;
    }

    if (job.completedAt) {
      response.completedAt = job.completedAt.toISOString();
      response.executionTime = job.completedAt.getTime() - job.createdAt.getTime();
    }

    if (job.progress) {
      response.progress = job.progress;
    }

    return response;
  }

  /**
   * Cleans up old completed jobs (older than 1 hour)
   */
  cleanupOldJobs(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Type guard to check if an object is an ErrorResponse
   */
  private isErrorResponse(obj: unknown): obj is ErrorResponse {
    return Boolean(
      obj &&
      typeof obj === 'object' &&
      'error' in obj &&
      typeof (obj as ErrorResponse).error.code === 'string' &&
      typeof (obj as ErrorResponse).error.message === 'string' &&
      'timestamp' in obj
    );
  }
}