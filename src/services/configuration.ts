import * as yaml from 'js-yaml';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

import {
  ErrorResponse,
  ReportSpecification,
  ValidationError,
  ValidationResult,
} from '../types/index.js';
import { validateReportSpecification } from '../types/validation.js';

/**
 * Service for parsing and validating report specification files
 */
export class ConfigurationService {
  /**
   * Parses a report specification file and validates its contents
   * Supports both JSON (.json) and YAML (.yaml, .yml) formats
   * @param filePath Path to the specification file
   * @returns Promise resolving to a validated ReportSpecification
   * @throws ErrorResponse if file cannot be read or specification is invalid
   */
  async parseSpecification(filePath: string): Promise<ReportSpecification> {
    try {
      // Read the file
      const fileContent = await fs.readFile(filePath, 'utf8');

      // Determine file format based on extension
      const fileExtension = extname(filePath).toLowerCase();
      const isYamlFile = fileExtension === '.yaml' || fileExtension === '.yml';

      // Parse based on file format
      let parsedSpec: unknown;
      try {
        parsedSpec = isYamlFile
          ? yaml.load(fileContent, {
              filename: filePath,
              onWarning(warning) {
                // Log YAML warnings but don't fail parsing
                console.warn(`YAML Warning in ${filePath}: ${warning.message}`);
              },
            })
          : JSON.parse(fileContent);
      } catch (parseError) {
        const formatName = isYamlFile ? 'YAML' : 'JSON';
        const errorCode = isYamlFile ? 'INVALID_YAML' : 'INVALID_JSON';

        // Enhanced error handling for YAML with line numbers
        const errorMessage = `Failed to parse specification file as ${formatName}`;
        let details = `The file contains invalid ${formatName} syntax`;
        let suggestions = [
          `Ensure the file contains valid ${formatName} syntax`,
        ];

        if (parseError instanceof Error) {
          details += `: ${parseError.message}`;

          suggestions = isYamlFile
            ? [
                'Check YAML indentation (use spaces, not tabs)',
                'Ensure proper YAML syntax for lists and objects',
                'Verify that strings with special characters are quoted',
                'Check for missing colons after keys',
              ]
            : [
                'Check for missing commas, brackets, or quotes',
                'Ensure proper JSON syntax',
                'Validate JSON structure online if needed',
              ];
        }

        throw this.createErrorResponse(errorCode, errorMessage, {
          context: {
            fileFormat: formatName,
            filePath,
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          },
          details,
          suggestions,
        });
      }

      // Handle empty or null YAML documents
      if (parsedSpec === null || parsedSpec === undefined) {
        throw this.createErrorResponse(
          'EMPTY_SPECIFICATION',
          'Specification file is empty or contains no valid data',
          {
            context: { filePath },
            details: 'The file does not contain any valid configuration data',
            suggestions: [
              'Ensure the file contains a valid specification',
              'Check that the file is not empty',
              'Verify the file format is correct',
            ],
          }
        );
      }

      // Validate the parsed specification
      const validation = this.validateSpecification(parsedSpec);

      if (!validation.isValid) {
        const errorMessages = validation.errors
          .map(err => `${err.field}: ${err.message}`)
          .join('; ');
        const suggestions = this.generateValidationSuggestions(
          validation.errors
        );

        throw this.createErrorResponse(
          'INVALID_SPECIFICATION',
          'Report specification validation failed',
          {
            context: { filePath, validationErrors: validation.errors },
            details: `Validation errors: ${errorMessages}`,
            suggestions,
          }
        );
      }

      return parsedSpec as ReportSpecification;
    } catch (error) {
      // If it's already an ErrorResponse, re-throw it
      if (this.isErrorResponse(error)) {
        throw error;
      }

      // Handle file system errors
      if (error instanceof Error) {
        if ('code' in error) {
          const fsError = error as NodeJS.ErrnoException;
          switch (fsError.code) {
            case 'ENOENT': {
              throw this.createErrorResponse(
                'FILE_NOT_FOUND',
                'Specification file not found',
                {
                  context: { filePath },
                  details: `The file '${filePath}' does not exist`,
                  suggestions: [
                    'Check that the file path is correct',
                    'Ensure the file exists in the specified location',
                    'Supported formats: .json, .yaml, .yml',
                  ],
                }
              );
            }

            case 'EACCES': {
              throw this.createErrorResponse(
                'FILE_ACCESS_DENIED',
                'Cannot read specification file',
                {
                  context: { filePath },
                  details: `Permission denied when trying to read '${filePath}'`,
                  suggestions: [
                    'Check file permissions',
                    'Ensure you have read access to the file',
                  ],
                }
              );
            }

            case 'EISDIR': {
              throw this.createErrorResponse(
                'PATH_IS_DIRECTORY',
                'Specification path is a directory',
                {
                  context: { filePath },
                  details: `The path '${filePath}' points to a directory, not a file`,
                  suggestions: [
                    'Provide a path to a specification file, not a directory',
                    'Supported formats: .json, .yaml, .yml',
                  ],
                }
              );
            }
          }
        }

        // Generic file system error
        throw this.createErrorResponse(
          'FILE_SYSTEM_ERROR',
          'Failed to read specification file',
          {
            context: { filePath, originalError: error.message },
            details: `Unexpected error reading '${filePath}': ${error.message}`,
            suggestions: [
              'Check that the file exists and is readable',
              'Verify the file path is correct',
              'Supported formats: .json, .yaml, .yml',
            ],
          }
        );
      }

      // Unknown error
      throw this.createErrorResponse(
        'UNKNOWN_ERROR',
        'Unexpected error occurred',
        {
          context: { error: String(error), filePath },
          details:
            'An unexpected error occurred while parsing the specification',
          suggestions: [
            'Try again',
            'Check the file format and content',
            'Supported formats: .json, .yaml, .yml',
          ],
        }
      );
    }
  }

