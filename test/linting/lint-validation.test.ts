import { execSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

/**
 * Linting validation tests
 * Validates Requirements 5.1: Linter exits with zero errors
 */

describe('Linting Validation', () => {
  describe('Linter Exit Code', () => {
    // Feature: fix-remaining-linting-errors, Property 1: Linter Exits Successfully
    test('should exit with code 0 when running npm run lint', () => {
      // Requirements: 5.1
      // This test verifies that the linter produces no errors
      // by checking that the command exits with code 0

      let exitCode = 0;
      let stdout = '';
      let stderr = '';

      try {
        // Execute the linter command
        const result = execSync('npm run lint', {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: 'pipe',
        });

        stdout = result;
      } catch (error: unknown) {
        // execSync throws an error if the command exits with non-zero code
        if (error && typeof error === 'object' && 'status' in error) {
          exitCode = (error as { status: number }).status;
        }

        if (error && typeof error === 'object' && 'stdout' in error) {
          stdout = (error as { stdout: Buffer }).stdout.toString();
        }

        if (error && typeof error === 'object' && 'stderr' in error) {
          stderr = (error as { stderr: Buffer }).stderr.toString();
        }
      }

      // Assert that the linter exited with code 0 (success)
      expect(exitCode).toBe(0);

      // If there were errors, the output should not contain error indicators
      if (stdout || stderr) {
        const output = stdout + stderr;
        // The output should not contain error counts like "1 error" or "5 errors"
        expect(output).not.toMatch(/\d+\s+errors?/i);
      }
    });
  });
});
