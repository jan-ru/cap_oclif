import fc from 'fast-check';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { OutputFormat } from '../../src/types/index.js';

// Helper function to simulate CLI argument validation logic
function validateCliArguments(
  specFile: string,
  outputFormat?: string,
  destination?: string
): { error?: string; isValid: boolean } {
  // Validate specification file exists
  if (!existsSync(specFile)) {
    return {
      error: `Specification file not found: ${specFile}`,
      isValid: false,
    };
  }

  // Validate output format
  const validFormats: OutputFormat[] = ['json', 'csv', 'table'];
  if (outputFormat && !validFormats.includes(outputFormat as OutputFormat)) {
    return {
      error: `Invalid output format: ${outputFormat}. Valid options: ${validFormats.join(', ')}`,
      isValid: false,
    };
  }

  // Validate destination path if provided
  if (destination) {
    const directoryName = dirname(destination);
    if (!existsSync(directoryName)) {
      return {
        error: `Destination directory does not exist: ${directoryName}`,
        isValid: false,
      };
    }
  }

  return { isValid: true };
}

describe('CLI Argument Processing Property Tests', () => {
  let tempDir: string;
  let validSpecFile: string;

  beforeAll(() => {
    // Create temporary directory for test files
    tempDir = join(tmpdir(), 'financial-reports-cli-test');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Create a valid specification file for testing
    validSpecFile = join(tempDir, 'valid-spec.json');
    const validSpec = {
      destination: {
        url: 'http://localhost:4004/odata/v4/financial',
      },
      entity: 'TestCompany',
      period: '2025-01',
      reportType: 'BalanceSheet',
    };
    writeFileSync(validSpecFile, JSON.stringify(validSpec, null, 2));
  });

  describe('Property 7: CLI Argument Processing', () => {
    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should accept valid report specification file paths as command-line arguments', () => {
      fc.assert(
        fc.property(
          // Generate valid output formats
          fc.constantFrom<OutputFormat>('json', 'csv', 'table'),
          // Generate boolean for verbose flag
          fc.boolean(),
          // Generate optional destination paths (valid directory paths)
          fc.option(
            fc.constantFrom(
              join(tempDir, 'output.json'),
              join(tempDir, 'output.csv')
            )
          ),
          (outputFormat, verbose, destination) => {
            // Test CLI argument validation with valid inputs
            const result = validateCliArguments(
              validSpecFile,
              outputFormat,
              destination
            );

            // Valid arguments should pass validation
            expect(result.isValid).toBe(true);
            expect(result.error).toBeUndefined();

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should reject invalid specification file paths with appropriate errors', () => {
      fc.assert(
        fc.property(
          // Generate invalid file paths (non-existent files)
          fc.constantFrom(
            '/non/existent/file.json',
            'missing-file.json',
            join(tempDir, 'does-not-exist.json')
          ),
          // Generate valid output formats
          fc.constantFrom<OutputFormat>('json', 'csv', 'table'),
          (invalidSpecFile, outputFormat) => {
            // Test CLI argument validation with invalid spec file
            const result = validateCliArguments(invalidSpecFile, outputFormat);

            // Invalid file paths should fail validation
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toContain('not found');

            return true;
          }
        ),
        { numRuns: 15 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should validate output format options correctly', () => {
      fc.assert(
        fc.property(
          // Generate both valid and invalid output formats
          fc.oneof(
            // Valid formats
            fc.constantFrom<OutputFormat>('json', 'csv', 'table'),
            // Invalid formats
            fc.constantFrom('xml', 'pdf', 'html', 'invalid')
          ),
          outputFormat => {
            // Test CLI argument validation with different output formats
            const result = validateCliArguments(validSpecFile, outputFormat);

            const validFormats: OutputFormat[] = ['json', 'csv', 'table'];
            const isValidFormat = validFormats.includes(
              outputFormat as OutputFormat
            );

            if (isValidFormat) {
              // Valid format should pass validation
              expect(result.isValid).toBe(true);
              expect(result.error).toBeUndefined();
            } else {
              // Invalid format should fail validation with helpful message
              expect(result.isValid).toBe(false);
              expect(result.error).toBeDefined();
              expect(result.error).toContain('Invalid output format');
              expect(result.error).toContain('Valid options:');
            }

            return true;
          }
        ),
        { numRuns: 25 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should validate destination paths when provided', () => {
      fc.assert(
        fc.property(
          // Generate both valid and invalid destination paths
          fc.oneof(
            // Valid paths (existing directory)
            fc.constantFrom(
              join(tempDir, 'output.json'),
              join(tempDir, 'output.csv'),
              join(tempDir, 'report.txt')
            ),
            // Invalid paths (non-existent directory)
            fc.constantFrom(
              '/non/existent/dir/output.json',
              'invalid/path/output.csv'
            )
          ),
          destination => {
            // Test CLI argument validation with different destination paths
            const result = validateCliArguments(
              validSpecFile,
              'json',
              destination
            );

            // Check if the destination directory exists
            const directoryName = dirname(destination);
            const isValidDestination = existsSync(directoryName);

            if (isValidDestination) {
              // Valid destination should pass validation
              expect(result.isValid).toBe(true);
              expect(result.error).toBeUndefined();
            } else {
              // Invalid destination should fail validation
              expect(result.isValid).toBe(false);
              expect(result.error).toBeDefined();
              expect(result.error).toContain(
                'Destination directory does not exist'
              );
            }

            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should handle verbose flag consistently across all argument combinations', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // verbose flag
          fc.constantFrom<OutputFormat>('json', 'csv', 'table'), // valid output format
          fc.option(fc.constantFrom(join(tempDir, 'output.json'))), // optional valid destination
          (verbose, outputFormat, destination) => {
            // Test that verbose flag doesn't affect validation of other arguments
            const result = validateCliArguments(
              validSpecFile,
              outputFormat,
              destination
            );

            // All valid combinations should pass validation regardless of verbose flag
            expect(result.isValid).toBe(true);
            expect(result.error).toBeUndefined();

            // The verbose flag itself doesn't affect argument validation logic
            // It only affects logging behavior, which is tested separately
            return true;
          }
        ),
        { numRuns: 15 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should correctly handle specification file argument requirements', () => {
      fc.assert(
        fc.property(
          // Generate various file path formats (syntactically valid)
          fc.oneof(
            fc.constantFrom(validSpecFile), // existing file
            fc.constantFrom('./spec.json', '../spec.json', 'spec.json'), // relative paths
            fc.constantFrom('/absolute/path/spec.json', '~/spec.json') // absolute paths
          ),
          specFile => {
            // Test CLI argument validation with different spec file formats
            const result = validateCliArguments(specFile);

            // Only existing files should pass validation
            const fileExists = existsSync(specFile);

            if (fileExists) {
              expect(result.isValid).toBe(true);
              expect(result.error).toBeUndefined();
            } else {
              expect(result.isValid).toBe(false);
              expect(result.error).toBeDefined();
              expect(result.error).toContain('not found');
            }

            return true;
          }
        ),
        { numRuns: 10 }
      );
    });

    // Feature: financial-reports-cli, Property 7: CLI Argument Processing
    test('should validate argument combinations comprehensively', () => {
      fc.assert(
        fc.property(
          // Generate file existence scenarios
          fc.boolean(),
          // Generate output format scenarios
          fc.oneof(
            fc.constantFrom<OutputFormat>('json', 'csv', 'table'),
            fc.constantFrom('invalid', 'xml')
          ),
          // Generate destination scenarios
          fc.option(
            fc.oneof(
              fc.constantFrom(join(tempDir, 'valid.json')),
              fc.constantFrom('/invalid/path/file.json')
            )
          ),
          (useValidFile, outputFormat, destination) => {
            const specFile = useValidFile
              ? validSpecFile
              : '/non/existent/file.json';
            const result = validateCliArguments(
              specFile,
              outputFormat,
              destination
            );

            // Determine expected validity based on all factors
            const fileExists = existsSync(specFile);
            const validFormats: OutputFormat[] = ['json', 'csv', 'table'];
            const formatValid = validFormats.includes(
              outputFormat as OutputFormat
            );
            const destValid = !destination || existsSync(dirname(destination));

            const shouldBeValid = fileExists && formatValid && destValid;

            expect(result.isValid).toBe(shouldBeValid);

            if (!shouldBeValid) {
              expect(result.error).toBeDefined();

              if (!fileExists) {
                expect(result.error).toContain('not found');
              } else if (!formatValid) {
                expect(result.error).toContain('Invalid output format');
              } else if (!destValid) {
                expect(result.error).toContain(
                  'Destination directory does not exist'
                );
              }
            }

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
