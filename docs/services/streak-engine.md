# DailyForge Service Layer — Streak Engine

The **single source of truth** for every streak number in the app. Before this
service existed, three modules each computed streaks their own way
(`analytics.ts`, `milestones.ts`, `Overview.tsx`) and they disagreed: the
`milestones.ts` and `Overview.tsx` versions counted calendar-consecutive dates,
so the weekly rest day broke the run (capping streak milestones at 3 in a
6-day/week program) while the rest of the app skipped rest days.

Now all consumers share one implementation and one semantic:
**a scheduled rest day never breaks a streak — it is skipped. A missed training
day resets the run.**

## Files

| Path | Purpose |
|---|---|
| `src/services/streaks/streakEngine.ts` | Pure, deterministic streak functions. |
| `src/services/streaks/streakEngine.test.mts` | Unit tests (15, Node `node:test`). |

## Stable API (v1)

```ts
computeCurrentStreak(sessionLogs, startIso, asOf: Date): number
computeLongestStreak(sessionLogs, startIso): number
computeConsecutiveTrainingDays(sessionLogs, asOf: Date): number
latestCompletedDate(sessionLogs): string | null
computeStreakSummary(sessionLogs, startIso, asOf): StreakSummary
isoOf(d: Date): string
```

- `computeCurrentStreak` — working backwards from `asOf`. If `asOf` is a
  training day not yet logged, counting starts the previous day (so an
  in-progress day doesn't zero the streak). Rest days are skipped; the first
  missed training day stops the count.
- `computeLongestStreak` — longest run over the whole history, same rest-day
  semantics, deterministic from `startIso`.
- `computeConsecutiveTrainingDays` — back-to-back **calendar** days with a
  completed session. This measures physical strain, so a rest day *does* break
  it (distinct from the consistency streaks above). Used by the Recovery service.
- `computeStreakSummary` — one call returning `{ current, longest, consecutive,
  lastTrainingDate }`.

`StreakSummary`:

| Field | Meaning |
|---|---|
| `current` | Rest-day-skipping current streak as of `asOf`. |
| `longest` | Longest rest-day-skipping run in history. |
| `consecutive` | Back-to-back calendar training days as of `asOf` (rest days break it). |
| `lastTrainingDate` | Most recent completed session date or `null`. |

**No `Date.now()` inside.** `asOf` is injected by the caller ("today" at the UI
boundary, or a report week's end date for a snapshot).

## Consumers

- `Home` — current streak card (`asOf: new Date()`).
- `Overview` — current + best streak (inline calendar-diff `longest` removed).
- `WorkoutReview` / `WorkoutMode` — current streak.
- `milestones.ts` — `currentStreak`/`longestStreak` for streak milestones and
  their unlock dates; the internal calendar-diff version was replaced, and
  `findStreakUnlockDate` now skips rest days to match.
- `weeklyReport.ts` — `summary.currentStreak` / `summary.longestStreak` anchored
  to the report week's end date.
- `recoveryScore.ts` — `computeConsecutiveTrainingDays` + `latestCompletedDate`.

## Test coverage (15/15, suite total 81/81)

- Rest days never break the run (current + longest, across week boundaries).
- Missed training days reset; incomplete logs are ignored.
- In-progress unlogged training day doesn't reset.
- `asOf` on a rest day counts the last training day.
- Consecutive (strain) counts calendar days and rest days break it.
- Determinism (deep-equal across runs).

Run: `npm test` · type-check: `npm run test:typecheck`.
