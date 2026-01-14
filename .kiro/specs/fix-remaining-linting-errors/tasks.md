2# Implementation Plan: Fix Remaining ESLint Errors

## Overview

This implementation plan addresses 706 ESLint errors through a phased approach: configuration updates, automated fixes, type definitions, and manual corrections. Each phase includes validation to ensure no regressions are introduced. The work focuses on maintaining API contract compatibility while improving type safety and code consistency.

## Tasks

- [x] 1. Update ESLint configuration for API contracts and Node.js features
  - Update `eslint.config.mjs` to allow snake_case in object properties and destructuring
  - Configure the camelcase rule with `properties: 'never'` and `ignoreDestructuring: true`
  - Add fetch to the ignored built-ins list for Node 20+ compatibility
  - Disable the `perfectionist/sort-switch-case` rule
  - Add inline comments documenting the rationale for each configuration change
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 6.5_

- [ ]* 1.1 Verify ESLint configuration changes
  - Run `npm run lint` and confirm error count decreased from 706
  - Verify no camelcase errors for API contract files
  - Verify no fetch-related errors
  - _Requirements: 1.3, 3.2_

- [x] 2. Apply automated style fixes
  - Run `npm run lint:fix` to auto-fix style issues
  - Review the git diff to identify all changes made by auto-fix
  - Manually inspect forEach to for...of conversions for potential side effects
  - Revert any auto-fixes that could change runtime behavior
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

- [ ]* 2.1 Verify automated fixes don't break tests
  - Run `npm test` to ensure all existing tests pass
  - If tests fail, investigate and revert problematic auto-fixes
  - _Requirements: 5.5_

- [x] 3. Checkpoint - Verify progress and test suite
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Define TypeScript interfaces for API contracts
  - [x] 4.1 Create JWT token claims interface
    - Define `JWTTokenClaims` interface with standard JWT fields (sub, iss, aud, exp, iat)
    - Include Keycloak-specific fields (realm_access, resource_access, azp)
    - Add index signature for additional claims
    - Export the interface from appropriate type file
    - _Requirements: 2.1_

  - [x] 4.2 Create OAuth2 token interfaces
    - Define `OAuth2TokenRequest` interface with grant_type, client_id, client_secret, etc.
    - Define `OAuth2TokenResponse` interface with access_token, token_type, expires_in, etc.
    - Export both interfaces from appropriate type file
    - _Requirements: 2.2_

  - [x] 4.3 Create audit event interface
    - Define `AuditEvent` interface with event_type, correlation_id, timestamp, etc.
    - Include optional fields for user_id, source_ip, user_agent, error details
    - Export the interface from appropriate type file
    - _Requirements: 2.3_

  - [x] 4.4 Create configuration and error interfaces
    - Define `AppConfig` interface for application configuration structure
    - Define `ErrorResponse` interface for error response payloads
    - Export both interfaces from appropriate type file
    - _Requirements: 2.4, 2.5_

- [x] 5. Replace `any` types with proper interfaces
  - Update `authentication-auditor.ts` to use `AuditEvent` and `JWTTokenClaims` instead of `any`
  - Update `client-credentials-service.ts` to use `OAuth2TokenRequest` and `OAuth2TokenResponse` instead of `any`
  - Update `config.ts` to use `AppConfig` instead of `any`
  - Update `server.ts` to use `ErrorResponse` instead of `any`
  - Add necessary type imports to all modified files
  - _Requirements: 2.7_

- [ ]* 5.1 Verify type replacements are correct
  - Run `npm run lint` and confirm zero `@typescript-eslint/no-explicit-any` errors
  - Run `npm test` to ensure types match runtime data structures
  - _Requirements: 2.6, 5.5_

- [x] 6. Checkpoint - Verify type safety improvements
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Apply manual fixes for remaining errors
  - Fix `n/no-unpublished-import` errors in development scripts
  - Replace `> -1` with `!== -1` for index existence checks
  - Simplify negated conditions where flagged by linter
  - Eliminate unnecessary use of `new` keyword for side effects
  - Add braces to switch case clauses if needed
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ]* 7.1 Verify all linting errors resolved
  - Run `npm run lint` and confirm exit code is 0
  - Verify output shows zero errors
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 8. Create validation tests for linting requirements
  - [x] 8.1 Create linter exit code test
    - Write test that executes `npm run lint` and asserts exit code is 0
    - Test should fail if any linting errors exist
    - _Requirements: 5.1_

  - [ ]* 8.2 Create ESLint configuration validation test
    - Write test that reads `eslint.config.mjs` and verifies expected rule configurations
    - Check camelcase rule has correct settings
    - Check fetch is in ignored built-ins
    - Check perfectionist/sort-switch-case is disabled
    - _Requirements: 1.1, 1.2, 3.1, 6.5_

  - [ ]* 8.3 Create type interface existence test
    - Write test that imports all required type interfaces
    - Verify `JWTTokenClaims`, `OAuth2TokenRequest`, `OAuth2TokenResponse`, `AuditEvent`, `AppConfig`, and `ErrorResponse` are exported
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 8.4 Create camelcase enforcement test
    - Create a temporary test file with internal snake_case variables
    - Run linter on that file and verify it produces camelcase errors
    - Clean up temporary file after test
    - _Requirements: 1.4_

- [x] 9. Final checkpoint - Verify all requirements met
  - Run `npm run lint` and confirm zero errors
  - Run `npm test` and confirm all tests pass
  - Review git diff to ensure no unintended changes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster completion
- Each checkpoint ensures incremental validation before proceeding
- Configuration changes should be made before code changes to minimize risk
- Auto-fix should be carefully reviewed, especially forEach conversions
- Type definitions should match external API documentation exactly
- All changes should maintain backward compatibility with existing API contracts
- The existing test suite serves as a regression safety net throughout implementation
