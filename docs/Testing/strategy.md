# Testing Strategy

## Overview

VSCord follows MCAF testing principles:
- **Integration tests first** — Cover real flows with real containers
- **No mocks for internal systems** — PostgreSQL and Redis run in Docker
- **Tests verify behavior** — Not just that code executes

---

## Test Levels

| Level | Purpose | Tools | Container Required |
|-------|---------|-------|-------------------|
| **Unit** | Pure functions, algorithms | Vitest | No |
| **Integration** | Component interactions | Vitest + Testcontainers | Yes |
| **E2E** | Full user flows | VS Code Extension Test | Yes |

---

## Test Structure

```
tests/
├── unit/
│   ├── protocol.test.ts      # Message parsing
│   └── privacy.test.ts       # Visibility logic
├── integration/
│   ├── auth.test.ts          # GitHub auth flow
│   ├── presence.test.ts      # Real-time updates
│   ├── pubsub.test.ts        # Redis pub/sub
│   └── database.test.ts      # PostgreSQL operations
└── e2e/
    └── extension.test.ts     # Full extension flow
```

---

## Test Environment

### Docker Compose

```yaml
# docker-compose.test.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: vscord_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"

  redis:
    image: redis:7
    ports:
      - "6380:6379"
```

### Running Tests

```bash
# Start containers
docker-compose -f docker-compose.test.yml up -d

# Run all tests
npm test

# Run specific suite
npm run test:unit
npm run test:integration
```

---

## Coverage Goals

| Module | Minimum Coverage | Focus Areas |
|--------|-----------------|-------------|
| Protocol handlers | 90% | All message types |
| Privacy logic | 95% | All visibility modes |
| Auth flow | 80% | Success + failure paths |
| Database | 70% | CRUD operations |

Coverage is a tool for finding gaps, not a target to game.

---

## Test Naming Convention

```
TST-{FEATURE}-{NUMBER}: {Description}

Examples:
TST-AUTH-001: Happy path authentication
TST-PRESENCE-002: Non-follower isolation
TST-PRIVACY-003: Invisible mode
```

---

## CI Pipeline

```yaml
# .github/workflows/test.yml
jobs:
  test:
    services:
      postgres:
        image: postgres:16
      redis:
        image: redis:7
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```
