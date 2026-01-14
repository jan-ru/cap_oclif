# Coolify Quick Start Guide

Quick reference for deploying Financial Reports CLI on Hetzner with Coolify.

## Prerequisites Checklist

- [ ] Hetzner Ubuntu server (4GB RAM minimum)
- [ ] Coolify installed and accessible
- [ ] Domain name configured (DNS A records)
- [ ] Subdomains: `api.yourdomain.com`, `auth.yourdomain.com`

## Deployment Steps

### 1. Create Project in Coolify

```
Projects → New Project
Name: financial-reports
Environment: production
```

### 2. Deploy Keycloak

**New Resource → Docker Compose**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keycloak"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  keycloak:
    image: quay.io/keycloak/keycloak:23.0
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: ${POSTGRES_PASSWORD}
      KEYCLOAK_ADMIN: ${KEYCLOAK_ADMIN_USER}
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD}
      KC_HOSTNAME: ${KEYCLOAK_HOSTNAME}
      KC_HOSTNAME_STRICT: "true"
      KC_HOSTNAME_STRICT_HTTPS: "true"
      KC_PROXY: edge
      KC_HTTP_ENABLED: "true"
      KC_LOG_LEVEL: INFO
    command:
      - start
      - --optimized
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 90s
    restart: unless-stopped

volumes:
  postgres-data:
```

**Environment Variables:**
```bash
POSTGRES_PASSWORD=<generate-with: openssl rand -base64 32>
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<generate-with: openssl rand -base64 32>
KEYCLOAK_HOSTNAME=auth.yourdomain.com
```

**Domain:** `auth.yourdomain.com` (Enable HTTPS)

### 3. Configure Keycloak Realm

1. Access: `https://auth.yourdomain.com`
2. Login with admin credentials
3. Create realm: `financial-reports`
4. Create client: `financial-reports-api`
   - Client Authentication: ON
   - Service Accounts: ON
   - Copy Client Secret
5. Create test user: `testuser` / `test123`

### 4. Deploy Financial Reports API

**New Resource → Docker Compose**

```yaml
version: '3.8'
services:
  financial-reports-api:
    build:
      context: https://github.com/jan-ru/financial-reports-cli.git#main
      dockerfile: Dockerfile
    environment:
      APP_MODE: api
      NODE_ENV: production
      PORT: 3000
      HOST: 0.0.0.0
      KEYCLOAK_URL: https://auth.yourdomain.com
      KEYCLOAK_REALM: financial-reports
      KEYCLOAK_CLIENT_ID: financial-reports-api
      KEYCLOAK_CLIENT_SECRET: ${KEYCLOAK_CLIENT_SECRET}
      JWT_ISSUER: https://auth.yourdomain.com/realms/financial-reports
      JWT_AUDIENCE: financial-reports-api
      JWT_ALGORITHMS: RS256
      JWT_CLOCK_TOLERANCE: 30
      JWKS_CACHE_TIMEOUT: 3600000
      JWKS_RATE_LIMIT: 10
      JWKS_REQUESTS_PER_MINUTE: 5
      RATE_LIMIT_WINDOW_MS: 900000
      RATE_LIMIT_MAX_REQUESTS: 100
      REQUIRE_HTTPS: "true"
      ALLOWED_ORIGINS: https://api.yourdomain.com,https://auth.yourdomain.com
      LOG_LEVEL: info
      AUDIT_ENABLED: "true"
      INCLUDE_TOKEN_CLAIMS: "false"
      ODATA_SERVICE_URL: ${ODATA_SERVICE_URL}
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
```

**Environment Variables:**
```bash
KEYCLOAK_CLIENT_SECRET=<from-keycloak-admin-console>
ODATA_SERVICE_URL=http://your-odata-service:4004/odata/v4/financial
```

**Domain:** `api.yourdomain.com` (Enable HTTPS)

## Testing

### 1. Health Checks

```bash
# API Health
curl https://api.yourdomain.com/health

# Keycloak Health
curl https://auth.yourdomain.com/health/ready
```

### 2. Get Access Token

```bash
TOKEN=$(curl -s -X POST https://auth.yourdomain.com/realms/financial-reports/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=financial-reports-api" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq -r '.access_token')

echo $TOKEN
```

### 3. Test API

```bash
# Test authenticated endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://api.yourdomain.com/api/reports

# Expected: 200 OK
```

## Common Issues

### SSL Certificate Not Working

```bash
# Check DNS
dig api.yourdomain.com

# Ensure ports are open
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Regenerate certificate in Coolify
Service → Domains → Regenerate Certificate
```

### Keycloak Not Accessible

```bash
# Check service status in Coolify
# View logs for errors
# Verify environment variables are set
# Ensure PostgreSQL is healthy
```

### Authentication Fails

```bash
# Verify client secret matches
# Check JWT issuer URL (must use https://)
# Ensure realm name is correct
# Test token generation manually
```

## Monitoring

### Coolify Dashboard

- CPU/Memory usage
- Container status
- Logs (real-time)
- Health checks

### Manual Checks

```bash
# SSH into server
ssh root@your-server-ip

# View containers
docker ps

# View logs
docker logs <container-id> --tail 100 -f

# Check resources
docker stats
```

## Backup

```bash
# Create backup script
cat > /root/backup-keycloak.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/root/backups/keycloak"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
CONTAINER=$(docker ps --filter "name=postgres" --format "{{.ID}}")
docker exec $CONTAINER pg_dump -U keycloak keycloak | gzip > $BACKUP_DIR/keycloak_$DATE.sql.gz
find $BACKUP_DIR -name "keycloak_*.sql.gz" -mtime +7 -delete
EOF

chmod +x /root/backup-keycloak.sh

# Schedule daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /root/backup-keycloak.sh") | crontab -
```

## Security Checklist

- [ ] Change all default passwords
- [ ] Enable HTTPS on all domains
- [ ] Configure firewall (UFW)
- [ ] Set up automated backups
- [ ] Enable Coolify notifications
- [ ] Configure rate limiting
- [ ] Restrict CORS origins
- [ ] Enable audit logging
- [ ] Regular security updates

## Next Steps

1. Configure production users in Keycloak
2. Set up monitoring and alerts
3. Configure backup strategy
4. Test disaster recovery
5. Document custom configurations
6. Set up CI/CD pipeline

## Resources

- [Full Deployment Guide](COOLIFY_DEPLOYMENT.md)
- [Docker Deployment](DOCKER_DEPLOYMENT.md)
- [Coolify Docs](https://coolify.io/docs)
- [Keycloak Docs](https://www.keycloak.org/documentation)
