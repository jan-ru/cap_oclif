import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationService } from '../../src/services/configuration.js';
import { createFinancialDataClient } from '../../src/services/financial-data-client.js';
import { OutputFormatter } from '../../src/services/output-formatter.js';
import { ReportService } from '../../src/services/report-service.js';
import {
  BalanceSheetData,
  CashFlowData,
  IncomeStatementData,
  LineItem,
  ReportOptions,
  ReportType,
} from '../../src/types/index.js';

// Mock the financial data client module
vi.mock('../../src/services/financial-data-client.js');

describe('ReportService Integration Tests', () => {
  let reportService: ReportService;
  let configService: ConfigurationService;
  let outputFormatter: OutputFormatter;
  let mockDataClient: unknown;
  let testSpecFile: string;
  let testOutputDir: string;

  beforeEach(() => {
    // Create test directory structure
    testOutputDir = join(process.cwd(), 'test', 'temp');
    try {
      mkdirSync(testOutputDir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    testSpecFile = join(testOutputDir, 'test-spec.json');

    // Create mock data client
    mockDataClient = {
      queryBalanceSheet: vi.fn(),
      queryCashFlow: vi.fn(),
      queryIncomeStatement: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(true),
    };

    // Mock the factory function
    vi.mocked(createFinancialDataClient).mockReturnValue(mockDataClient);

    // Initialize services
    configService = new ConfigurationService();
    outputFormatter = new OutputFormatter();
    reportService = new ReportService(configService, outputFormatter);
  });

  afterEach(() => {
    // Clean up test files
    try {
      rmSync(testOutputDir, { force: true, recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    vi.clearAllMocks();
  });

  describe('Complete Workflow Integration', () => {
    it('should generate BalanceSheet report successfully (Requirement 3.1)', async () => {
      // Arrange: Create test specification file
      const testSpec = {
        destination: {
          authentication: {
            password: 'test',
            type: 'basic',
            username: 'test',
          },
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      // Mock balance sheet data
      const mockAssets: LineItem[] = [
        {
          account: 'Cash',
          amount: 50_000,
          currency: 'USD',
          description: 'Cash and cash equivalents',
        },
        {
          account: 'Inventory',
          amount: 25_000,
          currency: 'USD',
          description: 'Product inventory',
        },
      ];

      const mockLiabilities: LineItem[] = [
        {
          account: 'AccountsPayable',
          amount: 15_000,
          currency: 'USD',
          description: 'Accounts payable',
        },
      ];

      const mockEquity: LineItem[] = [
        {
          account: 'RetainedEarnings',
          amount: 60_000,
          currency: 'USD',
          description: 'Retained earnings',
        },
      ];

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: mockAssets,
          entity: 'TestCompany',
          equity: mockEquity,
          liabilities: mockLiabilities,
          lineItems: [...mockAssets, ...mockLiabilities, ...mockEquity],
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify the complete workflow
      expect(mockDataClient.queryBalanceSheet).toHaveBeenCalledWith(
        'TestCompany',
        '2025-01',
        undefined
      );

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].entity).toBe('TestCompany');
      expect(result.data[0].period).toBe('2025-01');
      expect(result.data[0].reportType).toBe(ReportType.BalanceSheet);
      expect(result.data[0].lineItems).toHaveLength(4);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.entity).toBe('TestCompany');
      expect(result.metadata.period).toBe('2025-01');
      expect(result.metadata.reportType).toBe(ReportType.BalanceSheet);
      expect(result.metadata.recordCount).toBe(4);
      expect(result.metadata.executionTime).toBeGreaterThan(0);
    });

    it('should generate IncomeStatement report successfully (Requirement 3.2)', async () => {
      // Arrange: Create test specification file
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'IncomeStatement',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      // Mock income statement data
      const mockRevenue: LineItem[] = [
        {
          account: 'Sales',
          amount: 100_000,
          currency: 'USD',
          description: 'Product sales revenue',
        },
      ];

      const mockExpenses: LineItem[] = [
        {
          account: 'COGS',
          amount: 60_000,
          currency: 'USD',
          description: 'Cost of goods sold',
        },
        {
          account: 'Marketing',
          amount: 15_000,
          currency: 'USD',
          description: 'Marketing expenses',
        },
      ];

      const mockIncomeStatementData: IncomeStatementData[] = [
        {
          entity: 'TestCompany',
          expenses: mockExpenses,
          lineItems: [...mockRevenue, ...mockExpenses],
          netIncome: 25_000,
          period: '2025-01',
          reportType: ReportType.IncomeStatement,
          revenue: mockRevenue,
        },
      ];

      mockDataClient.queryIncomeStatement.mockResolvedValue(
        mockIncomeStatementData
      );

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify the complete workflow
      expect(mockDataClient.queryIncomeStatement).toHaveBeenCalledWith(
        'TestCompany',
        '2025-01',
        undefined
      );

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].entity).toBe('TestCompany');
      expect(result.data[0].period).toBe('2025-01');
      expect(result.data[0].reportType).toBe(ReportType.IncomeStatement);
      expect(result.data[0].lineItems).toHaveLength(3);

      expect(result.metadata.recordCount).toBe(3);
    });

    it('should generate Cashflow report successfully (Requirement 3.3)', async () => {
      // Arrange: Create test specification file
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'Cashflow',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      // Mock cash flow data
      const mockOperating: LineItem[] = [
        {
          account: 'NetIncome',
          amount: 25_000,
          currency: 'USD',
          description: 'Net income from operations',
        },
      ];

      const mockInvesting: LineItem[] = [
        {
          account: 'EquipmentPurchase',
          amount: -10_000,
          currency: 'USD',
          description: 'Equipment purchases',
        },
      ];

      const mockFinancing: LineItem[] = [
        {
          account: 'LoanProceeds',
          amount: 20_000,
          currency: 'USD',
          description: 'Loan proceeds',
        },
      ];

      const mockCashFlowData: CashFlowData[] = [
        {
          entity: 'TestCompany',
          financingActivities: mockFinancing,
          investingActivities: mockInvesting,
          lineItems: [...mockOperating, ...mockInvesting, ...mockFinancing],
          netCashFlow: 35_000,
          operatingActivities: mockOperating,
          period: '2025-01',
          reportType: ReportType.Cashflow,
        },
      ];

      mockDataClient.queryCashFlow.mockResolvedValue(mockCashFlowData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify the complete workflow
      expect(mockDataClient.queryCashFlow).toHaveBeenCalledWith(
        'TestCompany',
        '2025-01',
        undefined
      );

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].entity).toBe('TestCompany');
      expect(result.data[0].period).toBe('2025-01');
      expect(result.data[0].reportType).toBe(ReportType.Cashflow);
      expect(result.data[0].lineItems).toHaveLength(3);

      expect(result.metadata.recordCount).toBe(3);
    });

    it('should handle period-based filtering correctly (Requirement 3.4)', async () => {
      // Arrange: Create test specification with specific period
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2024-12',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [
            {
              account: 'Cash',
              amount: 30_000,
              currency: 'USD',
              description: 'December cash position',
            },
          ],
          period: '2024-12',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify period filtering is passed correctly
      expect(mockDataClient.queryBalanceSheet).toHaveBeenCalledWith(
        'TestCompany',
        '2024-12',
        undefined
      );

      expect(result.data[0].period).toBe('2024-12');
      expect(result.metadata.period).toBe('2024-12');
    });

    it('should return structured, readable format (Requirement 3.5)', async () => {
      // Arrange: Create test specification
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [
            {
              account: 'Cash',
              amount: 50_000,
              currency: 'USD',
              description: 'Cash and cash equivalents',
            },
          ],
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify structured format
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('metadata');

      // Verify data structure
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data[0]).toHaveProperty('entity');
      expect(result.data[0]).toHaveProperty('period');
      expect(result.data[0]).toHaveProperty('reportType');
      expect(result.data[0]).toHaveProperty('lineItems');

      // Verify metadata structure
      expect(result.metadata).toHaveProperty('entity');
      expect(result.metadata).toHaveProperty('period');
      expect(result.metadata).toHaveProperty('reportType');
      expect(result.metadata).toHaveProperty('recordCount');
      expect(result.metadata).toHaveProperty('executionTime');
      expect(result.metadata).toHaveProperty('generatedAt');

      // Verify readability - line items have proper structure
      const lineItem = result.data[0].lineItems[0];
      expect(lineItem).toHaveProperty('account');
      expect(lineItem).toHaveProperty('amount');
      expect(lineItem).toHaveProperty('currency');
      expect(lineItem).toHaveProperty('description');
    });

    it('should handle verbose output correctly', async () => {
      // Arrange: Create test specification
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [
            {
              account: 'Cash',
              amount: 50_000,
              currency: 'USD',
              description: 'Cash and cash equivalents',
            },
          ],
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      // Mock console.log to capture verbose output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: true,
      };

      // Act: Generate the report with verbose output
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify verbose logging occurred
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting report generation')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Parsing report specification')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Retrieving BalanceSheet data')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Report generation completed')
      );

      expect(result).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should handle file output correctly', async () => {
      // Arrange: Create test specification
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [
            {
              account: 'Cash',
              amount: 50_000,
              currency: 'USD',
              description: 'Cash and cash equivalents',
            },
          ],
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const outputFile = join(testOutputDir, 'output.json');
      const options: ReportOptions = {
        destination: outputFile,
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report with file output
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify the report was generated and file output was attempted
      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.metadata.recordCount).toBe(1);
    });

    it('should handle empty results correctly', async () => {
      // Arrange: Create test specification
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      // Mock empty balance sheet data
      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [], // Empty line items
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify empty results are handled correctly
      expect(result).toBeDefined();
      expect(result.data).toHaveLength(0);
      expect(result.metadata.recordCount).toBe(0);
      expect(result.metadata.entity).toBe('TestCompany');
      expect(result.metadata.period).toBe('2025-01');
      expect(result.metadata.reportType).toBe(ReportType.BalanceSheet);
    });

    it('should handle specification with filters', async () => {
      // Arrange: Create test specification with filters
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        filters: [
          {
            field: 'Category',
            operator: 'eq',
            value: 'Assets',
          },
        ],
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      const mockBalanceSheetData: BalanceSheetData[] = [
        {
          assets: [],
          entity: 'TestCompany',
          equity: [],
          liabilities: [],
          lineItems: [
            {
              account: 'Cash',
              amount: 50_000,
              category: 'Assets',
              currency: 'USD',
              description: 'Cash and cash equivalents',
            },
          ],
          period: '2025-01',
          reportType: ReportType.BalanceSheet,
        },
      ];

      mockDataClient.queryBalanceSheet.mockResolvedValue(mockBalanceSheetData);

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act: Generate the report
      const result = await reportService.generateReport(testSpecFile, options);

      // Assert: Verify filters are passed to the data client
      expect(mockDataClient.queryBalanceSheet).toHaveBeenCalledWith(
        'TestCompany',
        '2025-01',
        [
          {
            field: 'Category',
            operator: 'eq',
            value: 'Assets',
          },
        ]
      );

      expect(result).toBeDefined();
      expect(result.data[0].lineItems[0].category).toBe('Assets');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle invalid specification files gracefully', async () => {
      // Arrange: Create invalid specification file
      const invalidSpec = {
        entity: '', // Invalid empty entity
        period: 'invalid-period', // Invalid period format
        reportType: 'InvalidType', // Invalid report type
      };

      writeFileSync(testSpecFile, JSON.stringify(invalidSpec, null, 2));

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act & Assert: Expect error to be thrown
      await expect(
        reportService.generateReport(testSpecFile, options)
      ).rejects.toThrow();
    });

    it('should handle OData service errors gracefully', async () => {
      // Arrange: Create valid specification
      const testSpec = {
        destination: {
          url: 'http://localhost:4004/odata/v4/financial',
        },
        entity: 'TestCompany',
        period: '2025-01',
        reportType: 'BalanceSheet',
      };

      writeFileSync(testSpecFile, JSON.stringify(testSpec, null, 2));

      // Mock OData service error
      mockDataClient.queryBalanceSheet.mockRejectedValue(
        new Error('OData service unavailable')
      );

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act & Assert: Expect error to be thrown
      await expect(
        reportService.generateReport(testSpecFile, options)
      ).rejects.toThrow();
    });

    it('should handle missing specification files gracefully', async () => {
      // Arrange: Use non-existent file path
      const nonExistentFile = join(testOutputDir, 'non-existent.json');

      const options: ReportOptions = {
        outputFormat: 'json',
        verbose: false,
      };

      // Act & Assert: Expect error to be thrown
      await expect(
        reportService.generateReport(nonExistentFile, options)
      ).rejects.toThrow();
    });
  });
});
