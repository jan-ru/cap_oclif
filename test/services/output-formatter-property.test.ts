import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';

import { OutputFormatter } from '../../src/services/output-formatter.js';
import {
  FinancialData,
  OutputFormat,
  ReportMetadata,
  ReportType,
} from '../../src/types/index.js';

describe('OutputFormatter - Property-Based Tests', () => {
  let formatter: OutputFormatter;

  beforeAll(() => {
    formatter = new OutputFormatter();
  });

  describe('Property 6: Structured Output Generation', () => {
    // Feature: financial-reports-cli, Property 6: Structured Output Generation
    test('should return structured output with required metadata for any financial report data', () => {
      fc.assert(
        fc.property(
          // Generate arbitrary financial data
          fc.array(
            fc.record({
              entity: fc
                .string({ maxLength: 20, minLength: 1 })
                .filter(
                  s => !s.includes(',') && !s.includes('"') && !s.includes('\n')
                ),
              lineItems: fc.array(
                fc.record({
                  account: fc
                    .string({ maxLength: 15, minLength: 1 })
                    .filter(
                      s =>
                        !s.includes(',') &&
                        !s.includes('"') &&
                        !s.includes('\n')
                    ),
                  amount: fc.float({
                    max: 1_000_000,
                    min: -1_000_000,
                    noNaN: true,
                  }),
                  category: fc.option(
                    fc
                      .string({ maxLength: 15, minLength: 1 })
                      .filter(
                        s =>
                          !s.includes(',') &&
                          !s.includes('"') &&
                          !s.includes('\n')
                      )
                  ),
                  currency: fc.constantFrom('USD', 'EUR', 'GBP'),
                  description: fc
                    .string({ maxLength: 30, minLength: 1 })
                    .filter(
                      s =>
                        !s.includes(',') &&
                        !s.includes('"') &&
                        !s.includes('\n')
                    ),
                }),
                { maxLength: 5, minLength: 0 }
              ),
              period: fc.constantFrom(
                '2025-01',
                '2024-12',
                '2023-06',
                '2025-03'
              ),
              reportType: fc.constantFrom(...Object.values(ReportType)),
            }),
            { maxLength: 3, minLength: 0 }
          ),
          // Generate arbitrary metadata
          fc.record({
            entity: fc
              .string({ maxLength: 20, minLength: 1 })
              .filter(
                s => !s.includes(',') && !s.includes('"') && !s.includes('\n')
              ),
            executionTime: fc.nat({ max: 10_000 }),
            generatedAt: fc
              .date({
                max: new Date('2030-12-31'),
                min: new Date('2020-01-01'),
              })
              .filter(d => !Number.isNaN(d.getTime())),
            period: fc.constantFrom('2025-01', '2024-12', '2023-06', '2025-03'),
            recordCount: fc.nat({ max: 1000 }),
            reportType: fc.constantFrom(...Object.values(ReportType)),
          }),
          // Generate output format
          fc.constantFrom('json', 'csv', 'table') as fc.Arbitrary<OutputFormat>,
          (
            data: FinancialData[],
            metadata: ReportMetadata,
            format: OutputFormat
          ) => {
            const result = formatter.format(data, metadata, format);

            // All formats should return non-empty string
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);

            // All formats should include required metadata
            switch (format) {
              case 'csv': {
                // CSV format should contain metadata in header comments
                expect(result).toContain('# Financial Report CSV Export');
                expect(result).toContain(
                  `# Report Type: ${metadata.reportType}`
                );
                expect(result).toContain(`# Period: ${metadata.period}`);
                expect(result).toContain(`# Entity: ${metadata.entity}`);
                expect(result).toContain('# Generated At:');
                expect(result).toContain(
                  `# Record Count: ${metadata.recordCount}`
                );
                expect(result).toContain(
                  `# Execution Time: ${metadata.executionTime}ms`
                );
                break;
              }

              case 'json': {
                // JSON format should be valid JSON and contain metadata
                const parsed = JSON.parse(result);
                expect(parsed.metadata).toBeDefined();
                expect(parsed.metadata.reportType).toBe(metadata.reportType);
                expect(parsed.metadata.period).toBe(metadata.period);
                expect(parsed.metadata.entity).toBe(metadata.entity);
                expect(parsed.metadata.generatedAt).toBeDefined();
                expect(parsed.metadata.recordCount).toBe(metadata.recordCount);
                expect(parsed.metadata.executionTime).toBe(
                  metadata.executionTime
                );
                expect(parsed.data).toEqual(data);
                break;
              }

              case 'table': {
                // Table format should contain metadata in header
                expect(result).toContain(
                  `FINANCIAL REPORT - ${metadata.reportType.toUpperCase()}`
                );
                expect(result).toContain(`Entity: ${metadata.entity}`);
                expect(result).toContain(`Period: ${metadata.period}`);
                expect(result).toContain('Generated:');
                expect(result).toContain(`Records: ${metadata.recordCount}`);
                expect(result).toContain(
                  `Execution Time: ${metadata.executionTime}ms`
                );
                break;
              }
            }

            // Structured format should be readable (contain expected structural elements)
            switch (format) {
              case 'csv': {
                // CSV should have proper headers and structure
                if (data.some(d => d.lineItems.length > 0)) {
                  expect(result).toContain(
                    'Entity,Period,Report Type,Account,Description,Amount,Currency,Category'
                  );
                }

                break;
              }

              case 'json': {
                // JSON should be properly formatted with indentation
                expect(result).toContain('{\n');
                expect(result).toContain('  ');

                break;
              }

              case 'table': {
                // Table should have visual separators and structure
                expect(result).toContain('═');
                if (data.some(d => d.lineItems.length > 0)) {
                  expect(result).toContain('Account');
                  expect(result).toContain('Description');
                  expect(result).toContain('Amount');
                }

                break;
              }
              // No default
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: financial-reports-cli, Property 6: Structured Output Generation
    test('should handle empty data gracefully while maintaining metadata structure', () => {
      fc.assert(
        fc.property(
          // Generate metadata for empty data scenarios
          fc.record({
            entity: fc
              .string({ maxLength: 20, minLength: 1 })
              .filter(
                s => !s.includes(',') && !s.includes('"') && !s.includes('\n')
              ),
            executionTime: fc.nat({ max: 10_000 }),
            generatedAt: fc
              .date({
                max: new Date('2030-12-31'),
                min: new Date('2020-01-01'),
              })
              .filter(d => !Number.isNaN(d.getTime())),
            period: fc.constantFrom('2025-01', '2024-12', '2023-06', '2025-03'),
            recordCount: fc.constant(0), // Always 0 for empty data
            reportType: fc.constantFrom(...Object.values(ReportType)),
          }),
          fc.constantFrom('json', 'csv', 'table') as fc.Arbitrary<OutputFormat>,
          (metadata: ReportMetadata, format: OutputFormat) => {
            const emptyData: FinancialData[] = [];
            const result = formatter.format(emptyData, metadata, format);

            // Should still return structured output with metadata
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);

            // Should contain all required metadata even with empty data
            switch (format) {
              case 'csv': {
                expect(result).toContain('# Financial Report CSV Export');
                expect(result).toContain(
                  `# Report Type: ${metadata.reportType}`
                );
                expect(result).toContain(`# Period: ${metadata.period}`);
                expect(result).toContain(`# Entity: ${metadata.entity}`);
                expect(result).toContain('# Record Count: 0');
                expect(result).toContain(
                  '# No data found for the specified criteria'
                );
                break;
              }

              case 'json': {
                const parsed = JSON.parse(result);
                expect(parsed.metadata).toBeDefined();
                expect(parsed.metadata.reportType).toBe(metadata.reportType);
                expect(parsed.metadata.period).toBe(metadata.period);
                expect(parsed.metadata.entity).toBe(metadata.entity);
                expect(parsed.metadata.recordCount).toBe(0);
                expect(parsed.data).toEqual([]);
                break;
              }

              case 'table': {
                expect(result).toContain(
                  `FINANCIAL REPORT - ${metadata.reportType.toUpperCase()}`
                );
                expect(result).toContain(`Entity: ${metadata.entity}`);
                expect(result).toContain(`Period: ${metadata.period}`);
                expect(result).toContain('Records: 0');
                expect(result).toContain(
                  'No data found for the specified criteria'
                );
                break;
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: financial-reports-cli, Property 6: Structured Output Generation
    test('should maintain consistent metadata structure across all output formats', () => {
      fc.assert(
        fc.property(
          // Generate the same data and metadata for all formats
          fc.array(
            fc.record({
              entity: fc
                .string({ maxLength: 20, minLength: 1 })
                .filter(
                  s => !s.includes(',') && !s.includes('"') && !s.includes('\n')
                ),
              lineItems: fc.array(
                fc.record({
                  account: fc
                    .string({ maxLength: 15, minLength: 1 })
                    .filter(
                      s =>
                        !s.includes(',') &&
                        !s.includes('"') &&
                        !s.includes('\n')
                    ),
                  amount: fc.float({
                    max: 1_000_000,
                    min: -1_000_000,
                    noNaN: true,
                  }),
                  category: fc.option(
                    fc
                      .string({ maxLength: 15, minLength: 1 })
                      .filter(
                        s =>
                          !s.includes(',') &&
                          !s.includes('"') &&
                          !s.includes('\n')
                      )
                  ),
                  currency: fc.constantFrom('USD', 'EUR'),
                  description: fc
                    .string({ maxLength: 30, minLength: 1 })
                    .filter(
                      s =>
                        !s.includes(',') &&
                        !s.includes('"') &&
                        !s.includes('\n')
                    ),
                }),
                { maxLength: 3, minLength: 0 }
              ),
              period: fc.constantFrom('2025-01', '2024-12'),
              reportType: fc.constantFrom(...Object.values(ReportType)),
            }),
            { maxLength: 2, minLength: 0 }
          ),
          fc.record({
            entity: fc
              .string({ maxLength: 20, minLength: 1 })
              .filter(
                s => !s.includes(',') && !s.includes('"') && !s.includes('\n')
              ),
            executionTime: fc.nat({ max: 5000 }),
            generatedAt: fc
              .date({
                max: new Date('2030-12-31'),
                min: new Date('2020-01-01'),
              })
              .filter(d => !Number.isNaN(d.getTime())),
            period: fc.constantFrom('2025-01', '2024-12'),
            recordCount: fc.nat({ max: 100 }),
            reportType: fc.constantFrom(...Object.values(ReportType)),
          }),
          (data: FinancialData[], metadata: ReportMetadata) => {
            const jsonResult = formatter.format(data, metadata, 'json');
            const csvResult = formatter.format(data, metadata, 'csv');
            const tableResult = formatter.format(data, metadata, 'table');

            // All formats should contain the same core metadata information
            const formats = [
              { name: 'json', result: jsonResult },
              { name: 'csv', result: csvResult },
              { name: 'table', result: tableResult },
            ];

            for (const { name, result } of formats) {
              expect(result).toBeDefined();
              expect(typeof result).toBe('string');
              expect(result.length).toBeGreaterThan(0);

              // Each format should reference the same metadata values
              if (name === 'json') {
                const parsed = JSON.parse(result);
                expect(parsed.metadata.reportType).toBe(metadata.reportType);
                expect(parsed.metadata.period).toBe(metadata.period);
                expect(parsed.metadata.entity).toBe(metadata.entity);
              } else {
                // CSV and table formats should contain metadata as text
                // Only table format converts report type to uppercase, CSV keeps original case
                if (name === 'table') {
                  expect(result).toContain(metadata.reportType.toUpperCase());
                } else {
                  expect(result).toContain(metadata.reportType);
                }

                expect(result).toContain(metadata.period);
                expect(result).toContain(metadata.entity);
                expect(result).toContain(metadata.recordCount.toString());
                expect(result).toContain(metadata.executionTime.toString());
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
