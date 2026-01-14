import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath), 
  ...oclif, 
  prettier,
  {
    files: ['test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        test: 'readonly',
        vi: 'readonly'
      }
    }
  },
  {
    // Disable perfectionist sorting rules - they're too strict for this codebase
    rules: {
      'perfectionist/sort-array-includes': 'off',
      'perfectionist/sort-classes': 'off',
      'perfectionist/sort-enums': 'off',
      'perfectionist/sort-exports': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-named-exports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'perfectionist/sort-object-types': 'off',
      'perfectionist/sort-objects': 'off',
      'perfectionist/sort-union-types': 'off',
      // Disable switch case sorting - not needed for this codebase
      'perfectionist/sort-switch-case': 'off',
      
      // Allow snake_case in object properties and destructuring for API contracts
      // OAuth2 tokens, JWT claims, and audit events use snake_case per external API standards
      // Internal variables and functions still require camelCase
      'camelcase': ['error', {
        properties: 'never',           // Allow snake_case in object properties
        ignoreDestructuring: true,     // Allow destructuring snake_case properties
        allow: ['^[A-Z_]+$']           // Allow CONSTANT_CASE
      }],
      
      // Recognize fetch as stable in Node.js 20+ (no longer experimental)
      // fetch is a built-in global in Node 20.0.0 and above
      'n/no-unsupported-features/node-builtins': ['error', {
        ignores: ['fetch']
      }],
    }
  }
]
