import { Suspense, lazy, useEffect, useState } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { Home } from "@/pages/Home";
import { ExerciseLibrary } from "@/pages/ExerciseLibrary";
import { ExerciseDetail } from "@/pages/ExerciseDetail";
import { WorkoutMode } from "@/pages/WorkoutMode";
import { Book } from "@/pages/Book";
import { Settings } from "@/pages/Settings";
import { WorkoutReview } from "@/pages/WorkoutReview";
import { History } from "@/pages/History";
import { DebugPage } from "@/pages/Debug";
import { CoachPage } from "@/pages/Coach";
import { BottomNav } from "@/components/BottomNav";
import { SettingsProvider, useSettings } from "@/lib/SettingsContext";
import { ToastProvider } from "@/lib/toast";
import { getProgramStartDate } from "@/lib/db";
import { onDataChanged } from "@/lib/events";
import { refreshDailyReminders, refreshTodayCoachedNotification } from "@/lib/notifications";

const Progress = lazy(() =>
  import("@/pages/Progress").then((m) => ({ default: m.Progress })),
);

function Shell() {
  const location = useLocation();
  const { loaded, notificationsEnabled, reminderTime, navRefreshKey } = useSettings();
  const [hasStartDate, setHasStartDate] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loaded) return;
    getProgramStartDate().then((d) => setHasStartDate(d !== null));
  }, [loaded, navRefreshKey]);

  useEffect(() => {
    if (!loaded || !notificationsEnabled) return;
    let timer: number | undefined;
    // Any data mutation re-computes today's coached notification so an
    // already-scheduled notification never stays stale (debounced to coalesce
    // bursts such as the many set-log writes during a workout).
    const applyDataChanged = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const start = await getProgramStartDate();
        if (start) await refreshTodayCoachedNotification(start, reminderTime);
      }, 1500);
    };
    (async () => {
      const start = await getProgramStartDate();
      if (start) await refreshDailyReminders(start, reminderTime);
    })();
    const unsubscribe = onDataChanged(applyDataChanged);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, notificationsEnabled, reminderTime]);

  const isOnboarding = location.pathname === "/" && hasStartDate === false;
  const hideNav = location.pathname.startsWith("/workout") || location.pathname.startsWith("/review") || location.pathname.startsWith("/debug") || location.pathname.startsWith("/coach") || isOnboarding;

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<ExerciseLibrary />} />
        <Route path="/exercise/:id" element={<ExerciseDetail />} />
        <Route path="/workout/:sessionKey" element={<WorkoutMode />} />
        <Route path="/review/:date/:sessionKey" element={<WorkoutReview />} />
        <Route
          path="/progress"
          element={
            <Suspense fallback={null}>
              <Progress />
            </Suspense>
          }
        />
        <Route path="/history" element={<History />} />
        <Route path="/book" element={<Book />} />
        <Route path="/settings" element={<Settings />} />
        {/* Hidden developer routes — only reachable by typing /#/coach or /#/debug. */}
        <Route path="/coach" element={<CoachPage />} />
        <Route path="/debug" element={<DebugPage />} />
      </Routes>
      {!hideNav && <BottomNav />}
    </>
  );
}

function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </SettingsProvider>
    </ToastProvider>
  );
}

export default App;
