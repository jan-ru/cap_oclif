import { executeCLI, logger } from './cli.js';
import { ApiServer, type ApiServerConfig } from './api/index.js';

/**
 * Application mode enumeration
 */
export enum AppMode {
  CLI = 'cli',
  API = 'api',
  AUTO = 'auto',
}

/**
 * Configuration for dual-mode application startup
 */
export interface AppConfig {
  mode: AppMode;
  apiConfig?: Partial<ApiServerConfig>;
  cliArgs?: string[];
}

/**
 * Environment-based configuration detection
 */
function detectModeFromEnvironment(): AppMode {
  // Check for explicit mode setting
  const explicitMode = process.env.APP_MODE?.toLowerCase();
  if (explicitMode === 'api' || explicitMode === 'server') {
    return AppMode.API;
  }

  if (explicitMode === 'cli') {
    return AppMode.CLI;
  }

  // Auto-detect based on environment and arguments
  // If PORT is set and no CLI arguments, assume API mode
  if (process.env.PORT && process.argv.length <= 2) {
    return AppMode.API;
  }

  // If running in container environment, prefer API mode
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.DOCKER_CONTAINER) {
    return AppMode.API;
  }

  // Default to CLI mode for backward compatibility
  return AppMode.CLI;
}

/**
 * Load configuration from environment variables
 */
function loadConfigFromEnvironment(): AppConfig {
  const mode = detectModeFromEnvironment();
  
  const apiConfig: Partial<ApiServerConfig> = {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
    enableLogging: process.env.NODE_ENV !== 'test',
    environment: (process.env.NODE_ENV as ApiServerConfig['environment']) || 'development',
  };

  return {
    mode,
    apiConfig,
    cliArgs: process.argv.slice(2),
  };
}

/**
 * Start the application in API mode
 */
async function startApiMode(config: AppConfig): Promise<void> {
  logger.info('Starting Financial Reports API server...');
  
  try {
    const server = new ApiServer(config.apiConfig);
    await server.start();
    
    // Keep the process running
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start API server:', error);
    process.exit(1);
  }
}

/**
 * Start the application in CLI mode
 */
async function startCliMode(_config: AppConfig): Promise<void> {
  logger.debug('Starting Financial Reports CLI...');
  
  try {
    await executeCLI({
      development: process.env.NODE_ENV === 'development',
      dir: import.meta.url,
    });
  } catch (error) {
    logger.error('CLI execution failed:', error);
    process.exit(1);
  }
}

/**
 * Main application entry point with dual-mode support
 */
export async function startApplication(userConfig?: Partial<AppConfig>): Promise<void> {
  // Load configuration from environment and merge with user config
  const envConfig = loadConfigFromEnvironment();
  const config: AppConfig = {
    ...envConfig,
    ...userConfig,
    apiConfig: {
      ...envConfig.apiConfig,
      ...userConfig?.apiConfig,
    },
  };

  if (config.mode === AppMode.AUTO) {
    // Auto-detect mode based on arguments and environment
    const detectedMode = detectModeFromEnvironment();
    logger.debug(`Auto-detected mode: ${detectedMode}`);
    config.mode = detectedMode;
  }

  // Only log startup information in API mode
  if (config.mode === AppMode.API) {
    logger.info(`Financial Reports CLI v${process.env.npm_package_version || '0.1.3'}`);
    logger.debug(`Starting in ${config.mode} mode`);
  }

  // Start in the appropriate mode
  switch (config.mode) {
    case AppMode.API: {
      await startApiMode(config);
      break;
    }

    case AppMode.CLI: {
      await startCliMode(config);
      break;
    }

    default: {
      logger.error(`Unknown application mode: ${config.mode}`);
      process.exit(1);
    }
  }
}

/**
 * Default startup function for backward compatibility
 */
export async function main(): Promise<void> {
  await startApplication();
}

// Export types and utilities
export { type ApiServerConfig } from './api/index.js';
export { logger, CLILogger } from './cli.js';