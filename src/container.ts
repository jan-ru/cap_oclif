import { CLILogger } from './cli.js';
import { ConfigurationService } from './services/configuration.js';
import { OutputFormatter } from './services/output-formatter.js';
import { ReportService } from './services/report-service.js';

/**
 * Dependency injection container for the Financial Reports CLI
 * Provides centralized configuration and wiring of all application components
 */
export class DIContainer {
  private static instance: DIContainer;
  // Service instances
  private _configurationService?: ConfigurationService;
  private _logger?: CLILogger;
  private _outputFormatter?: OutputFormatter;
  private _reportService?: ReportService;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of the container
   */
  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }

    return DIContainer.instance;
  }

  /**
   * Configure the container with custom service instances (useful for testing)
   */
  configure(services: {
    configurationService?: ConfigurationService;
    logger?: CLILogger;
    outputFormatter?: OutputFormatter;
    reportService?: ReportService;
  }): void {
    if (services.configurationService) {
      this._configurationService = services.configurationService;
    }

    if (services.outputFormatter) {
      this._outputFormatter = services.outputFormatter;
    }

    if (services.reportService) {
      this._reportService = services.reportService;
    }

    if (services.logger) {
      this._logger = services.logger;
    }
  }

  /**
   * Get or create the ConfigurationService instance
   */
  getConfigurationService(): ConfigurationService {
    if (!this._configurationService) {
      this._configurationService = new ConfigurationService();
    }

    return this._configurationService;
  }

  /**
   * Get or create the CLILogger instance
   */
  getLogger(verbose: boolean = false): CLILogger {
    if (this._logger) {
      this._logger.setVerbose(verbose);
    } else {
      this._logger = new CLILogger(verbose);
    }

    return this._logger;
  }

  /**
   * Get or create the OutputFormatter instance
   */
  getOutputFormatter(): OutputFormatter {
    if (!this._outputFormatter) {
      this._outputFormatter = new OutputFormatter();
    }

    return this._outputFormatter;
  }

  /**
   * Get or create the ReportService instance with proper dependencies
   */
  getReportService(): ReportService {
    if (!this._reportService) {
      this._reportService = new ReportService(
        this.getConfigurationService(),
        this.getOutputFormatter()
      );
    }

    return this._reportService;
  }

  /**
   * Reset all services (useful for testing)
   */
  reset(): void {
    this._configurationService = undefined as any;
    this._outputFormatter = undefined as any;
    this._reportService = undefined as any;
    this._logger = undefined as any;
  }
}

/**
 * Convenience function to get the container instance
 */
export function getContainer(): DIContainer {
  return DIContainer.getInstance();
}

/**
 * Convenience functions for getting services
 */
export function getConfigurationService(): ConfigurationService {
  return getContainer().getConfigurationService();
}

export function getOutputFormatter(): OutputFormatter {
  return getContainer().getOutputFormatter();
}

export function getReportService(): ReportService {
  return getContainer().getReportService();
}

export function getLogger(verbose: boolean = false): CLILogger {
  return getContainer().getLogger(verbose);
}
