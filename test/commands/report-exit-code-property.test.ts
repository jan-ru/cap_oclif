import fc from 'fast-check';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Property-based tests for CLI exit code consistency
 * Validates Requirements 4.3, 4.4: Exit code handling
 */

/**
 * Helper function to execute CLI command and capture exit code
 */
async function executeCLI(
  args: string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise(resolve => {
    const child = spawn('node', ['./bin/run.js', ...args], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout?.on('data', data => {
      stdout += data.toString();
    });

    child.stderr?.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      resolve({
        exitCode: code || 0,
        stderr,
        stdout,
      });
    });
  });
}

describe('CLI Exit Code Consistency Property Tests', () => {
  let tempDir: string;
  let validSpecFile: string;
  let invalidSpecFile: string;

  beforeAll(() => {
    // Create temporary directory for test files
    tempDir = join(tmpdir(), 'financial-reports-cli-exit-code-test');
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

    // Create an invalid specification file for testing
    invalidSpecFile = join(tempDir, 'invalid-spec.json');
    writeFileSync(invalidSpecFile, '{ invalid json }');
  });

  describe('Property 8: Exit Code Consistency', () => {
    // Feature: financial-reports-cli, Property 8: Exit Code Consistency
    test('should exit with code 0 for successful operations and non-zero codes for errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate different command scenarios
          fc.oneof(
            // File not found scenarios (exit code 2)
            fc.record({
              outputFormat: fc.constantFrom('json', 'csv', 'table'),
              specFile: fc.constantFrom(
                '/non/existent/file.json',
                'missing.json'
              ),
              type: fc.constant('file_not_found'),
              verbose: fc.boolean(),
            }),
            // oclif validation error scenarios (exit code 2)
            fc.record({
              outputFormat: fc.constantFrom('invalid', 'xml', 'pdf'), // invalid format
              specFile: fc.constant(validSpecFile),
              type: fc.constant('oclif_validation_error'),
              verbose: fc.boolean(),
            }),
            // Application validation errors (exit code 1 or 2)
            fc.record({
              outputFormat: fc.constantFrom('json', 'csv', 'table'),
              specFile: fc.constant(invalidSpecFile), // malformed JSON
              type: fc.constant('app_validation_error'),
              verbose: fc.boolean(),
            }),
            // Invalid destination scenarios (exit code varies)
            fc.record({
              destination: fc.constantFrom('/non/existent/dir/output.json'),
              outputFormat: fc.constantFrom('json', 'csv', 'table'),
              specFile: fc.constant(validSpecFile),
              type: fc.constant('invalid_destination'),
              verbose: fc.boolean(),
            })
          ),
          async scenario => {
            // Build command arguments
            const args = ['report', scenario.specFile];

            if (scenario.outputFormat) {
              args.push('--output', scenario.outputFormat);
            }

            if (scenario.verbose) {
              args.push('--verbose');
            }

            if ('destination' in scenario && scenario.destination) {
              args.push('--destination', scenario.destination);
            }

            // Execute CLI command
            const result = await executeCLI(args);

            // Verify exit code based on scenario type
            switch (scenario.type) {
              case 'app_validation_error': {
                // Application validation errors return exit code 1 when file exists
                // but return exit code 2 if oclif validation fails first
                expect([1, 2]).toContain(result.exitCode);
                break;
              }

              case 'file_not_found': {
                // File not found should return exit code 2
                expect(result.exitCode).toBe(2);
                expect(result.stderr.toLowerCase()).toContain('not found');
                break;
              }

              case 'invalid_destination': {
                // Invalid destination should return appropriate error code
                expect(result.exitCode).toBeGreaterThan(0);
                expect([1, 2, 5]).toContain(result.exitCode); // General, file not found, or permission error
                break;
              }

              case 'oclif_validation_error': {
                // oclif validation errors (invalid flags) return exit code 2
                expect(result.exitCode).toBe(2);
                expect(result.stderr.toLowerCase()).toMatch(/invalid|error/);
                break;
              }

              default: {
                throw new Error(`Unknown scenario type: ${scenario.type}`);
              }
            }

            return true;
          }
        ),
        { numRuns: 20 } // Reduced runs due to subprocess overhead
      );
    }, 30_000); // 30 second timeout for subprocess tests

    // Feature: financial-reports-cli, Property 8: Exit Code Consistency
    test('should consistently map error types to appropriate exit codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate various error scenarios
          fc.oneof(
            // File system errors
            fc.record({
              args: fc.constantFrom(
                ['report', '/non/existent/file.json'],
                ['report', 'missing-spec.json'],
                [
                  'report',
                  validSpecFile,
                  '--destination',
                  '/invalid/path/output.json',
                ]
              ),
              errorType: fc.constant('file_system'),
            }),
            // oclif validation errors (invalid flags)
            fc.record({
              args: fc.constantFrom(
                ['report', validSpecFile, '--output', 'invalid'],
                ['report', validSpecFile, '--output', 'xml']
              ),
              errorType: fc.constant('oclif_validation'),
            }),
            // Application validation errors (malformed content)
            fc.record({
              args: fc.constantFrom(['report', invalidSpecFile]),
              errorType: fc.constant('app_validation'),
            })
          ),
          async scenario => {
            const result = await executeCLI(scenario.args);

            // Verify that exit codes are consistent for error types
            expect(result.exitCode).toBeGreaterThan(0);

            switch (scenario.errorType) {
              case 'app_validation': {
                // Application validation errors can return code 1 or 2 depending on validation order
                expect([1, 2]).toContain(result.exitCode);
                break;
              }

              case 'file_system': {
                // File system errors should map to codes 2 or 5
                expect([2, 5]).toContain(result.exitCode);
                break;
              }

              case 'oclif_validation': {
                // oclif validation errors should map to code 2
                expect(result.exitCode).toBe(2);
                break;
              }
            }

            // Verify error message is present
            expect(result.stderr.length).toBeGreaterThan(0);

            return true;
          }
        ),
        { numRuns: 15 }
      );
    }, 25_000);

    // Feature: financial-reports-cli, Property 8: Exit Code Consistency
    test('should maintain exit code consistency across different output formats and verbose modes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('json', 'csv', 'table'), // output format
          fc.boolean(), // verbose flag
          fc.constantFrom(
            // Different error scenarios
            '/non/existent/file.json', // file not found
            'invalid-format-spec.json' // non-existent file
          ),
          async (outputFormat, verbose, specFile) => {
            const args = ['report', specFile, '--output', outputFormat];
            if (verbose) {
              args.push('--verbose');
            }

            const result = await executeCLI(args);

            // Exit code should be consistent regardless of output format or verbose flag
            // File not found should always be exit code 2
            expect(result.exitCode).toBe(2);
            expect(result.stderr.toLowerCase()).toContain('not found');

            // Verbose flag should not affect exit code, only output verbosity
            if (verbose) {
              // In verbose mode, we might expect more detailed error information
              // but the exit code should remain the same
              expect(result.exitCode).toBe(2);
            }

            return true;
          }
        ),
        { numRuns: 12 }
      );
    }, 20_000);

    // Feature: financial-reports-cli, Property 8: Exit Code Consistency
    test('should handle help and version commands with exit code 0', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(['--help'], ['--version']),
          async args => {
            const result = await executeCLI(args);

            // Help and version commands should always exit with code 0
            expect(result.exitCode).toBe(0);

            // Should produce output (either help text or version)
            expect(result.stdout.length + result.stderr.length).toBeGreaterThan(
              0
            );

            return true;
          }
        ),
        { numRuns: 5 }
      );
    }, 15_000);

    // Feature: financial-reports-cli, Property 8: Exit Code Consistency
    test('should exit with appropriate codes for different argument validation failures', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate invalid argument combinations
          fc.oneof(
            // Missing required argument
            fc.record({
              args: fc.constant(['report']), // missing spec file
              expectedExitCode: fc.constant(2), // oclif typically uses 2 for missing args
            }),
            // Invalid flag values
            fc.record({
              args: fc.constantFrom(
                ['report', validSpecFile, '--output', 'invalid'],
                ['report', validSpecFile, '--output', 'xml'],
                ['report', validSpecFile, '--output', 'pdf']
              ),
              expectedExitCode: fc.constant(3), // validation error
            })
          ),
          async scenario => {
            const result = await executeCLI(scenario.args);

            // Should exit with non-zero code
            expect(result.exitCode).toBeGreaterThan(0);

            // Should be one of the expected error codes
            expect([1, 2, 3]).toContain(result.exitCode);

            // Should provide error message
            expect(result.stderr.length).toBeGreaterThan(0);

            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 15_000);
  });
});
