# DailyForge Service Layer — Notifications (Milestone 7)

The notification layer decides *whether* and *what* to tell the user, then
formats a self-explaining payload. It never calculates training data: it is a
**consumer** of the Recommendation Engine (which itself composes Recovery,
Streaks, Milestones, and Measurement lookups) and, where appropriate, the
Weekly Report.

## The seam (why it exists)

Today's notification is a *coached* notification, not a generic alert:

- The **NotificationEngine** (`src/services/notifications/notificationEngine.ts`)
  is a pure, deterministic service. It calls `buildRecommendations` with an
  injected `asOf`, keeps only recommendations that clear an importance floor,
  picks the single highest-value one, and formats the payload.
- The **lib layer** (`src/lib/notifications.ts`) is the only thing that reads
  the clock (`new Date()`) and storage, and it schedules via Capacitor. No
  workout math lives there.

This mirrors how the future Gemma coach will work: it consumes the same
payload the engine produces and may reword it — never re-deriving the numbers.

## Files

| Path | Purpose |
|---|---|
| `src/services/notifications/notificationEngine.ts` | The engine (pure, deterministic; decide → select → format). |
| `src/services/notifications/notificationEngine.test.mts` | Unit tests (12, Node `node:test`). |
| `src/lib/notifications.ts` | Capacitor scheduling; consumes the engine for today's notification. |

## Stable API (v1)

```ts
buildDailyNotifications(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: NotificationEngineConfig,
): CoachedNotification[]
```

`NotificationEngineConfig`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `startIso` | `string` | — | ISO date the program started. |
| `asOf` | `Date` | — | "Now", injected by the caller. Never read from the clock inside the service. |
| `reminderTime` | `string` | `'18:00'` | "HH:MM" used for `scheduledFor`. |
| `minImportance` | `RecommendationImportance` | `'high'` | Importance floor — anything below this never interrupts. |
| `availableWeights` | `number[]` | `undefined` | Owned dumbbell loads (kg); overload notifications never name an unowned load (see `docs/services/equipment.md`). |

`CoachedNotification`:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable id (`<category>:<recommendation-id>`). |
| `category` | `NotificationCategory` | `workout` \| `recovery` \| `recommendation` \| `milestone` \| `consistency` \| `measurement` \| `progress_photos` \| `weekly_review` — reserved for future filtering. |
| `importance` | `RecommendationImportance` | `critical` \| `high` \| `normal` \| `low`. |
| `title` | `string` | Short headline (from `resolveTitle`). |
| `body` | `string` | Plain-language decision (the recommendation's `decision`). |
| `reason` | `string[]` | The *why*, from the underlying services' own wording. |
| `action` | `RecommendationAction \| null` | Machine-readable decision the UI/coach can act on. |
| `scheduledFor` | `string` | ISO datetime — when it should fire. |
| `expiresAt` | `string` | ISO datetime — after this the notification is stale and should be dropped. |

There is also a weekly-review builder that consumes the Weekly Report:

```ts
buildWeeklyReviewNotification(
  report: WeeklyReport,
  config: { startIso: string; asOf: Date; reminderTime?: string },
): CoachedNotification | null
```

It only produces output when `asOf` falls on the report week's end date — the
natural "week's over" moment. Body and reason come entirely from the report's
own narrative; the engine formats, it never re-derives.

## Behavioural rules

- **Nothing if nothing important.** With the default `minImportance: 'high'`,
  only `critical`/`high` recommendations produce a notification. A normal-tier
  nudge (e.g. "log your measurements") never interrupts on its own.
- **Max one per day.** The engine returns at most one notification; the lib
  layer schedules exactly one for today and falls back to the plain training
  reminder (skipping rest days) for the rest of the rolling window.
- **Never twice for the same recommendation.** Only the highest-value
  recommendation is selected, and `id` is stable, so a recommendation can never
  be scheduled twice.
- **Deterministic.** Identical inputs → identical output (covered by a test).
- **No clock inside the service.** `asOf` is injected. `src/lib/notifications.ts`
  is the boundary that owns `new Date()`.

## Expiry semantics

| Category | `expiresAt` |
|---|---|
| `recommendation` (overload) | End of the next session day for that exercise ("valid until your next Push workout"). |
| `recovery` | End of today. |
| `recommendation` (deload) | End of the current program week ("valid until Sunday"). |
| `consistency`, `measurement`, `milestone` | End of the current program week. |
| `weekly_review` | End of the report week's end date. |

Expired notifications "disappear automatically": every refresh cancels pending
notifications and re-schedules from the engine, so anything past its
`expiresAt` is simply never re-scheduled.

## Consumers

| Consumer | Where | Notes |
|---|---|---|
| `src/lib/notifications.ts` | `refreshDailyReminders` | Schedules today's coached notification (id `900001`) plus the generic rolling window. |
| Future Gemma coach | — | Rewords the same payload; never recomputes. |
