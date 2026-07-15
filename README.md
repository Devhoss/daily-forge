# The Home Dumbbell Blueprint — Companion App (Phase 1)

A native-feeling workout companion for The Home Dumbbell Blueprint, built as a
different presentation layer over the **exact same data** that powers the
printed book — not a second copy of the content. Personal-use build
(sideload / TestFlight), no App Store distribution.

## What's in Phase 1

- **Home** — today's session at a glance, computed from a single stored
  program start date (Week X · Day Y · Push A/Pull A/etc., or Rest, or
  Program Complete).
- **Exercise Library** — all 30 exercises, browsable by Push/Pull/Legs/Core.
- **Exercise Detail** — the full coaching content (setup, execution,
  breathing, tempo/sets/reps/rest, mistakes, pro tips, progressions,
  regressions, safety) plus a Watch Demo link to the real video.
- **Workout Mode** — steps through today's session one exercise at a time
  with a built-in rest timer between sets, so you never touch a book or a
  separate timer app mid-set. Also captures actual reps completed per set
  (defaults to the exercise's target, adjustable with +/-). Ends with a
  quick session log (RPE, duration, energy, sleep, notes).
- **Book tab** — opens the bundled reference PDF (nutrition, recovery
  science, glossary, printable pages) for anything beyond daily training.
- **Offline** — everything (session logs, set logs) is stored locally via
  IndexedDB (Dexie). No internet required except to open a video link.

## What's in Phase 2

- **Progress → Overview** — three trend charts (recharts) built entirely
  from Phase 1's `sessionLogs`/`setLogs`: Weekly Consistency %, Total Reps
  Logged, Average RPE. Only shows weeks you've actually logged — no flat
  line of zeros stretching to Week 12 before you get there.
- **Progress → Measurements** — checkpoint forms for Weeks 1/4/8/12
  (`program.progress_checkpoints`), matching the book's exact fields
  (weight, chest, waist, hips, arms, thighs, calves, neck, notes).
- **Progress → Photos** — front/side/back capture at each checkpoint week
  (uses the device camera via a native file input — works in both a plain
  browser and the installed app), plus an automatic before/after comparison
  between your earliest and latest logged checkpoint.
- **Daily training reminders** — a toggle on the Progress tab. Schedules a
  rolling 55-day window of local notifications on training days only (skips
  rest days and stops after Week 12), refreshed automatically every time the
  app opens. Capped below iOS's hard 64-pending-notification limit on
  purpose — see "Notification scheduling" below. Only functions in the
  installed native app, not the browser preview.

**Not yet built (Phase 3):** anything beyond what's above — e.g. exporting a
personalized PDF report from your logged data, editing/deleting past log
entries, and a nicer native camera UI via `@capacitor/camera` (currently
using a plain file input, which already triggers the device camera on
mobile — functional, just not as polished as the native plugin's UI).

## The one rule this app follows

**No exercise content is ever hardcoded in a component.** Every screen reads
through `src/lib/data.ts`, which imports `src/data/exercises.json` and
`src/data/program.json` — the same files that generate the book. If you add
an exercise, fix a typo, or change the program in the book project, run:

```bash
npm run sync-data
```

This copies `exercises.json`, `program.json`, the built PDF, and every
illustration PNG from the book project into this app (defaults to
`../home-dumbbell-blueprint` as a sibling folder; pass a different path as
an argument if yours lives elsewhere:
`npm run sync-data -- /path/to/home-dumbbell-blueprint`).

**You mentioned you've already replaced all the demo illustrations** — run
`npm run sync-data` once you've got both projects on the same machine and
they'll be picked up automatically; nothing needs to change in the app code.

## Running it

```bash
npm install
npm run sync-data      # pull the latest exercises.json/program.json/PDF/illustrations
npm run dev            # http://localhost:5173, live in a normal browser tab
```

## Building the native app (do this on your own machine — needs Xcode/Android Studio)

This sandbox can build and type-check the web app, but can't compile actual
iOS/Android binaries (no Xcode or Android SDK here). On your machine:

```bash
npm run build             # produces dist/
npx cap add ios           # first time only
npx cap add android       # first time only
npm run cap:sync          # copies dist/ into the native projects, run after every change
npx cap open ios          # opens Xcode — run on your device or a simulator
npx cap open android      # opens Android Studio
```

For iOS, running on your own device via Xcode with a free Apple ID works for
7 days at a time (re-run from Xcode to refresh); a paid Apple Developer
account removes that limit and enables TestFlight.

## Architecture notes

- **Stack:** React + Vite + TypeScript + Tailwind v4 + Capacitor, matching
  your existing EchoDeck stack.
- **Offline storage:** Dexie (IndexedDB) rather than SQLite — simpler, no
  native plugin compilation step, and plenty for this data volume (a few
  hundred rows over months). See `src/lib/db.ts`.
- **Data model split intentionally:**
  - `sessionLogs` — one row per training day (mirrors the book's printed
    Workout Log row: date, RPE, duration, energy, sleep, notes).
  - `setLogs` — one row per completed set inside Workout Mode. This is the
    granular data Phase 3's rep/consistency trend graphs will read from.
  - `measurements` / `photos` tables are already defined (schema-only, no UI
    yet) so Phase 2 doesn't need a database migration to add them.
- **Program engine** (`src/lib/programEngine.ts`): a pure function mapping
  "days since program start" onto week number + day-of-week-in-cycle + phase,
  by reading `program.week_table` and `program.weekly_template` — change the
  program length in the JSON and this recalculates correctly with no code
  changes.
- **Router:** `HashRouter`, not `BrowserRouter` — deliberate, since Capacitor
  serves the app from a local file/custom scheme with no server to handle
  history-mode deep links.

### Notification scheduling

iOS enforces a hard cap of **64 pending local notifications** per app at any
time. A naive "schedule all ~72 remaining training days up front" approach
would silently fail to schedule the last several once that cap is hit. Instead
`refreshDailyReminders()` (`src/lib/notifications.ts`) cancels everything
pending and re-schedules only the next 55 days on every app open — safely
under the cap, and self-healing: as long as you open the app at least once
every ~7-8 weeks, the window keeps rolling forward and you'll never actually
run out of reminders. If you go longer than that without opening the app,
reminders simply stop until you open it again (no crash, no data loss — it
just re-fills the window from "today").

## Phase 2 polish round — what changed and what you need to do

**⚠️ Required after pulling this update:** several fixes touch native Android
config (`capacitor.config.ts`, the notification channel). These only take
effect after:

```bash
npm install          # picks up @capacitor/browser
npm run build
npx cap sync          # re-syncs native config into android/
```

...then **reinstall the app on your device from Android Studio** — just
refreshing the running app is not enough for native plugin/config changes.

### Fixes

0. **Reminder time is now configurable.** A time picker sits right in the
   reminder card (Progress → Overview) — defaults to 6:00 PM. Changing it
   immediately cancels and re-schedules every pending training-day
   notification at the new time (no need to toggle off/on). Stored as a
   global preference (`getReminderTime`/`setReminderTime` in `db.ts`), read
   by both the toggle-on flow and the every-app-open refresh in `App.tsx`.

1. **Daily reminders weren't actually scheduling.** The root cause: every
   error in `notifications.ts` was being silently swallowed by an empty
   `catch {}` — so if `schedule()` failed, you'd never know. Rewrote it to
   log every step (`checkPermissions`, `requestPermissions`, the exact
   notification array, `getPending()` before/after) to the device console,
   and added a real Android notification channel via
   `LocalNotifications.createChannel()` — **Android 8+ silently drops
   notifications with no channel**, even when `schedule()` resolves
   successfully and permission is granted. This is the single most likely
   cause of what you saw. There's now a **"Send a test notification in 30
   seconds"** button on the Progress → Overview tab, under the reminder
   toggle — use it to confirm the notification system itself works,
   independent of the day/session scheduling logic. Watch `adb logcat` or
   Android Studio's Logcat filtered to your app while testing; every step
   now logs with an `[notifications]` prefix.

   If the test notification still doesn't arrive after this fix, the next
   most likely cause is OEM battery optimization (Samsung/Xiaomi/Huawei
   especially) killing background scheduling — check your device's battery
   settings and exclude the app from optimization.

2. **Rest timer now says "Rest Time"** above the countdown.

3. **PDF wasn't opening on Android.** Android's WebView has no built-in PDF
   renderer — desktop Chrome does, which is why it worked in the dev server
   but not the installed app. Now hands off to the system browser via
   `@capacitor/browser` on native platforms (which does render PDFs), while
   still using the inline `<iframe>` preview on web/dev.

4. **Progress photos: retake/replace/delete.** Tapping an existing photo now
   opens a fullscreen viewer with tap-to-zoom, a Replace button (reopens the
   camera/file picker), and a Delete button (with a confirm step so you
   can't lose a photo by mis-tapping).

5. **Measurement units.** Added a Metric (cm/kg) / Imperial (in/lb) toggle
   at the top of the Measurements tab — a global preference, not per-field.
   Values are always stored internally in metric and converted for
   display/input, so switching units later never corrupts existing data.
   Every field label now shows its active unit.

### UI improvements

- **Home screen** redesigned into an actual dashboard: a program-progress
  bar (% through the full 12 weeks), a phase label, a 3-stat row (this
  week's consistency %, current training streak, all-time sessions
  completed), and a small rotating tip reflecting the program's actual
  training philosophy (fixed-load progression, tempo, deloads) — not
  generic filler copy.
- **Reminder card** rebuilt with a bell icon, tighter spacing, clearer
  copy, and the debug test button described above.

### Nice-to-have UX

- **Measurements:** keyboard "next" now moves to the next field in order,
  the last field's "done" saves, and every input scrolls itself into view
  on focus so the keyboard never covers what you're typing.
- **Photos:** tap an existing photo for a fullscreen tap-to-zoom viewer with
  Replace/Delete. Note: this is tap-to-zoom (tap once to zoom in centered,
  tap again to zoom out), not full pinch-gesture zoom — a deliberate scope
  cut to avoid pulling in a gesture-handling library for Phase 2; pinch
  support is an easy Phase 3 add if you want it.

## Suggested next steps (Phase 3)



1. A "your 12-week journey" PDF report generated from real logged data —
   would need a client-side PDF library (`jspdf` or `pdf-lib`) since
   WeasyPrint (Python) isn't available inside the app; a good scope split is
   summary stats + a photo grid, not a full re-implementation of the book's
   layout.
2. Editing/deleting past `sessionLogs`/`setLogs`/`measurements` entries —
   Phase 1/2 only support creating and overwriting the current day/week, not
   browsing and correcting history.
3. Swap the Photos capture `<input capture>` for `@capacitor/camera` (already
   installed, unused so far) for a native camera viewfinder UI instead of the
   OS's default file picker.
