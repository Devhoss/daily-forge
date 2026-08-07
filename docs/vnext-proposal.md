# DailyForge vNext — Roadmap & Execution Plan

*Approved direction. This document is the living execution plan; every future roadmap proposal opens with an updated Project Health Report.*

---

## Project Health Report

*Status: Phase 1 (Foundation) shipped — migration, backup/restore, weight logging, PR engine, milestones.*

| Metric | Rating | Notes |
|---|---|---|
| **Overall completion (v1)** | **~92%** | Functional ~98%; polish ~85%. Core loop plus trust/safety (backup, migration, load logging, PRs) are done; RC1 polish (Settings audit, loading-state consistency, accessibility, equipment-aware coaching) is complete. |
| **Architecture health** | **A−** | Clean layering (engine / data / pages), JSON-first content, pure program engine. Data model now expresses *load used*; versioned migration path in place; versioned, tolerant backup contract; PR logic extracted to a reusable lib. Equipment is a centralized, frozen capability (`docs/services/equipment.md`); coaching/analytics form a pure service layer. |
| **Technical debt level** | **Low** | P1 and P2 blockers (migration, backup, weightUsed) cleared; dead `intelligence.ts` removed; equipment interface frozen for RC2+. Remaining P3 nits listed in Architecture Notes. |
| **UX polish level** | **~85%** | Strong animation/motion and content depth; loading/empty/error states now consistent (shared `Skeleton`); accessibility labels/rings added to Settings + History; haptics deferred to the release build (plugin not yet installed). |
| **Release readiness** | **Improving** | Backup + migration blockers cleared. Remaining: iOS parity gaps, loading/empty-state consistency, and tuning the new recovery/progression heuristics. |
| **Risks introduced by Phase 2** | — | See below. |

**Phase 2 risks (introduced by the next planned work):**
1. **Analytics correctness.** Trend slopes, recovery scores, and overload suggestions must be defensible and deterministic; a wrong heuristic silently mis-coaches. Mitigate with a service-layer test harness and explicit undefined-data policy (unweighted sets never treated as `0`).
2. **Service seam stability.** Everything the future Gemma coach will consume ships now. The `src/services/` API must be stable and pure (typed inputs in, plain data out) or the coach becomes another refactor.
3. **Weekly Report scope creep.** The report is a retention hook; resist turning it into a dashboard. Ship the data service first, the page second, notification last.
4. **Loading/empty states for new surfaces.** New analytics pages inherit the existing inconsistency unless wrapped with the shared state patterns established in Phase 1.

---

## Vision

DailyForge is **not** trying to become Strong, Hevy, or Fitbod.

Its identity is:

> **An offline personal fitness coach that guides a structured transformation, remembers your entire journey locally, and gradually adapts to the user — without subscriptions, accounts, or cloud services.**

Every future feature must strengthen that identity:
- **Coach**, not tracker. Decisions are explained, not just recorded.
- **Remembers your journey** — photos, measurements, milestones, and the narrative of months of training live on the device, forever.
- **Gradually adapts** — the rules that coach progression today become the on-device AI that explains it tomorrow.
- **No cloud, no accounts, no subscriptions** — privacy and ownership are the product.

---

## Roadmap

### Phase 1 — Foundation ✅ SHIPPED

Blockers. Nothing intelligent is added until these exist.

1. **Backup & Restore** — ✅ complete export/import of: settings, workout history, measurements, milestones, photos, equipment profile, program start date. Single portable versioned file, forward-compatible, tested both directions (`scripts/verify-backup-roundtrip.mjs`, 20/20 checks).
2. **Database Versioning** — ✅ real migration strategy on the Dexie schema (`version(1)` → upgrade path), so schema additions never require wiping data.
3. **Weight Logging** — ✅ record per set: weight used, variation used, and bodyweight where applicable. Foundation for PRs, progression, recommendations, and AI.
4. **Exercise PR Engine** — ✅ per-exercise records: best weight, best reps, best volume, longest hold, best estimated 1RM. Celebrated on Workout Review, surfaced in Overview; PR logic lives in a reusable, testable lib layer.

**Done when:** ✅ a user can back up everything, restore onto a fresh device, log load per set, and see per-exercise PRs.

### Phase 2 — Training Intelligence (Current)

