# DailyForge Data Changed Event Bus (RC1)

The single source of truth for data freshness across the app.

Every data mutation emits a `data-changed` event. Coaching consumers subscribe
and recompute from the latest data. This replaces the previous implicit
guarantee ("screens refresh because routes happen to remount them") with an
explicit contract: **data changed ⇒ every consumer recomputes**.

## Public API

`src/lib/events.ts` — zero dependencies, pure orchestration wiring.

```ts
onDataChanged(listener: () => void): () => void   // subscribe; returns unsubscribe
emitDataChanged(): void                            // emit after a mutation commits
getDataVersion(): number                           // monotonic freshness counter
```

- Emitting is O(subscribers) and synchronous. During a workout the screens that
  subscribe are unmounted, so per-set emissions are effectively no-ops.
- `emitDataChanged()` is called **after** the underlying write resolves, so a
  subscriber's re-read always sees the committed data.

## Where the event is emitted

| Mutation | Site |
|---|---|
| Workout session saved (completed + final RPE pass) | `upsertSessionLog` (`src/lib/db.ts`) |
| Set logged | `addSetLog` (`src/lib/db.ts`) |
| Measurement saved | `upsertMeasurement` (`src/lib/db.ts`) |
| Photo added / exported / deleted | `upsertPhoto`, `deletePhoto` (`src/lib/db.ts`) |
| Program start date changed | `setProgramStartDate` (`src/lib/db.ts`) |
| Equipment profile changed | `saveEquipmentProfile` (`src/lib/equipment.ts`) |
| Progress / all-data reset | `resetProgress`, `resetAllData` (`src/lib/db.ts`) |
| Backup restored / imported | `restoreBackup` (`src/lib/backup.ts`) |

Workout "edit/delete" routes do not exist yet; when they land they must be
routed through a db.ts helper so they emit automatically.

## Who subscribes

| Consumer | Response |
|---|---|
| Home | re-runs `load()` — recomputes Recovery, top recommendation, Weekly Focus |
| Insights | re-runs its loader — recomputes Coach Summary, recommendations, recovery, trends |
| Overview | re-runs its loader — recomputes stats, streaks, milestones, PRs |
| Shell (App.tsx) | debounced (1.5 s) → `refreshTodayCoachedNotification` so an already-scheduled coached notification never stays stale |

Notifications use a **cheap incremental recompute** (`refreshTodayCoachedNotification`)
rather than the full 55-day `refreshDailyReminders`, so bursts of set-log writes
coalesce without churning the native notification schedule.

## Keeping services pure

The bus lives in `src/lib` (data/orchestration layer). Coaching services
(`src/services/**`) are untouched and stay pure — they still take plain typed
inputs and never read the bus. Only the orchestration layer (pages, notification
wiring, and the db.ts helpers that emit) changed.

## Evolution into typed events

The emitter is built on a generic event core so future typed events can be added
without changing the public API:

```ts
// today — every mutation is a generic "data changed"
emitDataChanged();

// future — typed payloads, still delivered to every onDataChanged subscriber
// publish({ type: 'workout-completed', sessionKey, date })
// publish({ type: 'measurements-updated', week })
// publish({ type: 'health-data-updated', source })
// publish({ type: 'backup-restored' })
```

`onDataChanged` subscribers keep working unchanged; new typed subscribers can
filter on `event.type`.

## Tests

`src/lib/events.test.mts` (runs under `npm test`, suite **108/108**): fires on
every emit, unsubscribe stops delivery, multiple subscribers, monotonic version,
late subscriber added during dispatch does not fire for that dispatch.

## Recovery model note (readiness vs post-workout state)

`computeRecoveryScore` intentionally models **readiness** — how ready you are to
train — anchored to `asOf` (a calendar day). It is not a "how tired am I right
now" gauge. After a session it does move immediately (time-since-last flips to
"Trained today", volume/RPE windows shift), but for a daily trainer the rolling
7-day windows move only slightly, so the number can look unchanged.

With the event bus, Recovery now recomputes the moment a workout is committed,
and Home shows a deterministic **"Reflects today's completed session"** cue on
the Recovery card whenever a session was completed today, so the refresh is
acknowledged even when the score barely moves. If a distinct post-workout
recovery state is wanted later, it should be a new pure service
(`computePostWorkoutRecovery`) — not a change to the readiness engine — and the
two states surfaced separately in the UI.
