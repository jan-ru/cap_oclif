# Node.js Version Requirements

## Specified Version

This project requires **Node.js >= 20.0.0** with a recommended version of **20.11.0** (LTS).

## Why Node.js 20?

### Stability and Support
- **LTS (Long Term Support)**: Node.js 20 is an LTS release, supported until April 2026
- **Production Ready**: Mature and stable for production deployments
- **Security Updates**: Regular security patches and updates

### Features Used
- **Native Fetch API**: Available in Node.js 18+, stable in 20+
- **Native Test Runner**: Built-in test runner improvements
- **Performance**: Better V8 engine performance
- **ESM Support**: Excellent ES Modules support

### Docker Compatibility
- Alpine Linux images available
- Small footprint for containers
- Well-tested in production environments

## Version Management

### Using nvm (Node Version Manager)

```bash
# Install the specified version
nvm install

# Use the specified version
nvm use

# Set as default
nvm alias default 20.11.0
```

The `.nvmrc` file in the project root specifies the exact version.

### Using fnm (Fast Node Manager)

```bash
# Install the specified version
fnm install

# Use the specified version
fnm use
```

The `.node-version` file in the project root specifies the exact version.

### Using asdf

```bash
# Install Node.js plugin
asdf plugin add nodejs

# Install the specified version
asdf install nodejs 20.11.0

# Set local version
asdf local nodejs 20.11.0
```

### Using Volta

```bash
# Pin Node.js version
volta pin node@20.11.0
```

## Verification

Check your Node.js version:

```bash
node --version
# Should output: v20.11.0 or higher
```

Check npm version:

```bash
npm --version
# Should output: 10.0.0 or higher
```

## CI/CD Considerations

### GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20.11.0'
```

### Docker

The Dockerfile uses:
```dockerfile
FROM node:20.11.0-alpine
```

### Coolify/Hetzner

Coolify will automatically use the Node.js version specified in the Docker image.

## Upgrading from Node.js 18

If you're upgrading from Node.js 18:

1. **No Breaking Changes**: Node.js 20 is backward compatible with 18
2. **Dependencies**: All dependencies are compatible with Node.js 20
3. **Tests**: Run `npm test` to verify everything works
4. **Build**: Run `npm run build` to ensure compilation succeeds

## Future Upgrades

### Node.js 22 (Next LTS)

When Node.js 22 becomes LTS (expected October 2024):
- Evaluate new features
- Test compatibility
- Update version requirements
- Update Docker images

### Deprecation Timeline

- **Node.js 18**: Maintenance until April 2025
- **Node.js 20**: Maintenance until April 2026
- **Node.js 22**: Expected LTS in October 2024

## Troubleshooting

### Version Mismatch

If you see errors about Node.js version:

```bash
# Check current version
node --version

# Install correct version with nvm
nvm install 20.11.0
nvm use 20.11.0

# Or with fnm
fnm install 20.11.0
fnm use 20.11.0
```

### npm Version Issues

If npm version is too old:

```bash
# Update npm
npm install -g npm@latest

# Verify version
npm --version
```

### Docker Build Issues

If Docker build fails:

```bash
# Pull latest Node.js 20 image
docker pull node:20.11.0-alpine

# Rebuild without cache
docker build --no-cache -t financial-reports-api .
```

## References

- [Node.js Release Schedule](https://nodejs.org/en/about/releases/)
- [Node.js 20 Release Notes](https://nodejs.org/en/blog/release/v20.0.0)
- [Node.js LTS Schedule](https://github.com/nodejs/release#release-schedule)
