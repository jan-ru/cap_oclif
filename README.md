# Financial Reports CLI

A TypeScript-based command-line tool for retrieving financial reports from OData v4 datasources using the SAP Cloud SDK. This tool provides a typed wrapper interface around @sap-cloud-sdk for querying CAP (Cloud Application Programming) services to generate financial reports based on configurable specifications.

## Features

- **OData v4 Integration**: Seamless connection to CAP services using SAP Cloud SDK
- **Multiple Report Types**: Support for Balance Sheet, Income Statement, and Cash Flow reports
- **Flexible Output Formats**: JSON, CSV, and human-readable table formats
- **Configuration-Driven**: Define report parameters through JSON specification files
- **Type Safety**: Full TypeScript support with strict type checking
- **Comprehensive Testing**: Unit tests and property-based testing with fast-check
- **Error Handling**: Detailed error messages and appropriate exit codes

## Installation

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Install from Source

```bash
git clone https://github.com/jan-ru/financial-reports-cli.git
cd financial-reports-cli
npm install
npm run build
```

### Global Installation

```bash
npm install -g financial-reports-cli
```

## Usage

### Basic Usage

```bash
financial-reports-cli report path/to/specification.json
```

### Command Options

```bash
financial-reports-cli report [SPECFILE] [OPTIONS]

ARGUMENTS
  SPECFILE  Path to the report specification JSON file

OPTIONS
  -f, --format=<option>      Output format
                             <options: json|csv|table>
                             [default: json]
  -o, --destination=<value>  Output file path (optional)
  -v, --verbose              Enable verbose logging
  -h, --help                 Show help information
```

### Examples

```bash
# Generate a balance sheet report in JSON format
financial-reports-cli report balance-sheet-spec.json

# Generate an income statement in CSV format
financial-reports-cli report income-spec.json --format csv

# Generate a cash flow report and save to file
financial-reports-cli report cashflow-spec.json --format table --destination report.txt

# Enable verbose logging for debugging
financial-reports-cli report spec.json --verbose
```

## Report Specification Format

Create a JSON file with the following structure:

```json
{
  "entity": "CompanyA",
  "reportType": "BalanceSheet",
  "period": "2025-01",
  "destination": {
    "url": "https://your-odata-service.com/api",
    "authentication": {
      "type": "basic",
      "username": "your-username",
      "password": "your-password"
    }
  },
  "filters": [
    {
      "field": "Department",
      "operator": "eq",
      "value": "Finance"
    }
  ]
}
```

### Specification Fields

- **entity** (required): The entity/company identifier
- **reportType** (required): One of `BalanceSheet`, `IncomeStatement`, or `Cashflow`
- **period** (required): Period in YYYY-MM format (e.g., "2025-01")
- **destination** (optional): OData service configuration
  - **url**: OData service endpoint URL
  - **authentication**: Authentication configuration
- **filters** (optional): Additional query filters

### Supported Report Types

1. **BalanceSheet**: Assets, Liabilities, and Equity data
2. **IncomeStatement**: Revenue and Expenses data
3. **Cashflow**: Operating, Investing, and Financing activities

### Period Format

Periods must be specified in `YYYY-MM` format:

- ✅ Valid: `"2025-01"`, `"2024-12"`
- ❌ Invalid: `"2025-1"`, `"25-01"`, `"2025/01"`

## Output Formats

### JSON Format (Default)

```json
{
  "metadata": {
    "generatedAt": "2025-01-13T10:30:00.000Z",
    "reportType": "BalanceSheet",
    "entity": "CompanyA",
    "period": "2025-01",
    "recordCount": 15,
    "executionTime": 250
  },
  "data": [
    {
      "entity": "CompanyA",
      "period": "2025-01",
      "reportType": "BalanceSheet",
      "lineItems": [
        {
          "account": "CASH",
          "description": "Cash and Cash Equivalents",
          "amount": 100000,
          "currency": "USD",
          "category": "Assets"
        }
      ]
    }
  ]
}
```

### CSV Format

