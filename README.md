# DailyForge

A native-feeling workout companion that sits over a structured 12-week dumbbell
program — no Wi-Fi needed, no server, no ads. Built with React + Vite +
TypeScript + Tailwind v4 + Capacitor.

## Features

- **Home dashboard** — today's session at a glance (or Rest & Mobility, or
  Program Complete), computed from a single stored program start date. Shows
  program progress bar, week/phase, consistency %, streak, and total workouts.
  Recommends starting loads per-exercise based on your experience level.
- **Workout Mode** — steps through today's session exercise by exercise with a
  built-in rest timer, adjustable reps, weight/load logging, and automatic
  progress to the next exercise. Ends with a summary screen: RPE, energy,
  duration, notes.
- **Workout Review** — post-workout breakdown showing title, duration, total
  reps, muscles trained, session highlights (PRs, longest sets), personal
  progress vs previous same-session, equipment used this workout, a next-
  session card, and milestone celebrations when earned.
- **Exercise Library** — all exercises browsable by Push / Pull / Legs / Core,
  with full coaching content and illustration images.
- **Exercise Detail** — setup, execution, breathing, tempo/sets/reps/rest,
  common mistakes, pro tips, progressions, regressions, safety notes, and a
  demo video link.
- **Progress → Overview** — training emphasis (muscle group volume with
  weighted-set credits), milestone history grouped by Consistency /
  Performance / Program with earn dates and progress bars, weekly consistency
  %, total reps logged, and average RPE trend charts (recharts), trimmed to
  only show weeks you've actually logged. Configurable daily training
  reminders with time picker.
- **Progress → Measurements** — checkpoint forms matching the program's
  scheduled progress weeks (weight, chest, waist, hips, arms, thighs, calves,
  neck, notes). Metric / Imperial toggle.
- **Progress → Photos** — front / side / back camera capture at each
  checkpoint, automatic before/after comparison, fullscreen tap-to-zoom
  viewer, replace and delete.
- **Milestones** — 15+ achievements across Consistency (streaks, total
  workouts), Performance (lifetime reps), and Program (week completion).
  Centralized unlock engine with date tracking persisted in localStorage.
  Celebrated inline on the Workout Review when newly earned.
- **Book tab** — bundled reference PDF (nutrition, recovery science, glossary,
  printable pages) opened in the system browser on native, or inline in dev.
- **Offline** — everything stored locally in IndexedDB (Dexie). No internet
  required.

## Stack

- **UI:** React 19 + TypeScript + Tailwind v4 + Framer Motion
- **Router:** HashRouter (Capacitor-friendly)
- **Storage:** Dexie (IndexedDB) — session logs, set logs, measurements, photos
- **Native:** Capacitor 8 — Android + iOS from a single codebase
- **Charts:** Recharts

## Architecture

### Data flow

**No exercise content is ever hardcoded in a component.** Every screen reads
through `src/lib/data.ts`, which imports `src/data/exercises.json` and
`src/data/program.json` — the same files that generate the printed program.
Run `npm run sync-data` to pull the latest JSON, illustrations, and PDF from
the book project (defaults to `../home-dumbbell-blueprint`).

### Storage model

- `sessionLogs` — one row per completed training day: date, week, session key,
  RPE, duration, energy, sleep, notes, load (kg/lbs), exercises completed.
- `setLogs` — one row per completed set: date, exercise ID, reps completed,
  weight, timestamp.
- `measurements` / `photos` — checkpoint data at scheduled progress weeks.
- `milestoneHistory` (localStorage) — permanently unlocked milestone dates,
  read on every app start. Computed client-side from session/set data; never
  stale.

### Program engine

`src/lib/programEngine.ts` is a pure function mapping "days since program
start" onto week number, day-of-week-in-cycle, and phase by reading
`program.week_table` and `program.weekly_template`. Change the program length
in JSON and it recalculates with no code changes.

All date arithmetic uses local-timezone parsing (`parseLocalDate` — splits the
ISO string and constructs `new Date(y, m-1, d)`) to avoid UTC offset
off-by-one errors.

### Notifications

