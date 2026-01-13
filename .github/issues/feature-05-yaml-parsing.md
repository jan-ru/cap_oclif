# Feature: Replace JSON with YAML specification parsing

## Feature Description

Replace the current JSON specification file parser with YAML parser to improve human readability and reduce syntax errors.

## User Story

**As a** financial analyst  
**I want** to write report specifications in YAML format  
**So that** I can easily read, edit, and maintain my report configurations with comments and cleaner syntax

## Acceptance Criteria

- [ ] CLI accepts both .yaml and .yml file extensions
- [ ] YAML parser correctly parses all existing specification fields
- [ ] Inline comments are preserved and don't cause parsing errors
- [ ] Multi-line strings work correctly for descriptions
- [ ] Error messages are clear and include line numbers when possible
- [ ] All existing tests pass with YAML specifications
- [ ] Documentation updated with YAML examples

## Requirements Reference

**Validates Requirements:** 1.1, 1.5, 1.6, 1.7

## Technical Notes

- Use `js-yaml` library for parsing
- Update `ConfigurationService.parseSpecification()` method
- Add file extension detection (.yaml, .yml)
- Maintain backward compatibility during transition
- Update error handling for YAML-specific errors

## Definition of Done

- [ ] Code implemented and tested
- [ ] Unit tests written and passing
- [ ] Integration tests updated with YAML files
- [ ] Documentation updated with YAML examples
- [ ] Pre-commit hooks pass
- [ ] Code reviewed and approved

## Example YAML Specification

```yaml
# Financial Report Specification
entity: ACME_Corp
reportType: BalanceSheet
period: 2025-01

destination:
  url: http://localhost:4004/odata/v4/financial
  authentication:
    type: basic
    username: user
    password: pass

# Filter to show only Assets
filters:
  - field: Category
    operator: eq
    value: Assets
```
