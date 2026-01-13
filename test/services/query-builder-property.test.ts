import fc from 'fast-check';

import { QueryBuilder } from '../../src/services/query-builder.js';
import { FilterConfig, ReportType } from '../../src/types/index.js';

describe('QueryBuilder - Property-Based Tests', () => {
  let queryBuilder: QueryBuilder;

  beforeAll(() => {
    queryBuilder = new QueryBuilder();
  });

  describe('Property 5: Report Query Generation', () => {
    // Feature: financial-reports-cli, Property 5: Report Query Generation
    test('should generate appropriate OData queries that filter data based on specified period parameter', () => {
      fc.assert(
        fc.property(
          // Generate valid report types
          fc.constantFrom(...Object.values(ReportType)),
          // Generate valid entity names
          fc
            .string({ maxLength: 50, minLength: 1 })
            .filter(s => s.trim().length > 0),
          // Generate valid periods in YYYY-MM format
          fc
            .tuple(
              fc.integer({ max: 2030, min: 2020 }),
              fc.integer({ max: 12, min: 1 })
            )
            .map(
              ([year, month]) => `${year}-${String(month).padStart(2, '0')}`
            ),
          // Generate optional filters
          fc.option(
            fc.array(
              fc.record({
                field: fc
                  .string({ maxLength: 20, minLength: 1 })
                  .filter(s => s.trim().length > 0),
                operator: fc.constantFrom('eq', 'ne', 'gt', 'lt', 'ge', 'le'),
                value: fc.oneof(
                  fc.string({ maxLength: 20, minLength: 1 }),
                  fc.integer({ max: 1_000_000, min: 0 })
                ),
              }),
              { maxLength: 3, minLength: 0 }
            )
          ),
          (
            reportType: ReportType,
            entity: string,
            period: string,
            filters?: FilterConfig[]
          ) => {
            // Generate query using the appropriate method based on report type
            let query;
            switch (reportType) {
              case ReportType.BalanceSheet: {
                query = queryBuilder.buildBalanceSheetQuery(
                  entity,
                  period,
                  filters
                );
                break;
              }

              case ReportType.Cashflow: {
                query = queryBuilder.buildCashFlowQuery(
                  entity,
                  period,
                  filters
                );
                break;
              }

              case ReportType.IncomeStatement: {
                query = queryBuilder.buildIncomeStatementQuery(
                  entity,
                  period,
                  filters
                );
                break;
              }

              default: {
                throw new Error(`Unsupported report type: ${reportType}`);
              }
            }

            // Verify query structure
            expect(query).toBeDefined();
            expect(query.entitySets).toBeDefined();
            expect(Array.isArray(query.entitySets)).toBe(true);
            expect(query.entitySets.length).toBeGreaterThan(0);
            expect(query.filter).toBeDefined();
            expect(typeof query.filter).toBe('string');

            // Verify period filtering is included in the query
            expect(query.filter).toContain('Period ge datetime');
            expect(query.filter).toContain('Period lt datetime');

            // Extract the period from the filter to verify it matches input
            const periodMatch = query.filter.match(
              /Period ge datetime'(\d{4}-\d{2}-\d{2})T00:00:00'/
            );
            expect(periodMatch).toBeTruthy();
            if (periodMatch) {
              const [, startDate] = periodMatch;
              expect(startDate).toBe(`${period}-01`);
            }

            // Verify entity filtering is included
            expect(query.filter).toContain(
              `Entity eq '${entity.replaceAll("'", "''")}'`
            );

            // Verify appropriate entity sets are returned based on report type
            switch (reportType) {
              case ReportType.BalanceSheet: {
                expect(query.entitySets).toEqual([
                  'BalanceSheetAssets',
                  'BalanceSheetLiabilities',
                  'BalanceSheetEquity',
                ]);
                break;
              }

              case ReportType.Cashflow: {
                expect(query.entitySets).toEqual([
                  'CashFlowOperating',
                  'CashFlowInvesting',
                  'CashFlowFinancing',
                ]);
                break;
              }

              case ReportType.IncomeStatement: {
                expect(query.entitySets).toEqual([
                  'IncomeStatementRevenue',
                  'IncomeStatementExpenses',
                ]);
                break;
              }
            }

            // Verify custom filters are included if provided
            if (filters && filters.length > 0) {
              for (const filter of filters) {
                // Handle field names with spaces (they get wrapped in quotes)
                const fieldName = filter.field.includes(' ')
                  ? `'${filter.field}'`
                  : filter.field;
                const expectedFilterPart = `${fieldName} ${filter.operator} ${
                  typeof filter.value === 'string'
                    ? `'${filter.value.replaceAll("'", "''")}'`
                    : filter.value.toString()
                }`;
                expect(query.filter).toContain(expectedFilterPart);
              }
            }

            // Verify select clause includes appropriate fields for report type
            if (query.select) {
              const selectFields = query.select.split(',');
              expect(selectFields).toContain('Account');
              expect(selectFields).toContain('Description');
              expect(selectFields).toContain('Amount');
              expect(selectFields).toContain('Currency');
              expect(selectFields).toContain('Category');

              // Verify report-type specific fields
              switch (reportType) {
                case ReportType.BalanceSheet: {
                  expect(selectFields).toContain('AccountType');
                  break;
                }

                case ReportType.Cashflow: {
                  expect(selectFields).toContain('ActivityType');
                  break;
                }

                case ReportType.IncomeStatement: {
                  expect(selectFields).toContain('StatementType');
                  break;
                }
              }
            }

            // Verify orderBy clause is appropriate for report type
            if (query.orderBy) {
              switch (reportType) {
                case ReportType.BalanceSheet: {
                  expect(query.orderBy).toBe('AccountType,Account');
                  break;
                }

                case ReportType.Cashflow: {
                  expect(query.orderBy).toBe('ActivityType,Account');
                  break;
                }

                case ReportType.IncomeStatement: {
                  expect(query.orderBy).toBe('StatementType,Account');
                  break;
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: financial-reports-cli, Property 5: Report Query Generation
    test('should generate consistent queries for the same input parameters', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.values(ReportType)),
          fc
            .string({ maxLength: 20, minLength: 1 })
            .filter(s => s.trim().length > 0),
          fc
            .tuple(
              fc.integer({ max: 2030, min: 2020 }),
              fc.integer({ max: 12, min: 1 })
            )
            .map(
              ([year, month]) => `${year}-${String(month).padStart(2, '0')}`
            ),
          (reportType: ReportType, entity: string, period: string) => {
            // Generate the same query twice
            let query1;
            let query2;

            switch (reportType) {
              case ReportType.BalanceSheet: {
                query1 = queryBuilder.buildBalanceSheetQuery(entity, period);
                query2 = queryBuilder.buildBalanceSheetQuery(entity, period);
                break;
              }

              case ReportType.Cashflow: {
                query1 = queryBuilder.buildCashFlowQuery(entity, period);
                query2 = queryBuilder.buildCashFlowQuery(entity, period);
                break;
              }

              case ReportType.IncomeStatement: {
                query1 = queryBuilder.buildIncomeStatementQuery(entity, period);
                query2 = queryBuilder.buildIncomeStatementQuery(entity, period);
                break;
              }

              default: {
                throw new Error(`Unsupported report type: ${reportType}`);
              }
            }

            // Queries should be identical
            expect(query1).toEqual(query2);
          }
        ),
        { numRuns: 50 }
      );
    });

    // Feature: financial-reports-cli, Property 5: Report Query Generation
    test('should handle period boundary conditions correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...Object.values(ReportType)),
          fc
            .string({ maxLength: 20, minLength: 1 })
            .filter(s => s.trim().length > 0),
          // Test boundary periods (year boundaries, month boundaries)
          fc.constantFrom(
            '2024-01',
            '2024-12', // Year boundaries
            '2025-01',
            '2025-12',
            '2023-02',
            '2024-02',
            '2025-02' // February (shorter month)
          ),
          (reportType: ReportType, entity: string, period: string) => {
            let query;

            switch (reportType) {
              case ReportType.BalanceSheet: {
                query = queryBuilder.buildBalanceSheetQuery(entity, period);
                break;
              }

              case ReportType.Cashflow: {
                query = queryBuilder.buildCashFlowQuery(entity, period);
                break;
              }

              case ReportType.IncomeStatement: {
                query = queryBuilder.buildIncomeStatementQuery(entity, period);
                break;
              }

              default: {
                throw new Error(`Unsupported report type: ${reportType}`);
              }
            }

            // Verify period filter handles boundaries correctly
            const [year, month] = period.split('-');
            const yearNum = Number.parseInt(year, 10);
            const monthNum = Number.parseInt(month, 10);

            // Calculate expected end date
            const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
            const nextYear = monthNum === 12 ? yearNum + 1 : yearNum;
            const expectedEndDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

            expect(query.filter).toContain(
              `Period ge datetime'${period}-01T00:00:00'`
            );
            expect(query.filter).toContain(
              `Period lt datetime'${expectedEndDate}T00:00:00'`
            );
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