After the foundation. Real analytics, not charts. Every deliverable is a **reusable data service** behind a stable API: the screens render the output, and the local coach (Phase 4) calls the exact same functions. This seam is built now so Gemma needs no refactor later.

- **Trend Engine** — calculate, not just display: consistency trend, recovery trend, training-volume trend, average RPE trend, average session length, weekly volume. Reusable analytics feeding every screen (`analytics.ts` currently computes only period averages — add slopes).
- **Weekly Report** — for every completed week, generate: workouts completed, consistency, training emphasis, measurements, milestones earned, PRs, streak, recovery, next week's focus. A page in-app and a natural notification hook.
- **Recovery Score** — a defensible, deterministic recovery heuristic (recent RPE/volume/frequency, rest days, consecutive-day load) surfaced as a single score plus a plain-language explanation. Feeds the weekly report and future session pacing.
- **Progressive Overload suggestions** — rules-driven next-step recommendations (raise weight when reps hit the top of range, tempo progression when weight is unavailable, unilateral variation when tempo is mastered, deload on poor recovery) per exercise from recorded performance + equipment. Deterministic; no AI.

**Architecture:** all four live in `src/services/` as pure, testable functions — typed inputs in, plain data objects out. No UI imports, no storage/timer coupling, no component-owned state. Existing component logic (`Overview.tsx:212-236`, `WorkoutReview.tsx:71-92`, recovery/progression heuristics) is extracted onto this seam.

**Done when:** a user can open a weekly report, see a trend and recovery score for the period, and receive a deterministic next-step suggestion per exercise — all produced by services the Gemma coach can also call.

### Phase 3 — Adaptive Coaching

Where DailyForge becomes unique. **Deterministic, rules-only. No AI yet.** Wires the Phase 2 services into an event-driven rule engine — the deterministic overload/recovery output already ships as services in Phase 2; Phase 3 makes recommendations automatic and event-triggered.

- **Coaching rule engine.** Rules fire on recorded data, e.g.:
  - Reached top of rep range → recommend increasing weight.
  - Weight unavailable → recommend tempo progression.
  - Tempo mastered → recommend unilateral variation.
  - Recovery poor → recommend an easier session.
- **Equipment Evolution** — replace category-based recommendations. Each exercise owns a recommendation profile (Goblet Squat: 5kg → rep range/tempo/difficulty/progression rule; 10kg → …; 15kg → …). Recommendations depend on **exercise + available equipment + previous performance**, never on category alone. Equipment influences recommendations — it never rewrites the program.

### Phase 4 — Offline AI

Only after the deterministic engine exists. The **Gemma** coach consumes the `src/services/` layer built in Phase 2 — no new data plumbing.

- The AI **never invents advice** — it explains decisions already made by the rule engine.
- Potential features: workout summary, coach notes, weekly narrative, recovery explanation, progress explanation, measurement summary, trend narration, natural-language session journal.
- Everything offline. No cloud, no chatbot, no generic assistant.

### Phase 5 — Motivation

- **Separate Milestones from Achievements.**
  - *Milestones* = program progression (week N complete, program complete).
  - *Achievements* = interesting, permanent collectibles (First Workout, Never Miss Monday, 100 Push-ups, Early Bird, Night Owl, Iron Will, Consistency King, etc.).
- **Seasonal Recaps** — generate Summer / Autumn / Year-in-Review showing: hours trained, reps completed, measurements, best streak, favorite exercises, biggest improvements, PR count. Should feel special.

---

## UX Improvements (continuous)

Priorities: consistent loading states · empty states · accessibility · haptics · animations · better transitions · unified duration formatting · error handling · backup before destructive actions.

---

## What NOT to Build Yet

Do not start: cloud sync · subscriptions · communities · leaderboards · wearable integrations · multiple workout programs. These belong after v1.

---

## Immediate Next Sprint (Phase 2)

1. **Trend Engine service** — slope-based trends (consistency, volume, RPE, session length) as pure functions + tests.
2. **Weekly Report service** — assembles trends + PRs + milestones + streak + measurements into a typed report object + tests (page next).
3. **Recovery Score service** — deterministic heuristic + explanation builder + tests.
4. **Progressive Overload suggestion service** — per-exercise next-step rules from performance + equipment + tests.
5. **UI:** weekly report page and trend/recovery surfaces rendering the services (shared loading/empty states).
6. **Notification hook** (after the page ships): weekly report as a natural check-in.

