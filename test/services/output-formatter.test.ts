import { beforeEach, describe, expect, it } from 'vitest';

import { OutputFormatter } from '../../src/services/output-formatter.js';
import {
  FinancialData,
  OutputFormat,
  ReportMetadata,
  ReportType,
} from '../../src/types/index.js';

describe('OutputFormatter', () => {
  let formatter: OutputFormatter;
  let sampleData: FinancialData[];
  let sampleMetadata: ReportMetadata;

  beforeEach(() => {
    formatter = new OutputFormatter();

    sampleData = [
      {
        entity: 'TestEntity',
        lineItems: [
          {
            account: 'CASH',
            amount: 100_000,
            category: 'Assets',
            currency: 'USD',
            description: 'Cash and Cash Equivalents',
          },
          {
            account: 'EQUITY',
            amount: 50_000,
            category: 'Equity',
            currency: 'USD',
            description: 'Shareholders Equity',
          },
        ],
        period: '2025-01',
        reportType: ReportType.BalanceSheet,
      },
    ];

    sampleMetadata = {
      entity: 'TestEntity',
      executionTime: 150,
      generatedAt: new Date('2025-01-13T09:50:00.000Z'),
      period: '2025-01',
      recordCount: 2,
      reportType: ReportType.BalanceSheet,
    };
  });

  describe('formatAsJson', () => {
    it('should format data as JSON with metadata', () => {
      const result = formatter.formatAsJson(sampleData, sampleMetadata);
      const parsed = JSON.parse(result);

      expect(parsed.metadata).toEqual({
        entity: 'TestEntity',
        executionTime: 150,
        generatedAt: '2025-01-13T09:50:00.000Z',
        period: '2025-01',
        recordCount: 2,
        reportType: 'BalanceSheet',
      });

      expect(parsed.data).toEqual(sampleData);
    });
  });

  describe('formatAsCsv', () => {
    it('should format data as CSV with metadata header', () => {
      const result = formatter.formatAsCsv(sampleData, sampleMetadata);

      expect(result).toContain('# Financial Report CSV Export');
      expect(result).toContain('# Generated At: 2025-01-13T09:50:00.000Z');
      expect(result).toContain('# Report Type: BalanceSheet');
      expect(result).toContain(
        'Entity,Period,Report Type,Account,Description,Amount,Currency,Category'
      );
      expect(result).toContain(
        'TestEntity,2025-01,BalanceSheet,CASH,Cash and Cash Equivalents,100000,USD,Assets'
      );
    });

    it('should handle empty data gracefully', () => {
      const result = formatter.formatAsCsv([], sampleMetadata);

      expect(result).toContain('# No data found for the specified criteria');
      expect(result).toContain(`# Record Count: ${sampleMetadata.recordCount}`);
    });
  });

  describe('formatAsTable', () => {
    it('should format data as human-readable table', () => {
      const result = formatter.formatAsTable(sampleData, sampleMetadata);

      expect(result).toContain('FINANCIAL REPORT - BALANCESHEET');
      expect(result).toContain('Entity: TestEntity');
      expect(result).toContain('Period: 2025-01');
      expect(result).toContain('Account');
      expect(result).toContain('Description');
      expect(result).toContain('CASH');
      expect(result).toContain('Cash and Cash Equivalents');
    });

    it('should handle empty data gracefully', () => {
      const result = formatter.formatAsTable([], sampleMetadata);

      expect(result).toContain('No data found for the specified criteria');
    });
  });

  describe('format', () => {
    it('should format based on specified format type', () => {
      const jsonResult = formatter.format(sampleData, sampleMetadata, 'json');
      const csvResult = formatter.format(sampleData, sampleMetadata, 'csv');
      const tableResult = formatter.format(sampleData, sampleMetadata, 'table');

      expect(jsonResult).toContain('"reportType": "BalanceSheet"');
      expect(csvResult).toContain('Entity,Period,Report Type');
      expect(tableResult).toContain('FINANCIAL REPORT');
    });

    it('should throw error for unsupported format', () => {
      expect(() => {
        formatter.format(sampleData, sampleMetadata, 'xml' as OutputFormat);
      }).toThrow('Unsupported output format: xml');
    });
  });
});
