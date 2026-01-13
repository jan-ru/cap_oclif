# Feature: Implement HTTP REST API endpoints

## Feature Description

Add HTTP REST API endpoints to enable the CLI tool to operate as a web service, supporting integration with CAP services and web applications.

## User Story

**As a** CAP service developer  
**I want** to call the financial reports tool via HTTP API  
**So that** I can integrate report generation into my service handlers and provide data to OpenUI5 applications

## Acceptance Criteria

- [ ] HTTP server starts when CLI is run in API mode
- [ ] POST /api/generate-report endpoint accepts JSON specification
- [ ] API returns JSON responses with proper HTTP status codes
- [ ] Same business logic used for both CLI and API modes
- [ ] Error responses include structured error information
- [ ] API supports all output formats (json, csv, table)
- [ ] Request/response logging implemented
- [ ] API documentation generated

## Requirements Reference

**Validates Requirements:** 7.1, 7.2, 7.3, 7.4

## Technical Notes

- Use Express.js for HTTP server
- Create dual-mode startup (CLI vs API)
- Share ReportService between CLI and API
- Add proper error handling middleware
- Structure: `src/api-server.ts`, `src/routes/reports.ts`

## Definition of Done

- [ ] Code implemented and tested
- [ ] Unit tests for API endpoints
- [ ] Integration tests for HTTP requests
- [ ] API documentation updated
- [ ] Pre-commit hooks pass
- [ ] Code reviewed and approved

## API Specification

```
POST /api/generate-report
Content-Type: application/json

{
  "entity": "ACME_Corp",
  "reportType": "BalanceSheet",
  "period": "2025-01",
  "destination": {
    "url": "http://localhost:4004/odata/v4/financial"
  }
}

Response: 200 OK
{
  "data": [...],
  "metadata": {...}
}
```
