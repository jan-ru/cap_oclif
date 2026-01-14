# Coolify Deployment Guide for Financial Reports CLI

This guide provides step-by-step instructions for deploying the Financial Reports CLI application with Keycloak authentication on a Hetzner Ubuntu server managed by Coolify.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Coolify Setup](#coolify-setup)
3. [Deploy Keycloak](#deploy-keycloak)
4. [Deploy Financial Reports API](#deploy-financial-reports-api)
5. [Configure Domain and SSL](#configure-domain-and-ssl)
6. [Environment Configuration](#environment-configuration)
7. [Monitoring and Maintenance](#monitoring-and-maintenance)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Hetzner Server Requirements

- **Server Type**: Ubuntu 22.04 LTS or newer
- **Minimum Specs**: 
  - 2 vCPUs
  - 4GB RAM
  - 40GB SSD
- **Recommended**: 
  - 4 vCPUs
  - 8GB RAM
  - 80GB SSD
- **Network**: Public IPv4 address

### Domain Setup

- Domain name pointed to your Hetzner server IP
- Subdomains configured:
  - `api.yourdomain.com` → Financial Reports API
  - `auth.yourdomain.com` → Keycloak

### Coolify Installation

If Coolify is not yet installed on your Hetzner server:

```bash
# SSH into your Hetzner server
ssh root@your-server-ip

# Install Coolify (one-line installer)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Access Coolify at http://your-server-ip:8000
```

## Coolify Setup

### 1. Initial Coolify Configuration

1. Access Coolify web interface: `http://your-server-ip:8000`
2. Complete initial setup wizard
3. Set admin password
4. Configure your server settings

### 2. Create a New Project

1. Navigate to **Projects** → **New Project**
2. Name: `financial-reports`
3. Description: `Financial Reports CLI with Keycloak Authentication`
4. Click **Create**

### 3. Add Environment

1. Inside your project, click **New Environment**
2. Name: `production`
3. Click **Create**

## Deploy Keycloak

### 1. Create Keycloak Service

1. In your environment, click **New Resource** → **Docker Compose**
2. Name: `keycloak`
3. Paste the following Docker Compose configuration:

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
      # Database
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: ${POSTGRES_PASSWORD}
      
      # Admin credentials
      KEYCLOAK_ADMIN: ${KEYCLOAK_ADMIN_USER}
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD}
      
      # Hostname configuration
      KC_HOSTNAME: ${KEYCLOAK_HOSTNAME}
      KC_HOSTNAME_STRICT: "true"
      KC_HOSTNAME_STRICT_HTTPS: "true"
      
      # Proxy configuration (for Coolify reverse proxy)
      KC_PROXY: edge
      KC_HTTP_ENABLED: "true"
      
      # Logging
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
    driver: local
```

### 2. Configure Keycloak Environment Variables

In Coolify, add these environment variables:

```bash
# Database
POSTGRES_PASSWORD=<generate-secure-password>

# Keycloak Admin
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=<generate-secure-password>

# Hostname (your domain)
KEYCLOAK_HOSTNAME=auth.yourdomain.com
```

**⚠️ Important**: Use strong, randomly generated passwords!

```bash
# Generate secure passwords
openssl rand -base64 32
```

### 3. Configure Domain for Keycloak

1. In Coolify, go to your Keycloak service
2. Navigate to **Domains** tab
3. Add domain: `auth.yourdomain.com`
4. Enable **HTTPS** (Let's Encrypt)
5. Click **Save**

### 4. Deploy Keycloak

1. Click **Deploy** button
2. Wait for deployment to complete (2-3 minutes)
3. Check logs for any errors
4. Access Keycloak at `https://auth.yourdomain.com`

### 5. Import Realm Configuration

1. Login to Keycloak Admin Console: `https://auth.yourdomain.com`
2. Navigate to **Realm Settings** → **Action** → **Partial Import**
3. Upload `docker/keycloak/realm-export.json` from your repository
4. Select all resources to import
5. Click **Import**

Alternatively, create the realm manually:

1. Click **Create Realm**
2. Name: `financial-reports`
3. Create clients, users, and roles as needed

## Deploy Financial Reports API

### 1. Create API Service

1. In your environment, click **New Resource** → **Docker Compose**
2. Name: `financial-reports-api`
3. Paste the following configuration:

```yaml
version: '3.8'

services:
  financial-reports-api:
    build:
      context: https://github.com/jan-ru/financial-reports-cli.git#main
      dockerfile: Dockerfile
    
    environment:
      # Application
      APP_MODE: api
      NODE_ENV: production
      PORT: 3000
      HOST: 0.0.0.0
      
      # Keycloak Authentication
      KEYCLOAK_URL: https://auth.yourdomain.com
      KEYCLOAK_REALM: financial-reports
      KEYCLOAK_CLIENT_ID: financial-reports-api
      KEYCLOAK_CLIENT_SECRET: ${KEYCLOAK_CLIENT_SECRET}
      
      # JWT Configuration
      JWT_ISSUER: https://auth.yourdomain.com/realms/financial-reports
      JWT_AUDIENCE: financial-reports-api
      JWT_ALGORITHMS: RS256
      JWT_CLOCK_TOLERANCE: 30
      
      # JWKS Configuration
      JWKS_CACHE_TIMEOUT: 3600000
      JWKS_RATE_LIMIT: 10
      JWKS_REQUESTS_PER_MINUTE: 5
      
      # Rate Limiting
      RATE_LIMIT_WINDOW_MS: 900000
      RATE_LIMIT_MAX_REQUESTS: 100
      
      # Security
      REQUIRE_HTTPS: "true"
      ALLOWED_ORIGINS: https://api.yourdomain.com,https://auth.yourdomain.com
      
      # Logging
      LOG_LEVEL: info
      AUDIT_ENABLED: "true"
      INCLUDE_TOKEN_CLAIMS: "false"
      
      # OData Service
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

### 2. Configure API Environment Variables

Add these environment variables in Coolify:

```bash
# Keycloak Client Secret (from Keycloak admin console)
KEYCLOAK_CLIENT_SECRET=<your-client-secret>

# OData Service URL (your backend service)
ODATA_SERVICE_URL=http://your-odata-service:4004/odata/v4/financial
```

To get the client secret from Keycloak:
1. Login to Keycloak Admin Console
2. Navigate to **Clients** → **financial-reports-api**
3. Go to **Credentials** tab
4. Copy the **Client Secret**

### 3. Configure Domain for API

1. In Coolify, go to your API service
2. Navigate to **Domains** tab
3. Add domain: `api.yourdomain.com`
4. Enable **HTTPS** (Let's Encrypt)
5. Click **Save**

### 4. Deploy API

1. Click **Deploy** button
2. Wait for build and deployment (3-5 minutes)
3. Check logs for any errors
4. Access API at `https://api.yourdomain.com/health`

## Configure Domain and SSL

### DNS Configuration

Ensure your DNS records are properly configured:

```
# A Records
api.yourdomain.com    → your-server-ip
auth.yourdomain.com   → your-server-ip

# Optional: Wildcard
*.yourdomain.com      → your-server-ip
```

### SSL Certificates

Coolify automatically provisions Let's Encrypt SSL certificates when you:
1. Add a domain to a service
2. Enable HTTPS
3. Ensure DNS is properly configured

**Troubleshooting SSL**:
- Verify DNS propagation: `dig api.yourdomain.com`
- Check Coolify logs for certificate errors
- Ensure ports 80 and 443 are open on your server

## Environment Configuration

### Production Environment Variables

Create a `.env` file for reference (not used directly in Coolify):

```bash
# Application
APP_MODE=api
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Keycloak
KEYCLOAK_URL=https://auth.yourdomain.com
KEYCLOAK_REALM=financial-reports
KEYCLOAK_CLIENT_ID=financial-reports-api
KEYCLOAK_CLIENT_SECRET=<from-keycloak-admin>

# JWT
JWT_ISSUER=https://auth.yourdomain.com/realms/financial-reports
JWT_AUDIENCE=financial-reports-api
JWT_ALGORITHMS=RS256
JWT_CLOCK_TOLERANCE=30

# JWKS
JWKS_CACHE_TIMEOUT=3600000
JWKS_RATE_LIMIT=10
JWKS_REQUESTS_PER_MINUTE=5

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Security
REQUIRE_HTTPS=true
ALLOWED_ORIGINS=https://api.yourdomain.com,https://auth.yourdomain.com

# Logging
LOG_LEVEL=info
AUDIT_ENABLED=true
INCLUDE_TOKEN_CLAIMS=false

# OData Service
ODATA_SERVICE_URL=http://your-odata-service:4004/odata/v4/financial
```

### Keycloak Realm Configuration

Update the realm configuration for production:

1. **Frontend URL**: Set to `https://auth.yourdomain.com`
2. **Valid Redirect URIs**: 
   - `https://api.yourdomain.com/*`
   - `https://yourdomain.com/*`
3. **Web Origins**: 
   - `https://api.yourdomain.com`
   - `https://yourdomain.com`
4. **SSL Required**: Set to `all requests`

## Monitoring and Maintenance

### Health Checks

Coolify automatically monitors your services using the health check endpoints:

```bash
# API Health
curl https://api.yourdomain.com/health

# Keycloak Health
curl https://auth.yourdomain.com/health/ready
```

### View Logs

In Coolify:
1. Navigate to your service
2. Click **Logs** tab
3. View real-time logs
4. Filter by service (API, Keycloak, PostgreSQL)

### Monitoring Dashboard

Coolify provides built-in monitoring:
- CPU usage
- Memory usage
- Network traffic
- Disk usage
- Container status

### Backup Strategy

#### Database Backups

Set up automated PostgreSQL backups:

```bash
# SSH into your server
ssh root@your-server-ip

# Create backup script
cat > /root/backup-keycloak.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/root/backups/keycloak"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Get container ID
CONTAINER=$(docker ps --filter "name=postgres" --format "{{.ID}}")

# Backup database
docker exec $CONTAINER pg_dump -U keycloak keycloak | gzip > $BACKUP_DIR/keycloak_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "keycloak_*.sql.gz" -mtime +7 -delete

echo "Backup completed: keycloak_$DATE.sql.gz"
EOF

chmod +x /root/backup-keycloak.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /root/backup-keycloak.sh") | crontab -
```

#### Realm Configuration Backup

Export realm configuration regularly:

```bash
# Export realm via API
curl -X GET https://auth.yourdomain.com/admin/realms/financial-reports \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > realm_backup_$(date +%Y%m%d).json
```

### Updates and Maintenance

#### Update Services

In Coolify:
1. Navigate to your service
2. Click **Redeploy** to pull latest image
3. Or update the image tag in Docker Compose
4. Click **Deploy**

#### Rolling Updates

For zero-downtime updates:
1. Deploy new version alongside old version
2. Test new version
3. Switch traffic to new version
4. Remove old version

## Troubleshooting

### Common Issues

#### 1. Service Won't Start

**Check logs in Coolify**:
1. Navigate to service
2. Click **Logs** tab
3. Look for error messages

**Common causes**:
- Port conflicts
- Missing environment variables
- Database connection issues
- Insufficient resources

#### 2. SSL Certificate Issues

**Symptoms**: HTTPS not working, certificate errors

**Solutions**:
```bash
# Verify DNS
dig api.yourdomain.com

# Check if ports are open
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Force certificate renewal in Coolify
# Navigate to service → Domains → Regenerate Certificate
```

#### 3. Keycloak Connection Errors

**Symptoms**: API cannot connect to Keycloak

**Solutions**:
```bash
# Test Keycloak connectivity
curl https://auth.yourdomain.com/health/ready

# Check JWKS endpoint
curl https://auth.yourdomain.com/realms/financial-reports/protocol/openid-connect/certs

# Verify environment variables in Coolify
# Ensure KEYCLOAK_URL uses https:// not http://
```

#### 4. Authentication Failures

**Symptoms**: 401 Unauthorized errors

**Solutions**:
1. Verify client secret matches Keycloak
2. Check JWT issuer URL is correct
3. Ensure realm name is correct
4. Verify user credentials
5. Check token expiration

```bash
# Get new token
TOKEN=$(curl -s -X POST https://auth.yourdomain.com/realms/financial-reports/protocol/openid-connect/token \
  -d "client_id=financial-reports-api" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=password" \
  -d "username=testuser" \
  -d "password=test123" \
  | jq -r '.access_token')

# Test API with token
curl -H "Authorization: Bearer $TOKEN" https://api.yourdomain.com/api/reports
```

#### 5. High Memory Usage

**Symptoms**: Server running out of memory

**Solutions**:
```bash
# Check memory usage
free -h
docker stats

# Restart services
# In Coolify: Navigate to service → Restart

# Increase server resources if needed
# Upgrade Hetzner server plan
```

### Debug Mode

Enable debug logging:

1. In Coolify, edit service environment variables
2. Set `LOG_LEVEL=debug`
3. Redeploy service
4. Check logs for detailed information

### Getting Help

1. **Coolify Logs**: Check service logs in Coolify dashboard
2. **Server Logs**: SSH into server and check Docker logs
3. **Keycloak Logs**: Check Keycloak admin console events
4. **API Logs**: Check application logs via Coolify

```bash
# SSH into server
ssh root@your-server-ip

# View Docker logs
docker logs <container-id> --tail 100 -f

# View all containers
docker ps -a
```

## Security Best Practices

### 1. Firewall Configuration

```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp  # Coolify dashboard
sudo ufw enable
```

### 2. Secure Passwords

- Use strong, randomly generated passwords
- Store passwords in a password manager
- Never commit passwords to git
- Rotate passwords regularly

### 3. Regular Updates

```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Update Docker
sudo apt install docker-ce docker-ce-cli containerd.io

# Update Coolify
# Coolify auto-updates, or manually:
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

### 4. Monitoring and Alerts

- Set up Coolify notifications (email, Slack, Discord)
- Monitor resource usage
- Set up uptime monitoring (UptimeRobot, Pingdom)
- Enable audit logging

### 5. Backup Strategy

- Daily database backups
- Weekly realm configuration exports
- Store backups off-server (S3, Backblaze B2)
- Test restore procedures regularly

## Performance Optimization

### 1. Resource Allocation

Adjust container resources in Coolify:
- CPU limits
- Memory limits
- Restart policies

### 2. Caching

- JWKS caching is enabled by default (1 hour)
- Consider adding Redis for session caching
- Use CDN for static assets

### 3. Database Optimization

```bash
# PostgreSQL tuning
# Edit postgresql.conf in container
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
```

### 4. Monitoring

- Use Coolify's built-in monitoring
- Consider adding Prometheus + Grafana
- Set up log aggregation (Loki, ELK)

## Additional Resources

- [Coolify Documentation](https://coolify.io/docs)
- [Hetzner Cloud Docs](https://docs.hetzner.com/cloud/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Project README](../README.md)
- [Docker Deployment Guide](DOCKER_DEPLOYMENT.md)
- [Development Guide](DEVELOPMENT.md)

## Support

For issues specific to:
- **Coolify**: [Coolify Discord](https://discord.gg/coolify)
- **Hetzner**: [Hetzner Support](https://www.hetzner.com/support)
- **Application**: [GitHub Issues](https://github.com/jan-ru/financial-reports-cli/issues)
