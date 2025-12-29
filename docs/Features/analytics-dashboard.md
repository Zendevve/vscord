# Feature: Analytics Dashboard

**Status**: Proposed
**Owner**: Dev
**Priority**: Medium (Phase 2)

---

## Purpose

Track and visualize coding activity over time:
- Time per project
- Time per language
- Daily/weekly activity heatmap
- Productivity insights

---

## Business Rules

1. **Local storage** — Analytics stored on client only (privacy)
2. **Opt-in** — User must enable analytics tracking
3. **Aggregation** — 5-minute buckets to reduce storage
4. **Retention** — 90 days sliding window

---

## Data Structure

```typescript
interface ActivityRecord {
  date: string;        // "2024-12-29"
  hour: number;        // 0-23
  project: string;
  language: string;
  minutes: number;     // Aggregated time
}
```

Stored in VS Code's `globalState` as:
```json
{
  "vscord.analytics": [
    { "date": "2024-12-29", "hour": 14, "project": "vscord", "language": "typescript", "minutes": 45 }
  ]
}
```

---

## Dashboard Views

### Today Summary
```
┌─────────────────────────────────────┐
│  Today: 4h 32m                      │
│  ████████████░░░░░░░░  TypeScript   │
│  ████░░░░░░░░░░░░░░░░  Markdown     │
│  ██░░░░░░░░░░░░░░░░░░  JSON         │
└─────────────────────────────────────┘
```

### Weekly Heatmap
```
       Mon Tue Wed Thu Fri Sat Sun
 8am   ░░░ ░░░ ███ ███ ░░░ ░░░ ░░░
 9am   ░░░ ███ ███ ███ ███ ░░░ ░░░
10am   ███ ███ ███ ███ ███ ░░░ ░░░
...
```

### Project Breakdown
```
vscord      ████████████  12h 15m
my-app      ████████      8h 30m
notes       ██            2h 10m
```

---

## Implementation

1. **Data Collection** — Hook into ActivityTracker, log every 5 min
2. **Storage** — Append to globalState array
3. **Webview** — HTML dashboard with Chart.js
4. **Command** — `vscord.openAnalytics` opens dashboard

---

## Definition of Done

- [ ] ActivityTracker logs to globalState
- [ ] Data aggregation by project/language/hour
- [ ] Webview dashboard with charts
- [ ] Today summary, weekly heatmap, project breakdown
- [ ] Retention cleanup (90 days)
