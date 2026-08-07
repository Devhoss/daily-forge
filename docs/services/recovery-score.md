# DailyForge Service Layer — Recovery Score (Milestone 3/6)

A deterministic recovery analysis built from the same typed data as every other
service. Recovery is **an analysis, not a single number**: it returns a score,
a level, per-factor contributors with plain-language readings, an explanation,
a recommendation, and a confidence value — so the UI, notifications, and the
future Gemma coach never have to re-derive *why* the score is what it is.

## Files

| Path | Purpose |
|---|---|
| `src/services/recovery/recoveryScore.ts` | The recovery analysis (pure, deterministic). |
| `src/services/recovery/recoveryScore.test.mts` | Unit tests (16, Node `node:test`). |

## Reused services

| Source | Used for |
|---|---|
| `src/services/streaks/streakEngine.ts` | `computeConsecutiveTrainingDays`, `latestCompletedDate`. |
| `src/services/trends/trendEngine.ts` | `average` (RPE windows). |
| `src/lib/programEngine.ts` | Scheduled rest days (today/tomorrow lookahead). |

## Stable API (v1)

```ts
computeRecoveryScore(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  config: { startIso: string; asOf: Date },   // "now" is injected, never read internally
): RecoveryAnalysis
```

`RecoveryAnalysis` fields:

| Field | Type | Meaning |
|---|---|---|
| `score` | `number` | 0-100 composite; higher = more recovered. |
| `level` | `'fresh' \| 'ready' \| 'tired' \| 'overtraining_risk'` | Bucket for `score` (`≥85`/`≥65`/`≥45`/else). |
| `contributors` | `RecoveryFactor[]` | Only factors with enough data, in a stable order. |
| `explanation` | `string` | Composite plain-language summary of the signals. |
| `recommendation` | `string` | Plain-language suggestion per level. |
| `confidence` | `'low' \| 'medium' \| 'high'` | `high` if ≥5 factors, `medium` if ≥3, else `low`. |

`RecoveryFactor` fields:

| Field | Type | Meaning |
|---|---|---|
| `key` | see list below | Stable factor identifier. |
| `label` | `string` | Human label ("Recent RPE"). |
| `direction` | `'straining' \| 'recovering' \| 'neutral'` | Which way the factor points. |
| `impact` | `number` | Signed points toward the score (positive = more recovered). |
| `detail` | `string` | One-line reading ("Average RPE 7 this week vs 7 the week before."). |

### Factors

| Key | What it reads | Omitted when |
|---|---|---|
| `rpe_trend` | Avg RPE last 7 days vs the 7 before | Either window has no RPE values. |
| `volume_trend` | Total volume (reps/hold-seconds) last 7 days vs the 7 before | No volume recorded in either window. |
| `consecutive_training_days` | Back-to-back calendar training days | *(always present)* |
| `planned_rest` | Scheduled rest day today/tomorrow; strain after 3+ straight days | *(always present)* |
| `consistency` | % of planned training days completed in the trailing 21 days (or since program start) | No completed sessions at all. |
| `workload_trend` | Volume of the last logged program week vs the prior one | Fewer than two logged weeks, or a zero-volume week. |
| `time_since_last_workout` | Days since the most recent completed session (clamped ≥ 0) | No completed sessions. |

Scoring starts at a neutral **65** ("ready" for a rested, untrained state) and
each factor nudges the total by its `impact`. Output is fully deterministic for
a fixed `asOf` — nothing reads the clock.

### Verified example output

Input: 15 completed sessions (rpe 7, 3×10-rep sets each) over weeks 1-3 of the
6-day program; `asOf` is a scheduled rest day. Output:

```jsonc
{
  "score": 81,
  "level": "ready",
  "contributors": [
    { "key": "rpe_trend", "label": "Recent RPE", "direction": "neutral", "impact": 0,
      "detail": "Average RPE 7 this week vs 7 the week before." },
    { "key": "volume_trend", "label": "Recent volume", "direction": "neutral", "impact": 0,
      "detail": "Weekly volume is steady vs the previous week." },
    { "key": "consecutive_training_days", "label": "Consecutive training days", "direction": "neutral", "impact": 0,
      "detail": "No consecutive-day strain right now." },
    { "key": "planned_rest", "label": "Planned rest", "direction": "recovering", "impact": 8,
      "detail": "Today is a scheduled rest day." },
    { "key": "consistency", "label": "Consistency", "direction": "recovering", "impact": 6,
      "detail": "Consistent schedule — 100% of planned sessions completed." },
    { "key": "workload_trend", "label": "Weekly workload", "direction": "recovering", "impact": 4,
      "detail": "Weekly workload down 50% from the prior logged week." },
    { "key": "time_since_last_workout", "label": "Time since last workout", "direction": "neutral", "impact": -2,
      "detail": "Last workout 1 day ago." }
  ],
  "explanation": "Recovery is estimated at 81/100 (ready). No major strain signals. Recovery signals: planned rest, consistency, weekly workload.",
  "recommendation": "You're recovered enough to follow your normal plan.",
  "confidence": "high"
}
```

## Consumers

- **Weekly Report** — embeds the full `RecoveryAnalysis` in `recoveryScore`,
  anchored to the report week's end date (so historical weeks read deterministically).
- **Home / Notifications / Workout Review / Gemma coach** (planned) — render the
  score, level, and the factor readings directly; no re-derivation.

## Test coverage (16/16, suite total 81/81)

- Empty history ⇒ neutral `ready` 65 with `low` confidence and only the two
  always-present factors.
- Each factor: rising/falling RPE, volume jump / flat / absent, consecutive-day
  cap (6 in a 6-day/week program), rest today vs tomorrow vs 3+ straight days,
  near-complete vs erratic consistency, rising/absent workload trend, trained
  today vs a few days off.
- Omitted-factor policy (no RPE window, no sets, single logged week, no sessions).
- A heavy two-week block scores below `ready` with `high` confidence.
- Determinism (deep-equal across runs).

Run: `npm test` · type-check: `npm run test:typecheck`.

## Known limitations

- **Heuristic, not science.** Scores are deterministic and factor-traceable but
  are not validated against physiological markers; treat as guidance.
- **Partial current week.** Rolling windows are anchored to `asOf`; a week in
  progress is counted as-is (same property as the trend engine's weekly points).
- **Units.** Volume counts reps (or hold-seconds) only; load weighting is not
  part of the composite.

## Recommended next step

**Milestone 4 — completed** — the general Recommendation Engine
(`src/services/recommendations/recommendationEngine.ts`) consumes this service
for its `recovery` prompt and `consistency` signal; see
`docs/services/recommendations.md`. **Milestone 5 — Home / Dashboard
integration** renders the ranked recommendations in a "What's next today?" card.
