# Financial Reports CLI

[![Version](https://img.shields.io/github/package-json/v/jan-ru/cap_oclif_keycloack?style=flat-square)](https://github.com/jan-ru/cap_oclif_keycloack/releases)
[![CI/CD Pipeline](https://img.shields.io/github/actions/workflow/status/jan-ru/cap_oclif_keycloack/ci.yml?branch=main&style=flat-square&label=build)](https://github.com/jan-ru/cap_oclif_keycloack/actions/workflows/ci.yml)
[![Codecov](https://img.shields.io/codecov/c/github/jan-ru/cap_oclif_keycloack?style=flat-square)](https://codecov.io/gh/jan-ru/cap_oclif_keycloack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

A TypeScript-based command-line tool and HTTP API for retrieving financial reports from OData v4 datasources using the SAP Cloud SDK. This tool provides both CLI and API interfaces for querying CAP (Cloud Application Programming) services to generate financial reports based on configurable specifications.

## Features

- **Dual Mode Operation**: Both CLI and HTTP API modes
- **OData v4 Integration**: Seamless connection to CAP services using SAP Cloud SDK
- **Multiple Report Types**: Support for Balance Sheet, Income Statement, and Cash Flow reports
- **Flexible Output Formats**: JSON, CSV, and human-readable table formats
- **Configuration-Driven**: Define report parameters through YAML or JSON specification files
- **Health Check Endpoints**: Container-ready health monitoring for orchestration platforms
- **Type Safety**: Full TypeScript support with strict type checking
- **Comprehensive Testing**: Unit tests and property-based testing with fast-check
- **Error Handling**: Detailed error messages and appropriate exit codes
- **Container Ready**: Docker and Kubernetes deployment support

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

### CLI Mode

#### Basic Usage

```bash
financial-reports-cli report path/to/specification.yaml
```

#### Command Options

```bash
financial-reports-cli report [SPECFILE] [OPTIONS]

ARGUMENTS
  SPECFILE  Path to the report specification YAML/JSON file

OPTIONS
  -f, --format=<option>      Output format
                             <options: json|csv|table>
                             [default: json]
  -o, --destination=<value>  Output file path (optional)
  -v, --verbose              Enable verbose logging
  -h, --help                 Show help information
```

#### Examples

```bash
# Generate a balance sheet report in JSON format
financial-reports-cli report balance-sheet-spec.yaml

# Generate an income statement in CSV format
financial-reports-cli report income-spec.yaml --format csv

# Generate a cash flow report and save to file
financial-reports-cli report cashflow-spec.yaml --format table --destination report.txt

# Enable verbose logging for debugging
financial-reports-cli report spec.yaml --verbose
```

### HTTP API Mode

#### Starting the API Server

```bash
# Start API server on default port 3000
financial-reports-cli --mode api

# Start with custom configuration
PORT=8080 HOST=0.0.0.0 financial-reports-cli --mode api
```

#### API Endpoints

- **POST /api/reports** - Generate financial reports
- **GET /api/reports/:id** - Get report status
- **GET /health** - Comprehensive health check
- **GET /health/live** - Liveness probe (Kubernetes)
- **GET /health/ready** - Readiness probe (Kubernetes)
- **GET /api** - API information

#### API Usage Examples

```bash
# Generate a report via API
curl -X POST http://localhost:3000/api/reports \
  -H "Content-Type: application/json" \
  -d '{
    "specification": {
      "entity": "CompanyA",
      "reportType": "BalanceSheet",
      "period": "2025-01"
    },
    "outputFormat": "json"
  }'

# Check health status
curl http://localhost:3000/health

# Check readiness for Kubernetes
curl http://localhost:3000/health/ready
```

## Report Specification Format

Create a YAML or JSON file with the following structure:

### YAML Format (Recommended)

```yaml
# Financial Report Specification
entity: CompanyA
reportType: BalanceSheet  # BalanceSheet | IncomeStatement | Cashflow
period: "2025-01"         # YYYY-MM format

# Optional OData service configuration
destination:
  url: https://your-odata-service.com/api
  authentication:
    type: basic
    username: your-username
    password: your-password

# Optional filters
filters:
  - field: Department
    operator: eq
    value: Finance
  - field: Region
    operator: in
    value: [US, EU, APAC]
```

### JSON Format (Legacy)

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

## Container Deployment

### Docker

```dockerfile
FROM node:18-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000

# Health check configuration
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health/ready || exit 1

CMD ["node", "dist/main.js", "--mode", "api"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  financial-reports-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - ODATA_SERVICE_URL=http://odata-service:4004/odata/v4/financial
      - KEYCLOAK_SERVICE_URL=http://keycloak:8080
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: financial-reports-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: financial-reports-api
  template:
    metadata:
      labels:
        app: financial-reports-api
    spec:
      containers:
      - name: api
        image: financial-reports-api:latest
        ports:
        - containerPort: 3000
        
        # Liveness probe
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        
        # Readiness probe
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

For complete container configuration examples, see [docker-healthcheck.md](docker-healthcheck.md).

## Health Check Endpoints

The API provides comprehensive health check endpoints for container orchestration:

- **GET /health** - Full health check with service dependencies
- **GET /health/live** - Liveness check (always returns 200 when app is running)
- **GET /health/ready** - Readiness check (validates service dependencies)

### Health Response Format

```json
{
  "status": "healthy|degraded|unhealthy",
  "version": "0.1.4",
  "timestamp": "2025-01-13T16:44:30.330Z",
  "environment": "production",
  "services": {
    "odata": {
      "status": "healthy",
      "responseTime": 45,
      "lastChecked": "2025-01-13T16:44:30.330Z"
    },
    "keycloak": {
      "status": "healthy",
      "responseTime": 23,
      "lastChecked": "2025-01-13T16:44:30.337Z"
    }
  },
  "uptime": 3600
}
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
- **ConfigurationService**: YAML/JSON specification parsing and validation
- **FinancialDataClient**: OData v4 client wrapper
- **QueryBuilder**: OData query generation
- **OutputFormatter**: Multi-format output generation
- **ApiServer**: HTTP API server with Express.js
- **HealthService**: Container health check and monitoring

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

## Documentation

- **[Authentication Integration Status](docs/AUTHENTICATION_INTEGRATION_STATUS.md)**: Comprehensive status report of Keycloak JWT authentication integration
- **[Service Account Authentication](docs/SERVICE_ACCOUNT_AUTHENTICATION.md)**: Guide for configuring and using service account authentication
- **[Docker Deployment Guide](docs/DOCKER_DEPLOYMENT.md)**: Complete guide for deploying with Docker and Kubernetes
- **[Coolify Deployment Guide](docs/COOLIFY_DEPLOYMENT.md)**: Step-by-step guide for deploying on Hetzner with Coolify
- **[Development Guide](docs/DEVELOPMENT.md)**: Local development setup and guidelines

## Changelog

### v0.1.6 (2025-01-14)

- **✅ Property-Based Testing**: Implemented comprehensive property tests for authentication
- **🔐 Token Validation Consistency**: Property test validates all requests without JWT tokens return 401
- **🛡️ Invalid Token Rejection**: Property test validates all invalid JWT tokens are rejected with error details
- **🧪 Enhanced Test Coverage**: 100+ iterations per property test using fast-check library
- **📊 Test Quality**: Property tests validate universal correctness properties across random inputs
- **🔍 Edge Case Coverage**: Tests cover malformed tokens, missing claims, invalid signatures, and more

### v0.1.5 (2025-01-13)

- **🔐 Enhanced Authentication Error Handling**: Implemented comprehensive authentication error handler
- **🛡️ Secure Error Responses**: Generic error messages to clients while detailed logging internally
- **🔍 Correlation ID Support**: Enhanced request tracing with automatic correlation ID generation
- **⚠️ Security Alert Integration**: Automatic detection of suspicious authentication patterns
- **📊 Improved Error Classification**: Specific error types for better debugging and monitoring
- **✅ Updated Test Coverage**: All authentication tests updated for new error handling behavior

### v0.1.4 (2025-01-13)

- **🚀 HTTP API Mode**: Added comprehensive REST API server with Express.js
- **🏥 Health Check Endpoints**: Container-ready health monitoring (`/health`, `/health/live`, `/health/ready`)
- **📊 Service Dependency Monitoring**: OData and Keycloak connectivity validation
- **🐳 Container Support**: Docker, Kubernetes, and Coolify deployment configurations
- **⚡ Async Report Processing**: Job tracking and status monitoring for API requests
- **🔧 Enhanced Configuration**: Health check timeouts and service URL configuration
- **📝 Container Documentation**: Complete deployment examples and health check configuration
- **✅ Comprehensive Testing**: 25+ health service tests and API endpoint integration tests

### v0.1.3 (2025-01-13)

- Added comprehensive GitHub issue templates for structured issue creation
- Created detailed issue content files for all planned features and epics
- Enhanced project documentation with issue templates for feature requests, epics, and bug reports
- Prepared issue content for YAML support, HTTP API mode, Keycloak authentication, and multi-client integration

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
