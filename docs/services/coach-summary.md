# DailyForge Service Layer — Coach Summary (RC1)

A deterministic **orchestrator** — not an AI. It composes one short coaching
paragraph from the existing services, so the Insights screen (and later the
RC2 Gemma coach) describes the same situation as every other surface.

## Design

- **No new formulas.** Every sentence is composed from the outputs of existing
  services: `computeRecoveryScore`, `buildRecommendations`, and the pure
  `getMilestoneProgress` path from `@/lib/milestones`.
- **Deterministic.** `asOf` is injected; no clock, no storage, no React.
- **De-duplicating.** A signal is stated once, from whichever service carries
  it (e.g. a near milestone is expressed by the milestone service, not repeated
  from the recommendation list).

## Files

| Path | Purpose |
|---|---|
| `src/services/coaching/coachSummary.ts` | The orchestrator (pure). |
| `src/services/coaching/coachSummary.test.mts` | Unit tests (5, Node `node:test`). |

## API

```ts
buildCoachSummary(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: CoachSummaryConfig,
): CoachSummary
```

`CoachSummaryConfig`: `{ startIso, asOf, maxSentences?, availableWeights? }`
(`maxSentences` caps the paragraph; default 3. `availableWeights` is forwarded
to the recommendation engine so its top sentence never recommends an unowned
dumbbell load — see `docs/services/equipment.md`).

`CoachSummary`: `{ sentences: string[], paragraph: string }`.

## Sentence order

1. **Recovery always leads** — a coach opens with how you're feeling
   ("Recovery is excellent — you're primed to push hard today.").
2. **Close milestones** — "One session to unlock …" / "You're close to
   unlocking 2 milestones." (milestones within 2 sessions, skipping
   `first-workout`).
3. **Top non-recovery, non-milestone recommendation** — its `decision` verbatim
   (e.g. a load increase, a measurement nudge, a streak restart).

## Future (RC2)

Gemma will *replace* the sentence composer while consuming the exact same
service layer — the contract (`CoachSummary`) stays stable so the UI never
knows whether the text came from the orchestrator or the on-device model.

Run: `npm test` · type-check: `npm run test:typecheck`.
