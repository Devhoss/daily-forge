import { Suspense, lazy, useEffect } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { Home } from "@/pages/Home";
import { ExerciseLibrary } from "@/pages/ExerciseLibrary";
import { ExerciseDetail } from "@/pages/ExerciseDetail";
import { WorkoutMode } from "@/pages/WorkoutMode";
import { Book } from "@/pages/Book";
import { BottomNav } from "@/components/BottomNav";
import { SettingsProvider, useSettings } from "@/lib/SettingsContext";
import { getProgramStartDate } from "@/lib/db";
import { refreshDailyReminders } from "@/lib/notifications";

const Progress = lazy(() =>
  import("@/pages/Progress").then((m) => ({ default: m.Progress })),
);

function Shell() {
  const location = useLocation();
  const { loaded, notificationsEnabled, reminderTime } = useSettings();
  const hideNav = location.pathname.startsWith("/workout");

  useEffect(() => {
    if (!loaded || !notificationsEnabled) return;
    (async () => {
      const start = await getProgramStartDate();
      if (start) await refreshDailyReminders(start, reminderTime);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, notificationsEnabled, reminderTime]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<ExerciseLibrary />} />
        <Route path="/exercise/:id" element={<ExerciseDetail />} />
        <Route path="/workout/:sessionKey" element={<WorkoutMode />} />
        <Route
          path="/progress"
          element={
            <Suspense fallback={null}>
              <Progress />
            </Suspense>
          }
        />
        <Route path="/book" element={<Book />} />
      </Routes>
      {!hideNav && <BottomNav />}
    </>
  );
}

function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SettingsProvider>
  );
}

export default App;
