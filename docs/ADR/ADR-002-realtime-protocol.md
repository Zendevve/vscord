# ADR-002: Real-time Protocol Design

**Status**: Proposed
**Date**: 2024-12-28
**Owner**: Dev
**Related Features**: `docs/Features/realtime-presence.md`
**Supersedes**: N/A

---

## Context

Competitor uses O(N²) broadcast where every status change sends full user lists to all clients.
- 100 users = 10,000 operations per change
- 1000 users = 1,000,000 operations per change (crashes)

We need a protocol that scales linearly with friend count, not total users.

---

## Decision

Implement **Pub/Sub Delta Protocol**:

1. **Channel-per-user model**: Each user has a Redis channel `presence:{username}`
2. **Subscribe on connect**: When A connects, server subscribes A's socket to channels of all friends
3. **Delta updates only**: Status changes publish only changed fields, not full objects
4. **Compact message format**: Short keys (`t`, `s`, `a`, `p`, `l`) to minimize bandwidth

### Message Types

| Type | Code | Direction | Purpose |
|------|------|-----------|---------|
| Heartbeat | `hb` | Bidirectional | Keep-alive |
| Token | `token` | S→C | Resume token for reconnection |
| Sync | `sync` | S→C | Initial full state on connect |
| Update | `u` | S→C | Delta status change |
| Online | `o` | S→C | User came online |
| Offline | `x` | S→C | User went offline |
| Login | `login` | C→S | Authentication |
| StatusUpdate | `statusUpdate` | C→S | Client status change |

### Example Flow

```
Client A connects:
  → login { username: "alice", token: "..." }
  ← sync { users: [{ username: "bob", s: "Online", a: "Coding", p: "MyApp", l: "TS" }] }

Bob changes status:
  Server publishes to presence:bob
  Redis notifies Alice's connection
  ← { t: "u", id: "bob", a: "Debugging" }  // Only changed field

Bob goes offline:
  ← { t: "x", id: "bob", ts: 1703789400000 }
```

Key points:

- **O(K) complexity**: Update cost = number of friends of updater
- **98% bandwidth reduction**: Delta vs full list
- **No flapping**: Resume tokens prevent offline/online spam

---

## Alternatives Considered

### Full Broadcast (Competitor Approach)
- **Pros**: Simple implementation
- **Cons**: O(N²), crashes at 100+ users
- **Rejected because**: Our main competitive advantage

### GraphQL Subscriptions
- **Pros**: Type-safe, standard
- **Cons**: Heavier, overkill for simple status
- **Rejected because**: WebSocket + JSON is lighter

### MessagePack (Binary)
- **Pros**: 60% smaller payload
- **Cons**: Adds complexity, debugging harder
- **Rejected because**: Future optimization, not MVP blocker

---

## Consequences

### Positive
- 1000x fewer operations at scale
- 98% bandwidth reduction
- Ready for horizontal scaling with Redis

### Negative / Risks
- **Redis dependency** — Mitigation: Redis is reliable, required anyway
- **Channel cleanup** — Mitigation: Unsubscribe on disconnect, TTL on presence

---

## Verification

### Objectives
- Prove O(K) complexity with metric logging
- Verify non-followers don't receive updates
- Stress test with 100 concurrent connections

### New Tests

| ID | Scenario | Level | Expected |
|----|----------|-------|----------|
| TST-PROTO-001 | Delta contains only changed fields | Integration | `u` message has 1-2 fields |
| TST-PROTO-002 | Non-follower isolation | Integration | No message to non-followers |
| TST-PROTO-003 | 100 user stress test | Load | No crashes, sub-100ms latency |

---

## Filing Checklist
- [x] Filed under `docs/ADR/ADR-002-realtime-protocol.md`
- [x] Status: Proposed
- [x] Links to realtime-presence feature
