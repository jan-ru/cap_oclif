# Docker Deployment Guide

This directory contains Docker configuration files for deploying the Financial Reports CLI with Keycloak authentication.

## Quick Start

### 1. Build and Start All Services

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check service health
docker-compose ps
```

### 2. Access Services

- **Financial Reports API**: http://localhost:3000
- **Keycloak Admin Console**: http://localhost:8080
  - Username: `admin`
  - Password: `admin`

### 3. Test Authentication

```bash
# Get an access token
TOKEN=$(curl -X POST http://localhost:8080/realms/financial-reports/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=financial-reports-api" \
  -d "client_secret=financial-reports-api-secret" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq -r '.access_token')

# Use the token to access the API
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/reports
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Application
APP_MODE=api
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Keycloak
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=financial-reports
JWT_ISSUER=http://keycloak:8080/realms/financial-reports
JWT_AUDIENCE=financial-reports-api

# OData Service (update with your service URL)
ODATA_SERVICE_URL=http://your-odata-service:4004/odata/v4/financial
```

### Keycloak Realm Configuration

The `realm-export.json` file contains:

- **Realm**: `financial-reports`
- **Clients**:
  - `financial-reports-api` (backend API, confidential)
  - `financial-reports-web` (frontend, public)
- **Users**:
  - `admin` / `admin123` (admin role)
  - `testuser` / `test123` (user role)
  - `viewer` / `viewer123` (viewer role)
- **Roles**: `admin`, `user`, `viewer`

## Production Deployment

### 1. Use PostgreSQL for Keycloak

Uncomment the PostgreSQL service in `docker-compose.yml` and update Keycloak configuration:

```yaml
keycloak:
  environment:
    KC_DB: postgres
    KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
    KC_DB_USERNAME: keycloak
    KC_DB_PASSWORD: ${KEYCLOAK_DB_PASSWORD}
  depends_on:
    postgres:
      condition: service_healthy
```

### 2. Enable HTTPS

Update the Financial Reports API configuration:

```yaml
financial-reports-api:
  environment:
    REQUIRE_HTTPS: "true"
```

Add a reverse proxy (nginx/traefik) for TLS termination.

### 3. Secure Secrets

Use Docker secrets or environment variable files:

```bash
# Create secrets
echo "your-secure-password" | docker secret create keycloak_admin_password -
echo "your-client-secret" | docker secret create api_client_secret -

# Update docker-compose.yml to use secrets
secrets:
  keycloak_admin_password:
    external: true
  api_client_secret:
    external: true
```

### 4. Configure Resource Limits

```yaml
financial-reports-api:
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 512M
      reservations:
        cpus: '0.5'
        memory: 256M
```

## Kubernetes Deployment

### 1. Create Kubernetes Manifests

```bash
# Generate Kubernetes manifests from docker-compose
kompose convert -f docker-compose.yml
```

### 2. Apply Manifests

```bash
kubectl apply -f k8s/
```

### 3. Example Deployment

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
        env:
        - name: KEYCLOAK_URL
          value: "http://keycloak:8080"
        - name: KEYCLOAK_REALM
          value: "financial-reports"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

## Monitoring

### Health Checks

```bash
# Liveness check
curl http://localhost:3000/health/live

# Readiness check
curl http://localhost:3000/health/ready

# Full health check
curl http://localhost:3000/health
```

### Logs

```bash
# View API logs
docker-compose logs -f financial-reports-api

# View Keycloak logs
docker-compose logs -f keycloak

# View all logs
docker-compose logs -f
```

## Troubleshooting

### Keycloak Not Starting

```bash
# Check Keycloak logs
docker-compose logs keycloak

# Restart Keycloak
docker-compose restart keycloak
```

### API Cannot Connect to Keycloak

```bash
# Check network connectivity
docker-compose exec financial-reports-api ping keycloak

# Verify Keycloak is healthy
curl http://localhost:8080/health/ready
```

### Authentication Failures

```bash
# Check JWT configuration
docker-compose exec financial-reports-api env | grep JWT

# Verify JWKS endpoint
curl http://localhost:8080/realms/financial-reports/protocol/openid-connect/certs
```

## Cleanup

```bash
# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes all data)
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

## Development

### Local Development with Docker

```bash
# Start only Keycloak
docker-compose up -d keycloak

# Run API locally
npm run build
APP_MODE=api \
KEYCLOAK_URL=http://localhost:8080 \
KEYCLOAK_REALM=financial-reports \
JWT_ISSUER=http://localhost:8080/realms/financial-reports \
node dist/main.js
```

### Rebuild After Code Changes

```bash
# Rebuild and restart API
docker-compose up -d --build financial-reports-api
```

## Security Considerations

1. **Change Default Passwords**: Update all default passwords in production
2. **Use HTTPS**: Enable TLS for all external communication
3. **Secure Secrets**: Use Docker secrets or external secret management
4. **Network Isolation**: Use Docker networks to isolate services
5. **Regular Updates**: Keep base images and dependencies updated
6. **Audit Logging**: Enable and monitor audit logs
7. **Rate Limiting**: Configure appropriate rate limits
8. **CORS**: Restrict CORS origins to trusted domains

## Additional Resources

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
