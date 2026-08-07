# DailyForge Service Layer — Weekly Report (Milestone 2/6)

A thin orchestrator. It composes existing, reusable services into one typed
`WeeklyReport` for a program week and contains **no analytics formulas** — every
calculation lives in a service it calls.

## Files

| Path | Purpose |
|---|---|
| `src/services/report/weeklyReport.ts` | The orchestrator (composer only). |
| `src/services/report/weekRange.ts` | Pure program-week calendar helpers. |
| `src/services/measurements/measurementDeltas.ts` | Measurement lookup + deltas. |
| `src/services/report/weeklyReport.test.mts` | Unit tests (7, Node `node:test`). |
| `scripts/service-loader.mjs` | `@/` alias + JSON resolver for Node tests. |

## What it composes

| Facet | Service | Notes |
|---|---|---|
| Trends | `src/services/trends/trendEngine.ts` (`computeTrendReport`) | Whole-series, snapshot to end of report week. |
| PRs set this week | `src/lib/prs.ts` (`detectPRsSetInDateRange`) | Newly added pure fn; compares week vs prior history. |
| Milestones earned | `src/lib/milestones.ts` (`gatherMilestoneData`, `getNewlyUnlockedMilestones`) | Diff of states before vs at end of week. |
| Streak | `src/services/streaks/streakEngine.ts` (`computeCurrentStreak`, `computeLongestStreak`) | As-of the report week's end date — deterministic. |
| Recovery | `src/services/recovery/recoveryScore.ts` (`computeRecoveryScore`) | Anchored to the report week's end date. |
| Recommendations | `src/services/recommendations/recommendationEngine.ts` (`buildRecommendations`) | Ranked `Recommendation[]`, anchored to the report week's end date. |
| Measurements | `src/services/measurements/measurementDeltas.ts` | Latest ≤ week + week-over-week deltas. |
| Week calendar | `src/services/report/weekRange.ts` | Inclusive `[startIso, endIso]` per week. |
| Focus / next focus | `src/lib/data.ts` (`getWeekRow`) | phase, focus, deload flag + next week row. |

## Stable API (v1)

```ts
buildWeeklyReport(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: { weekNumber: number; startDate: string; trainingSessionsPerWeek?: number; availableWeights?: number[] },
): WeeklyReport
```

`WeeklyReport` fields:

```jsonc
{
  "weekNumber": 1,
  "weekRange": { "startIso": "2026-07-26", "endIso": "2026-08-01" },
  "summary": {
    "sessionsCompleted": 6, "plannedSessions": 6, "consistencyPct": 100,
    "volume": 60, "avgRpe": 7, "avgDurationMin": 30, "avgEnergy": 6, "avgSleep": 7.5,
    "currentStreak": 6, "longestStreak": 6, "lifetimeReps": 60
  },
  "workouts": [ { "date": "2026-07-26", "sessionKey": "push_a", "title": "Push A - Chest & Triceps Emphasis",
                  "rpe": 7, "durationMin": 30, "energy": 6, "sleepHours": 7.5, "bodyWeight": null, "notes": null } ],
  "trends": { /* TrendReport from M1, snapshot through endIso */ },
  "prs": [ { "exerciseId": "dumbbell-floor-press", "type": "weight", "previous": null, "current": 12 } ],
  "milestonesEarned": [ /* MilestoneWithState[] newly unlocked by end of the week */ ],
  "measurements": { "recorded": null, "previousWeek": null, "deltas": [] },
  "recoveryScore": { "score": 49, "level": "tired", "contributors": [ /* RecoveryFactor[] */ ],
                     "explanation": "Recovery is estimated at 49/100 (tired). Strain signals: recent volume, planned rest. Recovery signals: consistency.",
                     "recommendation": "Take it easy today — consider a lighter session or an extra rest day.",
                     "confidence": "high" },
  "recommendations": [ /* Recommendation[] from M4, ranked by priority */ ],
  "focus": { "phase": "Foundation", "focus": "Learn every pattern", "isDeload": false,
             "next": { "week": 2, "phase": "Foundation", "focus": "Build technique", "isDeload": false } },
  "narrative": [
    "6 of 6 sessions completed — 100% consistency, 60 total reps.",
    "Milestone unlocked — First Workout.",
    "Milestone unlocked — Week 1 Complete."
  ]
}
```

