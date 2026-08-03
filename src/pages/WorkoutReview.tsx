import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getSessionLog, getAllSetLogs, getAllSessionLogs, getProgramStartDate } from "@/lib/db";
import { getExercisesForSession, program } from "@/lib/data";
import { getNextWorkoutLabel, getTodayInfo } from "@/lib/programEngine";
import { computeCurrentStreak } from "@/lib/analytics";
import { gatherMilestoneData, getNewlyUnlockedMilestones } from "@/lib/milestones";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDuration } from "@/lib/utils";
import { humanizeEquipment } from "@/lib/equipment";
import type { SessionLog, SetLog } from "@/lib/db";
import type { Exercise } from "@/types";
import { Dumbbell, Moon, ArrowRight, Clock, Zap, Target, Sparkles, TrendingUp, MessageSquare, Hexagon, Lightbulb } from "lucide-react";

/* ---------- helpers ---------- */

function uniqueMuscles(exercises: Exercise[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ex of exercises) {
    for (const m of ex.muscles_primary) {
      const clean = m.split("(")[0].trim();
      if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
    }
  }
  return out;
}

function uniqueEquipment(exercises: Exercise[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ex of exercises) {
    for (const eq of ex.equipment) {
      const name = humanizeEquipment(eq);
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

function parseMinSets(setsField: string): number {
  const m = setsField.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 3;
}

/* ---------- Highlights ---------- */

interface Highlight {
  icon: React.ReactNode;
  text: string;
}

function computeHighlights(
  log: SessionLog,
  setLogs: SetLog[],
  allSessionLogs: SessionLog[],
  allSetLogs: SetLog[],
  streak: number,
  sessionKey: string,
): Highlight[] {
  const highlights: Highlight[] = [];
  const completed = allSessionLogs.filter((s) => s.completed);
  const thisDuration = log.durationMin ?? 0;
  const thisReps = setLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);

  const longestEver = Math.max(...completed.map((s) => s.durationMin ?? 0), 0);
  if (thisDuration > 0 && thisDuration >= longestEver) {
    highlights.push({
      icon: <Clock size={14} className="text-orange-400" />,
      text: `Longest workout so far`,
    });
  }

  const sessionRepCounts = new Map<string, number>();
  for (const sl of completed) {
    const sets = allSetLogs.filter((l) => l.date === sl.date && l.sessionKey === sl.sessionKey);
    const reps = sets.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
    const key = `${sl.date}-${sl.sessionKey}`;
    sessionRepCounts.set(key, reps);
  }
  const maxRepsEver = Math.max(...sessionRepCounts.values(), 0);
  if (thisReps > 0 && thisReps >= maxRepsEver) {
    highlights.push({
      icon: <Zap size={14} className="text-blue-400" />,
      text: `Highest rep count`,
    });
  }

  const exercises = getExercisesForSession(sessionKey);
  const expectedSets = exercises.reduce((sum, ex) => sum + parseMinSets(ex.sets), 0);
  if (setLogs.length >= expectedSets) {
    highlights.push({
      icon: <Target size={14} className="text-emerald-400" />,
      text: `Completed every planned set`,
    });
  }

  if (streak >= 3) {
    const streakTargets = [3, 5, 7, 10, 15, 20, 30, 50, 75, 100];
    for (const t of streakTargets) {
      if (streak === t) {
        highlights.push({
          icon: <Sparkles size={14} className="text-yellow-400" />,
          text: `${t}-day streak!`,
        });
        break;
      }
    }
  }

  const sameSessionLogs = completed.filter((s) => s.sessionKey === sessionKey && s.date !== log.date);
  const sameDurations = sameSessionLogs.map((s) => s.durationMin ?? 999);
  const minSame = Math.min(...sameDurations, 999);
  if (thisDuration > 0 && sameSessionLogs.length > 0 && thisDuration <= minSame) {
    const sessionLabel = program.weekly_template.find((d) => d.session_key === sessionKey)?.label ?? "";
    highlights.push({
      icon: <Clock size={14} className="text-emerald-400" />,
      text: `Fastest ${sessionLabel} session`,
    });
  }

  return highlights;
}

/* ---------- Personal Progress ---------- */

interface ProgressDiff {
  key: string;
  value: string;
  positive: boolean;
}

function computeProgress(
  log: SessionLog,
  setLogs: SetLog[],
  allSessionLogs: SessionLog[],
  allSetLogs: SetLog[],
  sessionKey: string,
): ProgressDiff[] {
  const completed = allSessionLogs.filter((s) => s.completed && s.sessionKey === sessionKey && s.date < log.date).sort((a, b) => b.date.localeCompare(a.date));
  const prev = completed[0];
  if (!prev) return [];

  const diffs: ProgressDiff[] = [];

  const prevSets = allSetLogs.filter((l) => l.date === prev.date && l.sessionKey === prev.sessionKey);
  const currReps = setLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
  const prevReps = prevSets.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
  const repDiff = currReps - prevReps;
  if (repDiff !== 0) {
    diffs.push({
      key: "Reps",
      value: repDiff > 0 ? `+${repDiff}` : `${repDiff}`,
      positive: repDiff > 0,
    });
  }

  const currDur = log.durationMin ?? 0;
  const prevDur = prev.durationMin ?? 0;
  const durDiff = currDur - prevDur;
  if (durDiff !== 0 && currDur > 0 && prevDur > 0) {
    diffs.push({
      key: "Duration",
      value: durDiff < 0 ? `${Math.abs(durDiff)}m faster` : `${durDiff}m longer`,
      positive: durDiff < 0,
    });
  }

  if (log.rpe != null && prev.rpe != null && log.rpe !== prev.rpe) {
    diffs.push({
      key: "RPE",
      value: log.rpe > prev.rpe ? `${log.rpe}/10 (harder)` : `${log.rpe}/10 (easier)`,
      positive: log.rpe <= prev.rpe,
    });
  }

  const setDiff = setLogs.length - prevSets.length;
  if (setDiff !== 0) {
    diffs.push({
      key: "Sets",
      value: setDiff > 0 ? `+${setDiff}` : `${setDiff}`,
      positive: setDiff > 0,
    });
  }

  return diffs;
}

/* ========== Main component ========== */

export function WorkoutReview() {
  const { sessionKey, date } = useParams<{ date: string; sessionKey: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<SessionLog | undefined>();
  const [setLogs, setSetLogs] = useState<SetLog[]>([]);
  const [allSessionLogs, setAllSessionLogs] = useState<SessionLog[]>([]);
  const [allSetLogs, setAllSetLogs] = useState<SetLog[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const session = sessionKey ? program.sessions[sessionKey] : undefined;
  const exercises = useMemo(() => (sessionKey ? getExercisesForSession(sessionKey) : []), [sessionKey]);

  useEffect(() => {
    if (!sessionKey || !date) return;
    (async () => {
      const [sessionLog, allSessions, allSets, sd] = await Promise.all([
        getSessionLog(date, sessionKey),
        getAllSessionLogs(),
        getAllSetLogs(),
        getProgramStartDate(),
      ]);
      setLog(sessionLog);
      const mySetLogs = allSets.filter(
        (l) => l.date === date && l.sessionKey === sessionKey,
      );
      setSetLogs(mySetLogs);
      setAllSessionLogs(allSessions);
      setAllSetLogs(allSets);
      setStartDate(sd);
      setLoaded(true);
    })();
  }, [sessionKey, date]);

  const streak = useMemo(() => {
    if (!startDate) return 0;
    return computeCurrentStreak(allSessionLogs, startDate);
  }, [allSessionLogs, startDate]);

  const highlights = useMemo(() => {
    if (!log) return [];
    return computeHighlights(log, setLogs, allSessionLogs, allSetLogs, streak, sessionKey ?? "");
  }, [log, setLogs, allSessionLogs, allSetLogs, streak, sessionKey]);

  const progress = useMemo(() => {
    if (!log) return [];
    return computeProgress(log, setLogs, allSessionLogs, allSetLogs, sessionKey ?? "");
  }, [log, setLogs, allSessionLogs, allSetLogs, sessionKey]);

  const totalReps = useMemo(
    () => setLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0),
    [setLogs],
  );

  const tomorrowInfo = useMemo(() => {
    if (!startDate || !date) return null;
    const todayInfo = getTodayInfo(startDate, new Date(date + "T00:00:00"));
    const nextLabel = getNextWorkoutLabel(todayInfo.dayIndex);
    const tomorrowDate = new Date(date + "T00:00:00");
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowInfo = getTodayInfo(startDate, tomorrowDate);
    let estimatedMin = 0;
    if (tomorrowInfo.weeklyTemplateEntry.session_key !== "rest") {
      const tomorrowSession = program.sessions[tomorrowInfo.weeklyTemplateEntry.session_key];
      if (tomorrowSession) {
        const tomorrowExs = getExercisesForSession(tomorrowInfo.weeklyTemplateEntry.session_key);
        for (const ex of tomorrowExs) {
          const sets = parseMinSets(ex.sets);
          const restMatch = ex.rest.match(/(\d+)/);
          const restSec = restMatch ? parseInt(restMatch[1], 10) : 60;
          estimatedMin += (sets * (40 + restSec)) / 60;
        }
      }
    }
    return { label: nextLabel, estimatedMin, isRest: tomorrowInfo.weeklyTemplateEntry.session_key === "rest" };
  }, [startDate, date]);

  const newMilestones = useMemo(() => {
    if (!startDate || !log) return [];
    const completed = allSessionLogs.filter((s) => s.completed);
    const sorted = [...completed].sort((a, b) => a.date.localeCompare(b.date));
    const thisIdx = sorted.findIndex((s) => s.date === log.date && s.sessionKey === log.sessionKey);

    const beforeSessionLogs = allSessionLogs.filter((s) => {
      const idx = sorted.findIndex((x) => x.date === s.date && x.sessionKey === s.sessionKey);
      return idx >= 0 && idx < thisIdx;
    });
    const beforeSetLogs = allSetLogs.filter((l) => {
      return beforeSessionLogs.some((s) => s.date === l.date && s.sessionKey === l.sessionKey);
    });

    const prevData = startDate
      ? gatherMilestoneData(beforeSessionLogs, beforeSetLogs, startDate)
      : null;
    const currentData = gatherMilestoneData(allSessionLogs, allSetLogs, startDate);
    const newly = getNewlyUnlockedMilestones(prevData, currentData);
    return newly;
  }, [allSessionLogs, allSetLogs, log, startDate]);

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
  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const muscles = uniqueMuscles(exercises);
  const equipment = uniqueEquipment(exercises);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="safe-top min-h-screen px-5 pb-10 pt-8 text-white"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm text-slate-400 transition hover:bg-white/20"
        >
          &larr;
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mt-5"
      >
        <div className="flex items-center gap-2 text-emerald-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-[0.12em]">Workout Complete</span>
        </div>
        <h1 className="mt-1 text-[28px] font-extrabold leading-tight text-white">{title}</h1>
        <p className="mt-0.5 text-sm font-medium text-slate-400">
          Week {log.weekNumber} &middot; {formattedDate}
        </p>
      </motion.div>

      {/* Quick stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mt-4 grid grid-cols-3 gap-2.5"
      >
        <div className="rounded-xl bg-white/5 px-3 py-2.5 text-center">
          <p className="text-lg font-extrabold tabular-nums text-white">{log.durationMin ?? "\u2014"}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Minutes</p>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2.5 text-center">
          <p className="text-lg font-extrabold tabular-nums text-white">{totalReps}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Reps</p>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2.5 text-center">
          <p className="text-lg font-extrabold tabular-nums text-orange-400">{log.rpe ?? "\u2014"}/10</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">RPE</p>
        </div>
      </motion.div>

      {/* Newly unlocked milestones */}
      {newMilestones.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.15, type: "spring" }}
          className="mt-4 overflow-hidden rounded-2xl border border-yellow-500/20 bg-gradient-to-br from-yellow-500/10 to-transparent"
        >
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-yellow-400">Milestone Unlocked</p>
            <div className="mt-2 space-y-1">
              {newMilestones.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <Sparkles size={14} className="text-yellow-400" />
                  <span className="text-sm font-semibold text-white">{m.title}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Muscle Groups Trained */}
      {muscles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="mt-5"
        >
          <Card>
            <div className="flex items-center gap-2">
              <Dumbbell size={14} className="text-blue-400" />
              <h3 className="text-xs font-bold text-white">Muscles Trained</h3>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-300">
              {muscles.join(" \u2022 ")}
            </p>
          </Card>
        </motion.div>
      )}

      {/* Session Highlights */}
      {highlights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="mt-4"
        >
          <Card>
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-yellow-400" />
              <h3 className="text-xs font-bold text-white">Session Highlights</h3>
            </div>
            <div className="mt-2 space-y-1.5">
              {highlights.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  {h.icon}
                  <span className="text-xs text-slate-300">{h.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Personal Progress */}
      {progress.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="mt-4"
        >
          <Card>
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-400" />
              <h3 className="text-xs font-bold text-white">Personal Progress</h3>
            </div>
            <div className="mt-2 space-y-1.5">
              {progress.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <span className="text-xs text-slate-400">{d.key}</span>
                  <span className={`text-xs font-bold tabular-nums ${d.positive ? "text-emerald-400" : "text-rose-400"}`}>
                    {d.positive ? "\u25B2" : "\u25BC"} {d.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Workout Notes */}
      {log.notes && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.35 }}
          className="mt-4"
        >
          <Card>
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-blue-400" />
              <h3 className="text-xs font-bold text-white">Workout Notes</h3>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{log.notes}</p>
          </Card>
        </motion.div>
      )}

      {/* Equipment Used */}
      {equipment.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.4 }}
          className="mt-4"
        >
          <Card>
            <div className="flex items-center gap-2">
              <Hexagon size={14} className="text-slate-400" />
              <h3 className="text-xs font-bold text-white">Equipment Used</h3>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-300">
              {equipment.join(" \u2022 ")}
            </p>
          </Card>
        </motion.div>
      )}

      {/* Coach Notes (hidden until recommendation engine is ready) */}
      <div className="hidden">
        <Card>
          <div className="flex items-center gap-2">
            <Lightbulb size={14} className="text-yellow-400" />
            <h3 className="text-xs font-bold text-white">Coach Notes</h3>
          </div>
        </Card>
      </div>

      {/* Next Session */}
      {tomorrowInfo && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.45 }}
          className="mt-4"
        >
          <Card className="border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ArrowRight size={12} />
              {tomorrowInfo.isRest ? "Tomorrow" : "Next Up"}
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white">{tomorrowInfo.label}</p>
                {!tomorrowInfo.isRest && (
                  <p className="text-xs text-slate-500">Est. {formatDuration(tomorrowInfo.estimatedMin)}</p>
                )}
              </div>
              {tomorrowInfo.isRest && <Moon size={16} className="text-blue-400" />}
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.5 }}
        className="mt-8"
      >
        <Button size="lg" className="w-full" onClick={() => navigate("/")}>
          Back to Home
        </Button>
      </motion.div>
    </motion.div>
  );
}
