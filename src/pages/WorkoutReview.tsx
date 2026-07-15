import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getSessionLog, getAllSetLogs } from "@/lib/db";
import { program } from "@/lib/data";
import { Button } from "@/components/ui/Button";
import type { SessionLog, SetLog } from "@/lib/db";

export function WorkoutReview() {
  const { sessionKey, date } = useParams<{ date: string; sessionKey: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<SessionLog | undefined>();
  const [setLogs, setSetLogs] = useState<SetLog[]>([]);
  const [totalReps, setTotalReps] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const session = sessionKey ? program.sessions[sessionKey] : undefined;

  useEffect(() => {
    if (!sessionKey || !date) return;
    (async () => {
      const [sessionLog, allSetLogs] = await Promise.all([
        getSessionLog(date, sessionKey),
        getAllSetLogs(),
      ]);
      setLog(sessionLog);
      const mySetLogs = allSetLogs.filter(
        (l) => l.date === date && l.sessionKey === sessionKey,
      );
      setSetLogs(mySetLogs);
      setTotalReps(mySetLogs.reduce((s, l) => s + (l.repsCompleted ?? 0), 0));
      setLoaded(true);
    })();
  }, [sessionKey, date]);

  if (!loaded || !sessionKey) {
    return (
      <div className="safe-top flex min-h-screen items-center justify-center px-5 pt-8">
        <p className="text-sm text-slate-500">Loading\u2026</p>
      </div>
    );
  }

  if (!log) {
    return (
      <div className="safe-top min-h-screen px-5 pt-8 text-white">
        <p className="text-sm text-slate-400">No workout found for this date.</p>
        <Button size="lg" className="mt-6" onClick={() => navigate("/")}>
          Back to Home
        </Button>
      </div>
    );
  }

  const title = session?.title.split("—")[0].trim() ?? sessionKey;
  const exerciseCount = session?.exercises.length ?? 0;
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const statCards = [
    { label: "Exercises", value: String(exerciseCount) },
    { label: "Duration", value: `${log.durationMin ?? "\u2014"}m` },
    { label: "Total Reps", value: String(totalReps) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="safe-top min-h-screen px-5 pb-10 pt-8 text-white"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm text-slate-400 transition hover:bg-white/20"
        >
          &larr;
        </button>
        <h1 className="text-lg font-bold">Workout Review</h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mt-6 rounded-2xl border border-white/10 bg-[var(--color-bg-raised)] p-5"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {formattedDate}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold leading-tight text-white">
          {title}
        </h2>
        <p className="mt-0.5 text-sm font-medium text-slate-400">
          Week {log.weekNumber}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mt-4 grid grid-cols-3 gap-2.5"
      >
        {statCards.map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-white/5 px-3 py-2.5 text-center"
          >
            <p className="text-lg font-extrabold tabular-nums text-white">
              {s.value}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {s.label}
            </p>
          </div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="mt-4 space-y-2"
      >
        {log.rpe != null && (
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Effort (RPE)</span>
            <span className="text-sm font-bold tabular-nums text-orange-400">
              {log.rpe}/10
            </span>
          </div>
        )}
        {log.energy != null && (
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Energy</span>
            <span className="text-sm font-bold tabular-nums text-white">
              {log.energy}/5
            </span>
          </div>
        )}
        {log.notes && (
          <div className="rounded-xl bg-white/5 px-3.5 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Notes</span>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              {log.notes}
            </p>
          </div>
        )}
        <div className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5">
          <span className="text-xs font-semibold text-slate-300">Sets Logged</span>
          <span className="text-sm font-bold tabular-nums text-white">
            {setLogs.length}
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="mt-8"
      >
        <Button size="lg" className="w-full" onClick={() => navigate("/")}>
          Back to Home
        </Button>
      </motion.div>
    </motion.div>
  );
}
