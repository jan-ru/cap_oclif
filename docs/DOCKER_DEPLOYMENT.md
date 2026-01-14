# Docker Deployment Guide for Financial Reports CLI

This guide provides comprehensive instructions for deploying the Financial Reports CLI application with Keycloak authentication in Docker containers.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [Production Deployment](#production-deployment)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **curl** or **httpie**: For testing API endpoints
- **jq**: For JSON processing (optional but recommended)

### System Requirements

- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 10GB free space
- **Network**: Internet access for pulling images

### Installation

```bash
# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/jan-ru/financial-reports-cli.git
cd financial-reports-cli

# Create environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### 2. Build and Start Services

```bash
# Build the application image
docker-compose build

# Start all services in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 3. Verify Deployment

```bash
# Check API health
curl http://localhost:3000/health

# Check Keycloak health
curl http://localhost:8080/health/ready

# Expected output: {"status":"UP"}
```

### 4. Access Services

- **Financial Reports API**: http://localhost:3000
  - Health: http://localhost:3000/health
  - API Info: http://localhost:3000/api
  
- **Keycloak Admin Console**: http://localhost:8080
  - Username: `admin`
  - Password: `admin` (change in production!)

### 5. Test Authentication

```bash
# Get access token for testuser
TOKEN=$(curl -s -X POST http://localhost:8080/realms/financial-reports/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=financial-reports-api" \
  -d "client_secret=financial-reports-api-secret" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq -r '.access_token')

# Use token to access protected endpoint
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/reports

# Expected: 200 OK with API response
```

## Configuration

### Environment Variables

The application uses environment variables for configuration. Create a `.env` file:

```bash
# Application Configuration
APP_MODE=api                    # Run in API mode
NODE_ENV=production             # Production environment
PORT=3000                       # API port
HOST=0.0.0.0                    # Listen on all interfaces

# Keycloak Authentication
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=financial-reports
KEYCLOAK_CLIENT_ID=financial-reports-api
KEYCLOAK_CLIENT_SECRET=financial-reports-api-secret

# JWT Configuration
JWT_ISSUER=http://keycloak:8080/realms/financial-reports
JWT_AUDIENCE=financial-reports-api
JWT_ALGORITHMS=RS256
JWT_CLOCK_TOLERANCE=30

# JWKS Configuration
JWKS_CACHE_TIMEOUT=3600000      # 1 hour
JWKS_RATE_LIMIT=10
JWKS_REQUESTS_PER_MINUTE=5

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000     # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Security
REQUIRE_HTTPS=false             # Set to true in production
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080

# Logging
LOG_LEVEL=info
AUDIT_ENABLED=true
INCLUDE_TOKEN_CLAIMS=false      # Security sensitive

# OData Service (update with your service URL)
ODATA_SERVICE_URL=http://your-odata-service:4004/odata/v4/financial
```

### Keycloak Realm Configuration

The default realm configuration includes:

**Realm**: `financial-reports`

**Clients**:
- `financial-reports-api` (Backend API)
  - Type: Confidential
  - Client Secret: `financial-reports-api-secret`
  - Service Accounts: Enabled
  
- `financial-reports-web` (Frontend)
  - Type: Public
  - Standard Flow: Enabled

**Default Users**:
| Username | Password | Roles |
|----------|----------|-------|
| admin | admin123 | admin, user |
| testuser | test123 | user |
| viewer | viewer123 | viewer |

**⚠️ IMPORTANT**: Change all default passwords in production!

### Customizing Keycloak Realm

To customize the realm configuration:

1. Edit `docker/keycloak/realm-export.json`
2. Rebuild and restart:

```bash
docker-compose down
docker-compose up -d
```

Or import via Keycloak Admin Console:
1. Login to http://localhost:8080
2. Navigate to: Realm Settings → Import
3. Upload your realm JSON file

## Production Deployment

### 1. Use PostgreSQL for Keycloak

For production, use PostgreSQL instead of H2:

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: financial-reports-postgres
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - financial-reports-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keycloak"]
      interval: 10s
      timeout: 5s
      retries: 5

  keycloak:
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: ${POSTGRES_PASSWORD}
      KC_HOSTNAME: ${KEYCLOAK_HOSTNAME}
      KC_HOSTNAME_STRICT: "true"
      KC_HOSTNAME_STRICT_HTTPS: "true"
      KC_PROXY: edge
    depends_on:
      postgres:
        condition: service_healthy
    command:
      - start
      - --optimized

volumes:
  postgres-data:
```

### 2. Enable HTTPS with Reverse Proxy

Use nginx or Traefik for TLS termination:

```nginx
# nginx.conf
upstream financial_reports_api {
    server localhost:3000;
}

upstream keycloak {
    server localhost:8080;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://financial_reports_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name auth.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://keycloak;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Secure Secrets Management

Use Docker secrets or external secret management:

```bash
# Create secrets
echo "your-secure-password" | docker secret create postgres_password -
echo "your-client-secret" | docker secret create api_client_secret -
echo "your-admin-password" | docker secret create keycloak_admin_password -

# Update docker-compose.yml
services:
  keycloak:
    secrets:
      - keycloak_admin_password
    environment:
      KEYCLOAK_ADMIN_PASSWORD_FILE: /run/secrets/keycloak_admin_password

secrets:
  postgres_password:
    external: true
  api_client_secret:
    external: true
  keycloak_admin_password:
    external: true
```

### 4. Resource Limits

Configure resource limits for production:

```yaml
services:
  financial-reports-api:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
```

### 5. Backup Strategy

```bash
# Backup PostgreSQL
docker-compose exec postgres pg_dump -U keycloak keycloak > backup_$(date +%Y%m%d).sql

# Backup Keycloak realm
curl -X GET http://localhost:8080/admin/realms/financial-reports \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > realm_backup_$(date +%Y%m%d).json

# Restore PostgreSQL
docker-compose exec -T postgres psql -U keycloak keycloak < backup_20250114.sql
```

## Kubernetes Deployment

### 1. Create Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: financial-reports
```

### 2. Create ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: financial-reports-config
  namespace: financial-reports
data:
  APP_MODE: "api"
  NODE_ENV: "production"
  PORT: "3000"
  KEYCLOAK_REALM: "financial-reports"
  JWT_ALGORITHMS: "RS256"
  LOG_LEVEL: "info"
```

### 3. Create Secrets

```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: financial-reports-secrets
  namespace: financial-reports
type: Opaque
stringData:
  KEYCLOAK_CLIENT_SECRET: "your-client-secret"
  POSTGRES_PASSWORD: "your-postgres-password"
  KEYCLOAK_ADMIN_PASSWORD: "your-admin-password"
```

### 4. Deploy Application

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: financial-reports-api
  namespace: financial-reports
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
          name: http
        envFrom:
        - configMapRef:
            name: financial-reports-config
        - secretRef:
            name: financial-reports-secrets
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: financial-reports-api
  namespace: financial-reports
spec:
  selector:
    app: financial-reports-api
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
  type: LoadBalancer
```

### 5. Deploy Keycloak

```yaml
# keycloak-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: financial-reports
spec:
  replicas: 2
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:23.0
        args:
        - start
        - --optimized
        - --proxy=edge
        env:
        - name: KC_DB
          value: "postgres"
        - name: KC_DB_URL
          value: "jdbc:postgresql://postgres:5432/keycloak"
        - name: KC_DB_USERNAME
          value: "keycloak"
        - name: KC_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: financial-reports-secrets
              key: POSTGRES_PASSWORD
        - name: KEYCLOAK_ADMIN
          value: "admin"
        - name: KEYCLOAK_ADMIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: financial-reports-secrets
              key: KEYCLOAK_ADMIN_PASSWORD
        ports:
        - containerPort: 8080
          name: http
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
          initialDelaySeconds: 60
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: financial-reports
spec:
  selector:
    app: keycloak
  ports:
  - port: 8080
    targetPort: 8080
  type: LoadBalancer
```

### 6. Apply Manifests

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Create secrets
kubectl apply -f secrets.yaml

# Create configmap
kubectl apply -f configmap.yaml

# Deploy PostgreSQL (if using)
kubectl apply -f postgres-deployment.yaml

# Deploy Keycloak
kubectl apply -f keycloak-deployment.yaml

# Deploy API
kubectl apply -f deployment.yaml

# Check status
kubectl get pods -n financial-reports
kubectl get services -n financial-reports
```

## Monitoring and Maintenance

### Health Checks

```bash
# Check API health
curl http://localhost:3000/health

# Check liveness
curl http://localhost:3000/health/live

# Check readiness
curl http://localhost:3000/health/ready

# Expected response
{
  "status": "healthy",
  "version": "0.1.6",
  "timestamp": "2025-01-14T10:00:00.000Z",
  "services": {
    "keycloak": {
      "status": "healthy",
      "responseTime": 45
    }
  }
}
```

### Logging

```bash
# View API logs
docker-compose logs -f financial-reports-api

# View Keycloak logs
docker-compose logs -f keycloak

# View last 100 lines
docker-compose logs --tail=100 financial-reports-api

# Follow logs with timestamps
docker-compose logs -f -t financial-reports-api
```

### Metrics

```bash
# Container stats
docker stats

# Specific container
docker stats financial-reports-api

# Export metrics (if Prometheus is configured)
curl http://localhost:3000/metrics
```

### Updates

```bash
# Pull latest images
docker-compose pull

# Rebuild and restart
docker-compose up -d --build

# Rolling update (zero downtime)
docker-compose up -d --no-deps --build financial-reports-api
```

## Troubleshooting

### Common Issues

#### 1. Keycloak Not Starting

**Symptoms**: Keycloak container exits or restarts repeatedly

**Solutions**:
```bash
# Check logs
docker-compose logs keycloak

# Common issues:
# - Database connection failed
# - Port already in use
# - Insufficient memory

# Fix: Increase memory
docker-compose down
docker-compose up -d --scale keycloak=1 --memory=2g
```

#### 2. API Cannot Connect to Keycloak

**Symptoms**: Authentication failures, JWKS errors

**Solutions**:
```bash
# Check network connectivity
docker-compose exec financial-reports-api ping keycloak

# Verify Keycloak is healthy
curl http://localhost:8080/health/ready

# Check JWKS endpoint
curl http://localhost:8080/realms/financial-reports/protocol/openid-connect/certs

# Verify environment variables
docker-compose exec financial-reports-api env | grep KEYCLOAK
```

#### 3. Authentication Token Errors

**Symptoms**: 401 Unauthorized, invalid token errors

**Solutions**:
```bash
# Verify token is valid
echo $TOKEN | cut -d'.' -f2 | base64 -d | jq

# Check token expiration
# exp claim should be in the future

# Get new token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/financial-reports/protocol/openid-connect/token \
  -d "client_id=financial-reports-api" \
  -d "client_secret=financial-reports-api-secret" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq -r '.access_token')
```

#### 4. Port Conflicts

**Symptoms**: Cannot start services, port already in use

**Solutions**:
```bash
# Check what's using the port
lsof -i :3000
lsof -i :8080

# Change ports in docker-compose.yml
ports:
  - "3001:3000"  # Use different host port
```

#### 5. Permission Denied

**Symptoms**: Cannot write to volumes, permission errors

**Solutions**:
```bash
# Fix volume permissions
sudo chown -R 1001:1001 ./volumes

# Or run with user
docker-compose run --user $(id -u):$(id -g) financial-reports-api
```

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
docker-compose exec financial-reports-api \
  sh -c 'export LOG_LEVEL=debug && node dist/main.js'

# Or update docker-compose.yml
environment:
  LOG_LEVEL: debug
```

### Clean Restart

```bash
# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes data)
docker-compose down -v

# Remove images
docker-compose down --rmi all

# Clean build
docker-compose build --no-cache

# Start fresh
docker-compose up -d
```

## Security Best Practices

1. **Change Default Passwords**: Update all default credentials
2. **Use HTTPS**: Enable TLS for all external communication
3. **Secure Secrets**: Use Docker secrets or external secret management
4. **Network Isolation**: Use Docker networks to isolate services
5. **Regular Updates**: Keep base images and dependencies updated
6. **Audit Logging**: Enable and monitor audit logs
7. **Rate Limiting**: Configure appropriate rate limits
8. **CORS**: Restrict CORS origins to trusted domains
9. **Firewall**: Use firewall rules to restrict access
10. **Monitoring**: Set up monitoring and alerting

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Project README](README.md)
- [Authentication Integration Status](docs/AUTHENTICATION_INTEGRATION_STATUS.md)
