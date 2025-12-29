# Feature: Rich Status / Custom Presence

**Status**: Proposed
**Owner**: Dev
**Priority**: Medium (Phase 2)

---

## Purpose

Allow users to set custom status messages like Discord:
- Custom text (e.g., "Working on a deadline")
- Optional emoji
- Auto-expiration (clear after X hours)

---

## Business Rules

1. **Text limit** — Max 128 characters
2. **Emoji support** — Single emoji prefix (optional)
3. **Expiration** — 1h, 4h, 8h, 24h, or never
4. **Visibility** — Follows privacy settings
5. **Override** — Custom status overrides activity detection

---

## Data Model

```typescript
interface CustomStatus {
  text: string;        // "In a meeting"
  emoji?: string;      // "📅"
  expiresAt?: number;  // Unix timestamp
}
```

Database addition:
```sql
ALTER TABLE users ADD COLUMN custom_status JSONB DEFAULT NULL;
```

---

## Protocol

### Set Custom Status
```json
{
  "t": "setStatus",
  "text": "Deep work mode",
  "emoji": "🧠",
  "expiresIn": 14400000  // 4 hours in ms
}
```

### Delta Update with Custom Status
```json
{
  "t": "u",
  "id": "alice",
  "cs": { "text": "Deep work mode", "emoji": "🧠" }
}
```

---

## UI

### Status Bar
```
🧠 Deep work mode ✕ (click to clear)
```

### Set Status Dialog
- Emoji picker (recent + categories)
- Text input
- Duration dropdown
- Clear button

---

## Definition of Done

- [ ] Database schema updated
- [ ] Server handles setStatus message
- [ ] Expiration timer clears status
- [ ] Client shows custom status in sidebar
- [ ] Quick status picker in extension