```csv
# Financial Report CSV Export
# Generated At: 2025-01-13T10:30:00.000Z
# Report Type: BalanceSheet
# Entity: CompanyA
# Period: 2025-01
Entity,Period,Report Type,Account,Description,Amount,Currency,Category
CompanyA,2025-01,BalanceSheet,CASH,Cash and Cash Equivalents,100000,USD,Assets
```

### Table Format

```
================================================================================
                        FINANCIAL REPORT - BALANCESHEET
================================================================================
Entity: CompanyA                                    Period: 2025-01
Generated: 2025-01-13T10:30:00.000Z               Records: 15

┌─────────────┬──────────────────────────────┬─────────────┬──────────┬──────────┐
│ Account     │ Description                  │ Amount      │ Currency │ Category │
├─────────────┼──────────────────────────────┼─────────────┼──────────┼──────────┤
│ CASH        │ Cash and Cash Equivalents    │ $100,000.00 │ USD      │ Assets   │
└─────────────┴──────────────────────────────┴─────────────┴──────────┴──────────┘
```

## Development

### Setup

```bash
git clone https://github.com/jan-ru/financial-reports-cli.git
cd financial-reports-cli
npm install
```

### Build

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Linting

```bash
npm run lint
```

### Development Commands

```bash
# Run CLI in development mode
./bin/dev.js report path/to/spec.json

# Build and test
npm run build && npm test
```

## Architecture

The application follows a layered architecture:

- **CLI Layer**: oclif-based command interface
- **Service Layer**: Business logic and orchestration
- **OData Client Layer**: SAP Cloud SDK integration
- **Configuration Layer**: Specification parsing and validation
- **Output Formatting Layer**: Multi-format output generation

### Key Components

- **ReportCommand**: Main CLI command handler
- **ReportService**: Core business logic orchestration
- **ConfigurationService**: Specification parsing and validation
- **FinancialDataClient**: OData v4 client wrapper
- **QueryBuilder**: OData query generation
- **OutputFormatter**: Multi-format output generation

## Error Handling

The CLI provides detailed error messages and appropriate exit codes:

- **Exit Code 0**: Success
- **Exit Code 1**: General errors (validation, parsing)
- **Exit Code 2**: Network/connection errors
- **Exit Code 3**: Authentication errors
- **Exit Code 4**: File system errors

### Common Error Scenarios

```bash
# Invalid specification file
Error: Report specification validation failed
- Missing required field: entity
- Invalid period format: must be YYYY-MM

# Connection errors
Error: Failed to connect to OData service
- Check network connectivity
- Verify service URL and authentication

# File not found
Error: Specification file not found: spec.json
- Verify file path is correct
- Check file permissions
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linting: `npm run lint`
6. Commit your changes: `git commit -am 'Add new feature'`
7. Push to the branch: `git push origin feature/new-feature`
8. Submit a pull request

### Development Guidelines

- Follow TypeScript best practices
- Maintain test coverage above 80%
- Use property-based testing for universal properties
- Follow the existing code style and linting rules
- Update documentation for new features

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/jan-ru/financial-reports-cli/issues)
- **Documentation**: This README and inline code documentation
- **Examples**: See `examples/` directory for sample specification files

## Changelog

### v0.1.2 (2025-01-13)

- Added comprehensive end-to-end integration tests covering complete CLI workflows
- Enhanced test coverage for error scenarios and edge cases
- Improved validation of command-line argument processing and exit codes
- Added tests for all output formats (JSON, CSV, Table) and file redirection
- Strengthened error handling validation for network issues and invalid inputs

### v0.1.1 (2025-01-13)

- Added property-based test for OData service configuration validation
- Enhanced test coverage for authentication and connection handling
- Improved error handling for invalid service configurations

### v0.1.0 (2025-01-13)

- Initial release
- Support for Balance Sheet, Income Statement, and Cash Flow reports
- Multiple output formats (JSON, CSV, Table)
- OData v4 integration with SAP Cloud SDK
- Comprehensive test suite with property-based testing
- Configuration-driven report generation
