# DailyForge Service Layer — Home Dashboard (Milestone 5/6)

The Home screen is the "what's the most valuable thing I should focus on today?"
answer. It stays **calm and curated**: exactly three coaching surfaces — a
single **What's Next Today** recommendation, a **Recovery** card, and a
**Weekly Focus** card — plus the functional Today's-Workout hero and the weekly
timeline/progress.

The screen contains **no business logic**: every number and sentence comes from
a service. Home only loads data and renders.

## What changed

| Area | Change |
|---|---|
| `src/pages/Home.tsx` | Rebuilt around three service-backed coaching cards. Removed the stat-card grid and generic tip-of-the-day to keep the screen calm (detailed stats live in Progress/Overview). |
| `src/services/recommendations/recommendationEngine.ts` | `Recommendation` gained `importance` (`critical/high/normal/low`) + `title` (headline), stamped by the orchestrator. Added `resolveImportance`, `resolveTitle`, and `findNextSessionForExercise`. |
| `src/pages/WorkoutMode.tsx` | Reads the `applyRecommendation` navigation state; pre-fills the recommended load on the matching exercise and shows a one-line coach hint. |
| `src/services/report/weeklyReport.ts` | Unchanged — the report already embeds all recommendations (importance-tier aware, shows everything). |

## The three cards

1. **What's Next Today** — the single highest-priority `critical`/`high`
   recommendation. Shows `title`, `decision`, `reasoning` (always explained),
   and `confidence`. When the recommendation is an overload step, an **Apply
   Recommendation** button navigates to the next session programming that
   exercise and pre-fills the target load. If nothing qualifies, the card shows
   a calm "All Clear" status (a status, not a recommendation).
2. **Recovery** — `computeRecoveryScore` output: level, score, the service's own
   explanation, and its recommendation. No charts.
3. **Weekly Focus** — the current week's `focus` string from the program's week
   table (`getTodayInfo(...).weekRow.focus`).

## Curation rules (presentation only)

- Home filters by `importance`: `critical` + `high`, then takes the top item.
- Weekly Report shows everything. Future notifications can filter to `critical`
  only.
- These filters are display rules; the engine still returns the full ranked
  list.

## Test coverage

- Service: 20/20 in `recommendationEngine.test.mts` (importance tiers, title
  presence, `findNextSessionForExercise`).
- Report: assertions now also check `importance`/`title`.
- Suite total: **81/81**, type-check clean, `tsc -b` clean, lint clean (4
  pre-existing warnings), `npm run build` passes.

## Known limitations

- The "All Clear" card is static copy; it does not distinguish "recovered and
  ready" from "no data yet" (the no-data state shows a separate first-workout
  prompt instead).
- "Apply Recommendation" pre-fills the target **load** and shows a hint, but
  does not auto-advance sets or pre-fill reps.
- The recovery explanation is the service's composite sentence (clinical but
  honest); no friendly re-wording is invented in the UI.

## Recommended next step

**Milestone 6 — completed** — the Insights screen (Progress → Insights) surfaces
the full ranked recommendation list plus recovery and trends; see
`docs/services/insights-screen.md`. **Milestone 7 — completed** — the
NotificationEngine now schedules today's notification from the same engine
(importance floor `high`); see `docs/services/notifications.md`.
