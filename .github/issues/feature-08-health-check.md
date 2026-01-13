# Feature: Add Health Check Endpoint for Containers

## Feature Overview
Implement health check endpoints for container orchestration platforms to monitor application status and enable automated restart/scaling decisions.

## Business Value
- **Operational Reliability**: Enable automated health monitoring
- **Container Orchestration**: Support Kubernetes, Docker Swarm, Coolify
- **Service Discovery**: Allow load balancers to route traffic appropriately
- **Monitoring Integration**: Enable integration with monitoring systems

## User Story
As a DevOps engineer, I want health check endpoints so that container orchestration platforms can automatically monitor and manage the financial reports service.

## Requirements Reference
**Validates Requirements:** 7.5, 8.3, 8.7

## Acceptance Criteria
- [ ] Implement `/health` endpoint returning 200 OK when service is healthy
- [ ] Implement `/health/ready` endpoint for readiness checks
- [ ] Implement `/health/live` endpoint for liveness checks
- [ ] Health checks validate OData service connectivity
- [ ] Health checks validate Keycloak authentication service connectivity
- [ ] Return structured JSON response with service status details
- [ ] Support configurable health check timeouts
- [ ] Include service version and build information in health response
- [ ] Handle partial service degradation (warn vs error states)
- [ ] Provide detailed error information for debugging

## Technical Implementation
- Create health check middleware for Express.js
- Implement service dependency checks (OData, Keycloak)
- Add health check configuration options
- Create health status aggregation logic
- Add metrics collection for health check performance

## Health Check Response Format
```json
{
  "status": "healthy|degraded|unhealthy",
  "version": "0.1.2",
  "timestamp": "2025-01-13T10:30:00Z",
  "services": {
    "odata": {
      "status": "healthy",
      "responseTime": 45
    },
    "keycloak": {
      "status": "healthy", 
      "responseTime": 23
    }
  }
}
```

## Container Integration
- Configure Docker HEALTHCHECK instruction
- Support Kubernetes readiness/liveness probes
- Enable Coolify health monitoring
- Provide health check configuration examples

## Testing Strategy
- Unit tests for health check logic
- Integration tests with service dependencies
- Container health check validation
- Load testing health check performance

## Definition of Done
- [ ] Health check endpoints implemented and tested
- [ ] Container health check configuration documented
- [ ] Service dependency validation working
- [ ] Monitoring integration examples provided
- [ ] Performance benchmarks established