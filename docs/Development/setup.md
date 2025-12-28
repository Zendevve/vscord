# Development Setup

## Prerequisites

- Node.js 20 LTS
- Docker Desktop
- VS Code 1.85+
- Git

---

## Quick Start

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/vscord.git
cd vscord

# Install dependencies
npm install

# Start test containers
docker-compose up -d

# Run tests
npm test

# Build extension
npm run build

# Launch extension (F5 in VS Code)
```

---

## Environment Variables

Create `.env` file in root:

```env
# Database
DATABASE_URL=postgresql://test:test@localhost:5433/vscord_test

# Redis
REDIS_URL=redis://localhost:6380

# Server
PORT=8080
NODE_ENV=development

# GitHub (optional for dev)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
```

---

## Project Structure

```
vscord/
├── src/
│   ├── client/           # VS Code extension
│   │   ├── extension.ts  # Entry point
│   │   ├── services/     # Auth, WS client
│   │   └── providers/    # Sidebar views
│   ├── server/           # WebSocket server
│   │   ├── index.ts      # Entry point
│   │   ├── database/     # PostgreSQL
│   │   ├── services/     # Pub/sub, auth
│   │   └── handlers/     # Message handlers
│   └── shared/           # Shared types
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── Features/
│   ├── ADR/
│   └── Testing/
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── AGENTS.md
```

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build extension and server |
| `npm run dev` | Watch mode |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

---

## Debugging

### Extension
1. Open project in VS Code
2. Press F5 to launch Extension Development Host
3. Check Output panel → "VSCord" for logs

### Server
```bash
# Start with debug logging
DEBUG=vscord:* npm run dev:server
```