  /**
   * Validates a report specification object
   * @param spec The specification object to validate
   * @returns ValidationResult indicating success or failure with detailed errors
   */
  validateSpecification(spec: unknown): ValidationResult {
    return validateReportSpecification(spec);
  }

  /**
   * Creates a standardized error response
   */
  private createErrorResponse(
    code: string,
    message: string,
    options?: {
      context?: Record<string, unknown>;
      details?: string;
      suggestions?: string[];
    }
  ): ErrorResponse {
    const errorResponse: ErrorResponse = {
      error: {
        code,
        message,
        ...(options?.details && { details: options.details }),
        ...(options?.suggestions && { suggestions: options.suggestions }),
      },
      timestamp: new Date(),
    };

    if (options?.context) {
      errorResponse.context = options.context;
    }

    return errorResponse;
  }

  /**
   * Generates helpful suggestions based on validation errors
   */
  private generateValidationSuggestions(errors: ValidationError[]): string[] {
    const suggestions: string[] = [];

    const errorCodes = errors.map(err => err.code);

    if (errorCodes.includes('MISSING_ENTITY')) {
      suggestions.push(
        'Add an "entity" field with a string value (e.g., "CompanyA")'
      );
    }

    if (errorCodes.includes('MISSING_REPORT_TYPE')) {
      suggestions.push(
        'Add a "reportType" field with one of: BalanceSheet, IncomeStatement, Cashflow'
      );
    }

    if (errorCodes.includes('INVALID_REPORT_TYPE')) {
      suggestions.push(
        'Use a valid reportType: "BalanceSheet", "IncomeStatement", or "Cashflow"'
      );
    }

    if (errorCodes.includes('MISSING_PERIOD')) {
      suggestions.push(
        'Add a "period" field with YYYY-MM format (e.g., "2025-01")'
      );
    }

    if (errorCodes.includes('INVALID_PERIOD_FORMAT')) {
      suggestions.push(
        'Use YYYY-MM format for period (e.g., "2025-01", "2024-12")',
        'Ensure month is between 01 and 12',
        'Ensure year is a 4-digit number'
      );
    }

    if (errorCodes.some(code => code.includes('DESTINATION'))) {
      suggestions.push(
        'Check destination configuration - URL must be a valid string'
      );
    }

    if (errorCodes.some(code => code.includes('FILTER'))) {
      suggestions.push(
        'Check filter configuration - each filter needs field, operator, and value',
        'Use valid operators: eq, ne, gt, lt, ge, le'
      );
    }

    // Add a general suggestion if no specific ones were added
    if (suggestions.length === 0) {
      suggestions.push(
        'Review the specification format and ensure all required fields are present'
      );
    }

    return suggestions;
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
      'timestamp' in obj &&
      (obj as ErrorResponse).timestamp instanceof Date
    );
  }
}

/**
 * Default instance of ConfigurationService for convenience
 */
export const configurationService = new ConfigurationService();
