import fc from 'fast-check';
import { beforeAll, describe, test, vi } from 'vitest';

import { ConfigurationService } from '../../src/services/configuration.js';
import {
  createFinancialDataClient,
  FinancialDataClient,
} from '../../src/services/financial-data-client.js';
import { OutputFormatter } from '../../src/services/output-formatter.js';
import { ReportService } from '../../src/services/report-service.js';
import {
  ReportOptions,
  ReportSpecification,
  ReportType,
} from '../../src/types/index.js';

// Mock the financial data client module
vi.mock('../../src/services/financial-data-client.js');

describe('ReportService - Empty Result Handling Property Tests', () => {
  let reportService: ReportService;
  let mockConfigService: ConfigurationService;
  let mockOutputFormatter: OutputFormatter;

  beforeAll(() => {
    mockConfigService = new ConfigurationService();
    mockOutputFormatter = new OutputFormatter();
    reportService = new ReportService(mockConfigService, mockOutputFormatter);
  });

  describe('Property 10: Empty Result Handling', () => {
    // Feature: financial-reports-cli, Property 10: Empty Result Handling
    test('should inform user when no matching records exist for any valid query criteria', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate valid report specifications
          fc.record({
            destination: fc.constant({
              url: 'http://localhost:4004/odata/v4/financial',
            }),
            entity: fc.constantFrom('CompanyA', 'CompanyB', 'CompanyC'),
            period: fc.constantFrom('2025-01', '2024-12', '2023-06'),
            reportType: fc.constantFrom(...Object.values(ReportType)),
          }),
          // Generate report options
          fc.record({
            outputFormat: fc.constantFrom(
              'json',
              'csv',
              'table'
            ) as fc.Arbitrary<'csv' | 'json' | 'table'>,
            verbose: fc.boolean(),
          }),
          async (
            specification: ReportSpecification,
            options: ReportOptions
          ) => {
            // Mock the configuration service to return the specification
            vi.spyOn(mockConfigService, 'parseSpecification').mockResolvedValue(
              specification
            );

            // Mock the financial data client to return empty results
            const mockClient = {
              queryBalanceSheet: vi.fn().mockResolvedValue([
                {
                  assets: [],
                  entity: specification.entity,
                  equity: [],
                  liabilities: [],
                  lineItems: [], // Empty line items
                  period: specification.period,
                  reportType: specification.reportType,
                },
              ]),
              queryCashFlow: vi.fn().mockResolvedValue([
                {
                  entity: specification.entity,
                  financingActivities: [],
                  investingActivities: [],
                  lineItems: [], // Empty line items
                  netCashFlow: 0,
                  operatingActivities: [],
                  period: specification.period,
                  reportType: specification.reportType,
                },
              ]),
              queryIncomeStatement: vi.fn().mockResolvedValue([
                {
                  entity: specification.entity,
                  expenses: [],
                  lineItems: [], // Empty line items
                  netIncome: 0,
                  period: specification.period,
                  reportType: specification.reportType,
                  revenue: [],
                },
              ]),
              testConnection: vi.fn().mockResolvedValue(true),
            };

            // Mock the createFinancialDataClient function
            vi.mocked(createFinancialDataClient).mockReturnValue(
              mockClient as FinancialDataClient
            );

            // Execute the report generation
            const result = await reportService.generateReport(
              'dummy-spec.json',
              options
            );

            // Verify that empty results are handled correctly
            // The system should return a result with empty data array
            expect(result.data).toEqual([]);

            // Metadata should indicate no records found
            expect(result.metadata.recordCount).toBe(0);
            expect(result.metadata.entity).toBe(specification.entity);
            expect(result.metadata.period).toBe(specification.period);
            expect(result.metadata.reportType).toBe(specification.reportType);
            expect(result.metadata.generatedAt).toBeInstanceOf(Date);
            expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);

            // Verify that the appropriate client method was called based on report type
            switch (specification.reportType) {
              case ReportType.BalanceSheet: {
                expect(mockClient.queryBalanceSheet).toHaveBeenCalledWith(
                  specification.entity,
                  specification.period,
                  specification.filters
                );
                break;
              }

              case ReportType.Cashflow: {
                expect(mockClient.queryCashFlow).toHaveBeenCalledWith(
                  specification.entity,
                  specification.period,
                  specification.filters
                );
                break;
              }

              case ReportType.IncomeStatement: {
                expect(mockClient.queryIncomeStatement).toHaveBeenCalledWith(
                  specification.entity,
                  specification.period,
                  specification.filters
                );
                break;
              }
            }
          }
        ),
        { numRuns: 100 } // Run 100 iterations as specified in the design
      );
    });

    // Feature: financial-reports-cli, Property 10: Empty Result Handling
    test('should handle mixed empty and non-empty results correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate valid report specifications
          fc.record({
            destination: fc.constant({
              url: 'http://localhost:4004/odata/v4/financial',
            }),
            entity: fc.constantFrom('CompanyA', 'CompanyB'),
            period: fc.constantFrom('2025-01', '2024-12'),
            reportType: fc.constantFrom(...Object.values(ReportType)),
          }),
          // Generate report options
          fc.record({
            outputFormat: fc.constantFrom(
              'json',
              'csv',
              'table'
            ) as fc.Arbitrary<'csv' | 'json' | 'table'>,
            verbose: fc.boolean(),
          }),
          // Generate whether to return empty or non-empty results
          fc.boolean(),
          async (
            specification: ReportSpecification,
            options: ReportOptions,
            shouldReturnEmpty: boolean
          ) => {
            // Mock the configuration service to return the specification
            vi.spyOn(mockConfigService, 'parseSpecification').mockResolvedValue(
              specification
            );

            const emptyLineItems: unknown[] = [];
            const nonEmptyLineItems = [
              {
                account: 'TestAccount',
                amount: 1000,
                currency: 'USD',
                description: 'Test line item',
              },
            ];

            const lineItems = shouldReturnEmpty
              ? emptyLineItems
              : nonEmptyLineItems;

            // Mock the financial data client to return results based on the flag
            const mockClient = {
              queryBalanceSheet: vi.fn().mockResolvedValue([
                {
                  assets: lineItems,
                  entity: specification.entity,
                  equity: [],
                  liabilities: [],
                  lineItems,
                  period: specification.period,
                  reportType: specification.reportType,
                },
              ]),
              queryCashFlow: vi.fn().mockResolvedValue([
                {
                  entity: specification.entity,
                  financingActivities: [],
                  investingActivities: [],
                  lineItems,
                  netCashFlow: shouldReturnEmpty ? 0 : 1000,
                  operatingActivities: lineItems,
                  period: specification.period,
                  reportType: specification.reportType,
                },
              ]),
              queryIncomeStatement: vi.fn().mockResolvedValue([
                {
                  entity: specification.entity,
                  expenses: [],
                  lineItems,
                  netIncome: shouldReturnEmpty ? 0 : 1000,
                  period: specification.period,
                  reportType: specification.reportType,
                  revenue: lineItems,
                },
              ]),
              testConnection: vi.fn().mockResolvedValue(true),
            };

            // Mock the createFinancialDataClient function
            vi.mocked(createFinancialDataClient).mockReturnValue(
              mockClient as FinancialDataClient
            );

            // Execute the report generation
            const result = await reportService.generateReport(
              'dummy-spec.json',
              options
            );

            if (shouldReturnEmpty) {
              // Should return empty result with appropriate metadata
              expect(result.data).toEqual([]);
              expect(result.metadata.recordCount).toBe(0);
            } else {
              // Should return non-empty result with appropriate metadata
              expect(result.data).toHaveLength(1);
              expect(result.data[0].lineItems).toHaveLength(1);
              expect(result.metadata.recordCount).toBe(1);
            }

            // Common metadata checks
            expect(result.metadata.entity).toBe(specification.entity);
            expect(result.metadata.period).toBe(specification.period);
            expect(result.metadata.reportType).toBe(specification.reportType);
            expect(result.metadata.generatedAt).toBeInstanceOf(Date);
            expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 50 } // Reduced runs for this more complex test
      );
    });
  });
});
