/**
 * Example usage of Service Account Authentication for Automated Workflows
 * 
 * This file demonstrates how to use the client credentials flow for service accounts
 * in automated workflows, scheduled jobs, and system-to-system communication.
 * 
 * Requirements demonstrated:
 * - 4.5: Support service account authentication for automated workflows
 * - 4.5: Handle service account token refresh
 */

import { 
  ClientCredentialsService, 
  ServiceAccountCredentials 
} from '../index.js';

/**
 * Example 1: Basic Service Account Authentication
 */
export async function basicServiceAccountAuth(): Promise<void> {
  try {
    // Create service account credentials
    const credentials: ServiceAccountCredentials = {
      clientId: 'financial-reports-service',
      clientSecret: 'your-client-secret',
      realm: 'financial-realm', // Optional, uses default if not specified
      scope: 'reports:read reports:write' // Optional scopes
    };

    // Create client credentials service
    const clientCredentialsService = new ClientCredentialsService();

    // Authenticate and get token
    const tokenResponse = await clientCredentialsService.authenticateServiceAccount(credentials);
    
    console.log('Service account authenticated successfully');
    console.log('Access token expires in:', tokenResponse.expires_in, 'seconds');
    
    // Use the token for API calls
    const authHeader = `Bearer ${tokenResponse.access_token}`;
    console.log('Authorization header:', authHeader);

  } catch (error) {
    console.error('Service account authentication failed:', error);
  }
}

/**
 * Example 2: Service Account with Token Refresh
 */
export async function serviceAccountWithRefresh(): Promise<void> {
  try {
    const credentials: ServiceAccountCredentials = {
      clientId: 'automated-reports',
      clientSecret: 'your-client-secret'
    };

    const clientCredentialsService = new ClientCredentialsService();

    // First authentication
    console.log('Initial authentication...');
    let tokenResponse = await clientCredentialsService.authenticateServiceAccount(credentials);
    console.log('Token expires at:', new Date(Date.now() + tokenResponse.expires_in * 1000));

    // Simulate some time passing...
    console.log('Performing work with token...');

    // Later, when token is about to expire, it will be automatically refreshed
    console.log('Re-authenticating (will use cached token or refresh)...');
    tokenResponse = await clientCredentialsService.authenticateServiceAccount(credentials);
    console.log('Token still valid or refreshed successfully');

    // Manual refresh if needed
    if (tokenResponse.refresh_token) {
      console.log('Manually refreshing token...');
      await clientCredentialsService.refreshServiceAccountToken(
        credentials, 
        tokenResponse.refresh_token
      );
      console.log('Token refreshed successfully');
    }

  } catch (error) {
    console.error('Service account refresh example failed:', error);
  }
}

/**
 * Example 3: Using Service Account Helper for Full Integration
 */
export async function serviceAccountHelperExample(): Promise<void> {
  try {
    // Note: In real usage, you would provide a configured JWTValidator
    // This example shows the API structure
    
    const credentials: ServiceAccountCredentials = {
      clientId: 'report-generator',
      clientSecret: 'your-client-secret'
    };

    // Create credentials from environment variables
    const envCredentials = ClientCredentialsService.createCredentialsFromEnv('REPORT_GENERATOR');
    console.log('Loaded credentials from environment for client:', envCredentials.clientId);

    // Check token status
    const clientCredentialsService = new ClientCredentialsService();
    const tokenInfo = clientCredentialsService.getTokenInfo(credentials);
    
    if (tokenInfo.hasToken) {
      console.log('Cached token found, expires at:', tokenInfo.expiresAt);
      console.log('Can refresh:', tokenInfo.canRefresh);
    } else {
      console.log('No cached token found');
    }

  } catch (error) {
    console.error('Service account helper example failed:', error);
  }
}

/**
 * Example 4: Automated Workflow Pattern
 */
export class AutomatedReportService {
  private clientCredentialsService: ClientCredentialsService;
  private credentials: ServiceAccountCredentials;

  constructor(credentials: ServiceAccountCredentials) {
    this.credentials = credentials;
    this.clientCredentialsService = new ClientCredentialsService();
  }

