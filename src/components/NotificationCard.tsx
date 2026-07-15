import { useState } from "react";
import { Bell, BellOff, BugPlay, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { useSettings } from "@/lib/SettingsContext";
import { getProgramStartDate } from "@/lib/db";
import {
  requestNotificationPermission,
  refreshDailyReminders,
  cancelAllReminders,
  scheduleTestNotification,
} from "@/lib/notifications";

export function NotificationCard() {
  const {
    loaded,
    notificationsEnabled,
    reminderTime,
    setNotificationsEnabled,
    setReminderTime,
  } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);
  const [justSavedTime, setJustSavedTime] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !notificationsEnabled;
    if (next) {
      const granted = await requestNotificationPermission();
      if (granted) {
        const start = await getProgramStartDate();
        if (start) await refreshDailyReminders(start, reminderTime);
        await setNotificationsEnabled(true);
      } else {
        setError(
          "Permission was not granted. Check your device Settings → Apps → this app → Notifications, then try again.",
        );
      }
    } else {
      await cancelAllReminders();
      await setNotificationsEnabled(false);
    }
    setBusy(false);
  }

  async function handleTimeChange(newTime: string) {
    await setReminderTime(newTime);
    if (notificationsEnabled) {
      setBusy(true);
      const start = await getProgramStartDate();
      if (start) await refreshDailyReminders(start, newTime);
      setBusy(false);
      setJustSavedTime(true);
      setTimeout(() => setJustSavedTime(false), 2500);
    }
  }

  async function runTest() {
    setTestSent(false);
    setError(null);
    await scheduleTestNotification();
    setTestSent(true);
  }

  return (
    <Card className="mt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15">
            {loaded && notificationsEnabled ? (
              <Bell size={18} className="text-orange-400" />
            ) : (
              <BellOff size={18} className="text-slate-500" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">
              Daily Training Reminder
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              One notification on each scheduled training day, automatically
              skipping rest days. Only fires from the installed app — not the
              browser preview.
            </p>
          </div>
        </div>

        <div className="shrink-0">
          {!loaded ? (
            <div className="h-7 w-12 animate-pulse rounded-full bg-white/10" />
          ) : (
            <button
              onClick={toggle}
              disabled={busy}
              aria-pressed={notificationsEnabled}
              className={cn(
                "relative block h-7 w-12 rounded-full transition-colors",
                notificationsEnabled ? "bg-blue-600" : "bg-white/15",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform",
                  notificationsEnabled && "translate-x-5",
                )}
              />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-slate-400" />
          <span className="text-sm text-slate-300">Reminder time</span>
        </div>
        <input
          type="time"
          value={reminderTime}
          onChange={(e) => handleTimeChange(e.target.value)}
          disabled={busy || !loaded}
          className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-sm text-white [color-scheme:dark]"
        />
      </div>
      {justSavedTime && (
        <p className="mt-2 text-xs text-emerald-400">
          Reminder time updated — training-day notifications rescheduled.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-white/10 pt-3">
        <button
          onClick={runTest}
          className="flex items-center gap-2 text-xs font-semibold text-slate-400"
        >
          <BugPlay size={14} />
          Send a test notification in 30 seconds
        </button>
        {testSent && (
          <p className="mt-2 text-xs text-slate-500">
            Scheduled — check the device console/logs if it doesn't arrive. Lock
            your screen or background the app so you actually see it.
          </p>
        )}
      </div>
    </Card>
  );
}
