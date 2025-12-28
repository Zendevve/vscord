# VSCord

> Real-time coding presence for your GitHub network. See what your friends are working on, right in VS Code.

## Features

- 🔐 **GitHub OAuth** — Authenticate with your GitHub account
- 👥 **Real-time Presence** — See who's online from your network
- 🔒 **Privacy Controls** — Control who can see your activity
- ⚡ **O(K) Scalability** — Built for thousands of users

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for development)

### Development

```bash
# Install dependencies
npm install

# Start containers (PostgreSQL, Redis)
docker-compose up -d

# Build
npm run build

# Run tests
npm test

# Launch extension (F5 in VS Code)
```

### Server

```bash
# Start server
npm run dev:server
```

## Architecture

- **Client**: VS Code Extension (TypeScript)
- **Server**: Node.js WebSocket Server
- **Database**: PostgreSQL
- **Cache/Pub-Sub**: Redis

See [docs/Architecture/](./docs/Architecture/) for details.

## Documentation

- [Development Setup](./docs/Development/setup.md)
- [Testing Strategy](./docs/Testing/strategy.md)
- [ADRs](./docs/ADR/)
- [Features](./docs/Features/)

## License

MIT
