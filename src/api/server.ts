import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Algorithm } from 'jsonwebtoken';

import { logger } from '../cli.js';
import { ErrorResponse } from '../types/index.js';
import { ReportApiService } from './report-api-service.js';
import { CreateReportRequest } from './types.js';
import { HealthService, HealthStatus } from './health-service.js';
import { 
  AuthenticationMiddlewareService,
  AuthenticatedRequest,
  JWTValidatorService,
  UserContextExtractorService,
  AuthenticationAuditorService,
  AuthenticationRateLimiter,
  AuthConfigLoader,
  JWKSClientService
} from '../auth/index.js';

/**
 * Configuration interface for the API server
 */
export interface ApiServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  enableLogging: boolean;
  environment: 'development' | 'production' | 'test';
  healthCheck?: {
    timeout?: number;
    enableServiceChecks?: boolean;
    odataServiceUrl?: string;
    keycloakServiceUrl?: string;
  };
  authentication?: {
    enabled: boolean;
    protectedRoutes?: string[];
    publicRoutes?: string[];
  };
}

/**
 * Default configuration for the API server
 */
const DEFAULT_CONFIG: ApiServerConfig = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
  enableLogging: process.env.NODE_ENV !== 'test',
  environment: (process.env.NODE_ENV as ApiServerConfig['environment']) || 'development',
  authentication: {
    enabled: process.env.AUTH_ENABLED !== 'false',
    protectedRoutes: ['/api/reports', '/api/admin'],
    publicRoutes: ['/health', '/health/live', '/health/ready', '/api']
  }
};

/**
 * Express.js API server for HTTP mode
 * Provides REST endpoints for financial report generation
 */
export class ApiServer {
  private app: Application;
  private config: ApiServerConfig;
  private server?: import('http').Server;
  private reportApiService: ReportApiService;
  private healthService: HealthService;
  private authMiddleware?: AuthenticationMiddlewareService;

