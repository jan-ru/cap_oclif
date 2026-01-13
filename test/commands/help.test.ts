import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import Help from '../../src/commands/help.js';
import ReportCommand from '../../src/commands/report.js';

/**
 * Unit tests for help documentation functionality
 * Validates Requirement 4.2: Help documentation for all available commands and options
 */
describe('Help Documentation Tests', () => {
  describe('Help Command Static Content', () => {
    test('should have comprehensive description and examples', () => {
      // Verify Help command has proper static documentation
      const { description, examples } = Help;
      expect(description).toBeDefined();
      expect(description.length).toBeGreaterThan(0);
      expect(examples).toBeDefined();
      expect(examples.length).toBeGreaterThan(0);

      // Check description includes key information
      expect(description).toContain('comprehensive help information');
      expect(description).toContain('Financial Reports CLI');
      expect(description).toContain('OData v4');
    });

    test('should document help command examples', () => {
      // Verify examples are provided for the help command
      const { examples } = Help;
      expect(examples.length).toBeGreaterThan(0);

      // Check for help-specific examples
      const exampleText = examples.join(' ');
      expect(exampleText).toContain('help');
      expect(exampleText).toContain('report');
    });

    test('should contain comprehensive help content in source', () => {
      // Since we can't easily run the command in tests due to oclif configuration,
      // we'll verify the help content exists in the source code by reading the file
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify comprehensive help content exists in the source
      expect(helpFileContent).toContain('Financial Reports CLI');
      expect(helpFileContent).toContain('OVERVIEW');
      expect(helpFileContent).toContain('QUICK START');
      expect(helpFileContent).toContain('MAIN COMMAND');
      expect(helpFileContent).toContain('GLOBAL OPTIONS');
      expect(helpFileContent).toContain('REPORT COMMAND OPTIONS');
      expect(helpFileContent).toContain('REPORT SPECIFICATION FORMAT');
      expect(helpFileContent).toContain('SUPPORTED REPORT TYPES');
      expect(helpFileContent).toContain('OUTPUT FORMATS');
      expect(helpFileContent).toContain('EXAMPLES');
      expect(helpFileContent).toContain('EXIT CODES');
      expect(helpFileContent).toContain('TROUBLESHOOTING');
      expect(helpFileContent).toContain('GETTING HELP');
    });

    test('should include all required command options in help content', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify all command options are documented
      expect(helpFileContent).toContain('report <specFile>');
      expect(helpFileContent).toContain('--help');
      expect(helpFileContent).toContain('--version');
      expect(helpFileContent).toContain('-o, --output FORMAT');
      expect(helpFileContent).toContain('-v, --verbose');
      expect(helpFileContent).toContain('-d, --destination');
    });

    test('should include all supported report types in help content', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify all supported report types are documented
      expect(helpFileContent).toContain('BalanceSheet');
      expect(helpFileContent).toContain('IncomeStatement');
      expect(helpFileContent).toContain('Cashflow');
    });

    test('should include all supported output formats in help content', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify all supported output formats are documented
      expect(helpFileContent).toContain('json (default)');
      expect(helpFileContent).toContain('csv');
      expect(helpFileContent).toContain('table');
    });

    test('should include practical examples in help content', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify practical examples are included
      expect(helpFileContent).toContain('financial-reports-cli report');
      expect(helpFileContent).toContain('./balance-sheet.json');
      expect(helpFileContent).toContain('--output csv --verbose');
      expect(helpFileContent).toContain('--destination');
    });

    test('should include exit codes documentation', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify exit codes are documented
      expect(helpFileContent).toContain('EXIT CODES');
      expect(helpFileContent).toContain('0    Success');
      expect(helpFileContent).toContain('1    General application error');
      expect(helpFileContent).toContain('2    File or resource not found');
      expect(helpFileContent).toContain('3    Validation or input error');
      expect(helpFileContent).toContain('4    Network or connection error');
      expect(helpFileContent).toContain('5    Permission or access error');
    });

    test('should include troubleshooting information', () => {
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Verify troubleshooting information is included
      expect(helpFileContent).toContain('TROUBLESHOOTING');
      expect(helpFileContent).toContain('File not found errors');
      expect(helpFileContent).toContain('Validation errors');
      expect(helpFileContent).toContain('Connection errors');
      expect(helpFileContent).toContain('Permission errors');
      expect(helpFileContent).toContain('--verbose flag');
    });
  });

  describe('Report Command Help', () => {
    test('should have comprehensive description and examples', () => {
      // Verify ReportCommand has proper help documentation
      const { description, examples } = ReportCommand;
      expect(description).toBeDefined();
      expect(description.length).toBeGreaterThan(0);
      expect(examples).toBeDefined();
      expect(examples.length).toBeGreaterThan(0);

      // Check description includes key information
      expect(description).toContain('Generate financial reports');
      expect(description).toContain('OData v4');
      expect(description).toContain('specification');
    });

    test('should document all command arguments', () => {
      // Verify specFile argument is properly documented
      const { args } = ReportCommand;
      expect(args).toBeDefined();
      expect(args.specFile).toBeDefined();
      expect(args.specFile.description).toBeDefined();
      expect(args.specFile.required).toBe(true);
      expect(args.specFile.description).toContain('specification file');
    });

    test('should document all command flags', () => {
      // Verify all flags are properly documented
      const { flags } = ReportCommand;
      expect(flags).toBeDefined();

      // Check output flag
      expect(flags.output).toBeDefined();
      expect(flags.output.description).toBeDefined();
      expect(flags.output.description).toContain('Output format');
      expect(flags.output.options).toEqual(['json', 'csv', 'table']);

      // Check verbose flag
      expect(flags.verbose).toBeDefined();
      expect(flags.verbose.description).toBeDefined();
      expect(flags.verbose.description).toContain('verbose');

      // Check destination flag
      expect(flags.destination).toBeDefined();
      expect(flags.destination.description).toBeDefined();
      expect(flags.destination.description).toContain('File path');
    });

    test('should include practical usage examples', () => {
      // Verify examples are comprehensive and practical
      const { examples } = ReportCommand;
      expect(examples.length).toBeGreaterThan(0);

      // Check for different usage scenarios
      const exampleText = examples.join(' ');
      expect(exampleText).toContain('report-spec.json');
      expect(exampleText).toContain('--output');
      expect(exampleText).toContain('--verbose');
      expect(exampleText).toContain('--destination');
      expect(exampleText).toContain('table');
      expect(exampleText).toContain('csv');
    });

    test('should document report specification format', () => {
      // Verify description includes specification format information
      const { description } = ReportCommand;
      expect(description).toContain('REPORT SPECIFICATION FORMAT');
      expect(description).toContain('entity');
      expect(description).toContain('reportType');
      expect(description).toContain('period');
      expect(description).toContain('YYYY-MM');
    });

    test('should document supported report types', () => {
      // Verify description includes all supported report types
      const { description } = ReportCommand;
      expect(description).toContain('SUPPORTED REPORT TYPES');
      expect(description).toContain('BalanceSheet');
      expect(description).toContain('IncomeStatement');
      expect(description).toContain('Cashflow');
    });

    test('should document output formats', () => {
      // Verify description includes all output formats
      const { description } = ReportCommand;
      expect(description).toContain('OUTPUT FORMATS');
      expect(description).toContain('json (default)');
      expect(description).toContain('csv');
      expect(description).toContain('table');
    });

    test('should document exit codes', () => {
      // Verify description includes exit code information
      const { description } = ReportCommand;
      expect(description).toContain('EXIT CODES');
      expect(description).toContain('0 - Success');
      expect(description).toContain('1 - General application error');
      expect(description).toContain('2 - File or resource not found');
      expect(description).toContain('3 - Validation or input error');
      expect(description).toContain('4 - Network or connection error');
      expect(description).toContain('5 - Permission or access error');
    });
  });

  describe('Help Accessibility', () => {
    test('should provide help through multiple access methods', () => {
      // Test that help is accessible through different methods

      // 1. Dedicated Help command exists
      expect(Help).toBeDefined();

      // 2. ReportCommand has built-in help
      const { args, description, examples, flags } = ReportCommand;
      expect(description).toBeDefined();
      expect(examples).toBeDefined();
      expect(flags).toBeDefined();
      expect(args).toBeDefined();

      // 3. Help command mentions how to get specific command help
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      expect(helpFileContent).toContain('help report');
      expect(helpFileContent).toContain('financial-reports-cli help');
    });

    test('should provide consistent help information across commands', () => {
      // Get help information from source file
      const helpFilePath = join(process.cwd(), 'src', 'commands', 'help.ts');
      const helpFileContent = readFileSync(helpFilePath, 'utf8');

      // Get help information from ReportCommand
      const { description: reportDescription } = ReportCommand;

      // Verify consistent information between both help sources
      // Both should mention the same report types
      expect(helpFileContent).toContain('BalanceSheet');
      expect(reportDescription).toContain('BalanceSheet');

      expect(helpFileContent).toContain('IncomeStatement');
      expect(reportDescription).toContain('IncomeStatement');

      expect(helpFileContent).toContain('Cashflow');
      expect(reportDescription).toContain('Cashflow');

      // Both should mention the same output formats
      expect(helpFileContent).toContain('json');
      expect(reportDescription).toContain('json');

      expect(helpFileContent).toContain('csv');
      expect(reportDescription).toContain('csv');

      expect(helpFileContent).toContain('table');
      expect(reportDescription).toContain('table');
    });
  });
});
