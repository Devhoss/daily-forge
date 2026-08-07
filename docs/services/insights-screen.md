# DailyForge Service Layer — Insights Screen (Milestone 6/7)

A single screen that surfaces the **full output** of the Recommendation, Trend,
and Recovery services. This is the "show everything" consumer — the counterpoint
to the curated Home screen. It lets you validate the coaching engine visually
(and manually sanity-check recommendations) before the notification layer starts
pushing them.

## Where it lives

- Route: `Progress → Insights` (4th tab on `/progress`).
- Deep-linked from Home's "What's Next Today" card via
  `navigate('/progress', { state: { tab: 'insights' } })`.
- Component: `src/pages/progress/Insights.tsx`.

## What it composes (services only)

| Section | Service | Notes |
|---|---|---|
| Recovery | `computeRecoveryScore(sessionLogs, setLogs, { startIso, asOf })` | Score, level, confidence, explanation, recommendation, and every `contributor` (label, direction, impact, detail). |
| Recommendations | `buildRecommendations(sessionLogs, setLogs, measurements, { startIso, asOf, maxResults: 20 })` | The full ranked list (all importance tiers), each with title, decision, reasoning, confidence, source, importance badge. Importance filter chips are pure presentation. |
| Trends | `computeTrendReport(sessionLogs, setLogs, { trainingSessionsPerWeek })` | All 7 `MetricTrend`s with direction chips and their plain-language `explanation`, plus first-half → last-half values. |

All three are anchored to `asOf = now` (unlike the weekly report, which anchors
to the report week's end). No logic is duplicated in the screen — it renders
what the services return.

## Presentation

Label/color maps are centralized in `src/lib/presentation.ts`
(`RECOVERY_LEVEL_META`, `CONFIDENCE_META`, `IMPORTANCE_META`,
`FACTOR_DIRECTION_META`, `trendDirectionMeta`), shared with Home so both
screens use identical words and colors for the same states.

## Test coverage

- No new service logic was added — the screen consumes existing services
  (recommendations 20, recovery 16, trends existing suites). Suite total
  **81/81**, type-check clean, `tsc -b` clean, lint clean (4 pre-existing
  warnings), `npm run build` passes.
- Empty state: no completed sessions ⇒ friendly "finish a workout" card.

## Known limitations

- Text-focused by design: no trend charts yet (recharts is available if wanted
  later); the trend service's explanations are the primary product here.
- `maxResults: 20` is passed to show the full list; the engine currently emits
  at most ~10 items, so nothing is truncated.
- The recovery "one short explanation" on Home is the same composite sentence
  shown here (honest, clinical).

## Recommended next step

**Milestone 7 — completed** — the NotificationEngine drives today's
notification from this same engine (importance floor `high`, reusing the same
`decision`/`reasoning`/`title` copy); see `docs/services/notifications.md`.
