import { logger } from '../cli.js';

/**
 * Health check status levels
 */
export enum HealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unhealthy = 'unhealthy',
}

/**
 * Individual service health check result
 */
export interface ServiceHealthResult {
  status: HealthStatus;
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

/**
 * Overall health check response
 */
export interface HealthCheckResponse {
  status: HealthStatus;
  version: string;
  timestamp: string;
  environment: string;
  services: Record<string, ServiceHealthResult>;
  uptime: number;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  timeout: number;
  enableServiceChecks: boolean;
  odataServiceUrl?: string;
  keycloakServiceUrl?: string;
}

/**
 * Service for performing health checks on the application and its dependencies
 */
export class HealthService {
  private config: HealthCheckConfig;
  private startTime: number;

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = {
      timeout: 5000, // 5 second timeout
      enableServiceChecks: true,
      ...config,
    };
    this.startTime = Date.now();
  }

  /**
   * Performs a comprehensive health check including service dependencies
   */
  async performHealthCheck(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();
    const version = process.env.npm_package_version || '0.1.3';
    const environment = process.env.NODE_ENV || 'development';
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const services: Record<string, ServiceHealthResult> = {};

    if (this.config.enableServiceChecks) {
      // Check OData service if configured
      if (this.config.odataServiceUrl) {
        services.odata = await this.checkODataService();
      }

      // Check Keycloak service if configured
      if (this.config.keycloakServiceUrl) {
        services.keycloak = await this.checkKeycloakService();
      }
    }

    // Determine overall status based on service checks
    const overallStatus = this.determineOverallStatus(services);

    return {
      status: overallStatus,
      version,
      timestamp,
      environment,
      services,
      uptime,
    };
  }

  /**
   * Performs a basic liveness check (application is running)
   */
  async performLivenessCheck(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();
    const version = process.env.npm_package_version || '0.1.3';
    const environment = process.env.NODE_ENV || 'development';
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: HealthStatus.Healthy,
      version,
      timestamp,
      environment,
      services: {},
      uptime,
    };
  }

  /**
   * Performs a readiness check (application is ready to serve requests)
   */
  async performReadinessCheck(): Promise<HealthCheckResponse> {
    const healthCheck = await this.performHealthCheck();
    
    // For readiness, we're more strict - any unhealthy service makes us not ready
    const hasUnhealthyServices = Object.values(healthCheck.services).some(
      service => service.status === HealthStatus.Unhealthy
    );

    if (hasUnhealthyServices) {
      healthCheck.status = HealthStatus.Unhealthy;
    }

    return healthCheck;
  }

  /**
   * Checks OData service connectivity
   */
  private async checkODataService(): Promise<ServiceHealthResult> {
    const startTime = Date.now();
    const lastChecked = new Date().toISOString();

    try {
      if (!this.config.odataServiceUrl) {
        return {
          status: HealthStatus.Degraded,
          error: 'OData service URL not configured',
          lastChecked,
        };
      }

      // Create a simple HTTP request to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(this.config.odataServiceUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok || response.status === 401) {
        // 401 is acceptable - service is running but requires auth
        return {
          status: HealthStatus.Healthy,
          responseTime,
          lastChecked,
        };
      }
 
        return {
          status: HealthStatus.Degraded,
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
          lastChecked,
        };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          status: HealthStatus.Unhealthy,
          responseTime,
          error: `Timeout after ${this.config.timeout}ms`,
          lastChecked,
        };
      }

      return {
        status: HealthStatus.Unhealthy,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        lastChecked,
      };
    }
  }

  /**
   * Checks Keycloak service connectivity
   */
  private async checkKeycloakService(): Promise<ServiceHealthResult> {
    const startTime = Date.now();
    const lastChecked = new Date().toISOString();

    try {
      if (!this.config.keycloakServiceUrl) {
        return {
          status: HealthStatus.Degraded,
          error: 'Keycloak service URL not configured',
          lastChecked,
        };
      }

      // Check Keycloak health endpoint or realm info
      const healthUrl = `${this.config.keycloakServiceUrl}/health`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          status: HealthStatus.Healthy,
          responseTime,
          lastChecked,
        };
      }

 if (response.status === 404) {
        // Try alternative endpoint - realm info
        return await this.checkKeycloakRealmInfo(startTime, lastChecked);
      }
 
        return {
          status: HealthStatus.Degraded,
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
          lastChecked,
        };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          status: HealthStatus.Unhealthy,
          responseTime,
          error: `Timeout after ${this.config.timeout}ms`,
          lastChecked,
        };
      }

      return {
        status: HealthStatus.Unhealthy,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        lastChecked,
      };
    }
  }

  /**
   * Alternative Keycloak check using realm info endpoint
   */
  private async checkKeycloakRealmInfo(startTime: number, lastChecked: string): Promise<ServiceHealthResult> {
    try {
      const realmUrl = `${this.config.keycloakServiceUrl}/realms/master`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(realmUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          status: HealthStatus.Healthy,
          responseTime,
          lastChecked,
        };
      }
 
        return {
          status: HealthStatus.Degraded,
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
          lastChecked,
        };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        status: HealthStatus.Unhealthy,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        lastChecked,
      };
    }
  }

  /**
   * Determines overall health status based on individual service checks
   */
  private determineOverallStatus(services: Record<string, ServiceHealthResult>): HealthStatus {
    const serviceStatuses = Object.values(services);
    
    if (serviceStatuses.length === 0) {
      return HealthStatus.Healthy;
    }

    const hasUnhealthy = serviceStatuses.some(service => service.status === HealthStatus.Unhealthy);
    const hasDegraded = serviceStatuses.some(service => service.status === HealthStatus.Degraded);

    if (hasUnhealthy) {
      return HealthStatus.Unhealthy;
    }

 if (hasDegraded) {
      return HealthStatus.Degraded;
    }
 
      return HealthStatus.Healthy;
    
  }

  /**
   * Updates health check configuration
   */
  updateConfig(config: Partial<HealthCheckConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Health check configuration updated', this.config);
  }

  /**
   * Gets current health check configuration
   */
  getConfig(): HealthCheckConfig {
    return { ...this.config };
  }
}