Only when the Phase 2 services and their screens ship do we move into Phase 3 (adaptive coaching) and beyond. Each future roadmap proposal opens with an updated Project Health Report tracking how close DailyForge is to a true v1.

---

## Release Candidate Roadmap

*Status: Phases 1–4 shipped (M1–M7). DailyForge is functionally complete; the remaining work is release polish and the on-device coach.*

| Milestone | Status | Delivered |
|---|---|---|
| **Phase 1 — Foundation** | ✅ | Migration, backup/restore, weight logging, PR engine, milestones. |
| **Phase 2 — Coaching Services** | ✅ | Trend Engine, Weekly Report, Recovery Score — pure, tested `src/services/` seam. |
| **Phase 3 — Home Experience** | ✅ | Recommendation Engine (M4), Home dashboard (M5), Insights screen (M6). |
| **Phase 4 — Notifications** | ✅ | Notification Engine (M7) — coached, importance-gated, expiring, anti-spam. |

---

**RC1 — Release Polish**
- ✅ Coaching Experience & Insights polish (in progress)
  - ✅ Insights information architecture — related recommendations grouped
    (`groupRecommendations`: "Milestones Ahead", "Hold Progression")
  - ✅ Prioritization — Critical/High/Normal/Low; Home keeps highest-value only,
    Insights shows all grouped + ordered by importance
  - ✅ Reduced information density — recommendation reasoning trimmed to 1–2
    concise, factual bullets
  - ✅ Confidence as a compact chip/badge (Home + Insights), not a full row
  - ✅ Trend empty states as unlockable insights ("Locked" + one-more-week hint)
  - ✅ Recovery card hierarchy — "Ready • 69/100" + coach-style reading order
  - ✅ Weekly Focus evolution surfaced via program week-table metadata
  - ✅ Coach Summary card (top of Insights) — deterministic orchestrator of
    existing services (`buildCoachSummary`), the seam RC2's Gemma will replace
- ✅ Equipment Engine architecture audit — equipment centralized as a capability
  - ✅ `availableWeights` config threaded through the recommendation engine,
    coach summary, notification engine, and weekly report; overload never
    prescribes an unowned rung (emits equipment-capped `progress` instead)
  - ✅ Home, Insights, and the notification pipeline pass the owned-dumbbell
    profile into every engine call
  - ✅ Unit tests guard the no-unavailable-weight rule (suite 104/104)
  - ✅ Interface frozen for RC2+ (`equipment.ts`, `weights.ts`,
    `recommendWeight` signature); documented in `docs/services/equipment.md`
- ✅ Settings UX audit — a11y focus rings + labels, destructive-action copy,
  backup/export metadata (last-backup timestamp + format version), About via
  new version module (`src/lib/version.ts`); dead `lib/intelligence.ts` removed
- ✅ Loading-state consistency — shared `Skeleton` component; Overview, Insights,
  and History no longer flash blank/null while DB loads resolve
- ✅ Accessibility — aria-labels on History search/filter, Settings controls
- ✅ Event-driven freshness — `docs/services/data-events.md`: every data mutation
  (workout/measurements/photos/settings/restore) emits a `data-changed` event;
  Home, Insights, Overview, and the notification rescheduler subscribe and
  recompute; services stay pure. Home's Recovery card acknowledges today's
  completed session so a post-workout refresh is visible. Suite 108/108.
- UI polish & bug fixes
- Animations
- Accessibility
- Performance
- Settings review
- **Haptics — deferred to release build** (`@capacitor/haptics` not installed;
  wiring it requires a native sync + device reinstall, out of scope for RC1 code)

**RC2 — Local Gemma Coach**
- On-device coach consuming the existing `src/services/` layer (no new data plumbing)
- AI explains rule-engine decisions; never invents advice

**Phase 5 — Health Adapter Layer** *(future)*
- Samsung Health · Google Health Connect · Apple Health
- Optional enhancements that raise recovery confidence — never a requirement

---

## Architecture Notes (from the approved proposal, retained)

