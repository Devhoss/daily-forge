# DailyForge Service Layer — Trend Engine (Milestone 1/6)

Pure, deterministic data services under `src/services/`. Phase 2 builds them as
reusable units so the local Gemma coach (Phase 4) can call the exact same
functions the UI renders — no second refactor.

**Guiding rule: optimize for explanations, not charts.** Every trend is a
`MetricTrend` that carries a plain-language `explanation`; points are available
for rendering, but the numbers alone are not the deliverable.

## Files

| Path | Purpose |
|---|---|
| `src/services/trends/trendEngine.ts` | The service (pure functions + types). |
| `src/services/trends/trendEngine.test.mts` | Unit tests (19, Node `node:test`). |

## Public API

```ts
computeWeeklyTrendPoints(sessionLogs, setLogs, config?): TrendPoint[]
computeTrendReport(sessionLogs, setLogs, config?): TrendReport
analyzeMetricSeries(key, values): MetricTrend      // reusable, generic
// generic primitives shared by later services:
average(values): number | null
linearSlope(values): number | null
halfDelta(values): { first, last }
```

`TrendReport = { asOfWeek, points: TrendPoint[], metrics: MetricTrend[] }`.

Metrics: `consistency`, `volume`, `load`, `rpe`, `duration`, `energy`, `sleep`.

## Stable API contract (v1)

Treat this as frozen for Phase 2 consumers. The Weekly Report (M2), the
Recovery Score (M3), the overload suggestions (M4), and the Gemma coach (Phase 4)
all consume these shapes. Extensions must be additive (new fields/keys), never
removals or renames.

### Inputs

```ts
computeTrendReport(
  sessionLogs: SessionLog[],          // full history; only completed + weekNumber matter
  setLogs: SetLog[],                  // full history; reps/seconds + weightUsed used
  config?: { trainingSessionsPerWeek?: number },  // default 3
): TrendReport
```

A `SessionLog` needs `{ date, weekNumber, completed, rpe?, durationMin?,
energy?, sleepHours? }`; a `SetLog` needs `{ date, repsCompleted?,
holdDurationSeconds?, weightUsed? }`. All units are raw DB units (kg for load).

### Output — realistic example (verified output of the real service)

Program start `2026-07-26`, 3 weeks logged: week 1 → 2/3 sessions, 20 reps @
10 kg, RPE 6; week 2 → 3/3, 42 reps @ 12.5 kg, RPE 7; week 3 → 3/3, 48 reps @
15 kg, RPE 8.

```jsonc
{
  "asOfWeek": 3,
  "points": [
    { "week": 1, "sessionsCompleted": 2, "consistencyPct": 67, "volume": 20, "loadAvg": 10,   "rpeAvg": 6,  "durationMinAvg": 30, "energyAvg": 6, "sleepAvg": 7.5 },
    { "week": 2, "sessionsCompleted": 3, "consistencyPct": 100,"volume": 42, "loadAvg": 12.5, "rpeAvg": 7,  "durationMinAvg": 30, "energyAvg": 6, "sleepAvg": 7.5 },
    { "week": 3, "sessionsCompleted": 3, "consistencyPct": 100,"volume": 48, "loadAvg": 15,   "rpeAvg": 8,  "durationMinAvg": 30, "energyAvg": 6, "sleepAvg": 7.5 }
  ],
  "metrics": [
    { "key": "consistency", "label": "Consistency", "unit": "%", "observedWeeks": 3, "direction": "rising", "favorable": true,
      "trendPct": 19.8, "slopePerWeek": 16.5, "firstHalfAvg": 83.5, "lastHalfAvg": 100,
      "explanation": "Consistency climbed from 84% to 100% of planned sessions over the first half vs the last half. You are showing up more reliably." },
    { "key": "volume", "label": "Weekly volume", "unit": "reps", "observedWeeks": 3, "direction": "rising", "favorable": true,
      "trendPct": 54.8, "slopePerWeek": 14, "firstHalfAvg": 31, "lastHalfAvg": 48,
      "explanation": "Weekly volume grew from 31 to 48 total reps over the first half vs the last half. Progressive overload is happening." },
    { "key": "load", "label": "Average load", "unit": "kg", "observedWeeks": 3, "direction": "rising", "favorable": true,
      "trendPct": 33.3, "slopePerWeek": 2.5, "firstHalfAvg": 11.3, "lastHalfAvg": 15,
      "explanation": "Average working weight rose from 11.3 to 15 kg. Strength is trending up." },
    { "key": "rpe", "label": "Average effort (RPE)", "unit": "/10", "observedWeeks": 3, "direction": "rising", "favorable": null,
      "trendPct": 23.1, "slopePerWeek": 1, "firstHalfAvg": 6.5, "lastHalfAvg": 8,
      "explanation": "Average effort rose from 6.5/10 to 8/10. Sessions are feeling harder recently — good for drive, but pair it with recovery." }
    // duration/energy/sleep follow the same MetricTrend shape (here: steady).
  ]
}
```

