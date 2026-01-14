# Docker Health Check Configuration

This document provides examples for configuring health checks in various container orchestration platforms.

## Docker Compose

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

## Dockerfile

```dockerfile
FROM node:18-alpine

# Install curl for health checks
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

## Kubernetes Deployment

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
        - name: NODE_ENV
          value: "production"
        - name: ODATA_SERVICE_URL
          value: "http://odata-service:4004/odata/v4/financial"
        - name: KEYCLOAK_SERVICE_URL
          value: "http://keycloak:8080"
        
        # Liveness probe - checks if container is running
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        
        # Readiness probe - checks if container is ready to serve traffic
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        
        # Startup probe - gives container time to start up
        startupProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 12  # 60 seconds total
        
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
```

## Coolify Configuration

```yaml
# coolify.yaml
services:
  financial-reports-api:
    image: financial-reports-api:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      ODATA_SERVICE_URL: http://odata-service:4004/odata/v4/financial
      KEYCLOAK_SERVICE_URL: http://keycloak:8080
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
```

## Health Check Endpoints

### `/health`
- **Purpose**: Comprehensive health check including service dependencies
- **Use case**: General monitoring and alerting
- **Response codes**: 200 (healthy/degraded), 503 (unhealthy)

### `/health/live`
- **Purpose**: Liveness check - is the application running?
- **Use case**: Kubernetes liveness probe, container restart decisions
- **Response codes**: Always 200 when application is running

### `/health/ready`
- **Purpose**: Readiness check - is the application ready to serve traffic?
- **Use case**: Kubernetes readiness probe, load balancer routing decisions
- **Response codes**: 200 (ready), 503 (not ready)

## Configuration Options

The health check behavior can be configured via environment variables or API server configuration:

```javascript
const server = new ApiServer({
  healthCheck: {
    timeout: 5000,                    // Service check timeout (ms)
    enableServiceChecks: true,        // Enable dependency checks
    odataServiceUrl: process.env.ODATA_SERVICE_URL,
    keycloakServiceUrl: process.env.KEYCLOAK_SERVICE_URL,
  }
});
```

## Monitoring Integration

### Prometheus Metrics
The health endpoints can be scraped by Prometheus for monitoring:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'financial-reports-api'
    static_configs:
      - targets: ['financial-reports-api:3000']
    metrics_path: '/health'
    scrape_interval: 30s
```

### Alerting Rules
Example Prometheus alerting rules:

```yaml
groups:
  - name: financial-reports-api
    rules:
      - alert: FinancialReportsAPIDown
        expr: up{job="financial-reports-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Financial Reports API is down"
          
      - alert: FinancialReportsAPIDegraded
        expr: financial_reports_api_health_status == 1  # degraded
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Financial Reports API is degraded"
```

## Best Practices

1. **Use different endpoints for different purposes**:
   - `/health/live` for liveness probes
   - `/health/ready` for readiness probes
   - `/health` for comprehensive monitoring

2. **Configure appropriate timeouts**:
   - Liveness: Longer timeout, fewer retries
   - Readiness: Shorter timeout, more frequent checks

3. **Consider startup time**:
   - Use startup probes for applications with long initialization
   - Set appropriate `initialDelaySeconds`

4. **Monitor dependencies**:
   - Enable service checks for critical dependencies
   - Use degraded status for non-critical issues

5. **Resource limits**:
   - Set appropriate CPU and memory limits
   - Monitor resource usage during health checks