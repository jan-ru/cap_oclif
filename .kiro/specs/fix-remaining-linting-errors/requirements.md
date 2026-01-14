# Requirements Document: Fix Remaining ESLint Errors

## Introduction

After disabling the perfectionist sorting rules, approximately 706 ESLint errors remain in the codebase. These errors must be resolved to pass CI/CD linting checks. The errors fall into five main categories: camelcase violations for API contracts, TypeScript `any` type usage, Node.js fetch API warnings, code style inconsistencies, and miscellaneous issues. This specification defines requirements for resolving all linting errors while maintaining code quality, type safety, and API contract compatibility.

## Glossary

- **Linter**: A static code analysis tool (ESLint) that identifies programming errors, bugs, stylistic errors, and suspicious constructs
- **ESLint**: The JavaScript/TypeScript linting utility used in this codebase
- **EARS**: Easy Approach to Requirements Syntax, a pattern-based requirements writing methodology
- **CI/CD**: Continuous Integration/Continuous Deployment pipeline that runs automated checks
- **Snake_Case**: Naming convention using underscores between words (e.g., `user_id`)
- **CamelCase**: Naming convention capitalizing the first letter of each word except the first (e.g., `userId`)
- **API_Contract**: The agreed-upon structure and naming conventions for external API communication
- **Type_Safety**: TypeScript's ability to catch type-related errors at compile time

## Requirements

### Requirement 1: Handle Camelcase Violations for API Contracts

**User Story:** As a developer, I want snake_case identifiers for external API contracts to be allowed by the linter, so that the code maintains compatibility with OAuth2 and audit logging standards without generating linting errors.

#### Acceptance Criteria

1. THE Linter SHALL allow snake_case property names in object literals and destructuring patterns
2. THE Linter SHALL allow snake_case for properties matching external API contracts (OAuth2 token properties, audit event properties)
3. WHEN the linter runs on files containing API contract objects, THEN THE Linter SHALL produce zero camelcase errors
4. THE Linter SHALL continue to enforce camelCase for internal variable names and function names
5. THE ESLint configuration SHALL explicitly document which patterns are allowed and why

### Requirement 2: Replace TypeScript `any` Types with Proper Interfaces

**User Story:** As a developer, I want proper TypeScript type definitions instead of `any` types, so that the codebase has improved type safety and catches type-related errors at compile time.

#### Acceptance Criteria

1. THE Codebase SHALL define a TypeScript interface for JWT token claims structure
2. THE Codebase SHALL define TypeScript interfaces for OAuth2 token request and response payloads
3. THE Codebase SHALL define TypeScript interfaces for audit event structures
4. THE Codebase SHALL define TypeScript interfaces for configuration objects
5. THE Codebase SHALL define TypeScript interfaces for error response types
6. WHEN the linter runs, THEN THE Linter SHALL produce zero `@typescript-eslint/no-explicit-any` errors
7. THE Codebase SHALL replace all explicit `any` types with the appropriate interface definitions

### Requirement 3: Configure Fetch API Recognition for Node 20+

**User Story:** As a developer, I want the linter to recognize the fetch API as stable in Node.js 20+, so that no false warnings are generated for using the built-in fetch functionality.

#### Acceptance Criteria

1. THE ESLint configuration SHALL recognize fetch as a supported built-in feature in Node.js 20.0.0 and above
2. WHEN the linter runs on files using the fetch API, THEN THE Linter SHALL produce zero `n/no-unsupported-features/node-builtins` errors for fetch
3. THE Codebase SHALL not require any runtime code changes to satisfy this requirement
4. THE ESLint configuration SHALL document that fetch is stable in Node 20+

### Requirement 4: Fix Code Style Inconsistencies

**User Story:** As a developer, I want the codebase to follow consistent modern JavaScript/TypeScript style patterns, so that the code is maintainable and follows best practices.

#### Acceptance Criteria

1. THE Codebase SHALL not contain unnecessary else statements after return statements
2. THE Codebase SHALL use ternary expressions where appropriate instead of simple if-else statements
3. THE Codebase SHALL use spread operators instead of `Array.from()` where applicable
4. THE Codebase SHALL use `String.prototype.slice()` instead of deprecated `substr()` methods
5. THE Codebase SHALL use `Number.parseInt()` instead of global `parseInt()`
6. THE Codebase SHALL use `for...of` loops instead of `.forEach()` where appropriate
7. THE Codebase SHALL use method shorthand syntax in object literals
8. THE Codebase SHALL not contain redundant `await` keywords on return statements
9. THE Codebase SHALL include braces in switch case clauses where required
10. THE Codebase SHALL maintain proper blank line spacing between statement groups
11. WHEN auto-fixable style issues are corrected, THEN THE Linter SHALL produce zero style-related errors

### Requirement 5: Achieve Zero Linting Errors for CI/CD

**User Story:** As a developer, I want the CI/CD pipeline to pass all linting checks, so that code quality gates are satisfied and deployments can proceed.

#### Acceptance Criteria

1. WHEN `npm run lint` is executed, THEN THE Linter SHALL exit with zero errors
2. THE CI/CD pipeline SHALL pass the linting step for all supported Node.js versions (18.x, 20.x, 22.x)
3. THE Codebase SHALL reduce linting errors from 706 to 0
4. WHEN all requirements are implemented, THEN THE Linter SHALL produce a clean output with no errors or warnings that block CI/CD
5. THE Codebase SHALL maintain all existing functionality without runtime behavior changes

### Requirement 6: Handle Miscellaneous Linting Issues

**User Story:** As a developer, I want all remaining miscellaneous linting errors resolved, so that the codebase has a completely clean linting status.

#### Acceptance Criteria

1. THE Codebase SHALL resolve `n/no-unpublished-import` errors in development scripts
2. THE Codebase SHALL eliminate unnecessary use of `new` keyword for side effects
3. THE Codebase SHALL use `!== -1` instead of `> -1` for index existence checks
4. THE Codebase SHALL simplify negated conditions where appropriate
5. THE ESLint configuration SHALL disable the `perfectionist/sort-switch-case` rule
6. WHEN the linter runs, THEN THE Linter SHALL produce zero errors for these miscellaneous categories

## Notes

- ESLint configuration changes should be specific and well-documented to avoid being overly permissive
- All changes should be validated by running the full test suite to ensure no regressions
- Type definitions should be validated against actual API documentation and runtime behavior
- Auto-fix capabilities should be leveraged where possible to reduce manual effort
- The work should maintain backward compatibility with existing API contracts
