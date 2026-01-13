import { Args, Command, Config, Flags } from '@oclif/core';
import { existsSync } from 'node:fs';

import { CLILogger } from '../cli.js';
import { getLogger, getReportService } from '../container.js';
import { ReportService } from '../services/report-service.js';
import {
  ErrorResponse,
  OutputFormat,
  ReportCommandArgs,
  ReportCommandFlags,
  ReportOptions,
} from '../types/index.js';

/**
 * Main CLI command for generating financial reports
 * Implements command-line argument parsing, validation, and report generation orchestration
 */
export default class ReportCommand extends Command {
  static override args = {
    specFile: Args.string({
      description: 'Path to the report specification file (JSON format)',
      name: 'specFile',
      required: true,
    }),
  };
  static override description = `Generate financial reports from OData v4 datasources using report specifications

OVERVIEW
  The Financial Reports CLI connects to OData v4 services (such as CAP services) to retrieve
  and format financial data based on JSON specification files. It supports multiple report
  types including Balance Sheets, Income Statements, and Cash Flow reports.

REPORT SPECIFICATION FORMAT
  The specification file should be a JSON file with the following structure:
  {
    "entity": "CompanyEntity",
    "reportType": "BalanceSheet|IncomeStatement|Cashflow", 
    "period": "YYYY-MM",
    "destination": {
      "url": "http://your-odata-service/odata/v4/financial",
      "authentication": {
        "type": "basic|bearer|oauth",
        "username": "user",
        "password": "pass"
      }
    },
    "filters": [
      {
        "field": "fieldName",
        "operator": "eq|ne|gt|lt|ge|le",
        "value": "filterValue"
      }
    ]
  }

SUPPORTED REPORT TYPES
  • BalanceSheet - Assets, liabilities, and equity information
  • IncomeStatement - Revenue, expenses, and net income data  
  • Cashflow - Operating, investing, and financing activities

OUTPUT FORMATS
  • json (default) - Structured JSON with metadata
  • csv - Comma-separated values for spreadsheet import
  • table - Human-readable console table format

EXIT CODES
  • 0 - Success
  • 1 - General application error
  • 2 - File or resource not found
  • 3 - Validation or input error
  • 4 - Network or connection error
  • 5 - Permission or access error`;
  static override examples = [
    `<%= config.bin %> <%= command.id %> ./report-spec.json
Generate a financial report using the default JSON output format`,

    `<%= config.bin %> <%= command.id %> ./report-spec.json --output table --verbose
Generate a report with table output format and verbose logging`,

    `<%= config.bin %> <%= command.id %> ./report-spec.json --output csv --destination ./output.csv
Generate a CSV report and save it to a file`,

    `<%= config.bin %> <%= command.id %> ./balance-sheet-spec.json --verbose
Generate a balance sheet report with detailed logging`,

    `<%= config.bin %> <%= command.id %> ./income-statement.json --output table
Generate an income statement in table format for console viewing`,

    `<%= config.bin %> <%= command.id %> ./cashflow-spec.json --output json --destination ./reports/cashflow.json --verbose
Generate a cash flow report, save as JSON file with verbose output`,

    `# Example specification file (report-spec.json):
{
  "entity": "ACME_Corp",
  "reportType": "BalanceSheet", 
  "period": "2025-01",
  "destination": {
    "url": "http://localhost:4004/odata/v4/financial"
  }
}`,
  ];
  static override flags = {
    destination: Flags.string({
      char: 'd',
      description:
        'File path to write the output (if not specified, output goes to console)',
      helpValue: 'path/to/output/file',
    }),
    output: Flags.string({
      char: 'o',
      default: 'json',
      description: 'Output format for the financial report',
      helpValue: 'json|csv|table',
      options: ['json', 'csv', 'table'],
    }),
    verbose: Flags.boolean({
      char: 'v',
      default: false,
      description: 'Enable verbose output for debugging and detailed logging',
    }),
  };
  private logger: CLILogger;
  private reportService: ReportService;

  constructor(argv: string[], config: Config, reportService?: ReportService) {
    super(argv, config);
    this.reportService = reportService || getReportService();
    this.logger = getLogger();
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ReportCommand);

