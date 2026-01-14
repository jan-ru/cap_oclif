# Development Setup & Workflows

This document outlines the complete development workflow setup for the Financial Reports CLI project.

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/jan-ru/financial-reports-cli.git
cd financial-reports-cli

# Run setup script
./scripts/setup-hooks.sh

# Or manual setup
npm install
npx husky init
chmod +x .husky/pre-commit .husky/commit-msg
```

## 🔧 Development Workflows

### Local Development (Husky + lint-staged)

**Pre-commit Hook** (`.husky/pre-commit`):

- ✅ Runs `lint-staged` for changed files
- ✅ Runs all tests to ensure nothing is broken
- ✅ Builds project to ensure compilation succeeds
- ✅ Blocks commit if any step fails

**What happens on `git commit`:**

```bash
git add .
git commit -m "feat: add new feature"

# Automatically runs:
# 🔍 Running pre-commit checks...
# 📝 Linting and formatting changed files...
# 🧪 Running all tests...
# 🔨 Building project...
# ✅ All pre-commit checks passed!
```

### Remote CI/CD (GitHub Actions)

#### 1. **Main CI/CD Pipeline** (`.github/workflows/ci.yml`)

**Triggers:** Push/PR to `main` or `develop`

**Jobs:**

- **Test & Build**: Runs on Node.js 18.x, 20.x, 22.x
  - Install dependencies
  - Run linting
  - Run tests
  - Generate coverage report
  - Build project
  - Test CLI functionality
  - Upload coverage to Codecov

- **Security Audit**:
  - Run `npm audit`
  - Check dependencies with `audit-ci`

- **Code Quality**:
  - Check code formatting with Prettier
  - Advanced linting with JSON output
  - Generate test reports

#### 2. **Release Pipeline** (`.github/workflows/release.yml`)

**Triggers:** Version tags (`v*`)

**Jobs:**

- **Create Release**: Generate changelog and GitHub release
- **Publish to NPM**: Automated NPM publishing

## 📋 Available Commands

### Development Commands

```bash
npm run build         # Build TypeScript to dist/
npm run lint          # Run ESLint
npm run lint:fix      # Fix auto-fixable linting issues
npm run format        # Format code with Prettier
npm run format:check  # Check if code is formatted
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run validate      # Run lint + test + build (full validation)
```

### Git Workflow Commands

```bash
git add .
git commit -m "feat: new feature"  # Triggers pre-commit hooks
git push                           # Triggers CI/CD pipeline
```

## 🛠️ Configuration Files

### Husky Configuration

- `.husky/pre-commit` - Pre-commit hook script
- `.husky/commit-msg` - Commit message validation (optional)

### lint-staged Configuration (package.json)

```json
{
  "lint-staged": {
    "*.{ts,js}": ["eslint --fix"],
    "*.{ts,js,json,md}": ["prettier --write"]
  }
}
```

### Prettier Configuration (`.prettierrc`)

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "avoid"
}
```

### Security Audit Configuration (`audit-ci.json`)

```json
{
  "low": true,
  "moderate": true,
  "high": true,
  "critical": true,
  "report-type": "summary"
}
```

## 🔄 Complete Workflow

### 1. **Local Development**

```bash
# Make changes
vim src/services/new-feature.ts

# Commit (triggers pre-commit hooks)
git add .
git commit -m "feat: add new feature"
# ✅ Linting, tests, and build must pass

# Push to remote
git push origin feature/new-feature
```

### 2. **Remote CI/CD**

```bash
# Push triggers GitHub Actions
# ✅ Tests on Node 18.x, 20.x, 22.x
# ✅ Security audit
# ✅ Code quality checks
# ✅ Coverage reporting
```

### 3. **Release Process**

```bash
# Create and push version tag
npm version patch  # Updates to 0.1.1
git push --tags

# Triggers release workflow
# ✅ Creates GitHub release
# ✅ Publishes to NPM (if configured)
```

## 🚨 Quality Gates

### Pre-commit (Local)

- **ESLint**: Code quality and style
- **Prettier**: Code formatting
- **Tests**: All 27+ tests must pass
- **Build**: TypeScript compilation must succeed

### CI/CD (Remote)

- **Multi-Node Testing**: Compatibility across Node versions
- **Security Audit**: Dependency vulnerability scanning
- **Coverage**: Test coverage reporting
- **CLI Testing**: Functional CLI testing

## 🎯 Benefits

### **Husky (Local Pre-commit)**

- ⚡ **Instant feedback** (seconds)
- 🚫 **Prevents bad commits** from entering git history
- 💻 **Works offline**
- 🔧 **Catches issues early** in development

### **GitHub Actions (Remote CI/CD)**

- 🌐 **Team-wide quality assurance**
- 🔄 **Multi-environment testing**
- 📊 **Coverage and reporting**
- 🚀 **Automated releases**
- 🛡️ **Security monitoring**

## 🔧 Troubleshooting

### Pre-commit Hook Issues

```bash
# Make hooks executable
chmod +x .husky/pre-commit .husky/commit-msg

# Reinstall husky
rm -rf .husky
npx husky init

# Skip hooks temporarily (not recommended)
git commit --no-verify -m "emergency fix"
```

### CI/CD Issues

- Check GitHub Actions tab for detailed logs
- Ensure all required secrets are configured (NPM_TOKEN for releases)
- Verify Node.js version compatibility

### Linting Issues

```bash
# Fix auto-fixable issues
npm run lint:fix

# Check specific files
npx eslint src/specific-file.ts

# Format code
npm run format
```

This dual approach ensures code quality at every stage of development! 🎉
