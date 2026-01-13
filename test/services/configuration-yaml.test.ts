import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { ConfigurationService } from '../../src/services/configuration.js';
import { ErrorResponse, ReportType } from '../../src/types/index.js';

describe('ConfigurationService YAML Support', () => {
  let configService: ConfigurationService;
  let tempDir: string;

  beforeAll(() => {
    configService = new ConfigurationService();

    // Create temporary directory for test files
    tempDir = join(tmpdir(), 'financial-reports-cli-yaml-test');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
  });

  describe('YAML Parsing', () => {
    test('should parse valid YAML specification file', async () => {
      const yamlContent = `# Financial report specification
entity: TestCompany
reportType: BalanceSheet
period: "2025-01"

# OData service configuration
destination:
  url: http://localhost:4004/odata/v4/financial
  authentication:
    type: basic
    username: testuser
    password: testpass

# Optional filters
filters:
  - field: CompanyCode
    operator: eq
    value: "TEST001"`;

      const yamlFile = join(tempDir, 'valid-spec.yaml');
      writeFileSync(yamlFile, yamlContent);

      const result = await configService.parseSpecification(yamlFile);

      expect(result.entity).toBe('TestCompany');
      expect(result.reportType).toBe(ReportType.BalanceSheet);
      expect(result.period).toBe('2025-01');
      expect(result.destination?.url).toBe(
        'http://localhost:4004/odata/v4/financial'
      );
      expect(result.destination?.authentication?.type).toBe('basic');
      expect(result.filters).toHaveLength(1);
      expect(result.filters?.[0].field).toBe('CompanyCode');
      expect(result.filters?.[0].operator).toBe('eq');
      expect(result.filters?.[0].value).toBe('TEST001');
    });

    test('should parse valid YML specification file', async () => {
      const ymlContent = `entity: TestCompany
reportType: IncomeStatement
period: "2025-02"
destination:
  url: http://localhost:4004/odata/v4/financial`;

      const ymlFile = join(tempDir, 'valid-spec.yml');
      writeFileSync(ymlFile, ymlContent);

      const result = await configService.parseSpecification(ymlFile);

      expect(result.entity).toBe('TestCompany');
      expect(result.reportType).toBe(ReportType.IncomeStatement);
      expect(result.period).toBe('2025-02');
      expect(result.destination?.url).toBe(
        'http://localhost:4004/odata/v4/financial'
      );
    });

    test('should handle YAML with comments and multi-line strings', async () => {
      const yamlContent = `# This is a comment
entity: TestCompany  # Inline comment
reportType: Cashflow
period: "2025-03"

# Multi-line configuration
destination:
  url: http://localhost:4004/odata/v4/financial
  # Authentication section
  authentication:
    type: bearer
    token: |
      eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
      .eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ
      .SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`;

      const yamlFile = join(tempDir, 'comments-spec.yaml');
      writeFileSync(yamlFile, yamlContent);

      const result = await configService.parseSpecification(yamlFile);

      expect(result.entity).toBe('TestCompany');
      expect(result.reportType).toBe(ReportType.Cashflow);
      expect(result.destination?.authentication?.type).toBe('bearer');
      expect(result.destination?.authentication?.token).toContain(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      );
    });

    test('should maintain backward compatibility with JSON files', async () => {
      const jsonContent = `{
  "entity": "TestCompany",
  "reportType": "BalanceSheet",
  "period": "2025-01",
  "destination": {
    "url": "http://localhost:4004/odata/v4/financial"
  }
}`;

      const jsonFile = join(tempDir, 'json-spec.json');
      writeFileSync(jsonFile, jsonContent);

      const result = await configService.parseSpecification(jsonFile);

      expect(result.entity).toBe('TestCompany');
      expect(result.reportType).toBe(ReportType.BalanceSheet);
      expect(result.period).toBe('2025-01');
      expect(result.destination?.url).toBe(
        'http://localhost:4004/odata/v4/financial'
      );
    });
  });

  describe('YAML Error Handling', () => {
    test('should provide helpful error for invalid YAML syntax', async () => {
      const invalidYamlContent = `entity: TestCompany
reportType: BalanceSheet
period: "2025-01"
destination:
  url: http://localhost:4004/odata/v4/financial
  authentication:
    type: basic
    username: testuser
    password: testpass
  # Invalid YAML - incorrect indentation
filters:
- field: CompanyCode
  operator: eq
    value: TEST001  # Wrong indentation`;

      const yamlFile = join(tempDir, 'invalid-syntax.yaml');
      writeFileSync(yamlFile, invalidYamlContent);

      await expect(
        configService.parseSpecification(yamlFile)
      ).rejects.toMatchObject({
        error: {
          code: 'INVALID_YAML',
          message: 'Failed to parse specification file as YAML',
        },
      });
    });

    test('should handle empty YAML file', async () => {
      const emptyYamlContent = `# Just comments
# No actual content`;

      const yamlFile = join(tempDir, 'empty.yaml');
      writeFileSync(yamlFile, emptyYamlContent);

      await expect(
        configService.parseSpecification(yamlFile)
      ).rejects.toMatchObject({
        error: {
          code: 'EMPTY_SPECIFICATION',
          message: 'Specification file is empty or contains no valid data',
        },
      });
    });

    test('should handle null YAML document', async () => {
      const nullYamlContent = `---
# This produces null
`;

      const yamlFile = join(tempDir, 'null.yaml');
      writeFileSync(yamlFile, nullYamlContent);

      await expect(
        configService.parseSpecification(yamlFile)
      ).rejects.toMatchObject({
        error: {
          code: 'EMPTY_SPECIFICATION',
          message: 'Specification file is empty or contains no valid data',
        },
      });
    });

    test('should provide YAML-specific error suggestions', async () => {
      const invalidYamlContent = `entity TestCompany  # Missing colon
reportType: BalanceSheet
period: "2025-01"`;

      const yamlFile = join(tempDir, 'missing-colon.yaml');
      writeFileSync(yamlFile, invalidYamlContent);

      try {
        await configService.parseSpecification(yamlFile);
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        const errorResponse = error as ErrorResponse;
        expect(errorResponse.error.code).toBe('INVALID_YAML');
        expect(errorResponse.error.suggestions).toContain(
          'Check YAML indentation (use spaces, not tabs)'
        );
        expect(errorResponse.error.suggestions).toContain(
          'Check for missing colons after keys'
        );
      }
    });
  });

  describe('File Extension Detection', () => {
    test('should detect .yaml extension', async () => {
      const yamlContent = `entity: TestCompany
reportType: BalanceSheet
period: "2025-01"`;

      const yamlFile = join(tempDir, 'test.yaml');
      writeFileSync(yamlFile, yamlContent);

      const result = await configService.parseSpecification(yamlFile);
      expect(result.entity).toBe('TestCompany');
    });

    test('should detect .yml extension', async () => {
      const ymlContent = `entity: TestCompany
reportType: BalanceSheet
period: "2025-01"`;

      const ymlFile = join(tempDir, 'test.yml');
      writeFileSync(ymlFile, ymlContent);

      const result = await configService.parseSpecification(ymlFile);
      expect(result.entity).toBe('TestCompany');
    });

    test('should default to JSON for unknown extensions', async () => {
      const jsonContent = `{
  "entity": "TestCompany",
  "reportType": "BalanceSheet",
  "period": "2025-01"
}`;

      const unknownFile = join(tempDir, 'test.config');
      writeFileSync(unknownFile, jsonContent);

      const result = await configService.parseSpecification(unknownFile);
      expect(result.entity).toBe('TestCompany');
    });

    test('should handle files without extensions as JSON', async () => {
      const jsonContent = `{
  "entity": "TestCompany",
  "reportType": "BalanceSheet",
  "period": "2025-01"
}`;

      const noExtFile = join(tempDir, 'test-no-ext');
      writeFileSync(noExtFile, jsonContent);

      const result = await configService.parseSpecification(noExtFile);
      expect(result.entity).toBe('TestCompany');
    });
  });

  describe('Validation Integration', () => {
    test('should validate YAML specification same as JSON', async () => {
      const invalidYamlContent = `entity: TestCompany
# Missing reportType and period
destination:
  url: http://localhost:4004/odata/v4/financial`;

      const yamlFile = join(tempDir, 'invalid-validation.yaml');
      writeFileSync(yamlFile, invalidYamlContent);

      await expect(
        configService.parseSpecification(yamlFile)
      ).rejects.toMatchObject({
        error: {
          code: 'INVALID_SPECIFICATION',
          message: 'Report specification validation failed',
        },
      });
    });

    test('should provide validation suggestions for YAML files', async () => {
      const invalidYamlContent = `entity: TestCompany
reportType: InvalidType
period: "invalid-period"`;

      const yamlFile = join(tempDir, 'invalid-fields.yaml');
      writeFileSync(yamlFile, invalidYamlContent);

      try {
        await configService.parseSpecification(yamlFile);
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        const errorResponse = error as ErrorResponse;
        expect(errorResponse.error.code).toBe('INVALID_SPECIFICATION');
        expect(errorResponse.error.suggestions).toContain(
          'Use a valid reportType: "BalanceSheet", "IncomeStatement", or "Cashflow"'
        );
        expect(errorResponse.error.suggestions).toContain(
          'Use YYYY-MM format for period (e.g., "2025-01", "2024-12")'
        );
      }
    });
  });
});
