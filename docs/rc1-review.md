# RC1 Review Report

*Date: 2026-08-06 · Scope: Release polish pass + Equipment Engine architecture audit*

## What changed in this pass

### Settings UX audit
- **Accessibility** — focus-visible rings, `aria-label`/`aria-expanded`/
  `aria-controls`/`aria-pressed` on controls, equipment checkboxes rendered as
  labelled switches (`role="switch"`), removed a stray `as any`.
- **Copy** — trimmed verbose descriptions in Data & Backup, clarified restore
  confirmation wording, shortened "Save to device…"/"Share…" subtitles.
- **Backup/export metadata** — exports now record `lastBackupAt`
  (`db.settings`), and the UI shows "Last backup: …" plus "Backup format v{N}"
  (`BACKUP_FORMAT_VERSION` in `src/lib/backup.ts`).
- **About** — version/phase come from a new `src/lib/version.ts`
  (`APP_VERSION = '1.0.0'`, `APP_PHASE = 'RC1'`) instead of hardcoded literals.

### Equipment Engine architecture audit
- **Finding:** the recommendation engine, coach summary, notification engine,
  and weekly report were equipment-agnostic — the owned-dumbbell profile was
  only consulted by the pre-session weight picker. Overload prompts could
  prescribe rungs the user does not own.
- **Fix:** added an optional `availableWeights?: number[]` config field to all
  four services. When supplied, the next prescribed rung is the next **owned**
  rung; a program rung above the current one that the user does not own is never
  recommended as `increase_weight` — the engine emits `kind: 'progress'`
  (priority 0.7) naming the needed load. No `availableWeights` ⇒ unchanged full
  ladder (backward compatible).
- **Wiring:** Home, Insights, and the notification pipeline pass
  `eq.dumbbells` into every engine call.
- **Dead code removed:** `src/lib/intelligence.ts` (duplicated the engine, no
  imports/tests); README and roadmap references updated.
- **Tests:** 4 new equipment-aware overload cases; suite **104/104**.

### Cross-screen polish
- New shared `src/components/ui/Skeleton.tsx`.
- Overview, Insights, and History previously returned `null`/flashed empty copy
  while the DB load resolved — they now render skeletons (`aria-busy`).
- History search/filter inputs gained `aria-label`s.

## Verification

| Check | Result |
|---|---|
| `npm test` | 104/104 passing |
| `npm run test:typecheck` | clean |
| `npx tsc -b` | clean |
| `npm run lint` | 4 pre-existing warnings (SettingsContext, RestTimer ×2, Overview exhaustive-deps) — none new |
| `npm run build` | succeeds (pre-existing chunk-size advisory only) |

## Is the Equipment Engine production-ready?

**Yes, with the documented constraints.** The interface is now frozen for RC2+
(`equipment.ts`, `weights.ts`, `recommendWeight`, and `availableWeights` across
the coaching services — see `docs/services/equipment.md`). It is:
- deterministic and fully unit-tested for the unowned-rung case,
- backward compatible (the config field is optional),
- wired through every prescribing surface (Home, Insights, notifications,
  weekly report, Workout Mode pre-session picker).

Constraints worth knowing: only dumbbell loads constrain prescription today
(bench/bands/mat are recorded but not yet used); `recommendWeight` still guides
a closest-load-with-rep-adjustment when no owned load matches a ladder.

## Architectural concerns

1. **Coaching service layer is frozen, not finished.** Gemma (RC2) will consume
   the exact `src/services/` seam built for it. No RC1 change breaks that seam.
2. **Heuristic priorities remain hand-tuned** (documented in
   `recommendations.md`). Acceptable for RC1; not personalized.
3. **`availableWeights` is duplicated across four config types.** It is a small,
   stable contract and deliberately optional; a shared config type is a possible
   RC2 cleanup, not an RC1 blocker.
4. **No haptics.** `@capacitor/haptics` is not installed. Adding it requires a
   native sync and a device reinstall, so it is deferred to the release build —
   the one UX item intentionally not shipped in RC1 code.

## Is RC1 officially complete?

**Functionally yes; release-blocking polish remains on two tracks.**

Completed: equipment-aware coaching, Settings audit, loading-state consistency,
accessibility labels/rings, backup metadata, version module, dead-code removal,
and a 104/104 green suite.

Deferred (tracked, not blockers): haptics (release build), iOS "save to
gallery" writes to Documents instead of Photos, no 404 route, Photos object-URL
leak, milestone history in `localStorage` not cleared by reset flows. These are
P3 items already listed in `docs/vnext-proposal.md` Architecture Notes.

**Recommendation:** proceed to RC2 (Gemma coach) once the P3 list is triaged
and haptics is wired in the release build.
