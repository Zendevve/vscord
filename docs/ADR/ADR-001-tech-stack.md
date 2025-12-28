# ADR-001: Technology Stack Selection

**Status**: Proposed
**Date**: 2024-12-28
**Owner**: Dev
**Related Features**: All
**Supersedes**: N/A

---

## Context

We are building a VS Code extension for real-time social presence. Need to select:
- Server runtime and language
- Database
- Cache/Pub-Sub system
- Testing framework
- Build tools

**Constraints**:
- Must scale to 1000+ concurrent users (10x better than competitor)
- Must support O(K) pub/sub (not O(N²) broadcast)
- Must work with VS Code extension API
- Must enable integration testing with real containers

---

## Decision

Use the following stack:

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Server Runtime** | Node.js 20 LTS | Same ecosystem as VS Code, excellent WebSocket support |
| **Language** | TypeScript (strict) | Type safety, shared types between client/server |
| **Database** | PostgreSQL 16 | ACID, handles concurrent connections, production-focused |
| **Cache/Pub-Sub** | Redis 7 | Required for O(K) pub/sub and session storage |
| **WebSocket** | ws library | Battle-tested, used by competitor |
| **GitHub API** | @octokit/rest | Official GitHub SDK |
| **Testing** | Vitest + Testcontainers | Fast, native TS, real containers |
| **Build** | esbuild | Fast bundling for extension |

Key points:

- **PostgreSQL over SQLite** — handles concurrent writes, scales horizontally
- **Redis is REQUIRED** — pub/sub architecture cannot work without it
- **Vitest over Jest** — native ESM, faster, better TS support

---

## Alternatives Considered

### SQLite (Database)
- **Pros**: Simpler deployment, file-based, no separate server
- **Cons**: Single-writer bottleneck, limited concurrent connections
- **Rejected because**: Competitor's limitation (100 users max), doesn't scale

### Bun Runtime
- **Pros**: Faster startup, built-in bundler
- **Cons**: Newer, potential compatibility issues with VS Code API
- **Rejected because**: Risk of edge cases, Node.js is proven

### Socket.io
- **Pros**: Auto-reconnection, fallback transports
- **Cons**: Larger bundle, complexity we don't need
- **Rejected because**: Raw ws + custom reconnection is lighter

---

## Consequences

### Positive
- 10x+ scalability improvement over competitor
- Type safety across entire codebase
- Real integration testing with containers

### Negative / Risks
- **PostgreSQL requires hosting** — Mitigation: Docker for dev, cloud PG for prod
- **Redis adds complexity** — Mitigation: Required for pub/sub, mandatory anyway

---

## Impact

### Code
- Server: `src/server/` with PostgreSQL + Redis clients
- Extension: `src/client/` with WebSocket client
- Shared: `src/shared/` for TypeScript interfaces

### Data / Configuration
- **DB_URL**: PostgreSQL connection string
- **REDIS_URL**: Redis connection string
- Both required for server to start

### Documentation
- Update `docs/Development/setup.md` with container requirements
- Update `docs/Testing/strategy.md` with Testcontainers approach

---

## Verification

### Test Environment
- Docker Compose with PostgreSQL + Redis
- Testcontainers for integration tests

### Test Commands
- build: `npm run build`
- test: `npm test`
- format: `npm run format`

---

## Filing Checklist
- [x] Filed under `docs/ADR/ADR-001-tech-stack.md`
- [x] Status: Proposed (pending user approval)
- [x] Links to features included