  constructor(config: Partial<ApiServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.app = express();
    this.reportApiService = new ReportApiService();
    this.healthService = new HealthService(this.config.healthCheck);
    this.setupMiddleware();
    this.setupAuthentication();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Configure Express middleware
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: this.config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID'],
      credentials: true,
    }));

    // Request parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging (only in non-test environments)
    if (this.config.enableLogging) {
      this.app.use(morgan('combined', {
        stream: {
          write(message: string) {
            logger.info(`HTTP: ${message.trim()}`);
          },
        },
      }));
    }

    // Request ID middleware for tracing
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = req.headers['x-request-id'] || 
                       `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      req.headers['x-request-id'] = requestId as string;
      res.setHeader('X-Request-ID', requestId);
      next();
    });
  }

  /**
   * Set up authentication middleware
   * Requirements: 1.1, 1.4 - Add authentication middleware to protected routes
   */
  private setupAuthentication(): void {
    if (!this.config.authentication?.enabled) {
      logger.info('Authentication is disabled');
      return;
    }

    try {
      // Load authentication configuration
      const authConfig = AuthConfigLoader.loadConfig();
      const middlewareConfig = AuthConfigLoader.createAuthConfig(authConfig);

      // Update health service with Keycloak URL for health checks
      if (this.config.healthCheck) {
        this.config.healthCheck.keycloakServiceUrl = authConfig.keycloak.url;
        this.healthService.updateConfig(this.config.healthCheck);
      }

      // Create authentication components
      const jwksClient = new JWKSClientService(middlewareConfig.jwksUri!, middlewareConfig.cacheTimeout);
      
      const jwtValidator = new JWTValidatorService(
        jwksClient,
        authConfig.jwt.issuer,
        {
          ...(authConfig.jwt.audience && { audience: authConfig.jwt.audience }),
          clockTolerance: authConfig.jwt.clockTolerance,
          algorithms: authConfig.jwt.algorithms as Algorithm[]
        }
      );
      
      const userContextExtractor = new UserContextExtractorService();
      const auditor = new AuthenticationAuditorService();
      const rateLimiter = new AuthenticationRateLimiter(middlewareConfig.rateLimitConfig, auditor);

      // Create authentication middleware
      this.authMiddleware = new AuthenticationMiddlewareService(
        jwtValidator,
        userContextExtractor,
        auditor,
        middlewareConfig,
        rateLimiter
      );

      logger.info('Authentication middleware configured successfully');
      logger.info(`Protected routes: ${this.config.authentication.protectedRoutes?.join(', ') || 'none'}`);
      logger.info(`Public routes: ${this.config.authentication.publicRoutes?.join(', ') || 'none'}`);

    } catch (error) {
      logger.error('Failed to setup authentication:', error);
      if (this.config.environment === 'production') {
        throw error; // Fail fast in production
      } else {
        logger.warn('Continuing without authentication in development mode');
      }
    }
  }

  /**
   * Check if a route should be protected by authentication
   */
  private isProtectedRoute(path: string): boolean {
    if (!this.config.authentication?.enabled) {
      return false;
    }

    const publicRoutes = this.config.authentication.publicRoutes || [];
    const protectedRoutes = this.config.authentication.protectedRoutes || [];

    // Check if explicitly marked as public
    if (publicRoutes.some(route => path.startsWith(route))) {
      return false;
    }

    // Check if explicitly marked as protected
    if (protectedRoutes.some(route => path.startsWith(route))) {
      return true;
    }

    // Default behavior: protect all routes except health checks
    return !path.startsWith('/health') && !path.startsWith('/api') || path.startsWith('/api/reports');
  }

  /**
   * Apply authentication middleware to a route if needed
   */
  private applyAuthenticationIfNeeded(path: string): (req: Request, res: Response, next: NextFunction) => void {
    if (!this.isProtectedRoute(path) || !this.authMiddleware) {
      return (_req: Request, _res: Response, next: NextFunction) => next();
    }

    return (req: Request, res: Response, next: NextFunction) => {
      this.authMiddleware!.authenticate(req, res, next);
    };
  }

  /**
   * Set up API routes
   */
  private setupRoutes(): void {
    // Health check endpoints
    this.app.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const healthResult = await this.performEnhancedHealthCheck();
        const statusCode = this.getHttpStatusForHealth(healthResult.status);
        res.status(statusCode).json(healthResult);
      } catch (error) {
        next(error);
      }
    });

    this.app.get('/health/live', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const healthResult = await this.healthService.performLivenessCheck();
        const statusCode = this.getHttpStatusForHealth(healthResult.status);
        res.status(statusCode).json(healthResult);
      } catch (error) {
        next(error);
      }
    });

    this.app.get('/health/ready', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const healthResult = await this.performEnhancedReadinessCheck();
        const statusCode = this.getHttpStatusForHealth(healthResult.status);
        res.status(statusCode).json(healthResult);
      } catch (error) {
        next(error);
      }
    });

    // API info endpoint
    this.app.get('/api', (_req: Request, res: Response) => {
      const authEnabled = this.config.authentication?.enabled || false;
      
      res.json({
        name: 'Financial Reports API',
        version: process.env.npm_package_version || '0.1.3',
        description: 'REST API for generating financial reports from OData services',
        authentication: {
          enabled: authEnabled,
          type: authEnabled ? 'JWT Bearer Token' : 'None',
          protectedRoutes: authEnabled ? this.config.authentication?.protectedRoutes : [],
          publicRoutes: authEnabled ? this.config.authentication?.publicRoutes : []
        },
        endpoints: {
          health: 'GET /health',
          healthLive: 'GET /health/live',
          healthReady: 'GET /health/ready',
          reports: `POST /api/reports${authEnabled ? ' (requires authentication)' : ''}`,
          reportStatus: `GET /api/reports/:id${authEnabled ? ' (requires authentication)' : ''}`,
          ...(authEnabled && { 
            adminReports: 'GET /api/admin/reports (requires admin role)' 
          })
        },
        documentation: 'https://github.com/jan-ru/financial-reports-cli',
      });
    });

    // Report generation endpoints
    this.app.post('/api/reports', 
      this.applyAuthenticationIfNeeded('/api/reports'),
      async (req: Request, res: Response, next: NextFunction) => {
        try {
          // Validate request
          const validationErrors = this.reportApiService.validateCreateReportRequest(req.body);
          
          if (validationErrors.length > 0) {
            const errorResponse: ErrorResponse = {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                details: validationErrors.map(e => `${e.field}: ${e.message}`).join('; '),
              },
              timestamp: new Date(),
            };
            res.status(400).json(errorResponse);
            return;
          }

          // Process report generation with user context
          const request = req.body as CreateReportRequest;
          const authenticatedReq = req as AuthenticatedRequest;
          const userContext = authenticatedReq.user; // Available when authentication is enabled
          
          const result = await this.reportApiService.createReport(request, userContext);

          // Return appropriate status code based on result
          const statusCode = result.status === 'completed' ? 200 : 500;
          res.status(statusCode).json(result);

        } catch (error) {
          next(error);
        }
      }
    );

    this.app.get('/api/reports/:id', 
      this.applyAuthenticationIfNeeded('/api/reports'),
      (req: Request, res: Response) => {
        const jobId = req.params.id;
        
        if (!jobId || typeof jobId !== 'string') {
          const errorResponse: ErrorResponse = {
            error: {
              code: 'INVALID_REPORT_ID',
              message: 'Report ID is required and must be a valid string',
            },
            timestamp: new Date(),
          };
          res.status(400).json(errorResponse);
          return;
        }

        // Get user context for access control
        const authenticatedReq = req as AuthenticatedRequest;
        const userContext = authenticatedReq.user; // Available when authentication is enabled

        const status = this.reportApiService.getReportStatus(jobId, userContext);
        
        if (!status) {
          const errorResponse: ErrorResponse = {
            error: {
              code: 'REPORT_NOT_FOUND',
              message: `Report with ID '${jobId}' not found`,
            },
            timestamp: new Date(),
          };
          res.status(404).json(errorResponse);
          return;
        }

        res.json(status);
      }
    );

    // Admin endpoint for listing all reports (requires admin role)
    this.app.get('/api/admin/reports',
      this.applyAuthenticationIfNeeded('/api/admin/reports'),
      (req: Request, res: Response) => {
        // Get user context for role-based access control
        const authenticatedReq = req as AuthenticatedRequest;
        const userContext = authenticatedReq.user; // Available when authentication is enabled

        const allJobs = this.reportApiService.getAllJobs(userContext);
        res.json({
          reports: allJobs,
          total: allJobs.length,
          timestamp: new Date().toISOString()
        });
      }
    );

    // 404 handler for unknown routes
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: `Route ${req.method} ${req.originalUrl} not found`,
        },
        timestamp: new Date(),
      });
    });
  }

  /**
   * Set up global error handling middleware
   */
  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
      const requestId = req.headers['x-request-id'] as string;
      
      logger.error(`Request ${requestId} failed:`, error.message);
      
      // Check if it's a structured error response
      if (this.isErrorResponse(error)) {
        res.status(this.getHttpStatusForErrorCode(error.error.code)).json(error);
        return;
      }

      // Handle validation errors
      if (error.name === 'ValidationError') {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
          },
          timestamp: new Date(),
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Handle JSON parsing errors
      if (error instanceof SyntaxError && 'body' in error) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'INVALID_JSON',
            message: 'Invalid JSON in request body',
          },
          timestamp: new Date(),
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Default error response
      const errorResponse: ErrorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: this.config.environment === 'production' 
            ? 'An internal server error occurred' 
            : error.message,
        },
        timestamp: new Date(),
      };

      res.status(500).json(errorResponse);
    });
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

  /**
   * Map health status to HTTP status codes
   */
  private getHttpStatusForHealth(healthStatus: HealthStatus): number {
    switch (healthStatus) {
      case HealthStatus.Healthy: {
        return 200;
      }

      case HealthStatus.Degraded: {
        return 200;
      } // Still operational, but with warnings

      case HealthStatus.Unhealthy: {
        return 503;
      } // Service Unavailable

      default: {
        return 500;
      }
    }
  }

  /**
   * Map error codes to HTTP status codes
   */
  private getHttpStatusForErrorCode(errorCode: string): number {
    const statusMap: Record<string, number> = {
      // Client errors (4xx)
      'VALIDATION_ERROR': 400,
      'INVALID_JSON': 400,
      'MALFORMED_SPECIFICATION': 400,
      'PARSE_ERROR': 400,
      'INVALID_PERIOD_FORMAT': 400,
      'UNSUPPORTED_REPORT_TYPE': 400,
      'SPECIFICATION_INVALID': 400,
      
      'UNAUTHORIZED': 401,
      'AUTHENTICATION_ERROR': 401,
      
      'ACCESS_DENIED': 403,
      'PERMISSION_ERROR': 403,
      
      'FILE_NOT_FOUND': 404,
      'SPECIFICATION_NOT_FOUND': 404,
      'ENTITY_NOT_FOUND': 404,
      'ROUTE_NOT_FOUND': 404,
      
      'TIMEOUT_ERROR': 408,
      
      // Server errors (5xx)
      'INTERNAL_ERROR': 500,
      'UNKNOWN_ERROR': 500,
      'REPORT_GENERATION_ERROR': 500,
      
      'NOT_IMPLEMENTED': 501,
      
      'CONNECTION_ERROR': 502,
      'NETWORK_ERROR': 502,
      'ODATA_SERVICE_ERROR': 502,
      'DATA_RETRIEVAL_ERROR': 502,
      
      'FILE_WRITE_ERROR': 503,
    };

    return statusMap[errorCode] || 500;
  }

  /**
   * Enhanced health check that includes authentication service status
   */
  private async performEnhancedHealthCheck() {
    const baseHealthCheck = await this.healthService.performHealthCheck();
    
    // Add authentication service health check if enabled
    if (this.config.authentication?.enabled && this.authMiddleware) {
      try {
        const authHealthy = await this.authMiddleware.isHealthy();
        baseHealthCheck.services.authentication = {
          status: authHealthy ? HealthStatus.Healthy : HealthStatus.Unhealthy,
          lastChecked: new Date().toISOString(),
          ...(authHealthy ? {} : { error: 'Authentication service health check failed' })
        };
      } catch (error) {
        baseHealthCheck.services.authentication = {
          status: HealthStatus.Unhealthy,
          error: error instanceof Error ? error.message : 'Authentication service error',
          lastChecked: new Date().toISOString(),
        };
      }
    }

    return baseHealthCheck;
  }

  /**
   * Enhanced readiness check that includes authentication service status
   */
  private async performEnhancedReadinessCheck() {
    const baseReadinessCheck = await this.healthService.performReadinessCheck();
    
    // Add authentication service readiness check if enabled
    if (this.config.authentication?.enabled && this.authMiddleware) {
      try {
        const authHealthy = await this.authMiddleware.isHealthy();
        baseReadinessCheck.services.authentication = {
          status: authHealthy ? HealthStatus.Healthy : HealthStatus.Unhealthy,
          lastChecked: new Date().toISOString(),
          ...(authHealthy ? {} : { error: 'Authentication service not ready' })
        };

        // For readiness, authentication service must be healthy
        if (!authHealthy && baseReadinessCheck.status === HealthStatus.Healthy) {
          baseReadinessCheck.status = HealthStatus.Unhealthy;
        }
      } catch (error) {
        baseReadinessCheck.services.authentication = {
          status: HealthStatus.Unhealthy,
          error: error instanceof Error ? error.message : 'Authentication service error',
          lastChecked: new Date().toISOString(),
        };
        baseReadinessCheck.status = HealthStatus.Unhealthy;
      }
    }

    return baseReadinessCheck;
  }

  /**
   * Start the HTTP server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          logger.success(`API server started on http://${this.config.host}:${this.config.port}`);
          logger.info(`Environment: ${this.config.environment}`);
          logger.info(`CORS origins: ${this.config.corsOrigins.join(', ')}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          logger.error('Failed to start API server:', error.message);
          reject(error);
        });

        // Graceful shutdown handling
        process.on('SIGTERM', () => this.stop());
        process.on('SIGINT', () => this.stop());

      } catch (error) {
        logger.error('Error starting API server:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        logger.info('Stopping API server...');
        this.server.close(() => {
          logger.success('API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express application instance
   */
  public getApp(): Application {
    return this.app;
  }

  /**
   * Get the current configuration
   */
  public getConfig(): ApiServerConfig {
    return { ...this.config };
  }
}