  /**
   * Generate reports using service account authentication
   */
  async generateDailyReports(): Promise<void> {
    try {
      console.log('Starting automated report generation...');

      // Authenticate service account
      const tokenResponse = await this.clientCredentialsService.authenticateServiceAccount(this.credentials);
      const authHeader = `Bearer ${tokenResponse.access_token}`;

      // Make authenticated API calls to generate reports
      await this.callReportAPI('/api/reports/daily', authHeader);
      await this.callReportAPI('/api/reports/weekly', authHeader);
      
      console.log('Automated reports generated successfully');

    } catch (error) {
      console.error('Automated report generation failed:', error);
      throw error;
    }
  }

  /**
   * Simulate API call with authentication
   */
  private async callReportAPI(endpoint: string, _authHeader: string): Promise<void> {
    console.log(`Calling ${endpoint} with authentication...`);
    
    // In real implementation, this would be an actual HTTP request
    // const response = await fetch(`https://api.example.com${endpoint}`, {
    //   headers: {
    //     'Authorization': authHeader,
    //     'Content-Type': 'application/json'
    //   }
    // });
    
    console.log(`Successfully called ${endpoint}`);
  }

  /**
   * Health check that verifies service account can authenticate
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.clientCredentialsService.authenticateServiceAccount(this.credentials);
      return true;
    } catch (error) {
      console.error('Service account health check failed:', error);
      return false;
    }
  }
}

/**
 * Example 5: Environment Variable Configuration
 */
export function demonstrateEnvironmentConfig(): void {
  console.log('Service Account Environment Variable Configuration:');
  console.log('');
  console.log('Default service account:');
  console.log('  SERVICE_ACCOUNT_CLIENT_ID=your-client-id');
  console.log('  SERVICE_ACCOUNT_CLIENT_SECRET=your-client-secret');
  console.log('  SERVICE_ACCOUNT_REALM=optional-realm');
  console.log('  SERVICE_ACCOUNT_SCOPE=optional-scopes');
  console.log('');
  console.log('Named service account (e.g., "REPORTS"):');
  console.log('  SERVICE_ACCOUNT_REPORTS_CLIENT_ID=reports-client-id');
  console.log('  SERVICE_ACCOUNT_REPORTS_CLIENT_SECRET=reports-client-secret');
  console.log('  SERVICE_ACCOUNT_REPORTS_REALM=reports-realm');
  console.log('  SERVICE_ACCOUNT_REPORTS_SCOPE=reports:read reports:write');
  console.log('');
  
  // Example of loading from environment
  try {
    const defaultCredentials = ClientCredentialsService.createCredentialsFromEnv();
    console.log('Default credentials loaded:', { clientId: defaultCredentials.clientId });
  } catch {
    console.log('Default credentials not configured in environment');
  }

  try {
    const namedCredentials = ClientCredentialsService.createCredentialsFromEnv('REPORTS');
    console.log('Named credentials loaded:', { clientId: namedCredentials.clientId });
  } catch {
    console.log('Named credentials not configured in environment');
  }
}

/**
 * Run all examples (for testing purposes)
 */
export async function runAllExamples(): Promise<void> {
  console.log('=== Service Account Authentication Examples ===\n');
  
  try {
    console.log('1. Basic Service Account Authentication:');
    await basicServiceAccountAuth();
    console.log('');

    console.log('2. Service Account with Token Refresh:');
    await serviceAccountWithRefresh();
    console.log('');

    console.log('3. Service Account Helper Example:');
    await serviceAccountHelperExample();
    console.log('');

    console.log('4. Environment Configuration:');
    demonstrateEnvironmentConfig();
    console.log('');

    console.log('5. Automated Report Service Example:');
    const credentials: ServiceAccountCredentials = {
      clientId: 'example-service',
      clientSecret: 'example-secret'
    };
    const reportService = new AutomatedReportService(credentials);
    const isHealthy = await reportService.healthCheck();
    console.log('Service health check:', isHealthy ? 'PASS' : 'FAIL');

  } catch (error) {
    console.error('Examples failed:', error);
  }
}