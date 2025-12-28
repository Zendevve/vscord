# AGENTS.md

**VSCord** — TypeScript + VS Code Extension API + Node.js + PostgreSQL + Redis

Follows [MCAF](https://mcaf.managed-code.com/)

---

## Conversations (Self-Learning)

Learn the user's habits, preferences, and working style. Extract rules from conversations, save to "## Rules to follow", and generate code according to the user's personal rules.

**Update requirement (core mechanism):**

Before doing ANY task, evaluate the latest user message.
If you detect a new rule, correction, preference, or change → update `AGENTS.md` first.
Only after updating the file you may produce the task output.
If no new rule is detected → do not update the file.

**When to extract rules:**

- prohibition words (never, don't, stop, avoid) → add NEVER rule
- requirement words (always, must, make sure, should) → add ALWAYS rule
- memory words (remember, keep in mind, note that) → add rule
- process words (the process is, the workflow is, we do it like) → add to workflow
- future words (from now on, going forward) → add permanent rule

**Preferences → add to Preferences section:**

- positive (I like, I prefer, this is better) → Likes
- negative (I don't like, I hate, this is bad) → Dislikes
- comparison (prefer X over Y, use X instead of Y) → preference rule

**Strong signal (add IMMEDIATELY):**

- swearing, frustration, anger, sarcasm → critical rule
- ALL CAPS, excessive punctuation → high priority
- same mistake twice → permanent emphatic rule
- user undoes your changes → understand why, prevent

---

## Rules to follow (Mandatory, no exceptions)

### Commands

- build: `npm run build`
- test: `npm test`
- test:unit: `npm run test:unit`
- test:integration: `npm run test:integration`
- format: `npm run format`
- lint: `npm run lint`
- dev: `npm run dev`

### Task Delivery (ALL TASKS)

- Read assignment, inspect code and docs before planning
- Write multi-step plan before implementation
- Implement code and tests together
- Run tests in layers: new → related suite → broader regressions
- After all tests pass: run format, then build
- Summarize changes and test results before marking complete
- Always run required builds and tests yourself; do not ask the user to execute them

### Documentation (ALL TASKS)

- All docs live in `docs/`
- Update feature docs when behaviour changes
- Update ADRs when architecture changes
- Templates: `docs/templates/ADR-Template.md`, `docs/templates/Feature-Template.md`
- Write feature docs BEFORE heavy coding starts

### Testing (ALL TASKS)

- Every behaviour change needs sufficient automated tests
- Each public API endpoint has at least one test
- Integration tests must exercise real flows end-to-end
- Prefer integration/API/UI tests over unit tests
- No mocks for internal systems (DB, queues, caches) — use containers
- Mocks only for external third-party systems (GitHub API via recorded fixtures)
- Never delete or weaken a test to make it pass
- Check code coverage to find gaps

### Autonomy

- Start work immediately — no permission seeking
- Questions only for architecture blockers not covered by ADR
- Report only when task is complete

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- No magic literals — extract to constants, enums, config
- Use interfaces for all data contracts
- Document public APIs with JSDoc

### Architecture Principles (CRITICAL)

- O(K) scalability, NOT O(N²) — use pub/sub for updates
- Stateless server design — Redis for session state
- Delta updates only — never broadcast full user lists
- Real containers for testing — PostgreSQL, Redis via Docker Compose

### Critical (NEVER violate)

- Never commit secrets, keys, connection strings
- Never mock internal systems in integration tests
- Never skip tests to make PR green
- Never force push to main
- Never approve or merge (human decision)
- Never broadcast full user list — always use delta updates

### Boundaries

**Always:**

- Read AGENTS.md and docs before editing code
- Run tests before commit
- Write feature doc before implementing feature

**Ask first:**

- Changing public API contracts
- Adding new dependencies
- Modifying database schema
- Deleting code files
- Changes that affect WebSocket protocol

---

## Preferences

### Likes

- Modern, stunning UI with rich aesthetics
- Dark mode themes with subtle gradients
- Clean, modular code architecture
- Comprehensive documentation
- Type-safe code with strict TypeScript

### Dislikes

- Basic/plain tree views (prefer rich dashboards)
- O(N²) algorithms
- Magic numbers without constants
- Mocking internal systems
- SQLite for production (use PostgreSQL)