**Consumer contract notes**
- `points` is chronological, one entry per week up to `asOfWeek` (0 = nothing logged).
- Every `MetricTrend` has a non-empty `explanation` — render it verbatim; the
  coach can speak it.
- `direction ∈ {rising, falling, steady, insufficient}`; `favorable` is `null`
  for descriptive metrics (rpe, duration) and for `steady`/`insufficient`.
- `null` in `points` (e.g. `loadAvg`) means *no data*, never zero. `trendPct` is
  first-half→last-half change; `slopePerWeek` is the least-squares slope (both
  `null` when there is <2 observed weeks).
- A week with a skipped rest day is reflected honestly: a week with `0` sessions
  has `consistencyPct: 0` — the coach should phrase that as a missed week, not a
  hidden gap.

## Architural decisions

1. **Pure & decoupled.** Functions take arrays + a config object and return
   plain objects. No IndexedDB, no `@/lib/data` `program` import at runtime, no
   UI imports, no timers, no module-level mutable state. `import type` only, so
   the module runs unchanged under Node's native TS type-stripping.
2. **Deterministic.** Identical inputs ⇒ identical output (rounded, no random,
   no `Date.now()`).
3. **Explicit missing-data policy.** `undefined`/absent is never coerced to
   `0`. Unweighted sets are excluded from `load`; a weight-less week reports
   `loadAvg: null`, not `0`. `rpe`/`duration`/`energy`/`sleep` average over
   only actually-recorded values. This is what stops analytics from silently
   lying about legacy/sparse data (see roadmap risk #1).
4. **First-half vs last-half, not endpoints.** `halfDelta` compares the mean of
   the first half of observed weeks to the mean of the last half. More robust to
   a single noisy point than an end-to-end delta, and trivially explainable.
   `linearSlope` is also exposed for charting, but the *direction/favorable*
   decision is made on the robust half-delta.
5. **Honest series.** `computeWeeklyTrendPoints` walks weeks 1..max(logged week)
   so a genuinely skipped week appears as `0` sessions / `0` consistency — a
   real consistency signal, not a hidden gap.
6. **Favorability is selective.** `favorable` is meaningful only where the
   direction is unambiguous (consistency, volume, load, energy, sleep = `up`).
   RPE/duration are *descriptive* (`favorable: null`) because rising effort or
   longer sessions aren't inherently good — the explanation carries the nuance.
7. **Steady threshold.** A last-half vs first-half change under 5% is reported
   `steady` to avoid over-interpreting noise. Single-week data is
   `insufficient`, never guessed.

## Why explanations, not charts

The Output for a metric is a sentence like:

> "Consistency climbed from 50% to 100% of planned sessions over the first half
> vs the last half. You are showing up more reliably."

The Gemma coach can render this directly; the chart can draw the points
alongside. One seam, two consumers.

## Test coverage (19/19)

- Primitives: `average`, `linearSlope` (incl. <2 points, flat), `halfDelta`
  (empty / even / odd).
- Empty inputs ⇒ empty report, all metrics `insufficient`.
- Per-week normalisation vs `trainingSessionsPerWeek`; series capped at max week.
- Volume counts reps for completed-session dates only (excludes orphan sets).
- `loadAvg` skips unweighted sets, returns `null` when none weighted; reps still
  counted (missing-data policy).
- No-data week ⇒ `null` averages for rpe/duration/energy/sleep.
- Hold exercises count seconds as volume.
- Direction/favorability: rising consistency favorable, declining volume not,
  rising load favorable, RPE descriptive (favorable `null`).
- Single-week ⇒ `insufficient` but a usable report.
- Explanation non-empty + deterministic (deep-equal on two runs).
- `slopePerWeek`/`trendPct` positive on a steep rise.
- `analyzeMetricSeries` tolerates `null`/`undefined` interleaved.

Run: `npm test` · type-check tests: `npm run test:typecheck`.

## Known limitations

- **`load` unit is fixed to kg.** The service is unit-agnostic by design; the
  UI converts for display (imperial is cosmetic only). If mg of load ownership
  matters later, it belongs in the UI layer, not here.
- **Global flattening.** A single whole-program `volume`/`row` trend can mask
  an exercise- or session-specific story. Exercise-level trends are out of
  scope for this milestone and belong with the overload service (M4).
- **Recovery trend is intentionally NOT here.** Recovery is a composite
  heuristic, not a directly logged metric; it ships in M3 and can reuse
  `linearSlope`/`halfDelta` on its score series.
- **No significance testing.** 5% `steady` threshold is a heuristic, not a
  statistical test. Good for coaching language, not for claims of significance.

## Recommended next step

**Milestone 2 — Weekly Report Service** (`src/services/report/weeklyReport.ts`)
is done and orchestrates this service. **Milestone 3 — Recovery Score** follows:
a composite heuristic that reuses `average`/`linearSlope`/`halfDelta` on its
score series and slots into the report's reserved `recoveryScore` field.