*(Abridged for readability; `workouts`/`milestonesEarned` are full arrays.)*

**Semantics guaranteed to consumers (UI + Gemma):**
- Everything is snapshotted to the report week: data on/before `endIso`. Building
  a historical week reads the same as building the current week.
- Fully deterministic — no `Date.now()`. Streak "today" and the recovery anchor
  are the week's end date.
- `recoveryScore` is a full `RecoveryAnalysis` (score, level, per-factor
  contributors, explanation, recommendation, confidence) anchored to `endIso`.
- `recommendations` is a ranked `Recommendation[]` (M4) built from the same
  `startIso`/`endIso` anchor, so historical weeks read deterministically.
- `narrative` lines are composed from the facets' own explanations/labels —
  no new sentences are invented by the builder.

## Architectural decisions

1. **Thin composer.** The builder only slices (week/week filters) and delegates.
   New analytics (`detectPRsSetInDateRange`, `computeLongestStreak`,
   `measurementDelta`, `weekDateRange`) were added to the *reusable services*,
   not inline. The PR engine gained the date-range function in `src/lib/prs.ts`;
   streaks live in `src/services/streaks/streakEngine.ts`; recovery lives in
   `src/services/recovery/recoveryScore.ts`.
2. **Per-week determinism.** Week ranges are computed from `startDate` +
   `weekNumber` via `weekRange` (local-time, like `programEngine`), and all
   streak/PR/milestone/recovery inputs are filtered to `date <= endIso`.
3. **Testability via a resolver.** `scripts/service-loader.mjs` maps the
   bundler aliases (`@/lib/db`, `@/data/*.json`, `@/types`) so orchestrators
   that compose the real `src/lib/*` run in Node 24's TS-stripping test runner.
   Milestones' `localStorage` persistence is polyfilled in-memory in tests.
4. **Single streak source.** Streak math is centralized in
   `src/services/streaks/streakEngine.ts` (rest days never break a run) and
   shared by Home, Overview, Workout Review, Workout Mode, Milestones, and this
   report. The report passes an explicit end-of-week `asOf`.
5. **Recovery as an analysis, not a number.** The report embeds the full
   `RecoveryAnalysis` so UI/notifications/coach never have to re-derive why a
   score is what it is.
6. **Recommendations are a composed, ranked list.** The report adds the M4
   `buildRecommendations` output without re-deriving it; the engine reuses the
   same streak/recovery/milestone/measurement services the report already composes.

## Test coverage (suite total 81/81)

- Empty history ⇒ valid empty report with focus data and a "no sessions" narrative.
- A completed week: summary numbers, workout titles from the program, trends
  composed, PRs present, milestones earned (`first-workout`, `week-1-complete`,
  `streak-3`), focus + next focus, coach narrative, recovery populated,
  recommendations present with decision/reasoning/confidence/importance/title.
- PRs set later in the week detected vs earlier history (weight 10 → 14).
- Measurement deltas week-over-week (`-1 kg`), baseline-only handling, `null`
  `prev`/`change` for new fields.
- Milestones earned in week 2 exclude week-1 milestones.
- Determinism (deep-equal across runs).
- Streak engine (15) + recovery (16) + recommendations (18) tests in their own suites.

Run: `npm test` · type-check: `npm run test:typecheck`.

## Known limitations

- **`detectPRsSetInDateRange` compares vs history before the week** using the
  same `ExerciseRecord` model as `detectSessionPRs`; it is not a persistent PR
  ledger (records can be "re-set" if a heavier load is deleted later).
- **Milestones side effect.** Composing milestones persists unlock dates to
  `localStorage` (idempotent, existing app behavior). The builder itself is
  otherwise side-effect free.
- **`load` and measurements are kg/cm**; the UI owns unit conversion.
- **Recovery is a heuristic.** It is deterministic and factor-traceable, but
  not evidence-based training science; treat it as guidance, not prescription.

## Recommended next step

**Milestone 4 — Progressive Overload service** (`src/services/overload/`): detect
the next overload prompt for each exercise (add weight / add reps / hold longer)
from set history, reusing the services' typed outputs, and expose it via the
central `src/services/index.ts` seam.
