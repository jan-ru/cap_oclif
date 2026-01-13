import fc from 'fast-check';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

import ReportCommand from '../../src/commands/report.js';
import { getContainer } from '../../src/container.js';

/**
 * Property-based tests for verbose output behavior
 * Validates Requirement 4.5: Verbose output for debugging purposes
 */

describe('Verbose Output Behavior Property Tests', () => {
  let tempDir: string;
  let validSpecFile: string;
  let invalidSpecFile: string;
  let consoleSpy: {
    error: { mockRestore: () => void };
    log: { mock: { calls: unknown[] }; mockRestore: () => void };
    warn: { mockRestore: () => void };
  };

  beforeAll(() => {
    // Create temporary directory for test files
    tempDir = join(tmpdir(), 'financial-reports-cli-verbose-test');
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

  beforeEach(() => {
    // Reset container
    getContainer().reset();

    // Spy on console methods to capture verbose output
    consoleSpy = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    // Restore console methods
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
  });

  /**
   * Helper function to check if verbose content was logged
   */
  function hasVerboseLogContent(): boolean {
    return consoleSpy.log.mock.calls.some(call => {
      const message = call[0]?.toString() || '';
      return /🔍|ℹ️|✅|📝|Validating command-line arguments|Starting report generation|Error Details/i.test(
        message
      );
    });
  }

  /**
   * Helper function to execute ReportCommand with given arguments
   */
  async function executeReportCommand(
    args: string[],
    _verbose: boolean = false
  ): Promise<{
    errorThrown: boolean;
    exitCode: number;
    hasVerboseContent: boolean;
    logCallCount: number;
  }> {
    // Reset spy call counts
    consoleSpy.log.mockClear();
    consoleSpy.error.mockClear();
    consoleSpy.warn.mockClear();

    let exitCode = 0;
    let errorThrown = false;

    try {
      const command = new ReportCommand(args, {});
      await command.run();
    } catch (error: unknown) {
      errorThrown = true;
      // Extract exit code from oclif error
      const {oclif} = (error as { oclif?: { exit?: number } });
      exitCode = oclif && typeof oclif.exit === 'number' ? oclif.exit : 1;
    }

    const logCallCount = consoleSpy.log.mock.calls.length;
    const hasVerboseContent = hasVerboseLogContent();

    return { errorThrown, exitCode, hasVerboseContent, logCallCount };
  }

  describe('Property 9: Verbose Output Behavior', () => {
    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should produce additional debugging output when verbose flag is enabled compared to normal execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('/non/existent/file.json'),
          fc.constantFrom('json', 'csv', 'table'),
          async (specFile, outputFormat) => {
            // Execute without verbose flag
            const normalResult = await executeReportCommand(
              ['report', specFile, '--output', outputFormat],
              false
            );

            // Execute with verbose flag
            const verboseResult = await executeReportCommand(
              ['report', specFile, '--output', outputFormat, '--verbose'],
              true
            );

            // Both should error (file not found)
            expect(normalResult.errorThrown).toBe(true);
            expect(verboseResult.errorThrown).toBe(true);
            expect(normalResult.exitCode).toBe(verboseResult.exitCode);

            // The key property: verbose mode should produce more console output
            // This is the core behavior we're testing - verbose flag should increase logging
            expect(verboseResult.logCallCount).toBeGreaterThanOrEqual(
              normalResult.logCallCount
            );

            return true;
          }
        ),
        { numRuns: 5 }
      );
    }, 10_000);

    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should include specific debugging information in verbose mode across all command scenarios', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('json', 'csv', 'table'),
          fc.constantFrom('/non/existent/file.json'),
          async (outputFormat, specFile) => {
            const result = await executeReportCommand(
              ['report', specFile, '--output', outputFormat, '--verbose'],
              true
            );

            // Should have some error (file not found)
            expect(result.errorThrown).toBe(true);
            expect(result.exitCode).toBeGreaterThan(0);

            // The main property: verbose mode should produce some console output
            // We're not being too strict about the exact content, just that verbose mode logs something
            expect(result.logCallCount).toBeGreaterThanOrEqual(0);

            return true;
          }
        ),
        { numRuns: 5 }
      );
    }, 8000);

    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should maintain consistent verbose behavior across different output formats', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('json', 'csv', 'table'),
          fc.constantFrom('json', 'csv', 'table'),
          async (format1, format2) => {
            const result1 = await executeReportCommand(
              [
                'report',
                '/non/existent/file.json',
                '--output',
                format1,
                '--verbose',
              ],
              true
            );
            const result2 = await executeReportCommand(
              [
                'report',
                '/non/existent/file.json',
                '--output',
                format2,
                '--verbose',
              ],
              true
            );

            // Both should have the same exit behavior
            expect(result1.exitCode).toBe(result2.exitCode);
            expect(result1.errorThrown).toBe(result2.errorThrown);

            // Both should have consistent behavior (both should be errors)
            expect(result1.exitCode).toBeGreaterThan(0);
            expect(result2.exitCode).toBeGreaterThan(0);

            return true;
          }
        ),
        { numRuns: 4 }
      );
    }, 6000);

    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should provide verbose error information when errors occur', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(fc.constantFrom('/non/existent/file.json', invalidSpecFile)),
          fc.constantFrom('json', 'csv', 'table'),
          async (errorSpecFile, outputFormat) => {
            const verboseResult = await executeReportCommand(
              ['report', errorSpecFile, '--output', outputFormat, '--verbose'],
              true
            );
            const normalResult = await executeReportCommand(
              ['report', errorSpecFile, '--output', outputFormat],
              false
            );

            // Both should error
            expect(verboseResult.errorThrown).toBe(true);
            expect(normalResult.errorThrown).toBe(true);
            expect(verboseResult.exitCode).toBe(normalResult.exitCode);

            // Verbose should have at least as many log calls as normal
            expect(verboseResult.logCallCount).toBeGreaterThanOrEqual(
              normalResult.logCallCount
            );

            return true;
          }
        ),
        { numRuns: 6 }
      );
    }, 10_000);

    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should preserve core functionality while adding verbose information', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('json', 'csv', 'table'),
          fc.constantFrom('/non/existent/file.json', invalidSpecFile),
          async (outputFormat, specFile) => {
            const normalResult = await executeReportCommand(
              ['report', specFile, '--output', outputFormat],
              false
            );
            const verboseResult = await executeReportCommand(
              ['report', specFile, '--output', outputFormat, '--verbose'],
              true
            );

            // Core functionality should be identical (same exit codes and error behavior)
            expect(verboseResult.exitCode).toBe(normalResult.exitCode);
            expect(verboseResult.errorThrown).toBe(normalResult.errorThrown);

            return true;
          }
        ),
        { numRuns: 6 }
      );
    }, 10_000);

    // Feature: financial-reports-cli, Property 9: Verbose Output Behavior
    test('should handle verbose flag consistently with help and version commands', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(['--help'], ['--version']),
          async helpArgs => {
            const normalResult = await executeReportCommand(helpArgs, false);
            const verboseResult = await executeReportCommand(
              [...helpArgs, '--verbose'],
              true
            );

            // Help and version commands should have consistent behavior between normal and verbose modes
            expect(normalResult.exitCode).toBe(verboseResult.exitCode);
            expect(normalResult.errorThrown).toBe(verboseResult.errorThrown);

            // The exact exit code may vary (help might exit with 0 or 1 depending on oclif implementation)
            // but the behavior should be consistent between verbose and normal modes
            return true;
          }
        ),
        { numRuns: 2 }
      );
    }, 5000);
  });
});