    try {
      // Cast flags to proper types for validation
      const typedFlags: ReportCommandFlags = {
        destination: flags.destination,
        output: flags.output as OutputFormat,
        verbose: flags.verbose,
      };

      // Configure logger for verbose mode
      this.logger.setVerbose(typedFlags.verbose || false);

      // Validate command-line arguments (Requirement 4.1)
      if (typedFlags.verbose) {
        this.logger.debug('Validating command-line arguments...');
      }

      await this.validateArguments(args, typedFlags);

      if (typedFlags.verbose) {
        this.logger.success('Command-line arguments validated successfully');
        this.logger.info('Financial Reports CLI - Starting report generation');
        this.logger.info(`Specification file: ${args.specFile}`);
        this.logger.info(`Output format: ${typedFlags.output}`);
        if (typedFlags.destination) {
          this.logger.info(`Output destination: ${typedFlags.destination}`);
        } else {
          this.logger.info('Output destination: console');
        }

        this.logger.info(`Verbose logging: enabled`);
        this.logger.info('---');
      }

      // Create report options
      const reportOptions: ReportOptions = {
        destination: typedFlags.destination,
        outputFormat: typedFlags.output as OutputFormat,
        verbose: typedFlags.verbose || false,
      };

      // Generate the report
      const result = await this.reportService.generateReport(
        args.specFile,
        reportOptions
      );

      // Handle empty results (Requirement 5.4)
      if (result.data.every(report => report.lineItems.length === 0)) {
        if (typedFlags.verbose) {
          this.logger.warn(
            'No matching records found for the specified criteria'
          );
          this.logger.info('This could be due to:');
          this.logger.info('  • No data available for the specified period');
          this.logger.info('  • Entity name not found in the OData service');
          this.logger.info('  • Filters excluding all available data');
          this.logger.info('  • OData service connectivity issues');
        } else {
          this.logger.warn('No data found matching the specified criteria.');
        }

        // Still show metadata for empty results
        if (typedFlags.output === 'json') {
          this.log(JSON.stringify(result, null, 2));
        } else if (typedFlags.output === 'table') {
          this.log('\nReport Metadata:');
          this.log(`Entity: ${result.metadata.entity}`);
          this.log(`Report Type: ${result.metadata.reportType}`);
          this.log(`Period: ${result.metadata.period}`);
          this.log(`Records Found: ${result.metadata.recordCount}`);
          this.log(
            `Generated At: ${result.metadata.generatedAt.toISOString()}`
          );
          this.log(`Execution Time: ${result.metadata.executionTime}ms`);
        }

        // Exit with success code even for empty results (Requirement 4.3)
        return;
      }

      // Output the results if not writing to file
      if (!typedFlags.destination) {
        if (typedFlags.verbose) {
          this.logger.debug('Formatting output for console display...');
        }

        const formattedOutput = this.reportService.formatOutput(
          result.data,
          result.metadata,
          reportOptions
        );
        this.log(formattedOutput);

        if (typedFlags.verbose) {
          this.logger.success('Output formatted and displayed successfully');
        }
      } else if (typedFlags.verbose) {
        this.logger.success(
          `Output written to file: ${typedFlags.destination}`
        );
      }

      if (typedFlags.verbose) {
        this.logger.info('---');
        this.logger.success('Report generation completed successfully');
        this.logger.info(`📊 Total records: ${result.metadata.recordCount}`);
        this.logger.info(
          `⏱️  Execution time: ${result.metadata.executionTime}ms`
        );
        this.logger.info(
          `📅 Generated at: ${result.metadata.generatedAt.toISOString()}`
        );
        this.logger.info(`🏢 Entity: ${result.metadata.entity}`);
        this.logger.info(`📈 Report type: ${result.metadata.reportType}`);
        this.logger.info(`📆 Period: ${result.metadata.period}`);
      }

      // Exit with success code (Requirement 4.3)
    } catch (error) {
      await this.handleError(error, flags.verbose || false);
    }
  }

  /**
   * Categorizes error messages to determine appropriate exit codes
   * Implements Requirement 4.4: Different error types return appropriate non-zero codes
   */
  private categorizeErrorForExitCode(errorMessage: string): number {
    const message = errorMessage.toLowerCase();

    // File/resource not found errors (exit code 2)
    if (
      message.includes('not found') ||
      message.includes('does not exist') ||
      message.includes('no such file') ||
      message.includes('enoent')
    ) {
      return 2;
    }

    // Validation/input errors (exit code 3)
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      message.includes('malformed') ||
      message.includes('parse error') ||
      message.includes('syntax error')
    ) {
      return 3;
    }

    // Network/connection errors (exit code 4)
    if (
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('unreachable') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      return 4;
    }

    // Permission/access errors (exit code 5)
    if (
      message.includes('permission') ||
      message.includes('access') ||
      message.includes('forbidden') ||
      message.includes('unauthorized') ||
      message.includes('eacces') ||
      message.includes('eperm')
    ) {
      return 5;
    }

    // Default to general error (exit code 1)
    return 1;
  }

  /**
   * Maps service error codes to appropriate exit codes
   * Implements Requirement 4.4: Different error types return appropriate non-zero codes
   */
  private getExitCodeForError(errorCode: string): number {
    const errorCodeMap: Record<string, number> = {
      ACCESS_DENIED: 5,
      AUTHENTICATION_ERROR: 4,
      // Network/connection errors (exit code 4)
      CONNECTION_ERROR: 4,

      DATA_RETRIEVAL_ERROR: 4,
      ENTITY_NOT_FOUND: 2,
      FILE_NOT_FOUND: 2,
      FILE_WRITE_ERROR: 5,
      INTERNAL_ERROR: 1,
      INVALID_PERIOD_FORMAT: 3,

      MALFORMED_SPECIFICATION: 3,
      NETWORK_ERROR: 4,
      ODATA_SERVICE_ERROR: 4,
      PARSE_ERROR: 3,
      // Permission/access errors (exit code 5)
      PERMISSION_ERROR: 5,
      // General application errors (exit code 1)
      REPORT_GENERATION_ERROR: 1,

      // Validation/input errors (exit code 3)
      SPECIFICATION_INVALID: 3,
      // File/resource not found (exit code 2)
      SPECIFICATION_NOT_FOUND: 2,
      TIMEOUT_ERROR: 4,
      UNAUTHORIZED: 5,

      UNKNOWN_ERROR: 1,
      UNSUPPORTED_REPORT_TYPE: 3,
      VALIDATION_ERROR: 3,
    };

    return errorCodeMap[errorCode] || 1; // Default to general error
  }

  /**
   * Handles errors with appropriate exit codes and user-friendly messages
   * Implements Requirements 4.3, 4.4: Exit code handling
   *
   * Exit Code Standards:
   * 0 - Success (Requirement 4.3)
   * 1 - General application error
   * 2 - File/resource not found
   * 3 - Validation/input error
   * 4 - Network/connection error
   * 5 - Permission/access error
   */
  private async handleError(error: unknown, verbose: boolean): Promise<void> {
    if (verbose) {
      this.logger.error('--- Error Details ---');
      if (this.isErrorResponse(error)) {
        this.logger.error(`Error Code: ${error.error.code}`);
        this.logger.error(`Message: ${error.error.message}`);
        if (error.error.details) {
          this.logger.error(`Details: ${error.error.details}`);
        }

        if (error.error.suggestions && error.error.suggestions.length > 0) {
          this.logger.info('Suggestions:');
          for (const [index, suggestion] of error.error.suggestions.entries()) {
            this.logger.info(`  ${index + 1}. ${suggestion}`);
          }
        }

        if (error.context) {
          this.logger.error(
            `Context: ${JSON.stringify(error.context, null, 2)}`
          );
        }
      } else {
        this.logger.error(`Error: ${error}`);
      }

      this.logger.error('--- End Error Details ---');
    }

    // Handle ErrorResponse objects from services
    if (this.isErrorResponse(error)) {
      const exitCode = this.getExitCodeForError(error.error.code);

      // Format error message for user
      let errorMessage = error.error.message;
      if (error.error.details && !verbose) {
        errorMessage += ` (${error.error.details})`;
      }

      // Add suggestions if available and not in verbose mode
      if (
        error.error.suggestions &&
        error.error.suggestions.length > 0 &&
        !verbose
      ) {
        errorMessage += '\n\nSuggestions:';
        for (const [index, suggestion] of error.error.suggestions.entries()) {
          errorMessage += `\n  ${index + 1}. ${suggestion}`;
        }
      }

      this.error(errorMessage, { exit: exitCode });
      return;
    }

    // Handle standard errors
    if (error instanceof Error) {
      const exitCode = this.categorizeErrorForExitCode(error.message);
      this.error(error.message, { exit: exitCode });
      return;
    }

    // Handle unknown errors (Requirement 4.4)
    this.error(
      'An unexpected error occurred. Use --verbose for more details.',
      { exit: 1 }
    );
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
   * Validates command-line arguments and flags
   * Implements Requirement 4.1: CLI argument validation
   * Implements Requirement 4.5: Verbose output for debugging
   */
  private async validateArguments(
    args: ReportCommandArgs,
    flags: ReportCommandFlags
  ): Promise<void> {
    if (flags.verbose) {
      this.logger.debug('Performing argument validation checks...');
    }

    // Validate specification file exists
    if (flags.verbose) {
      this.logger.debug(
        `Checking if specification file exists: ${args.specFile}`
      );
    }

    if (!existsSync(args.specFile)) {
      throw new Error(`Specification file not found: ${args.specFile}`);
    }

    if (flags.verbose) {
      this.logger.success('Specification file found');
    }

    // Validate output format
    const validFormats: OutputFormat[] = ['json', 'csv', 'table'];
    if (flags.output && !validFormats.includes(flags.output as OutputFormat)) {
      throw new Error(
        `Invalid output format: ${flags.output}. Valid options: ${validFormats.join(', ')}`
      );
    }

    if (flags.verbose) {
      this.logger.success(`Output format '${flags.output}' is valid`);
    }

    // Validate destination path if provided
    if (flags.destination) {
      if (flags.verbose) {
        this.logger.debug(`Validating destination path: ${flags.destination}`);
      }

      try {
        // Check if the directory exists (not the file itself)
        const { dirname } = await import('node:path');
        const dirPath = dirname(flags.destination);
        if (!existsSync(dirPath)) {
          throw new Error(`Destination directory does not exist: ${dirPath}`);
        }

        if (flags.verbose) {
          this.logger.success(`Destination directory exists: ${dirPath}`);
        }
      } catch {
        throw new Error(`Invalid destination path: ${flags.destination}`);
      }
    } else if (flags.verbose) {
      this.logger.success(
        'No destination specified, output will go to console'
      );
    }
  }
}