`refreshDailyReminders()` cancels all pending notifications and re-schedules
only the next 55 training days on every app open — safely under iOS's 64-cap
and self-healing if the app isn't opened for weeks. Requires a notification
channel on Android 8+ (created automatically on first schedule). A test
button on Progress → Overview sends a notification in 30 seconds to confirm
the system works independent of the scheduling logic.

Notification branding: title "DailyForge", body `"Today's workout: {title}.
Time to train."` Android icon: monochrome white dumbbell vector at
`android/app/src/main/res/drawable/ic_notification.xml`.

### Weight recommendations

`src/lib/weights.ts` selects starting loads via per-exercise metadata rather
than category bands. Every exercise in `exercises.json` has a `recommendedLoads`
array with entries for beginner / intermediate / advanced experience and dumbbell
/ barbell variants, keyed by target rep range. `recommendWeight()` picks the
closest match; `getSessionWeightSummary()` groups loads by movement pattern
for the Workout Review; `getSessionVolume()` sums volume (kg × reps) across
all completed sets.

### Milestone engine

`src/lib/milestones.ts` centralises all 15+ achievements into a single
declarative system:
- **Definitions** — each milestone has an `id`, `title`, `category`
  (Consistency / Performance / Program), `description`, and an
  `unlockCondition(data)` function that receives real workout stats.
- **Data gathering** — `gatherMilestoneData()` scans all completed session and
  set logs to produce a snapshot: completed count, current streak, lifetime
  reps, sessions per week, etc.
- **State computation** — `computeMilestoneStates()` runs every definition
  against the data snapshot and returns each milestone's `unlocked` status,
  `unlockDate` (or null), and `progressCurrent / progressTarget` for locked
  progress bars.
- **Newly unlocked detection** — `getNewlyUnlockedMilestones(prevData,
  currentData)` diffs two snapshots, returning only milestones that flipped
  from locked to unlocked in the second snapshot.
- **Persistence** — unlock dates are written to `localStorage` under
  `df-milestone-history` so earned milestones persist across sessions.
  The computed date reflects the first session that satisfied the condition.

Progress → Overview shows all milestones grouped by category with checkmarks
and earn dates for unlocked items, or lock icons with progress bars for locked
ones. Workout Review calls `getNewlyUnlockedMilestones()` to detect what was
earned during the current workout and renders a golden celebration card.

## Getting started

```bash
npm install
npm run sync-data       # pull exercises.json, program.json, PDF, illustrations
npm run dev             # http://localhost:5173, works in browser
```

## Building for device

```bash
npm run build
npx cap add ios         # first time only
npx cap add android     # first time only
npm run cap:sync        # after every code change
npx cap open ios        # Xcode → run on device/simulator
npx cap open android    # Android Studio → run on device/emulator
```

On iOS, a free Apple ID works for 7 days at a time (re-run from Xcode to
refresh). A paid Developer account removes that limit and enables TestFlight.

## Project structure

```
src/
├── components/     # Reusable UI (Button, Card, StatCard, BottomNav, WeeklyTimeline)
├── data/           # exercises.json, program.json (auto-generated by sync-data)
├── lib/
│   ├── analytics.ts      # computeCurrentStreak, computeConsistency, PR detection
│   ├── data.ts           # re-exports exercises + program from JSON
│   ├── db.ts             # Dexie IndexedDB schema — sessionLogs, setLogs, measurements, photos
│   ├── equipment.ts      # equipment lookup and grouping helpers
│   ├── milestones.ts     # centralized milestone engine (definitions, unlock logic, persistence)
│   ├── notifications.ts  # daily reminder scheduling with refresh
│   ├── programEngine.ts  # pure fn mapping days-since-start → week, phase, today's session
│   ├── units.ts          # metric / imperial conversion
│   ├── utils.ts          # parseLocalDate, clamp, etc.
│   ├── weights.ts        # recommendWeight, getSessionWeightSummary, getSessionVolume
│   └── workoutState.ts   # workout mode state machine
├── pages/          # Home, WorkoutMode, WorkoutReview, ExerciseLibrary, ExerciseDetail,
│                   # Progress (Overview, Measurements, Photos), Book, Settings, Onboarding
└── App.tsx         # Root with HashRouter + routes + BottomNav shell
```
