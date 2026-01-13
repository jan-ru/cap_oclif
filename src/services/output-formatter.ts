import { constants, promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { FinancialData, OutputFormat, ReportMetadata } from '../types/index.js';

/**
 * Service for formatting financial report data into various output formats
 */
export class OutputFormatter {
  /**
   * Check if a file path is writable
   */
  async checkWriteAccess(filePath: string): Promise<boolean> {
    try {
      const dir = dirname(filePath);
      await fs.access(dir, constants.W_OK);
      return true;
    } catch {
      // Try to create the directory if it doesn't exist
      try {
        const dir = dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Format output based on the specified format
   */
  format(
    data: FinancialData[],
    metadata: ReportMetadata,
    format: OutputFormat
  ): string {
    switch (format) {
      case 'csv': {
        return this.formatAsCsv(data, metadata);
      }

      case 'json': {
        return this.formatAsJson(data, metadata);
      }

      case 'table': {
        return this.formatAsTable(data, metadata);
      }

      default: {
        throw new Error(`Unsupported output format: ${format}`);
      }
    }
  }

  /**
   * Format financial data as CSV string
   */
  formatAsCsv(data: FinancialData[], metadata: ReportMetadata): string {
    if (data.length === 0) {
      return this.formatEmptyCsv(metadata);
    }

    const lines: string[] = [];

    // Add metadata header
    lines.push(
      '# Financial Report CSV Export',
      `# Generated At: ${metadata.generatedAt.toISOString()}`,
      `# Report Type: ${metadata.reportType}`,
      `# Entity: ${metadata.entity}`,
      `# Period: ${metadata.period}`,
      `# Record Count: ${metadata.recordCount}`,
      `# Execution Time: ${metadata.executionTime}ms`,
      '',
      'Entity,Period,Report Type,Account,Description,Amount,Currency,Category'
    );

    // Data rows
    for (const report of data) {
      for (const lineItem of report.lineItems) {
        const row = [
          this.escapeCsvValue(report.entity),
          this.escapeCsvValue(report.period),
          this.escapeCsvValue(report.reportType),
          this.escapeCsvValue(lineItem.account),
          this.escapeCsvValue(lineItem.description),
          lineItem.amount.toString(),
          this.escapeCsvValue(lineItem.currency),
          this.escapeCsvValue(lineItem.category || ''),
        ];
        lines.push(row.join(','));
      }
    }

    return lines.join('\n');
  }

  /**
   * Format financial data as JSON string
   */
  formatAsJson(data: FinancialData[], metadata: ReportMetadata): string {
    const output = {
      data,
      metadata: {
        entity: metadata.entity,
        executionTime: metadata.executionTime,
        generatedAt: metadata.generatedAt.toISOString(),
        period: metadata.period,
        recordCount: metadata.recordCount,
        reportType: metadata.reportType,
      },
    };

    return JSON.stringify(output, null, 2);
  }

  /**
   * Format financial data as human-readable table
   */
  formatAsTable(data: FinancialData[], metadata: ReportMetadata): string {
    const lines: string[] = [];

    // Header with metadata
    lines.push(
      '═'.repeat(80),
      `  FINANCIAL REPORT - ${metadata.reportType.toUpperCase()}`,
      '═'.repeat(80),
      `Entity: ${metadata.entity}`,
      `Period: ${metadata.period}`,
      `Generated: ${metadata.generatedAt.toISOString()}`,
      `Records: ${metadata.recordCount} | Execution Time: ${metadata.executionTime}ms`,
      '═'.repeat(80),
      ''
    );

    if (data.length === 0) {
      lines.push('No data found for the specified criteria.', '');
      return lines.join('\n');
    }

    // Table header
    const headers = [
      'Account',
      'Description',
      'Amount',
      'Currency',
      'Category',
    ];
    const colWidths = [15, 30, 15, 10, 15];

    lines.push(this.formatTableRow(headers, colWidths), '─'.repeat(80));

    // Data rows
    for (const report of data) {
      if (report.lineItems.length > 0) {
        lines.push(
          `\n${report.reportType} - ${report.entity} (${report.period}):`,
          '─'.repeat(80)
        );

        for (const lineItem of report.lineItems) {
          const row = [
            lineItem.account,
            lineItem.description,
            this.formatAmount(lineItem.amount),
            lineItem.currency,
            lineItem.category || '',
          ];
          lines.push(this.formatTableRow(row, colWidths));
        }
      }
    }

    lines.push('', '═'.repeat(80));

    return lines.join('\n');
  }

  /**
   * Write formatted output to a file
   */
  async writeToFile(
    data: FinancialData[],
    metadata: ReportMetadata,
    format: OutputFormat,
    filePath: string
  ): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Format the data
      const formattedOutput = this.format(data, metadata, format);

      // Write to file
      await fs.writeFile(filePath, formattedOutput, 'utf8');
    } catch (error) {
      if (error instanceof Error) {
        throw new TypeError(
          `Failed to write output to file '${filePath}': ${error.message}`
        );
      }

      throw new Error(
        `Failed to write output to file '${filePath}': Unknown error`
      );
    }
  }

  /**
   * Escape CSV values to handle commas, quotes, and newlines
   */
  private escapeCsvValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replaceAll('"', '""')}"`;
    }

    return value;
  }

  /**
   * Format monetary amounts with proper alignment
   */
  private formatAmount(amount: number): string {
    return amount.toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }

  /**
   * Format empty CSV with metadata only
   */
  private formatEmptyCsv(metadata: ReportMetadata): string {
    const lines: string[] = [];
    lines.push(
      '# Financial Report CSV Export',
      `# Generated At: ${metadata.generatedAt.toISOString()}`,
      `# Report Type: ${metadata.reportType}`,
      `# Entity: ${metadata.entity}`,
      `# Period: ${metadata.period}`,
      `# Record Count: ${metadata.recordCount}`,
      `# Execution Time: ${metadata.executionTime}ms`,
      '',
      '# No data found for the specified criteria'
    );
    return lines.join('\n');
  }

  /**
   * Format a table row with proper column alignment
   */
  private formatTableRow(values: string[], widths: number[]): string {
    return values
      .map((value, index) => {
        const width = widths[index] || 15;
        return value.length > width
          ? value.slice(0, Math.max(0, width - 3)) + '...'
          : value.padEnd(width);
      })
      .join(' | ');
  }
}
