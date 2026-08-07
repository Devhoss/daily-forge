# DailyForge Equipment Engine (RC1 — frozen interface)

The equipment engine is the single source of truth for **what the user owns**.
It is a capability the coaching layer reads from — it never rewrites the
program. Every consumer that decides *what to prescribe* (recommendations,
coach summary, notifications, weekly report) receives the owned loads explicitly
rather than reading storage itself.

## Files

| Path | Purpose |
|---|---|
| `src/lib/equipment.ts` | `EquipmentProfile` model, storage (`db.settings` row `'equipment'`), defaults, `humanizeEquipment(…)`. |
| `src/lib/weights.ts` | `recommendWeight(ex)` — closest-available pre-session load picker; session summaries/volume helpers. |
| `src/services/recommendations/recommendationEngine.ts` | Consumes `availableWeights` (optional) to cap overload rungs. |
| `src/services/coaching/coachSummary.ts` | Orchestrator; forwards `availableWeights` into the engine. |
| `src/services/notifications/notificationEngine.ts` | Coached notifications; accepts `availableWeights`. |
| `src/services/report/weeklyReport.ts` | Weekly report; accepts `availableWeights`. |
| `src/pages/Settings.tsx` | Equipment configuration UI (dumbbell checkboxes, toggle rows). |
| `src/pages/Home.tsx`, `src/pages/progress/Insights.tsx` | Pass `eq.dumbbells` into every engine call. |

## EquipmentProfile (stable)

```ts
interface EquipmentProfile {
  dumbbells: number[];      // kg loads the user owns, e.g. [5, 7.5, 10]
  hasBench: boolean;
  hasBands: boolean;
  hasPullUpBar: boolean;
  hasMat: boolean;
  hasKettlebell: boolean;
}
```

- Persisted as a JSON string under the `db.settings` row `'equipment'`.
- `getEquipmentProfile()` deep-merges stored data over `DEFAULT_EQUIPMENT`
  (`dumbbells: [5, 7.5]`, `hasMat: true`), so a partial/old row is tolerated.
- `ALL_DUMBBELL_WEIGHTS` is the canonical dumbbell ladder `[2 … 25]` kg.

## How equipment flows through coaching

1. **UI/config** — Settings writes the profile via `saveEquipmentProfile`.
2. **Pre-session load picker** — `recommendWeight(ex)` (Workout Mode) reads the
   profile and returns `{ weight, available, repRange, adjustment }`. It prefers
   an owned load that appears in the exercise's `recommendedLoads`; otherwise it
   falls back to the closest program rung with a rep-range adjustment note. It
   never issues an unowned *increase*.
3. **Recommendation/coaching engine** — callers load the profile once and pass
   `availableWeights: number[]` (the owned dumbbell loads) in the config. With it
   set:
   - the "next rung" for a weighted overload is the next **owned** rung, and
   - a program rung above the current one that the user does not own is never
     recommended as `increase_weight` — the engine emits `kind: 'progress'`
     (priority 0.7) naming the needed load ("…top of your available
     dumbbells — add 12.5 kg…").
   Without `availableWeights` the engine behaves exactly as before (full ladder).
   The field is optional so legacy callers and tests stay valid.

## Freeze decision (RC1)

The equipment contract is **frozen for RC2+**. Do not change without a
versioned-migration or a documented API break:

- `EquipmentProfile` fields and storage key (`'equipment'`).
- `recommendWeight`'s return shape (`WeightRecommendation`).
- The `availableWeights?: number[]` config field on the recommendation, coach
  summary, notification, and weekly-report services.

Deferred (deliberately out of RC1 scope):

- **Haptics** — `@capacitor/haptics` is not installed; adding it requires a
  native sync and device reinstall. Recommended before the public release build.
- **Additional equipment categories** — the engine models dumbbells today;
  benches/bands/mats are recorded but do not yet constrain prescription. This is
  a RC2 coaching-signal enhancement, not a fix.

## Tests

- `recommendationEngine.test.mts` — equipment-aware overload cases: unowned
  rung never recommended as `increase_weight`; next-owned-rung step; non-ladder
  owned weight never the target; single qualifying session at the top owned rung
  ⇒ no prompt. Suite total **104/104**.
- Run: `npm test` · type-check: `npm run test:typecheck`.
