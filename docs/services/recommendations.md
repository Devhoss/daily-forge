# DailyForge Service Layer — Recommendations (Milestone 4/6)

A general, deterministic recommendation engine. Unlike an overload-only
service, it considers the whole training picture and returns a ranked list of
recommendations that can power the Home screen, Workout Review, Weekly Reports,
notifications, and the future offline Gemma coach.

Every recommendation carries **five things**:

- `title` — a short, encouraging headline ("Ready to Progress")
- `decision` — plain-language action ("Move Dumbbell Floor Press to 12.5 kg next
  session")
- `reasoning` — the *why*, composed from the underlying services' own numbers
  and explanations (never invented sentences)
- `confidence` — how much data the signal is based on
- `action` — a machine-readable decision the UI/coach can act on directly

Plus **presentation metadata** (stamped by the orchestrator, separate from the
0..1 `priority` sort key):

- `importance` — `'critical' | 'high' | 'normal' | 'low'`. Screens choose which
  tiers to render: Home shows `critical` + `high` only, Weekly Report shows
  everything, future notifications may show `critical` only.

The engine never suggests anything it cannot justify from the logged data or
the program definition, and it never writes to storage.

## Files

| Path | Purpose |
|---|---|
| `src/services/recommendations/recommendationEngine.ts` | The engine (pure, deterministic; 7 generators + orchestrator). |
| `src/services/recommendations/recommendationEngine.test.mts` | Unit tests (26, Node `node:test`). |

## Reused services

| Source | Used for |
|---|---|
| `src/services/recovery/recoveryScore.ts` | `computeRecoveryScore`, `computeTrailingConsistencyPct`. |
| `src/services/streaks/streakEngine.ts` | `computeCurrentStreak`, `isoOf`. |
| `src/services/measurements/measurementDeltas.ts` | `latestMeasurementAtOrBefore` (latest reading at/before a week). |
| `src/lib/milestones.ts` | `gatherMilestoneData` + pure `getMilestoneProgress` (no localStorage side effects). |
| `src/lib/data.ts` | `getExercise`, `getWeekRow`, `program`, `isTimeBasedExercise`, `parseHoldDuration`. |
| `src/lib/programEngine.ts` | `getTodayInfo` (week number for `asOf`). |

## Stable API (v1)

```ts
buildRecommendations(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: RecommendationConfig,
): Recommendation[]
```

`RecommendationConfig`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `startIso` | `string` | — | ISO date the program started. |
| `asOf` | `Date` | — | "Now". Deterministic output requires the caller to fix this date. |
| `maxResults` | `number` | `5` | Cap on the returned list, ordered by priority. |
| `maxOverload` | `number` | `3` | Max per-exercise overload prompts. |
| `availableWeights` | `number[]` | `undefined` | Owned dumbbell loads (kg). When set, overload never prescribes an unowned rung. Omit for the full program ladder (legacy). |

`Recommendation`:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable id (`key` or `key:exerciseId`). |
| `key` | `'overload' \| 'recovery' \| 'deload' \| 'consistency' \| 'measurement' \| 'streak' \| 'milestone'` | Recommendation type. |
| `priority` | `number` | 0..1 sort key; higher = more actionable. |
| `importance` | `'critical' \| 'high' \| 'normal' \| 'low'` | Presentation tier for screens (derived from `priority`). |
| `title` | `string` | Short, encouraging headline. |
| `decision` | `string` | Plain-language decision. |
| `reasoning` | `string[]` | Why — bullets composed from underlying services. |
| `confidence` | `'low' \| 'medium' \| 'high'` | Data-dependence of the signal. |
| `action` | `RecommendationAction` | Machine-readable decision. |
| `source` | `string` | Which service/data produced the signal (traceability). |

### Presentation metadata

`resolveImportance(priority)` maps priority to a tier deterministically:
`≥0.9` → `critical`, `≥0.7` → `high`, `≥0.5` → `normal`, else `low`.
`resolveTitle(key, action)` produces the headline. Consumers never re-derive
these — they filter by `importance` and display `title`/`decision`/`reasoning`/
`confidence`.

### Apply action

`findNextSessionForExercise(exerciseId, startDayIndex)` returns the next
scheduled session (cycling the weekly template from `startDayIndex`, rest days
skipped) that programs the exercise, or `null`. Home uses it to turn an
overload recommendation into a target workout, and Workout Mode pre-fills the
recommended load when opened with the `applyRecommendation` navigation state.

### Actions

| `action.type` | Payload |
|---|---|
| `overload` | `{ exerciseId, step: OverloadStep }` |
| `recovery` | `{ level }` |
| `deload` | `{ weekNumber }` |
| `consistency` | `{ consistencyPct }` |
| `measurement` | `{ daysSinceLast: number \| null }` |
| `streak` | `{ currentStreak }` |
| `milestone` | `{ milestoneId, milestoneTitle, remaining, progressCurrent, progressTarget }` |

`OverloadStep` carries `{ exerciseId, exerciseName, kind, current, target,
qualifyingSessions }` where `kind` is
`'increase_weight' \| 'increase_reps' \| 'increase_hold' \| 'progress'`.
The `milestone` action exposes the milestone's display name and current/target
progress so screens can render compact "5-Day Streak · 3/5" items without any
UI-side lookups or arithmetic.

### Grouping for screens (RC1)

`groupRecommendations(recommendations)` merges related recommendations before
rendering so screens present fewer, more meaningful cards:

- every `milestone` nudge → one **"Milestones Ahead"** group with per-item
  progress (`progressCurrent/progressTarget`, `remaining`)
- every `increase_hold` overload → one **"Hold Progression"** group
  (Plank, Wall Sit, …) with `current → target` holds
- everything else passes through as a singleton group

Groups are ordered by importance tier (`critical` first), then by priority.
The function is pure and never mutates its input. The Insights screen groups
its filtered list this way; Home keeps its single high-value card.

## Rules per key

### Overload (`source`: `program:recommendedLoads` / `program:reps` / `program:progressions`)

The engine looks at each exercise's most recent session and its **qualifying
sessions** (sessions in a row at the top of the prescribed range), then emits
one of:

- **Weighted lifts** — prescribed ladder from `recommendedLoads` (e.g.
  dumbbell-floor-press `5/7.5/10/12.5/15` kg). 2+ qualifying sessions at the
  top of the current rung ⇒ `increase_weight` to the next rung (priority 0.9,
  high). Exactly 1 ⇒ `increase_reps` confirmation prompt (0.75, medium).
  Near the top ⇒ `increase_reps` to the rung max (0.6, medium). At the top of
  the whole ladder ⇒ `progress` to heavier dumbbells / a harder variation (0.7,
  high).
- **Equipment-aware capping (RC1)** — when `availableWeights` is provided, the
  "next rung" is the next **owned** rung. A program-ladder rung above the
  current one that the user does not own is never recommended as
  `increase_weight`; instead the engine emits `kind: 'progress'` with
  decision/reasoning naming the needed load ("…top of your available
  dumbbells — add 12.5 kg…"). With no `availableWeights`, behavior is unchanged
  (full ladder).
- **Hold exercises** (time-based, e.g. plank, mid of `"30-90 second holds"`) —
  2+ qualifying sessions at/above target ⇒ `increase_hold` by +5s (0.85, high);
  near target ⇒ `increase_reps` up to the target (0.5, medium).
- **Bodyweight** (e.g. push-up `8-20` reps) — 2+ qualifying sessions at the max
  ⇒ `progress` to `progressions[0]` (0.85, high); near the max ⇒ `increase_reps`
  to the max (0.5, medium).

Only the `maxOverload` most recently trained exercises generate prompts.

### Recovery (`source`: `recovery`)

Defers to `computeRecoveryScore`. No prompt when `level === 'ready'`;
otherwise maps `overtraining_risk` ⇒ 0.95, `tired` ⇒ 0.8, `fresh` ⇒ a positive
"push intensity today" nudge at 0.6. Reasoning reuses the recovery service's
own explanation plus the top straining factors.

### Deload (`source`: `program:week_table`)

Current week is a deload ⇒ priority 0.9 (deload protocol). Next week is a
deload ⇒ 0.5 heads-up.

### Consistency (`source`: `recovery:consistency`)

Trailing-21-day planned-day completion (via `computeTrailingConsistencyPct`)
below 50% ⇒ habit nudge at 0.7. `null` (no sessions) is treated as no signal.

### Measurement (`source`: `measurements`)

No reading recorded ⇒ first-log prompt (0.55, `daysSinceLast: null`). Last
reading older than 14 days ⇒ weekly-measurement reminder (0.5).

### Streak (`source`: `streaks`)

Current streak is 0 but training history exists ⇒ restart prompt (0.65).

### Milestone (`source`: `milestones`)

Milestones within 2 sessions of unlocking (skipping `first-workout`) are
highlighted, nearest first — priority 0.72 when 1 session away, 0.62 when 2.

## Orchestration

Candidates are sorted by `priority` descending (tie-break: `id`), then sliced
to `maxResults`. Output is fully deterministic for a fixed `asOf` — nothing
reads the clock, and milestone progress uses the pure, non-persisting path.

## Consumers

- **Home (M5)** — a curated "What's Next Today" card showing only the single
  highest-priority `critical`/`high` recommendation (`title`, `decision`,
  `reasoning`, `confidence`), an "Apply Recommendation" button for overload
  prompts, a Recovery card, and a Weekly Focus card. No other recommendation
  content appears on Home.
- **Weekly Report** — embeds all `recommendations: Recommendation[]` anchored to
  the report week's end date (`asOf: parseDate(endIso)`), so historical weeks
  read deterministically.
- **Central seam** — exported from `src/services/index.ts` alongside
  trends/streaks/recovery.
- **Notifications / Gemma coach** (planned) — render `decision` + `reasoning`
  for humans and act on `action` programmatically; filter by `importance`.

## Test coverage (26/26, suite total 104/104)

- Empty history ⇒ no overload/recovery/streak; low-priority signals only.
- Overload: 2× top-of-range ⇒ 12.5 kg `increase_weight` (high); single
  qualifying ⇒ medium confirmation; below range top ⇒ no prompt; bodyweight
  progression; plank 60s/65s ⇒ `increase_hold` to 70s.
- Equipment-aware overload: an unowned ladder rung is never recommended as
  `increase_weight`; the next owned rung steps normally; a non-ladder owned
  weight is never the target; a single qualifying session at the top owned rung
  yields no prompt.
- Recovery: heavy block ⇒ rest recommendation with confidence.
- Deload: current deload week ⇒ 0.9; week before ⇒ 0.5.
- Consistency: 3/13 planned days ⇒ 23%.
- Measurement: first log (`daysSinceLast: null`); stale 17 days ⇒ reminder;
  recent ⇒ none.
- Streak: broken streak with history ⇒ 0.65 restart prompt.
- Milestone: 1 session from an unlock ⇒ highlighted; the action carries
  `progressCurrent/progressTarget`.
- Grouping: milestone + hold-overload nudges merge into family cards; singletons
  pass through; ordering by importance tier; input not mutated.
- Priority sort + `maxResults` cap; determinism.
- Every recommendation carries `importance` (matching `resolveImportance`) and
  a non-empty `title`.
- `resolveImportance` tier boundaries; `findNextSessionForExercise`.

Run: `npm test` · type-check: `npm run test:typecheck`.

## Known limitations

- **Heuristic priorities.** Priorities are hand-tuned constants, not learned;
  they order prompts sensibly but are not personalized.
- **Weighted overload ignores drop-sets/RPE.** A working set hitting the top of
  the rep range counts even if the session was unusually easy or hard; RPE is
  not part of the qualifying rule.
- **Single next-step for holds.** `increase_hold` adds a fixed +5s rather than
  consulting a per-exercise hold ladder.
- **Overload candidates limited per exercise count**, not per muscle group; two
  dumbbell press variants could both surface.

## Recommended next step

**Milestone 5 — completed** — Home curates this engine into a single
"What's Next Today" card (critical/high only) plus Recovery and Weekly Focus
cards. **Milestone 6 — completed** — the Insights screen (Progress → Insights)
surfaces the full ranked list alongside recovery and trends; see
`docs/services/insights-screen.md`. **Milestone 7 — completed** — the
NotificationEngine consumes this engine (importance floor `high`) to drive the
daily notification; see `docs/services/notifications.md`.

**RC1 (in progress)** — this engine now exposes `groupRecommendations` for
merged "Milestones Ahead" / "Hold Progression" cards, and its reasoning bullets
were trimmed to 1–2 concise, factual lines. It is also **equipment-aware**: an
optional `availableWeights` config caps every overload step to owned dumbbells
(Home, Insights, notifications, and the Weekly Report all pass the profile's
owned loads). The Coach Summary
(`src/services/coaching/coachSummary.ts`) orchestrates this engine alongside
recovery/milestone progress for the Insights screen's headline card — Gemma
(RC2) will replace that sentence composer while consuming the same services.