### Technical debt ranked
- **P1 — (cleared)** data model couldn't express load used; `SetLog` now records `weightUsed`/variation/bodyweight. Foundation of PRs, trends, adaptive coaching, and AI.
- **P2 — (cleared)** no migration strategy; Dexie now has a versioned `upgrade()` path. Schema additions no longer force wipes.
- **P2 — (cleared)** no backup/export; full versioned, tolerant export/import ships (photos included), verified 20/20.
- **P2 — logic duplicated in UI.** PR detection was extracted; muscle-group classification (three copies) and recovery/progression heuristics still live in components — Phase 2 extracts them into `src/services/`.
- **P3 — accuracy nits:** milestone history in `localStorage` not cleared by reset flows; `currentStreak` computed but never used; mid-hold exit restarts the timer; `Photos.tsx` object-URL leak; no 404 route; iOS "save to gallery" writes to Documents, not Photos. *(The old hold-exercise mis-scoring heuristic lived in the now-deleted `src/lib/intelligence.ts`; hold progression is covered by the recommendation engine's tests — suite 104/104.)*

### Competitive position (condensed)
- **DailyForge surpasses:** per-exercise coaching depth (setup/execution/breathing/mistakes/pro-tips/progressions), mechanical-progression program (tempo/density/ROM/unilateral/drop sets) that Strong/Hevy can't coach, offline+private+zero-cost model, milestone system.
- **Differentiation:** own *technique-based coaching* (no competitor optimizes mechanics, only weight); recorded-vs-planned honesty; best first-workout baseline experience; progress photos as emotional anchor; weekly report card as the "being checked on" retention hook.
- **Do not copy:** leaderboards/communities, subscription-paywalled analytics, Fitbod-style auto-workout generation (this program is fixed — coaching *within* it is the identity).


Phase 5 — Health Integrations & Adaptive Recovery (Future)
Vision

DailyForge should always work completely offline with no external accounts or integrations.

Health integrations are enhancements, never requirements.

The coaching experience must remain fully functional using DailyForge's own workout history alone.

External health data simply increases the confidence and accuracy of recommendations.

Design Philosophy

DailyForge never talks directly to Samsung Health, Apple Health, Google Health Connect, or wearables.

Instead, introduce a dedicated Health Adapter Layer.

Samsung Health
Google Health Connect
Apple Health
Garmin
Fitbit
Galaxy Watch

        │

        ▼

Health Adapter Layer

        │

        ▼

Normalized Health Signals

        │

        ▼

Recovery Engine

        │

        ▼

Recommendation Engine

        │

        ▼

Home
Insights
Notifications
Weekly Reports
Gemma Coach

The Recovery Engine should never know where the data came from.

It only consumes normalized health signals.

Supported Health Signals

Possible future inputs include:

Sleep
Total sleep duration
Sleep quality
Sleep stages (if available)
Bedtime consistency
Activity
Daily steps
Distance walked
Floors climbed
Active minutes
Recovery
Resting Heart Rate
Heart Rate Variability (HRV)
Stress score
Body Battery / Energy score (if available)
Body
Weight
Body fat %
Muscle mass
Hydration
Cardio
VO₂ Max
Resting cardiovascular trend
Recovery Engine Evolution

Today's Recovery Engine already evaluates:

Recent workload
RPE
Consistency
Planned rest
Time since last workout
Weekly trend

Future versions should simply receive additional signals.

Example:

computeRecovery({
    workoutSignals,
    healthSignals,
    lifestyleSignals,
    asOf
})

No architectural redesign should be required.

Confidence

Recovery confidence should evolve automatically.

Example:

Medium Confidence

Workout history only.

High Confidence

Workout history

Sleep

Steps

HRV

Resting Heart Rate

The engine should always explain why confidence is high or low.

Explainability

Every health signal should appear as a Recovery contributor.

Example:

Recovery

81

Why?

+ 8h 14m sleep

+ Planned recovery day

+ HRV above baseline

− Heavy lower-body session

− 13,000 steps yesterday

The system should never produce "magic numbers."

Every recommendation must remain explainable.

Gemma Integration

Gemma should never calculate recovery itself.

Instead it should consume the Recovery Engine output.

Example:

Recovery Engine

↓

Recovery Analysis

↓

Gemma

↓

"You've recovered well after yesterday's session, but your sleep was shorter than usual. I'd keep today's workout as planned but avoid adding extra sets."

The AI becomes a translator and coach—not the source of truth.

Design Principles
Health integrations are optional.
DailyForge remains fully functional without them.
External data increases confidence rather than replacing existing logic.
Recovery remains deterministic.
All recommendations remain explainable.
Every new provider plugs into the Health Adapter layer without changing the Recovery Engine.