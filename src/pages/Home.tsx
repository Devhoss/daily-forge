import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getProgramStartDate, getAllSessionLogs } from "@/lib/db";
import {
  getTodayInfo,
  getNextWorkoutLabel,
  type TodayInfo,
} from "@/lib/programEngine";
import { program, getExercisesForSession } from "@/lib/data";
import {
  computeWeeklyStats,
  computeCurrentStreak,
  computeOverallStats,
  computeProgramCompletionPct,
} from "@/lib/analytics";
import { tipOfTheDay } from "@/lib/tips";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Onboarding } from "@/pages/Onboarding";
import {
  Flame,
  Lightbulb,
  PartyPopper,
  Dumbbell,
  Moon,
  ArrowRight,
  Trophy,
} from "lucide-react";

function estimateMinutes(sessionKey: string): number {
  const exercises = getExercisesForSession(sessionKey);
  let total = 0;
  for (const ex of exercises) {
    const setsMatch = ex.sets.match(/(\d+)/);
    const sets = setsMatch ? parseInt(setsMatch[1], 10) : 3;
    const restMatch = ex.rest.match(/(\d+)/);
    const restSec = restMatch ? parseInt(restMatch[1], 10) : 60;
    total += sets * (40 + restSec);
  }
  return Math.round(total / 60);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function formattedDate(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

interface DashboardStats {
  consistencyPct: number;
  streak: number;
  totalCompleted: number;
  programPct: number;
  hasAnyData: boolean;
}

export function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [today, setToday] = useState<TodayInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  async function load() {
    const d = await getProgramStartDate();
    setStartDate(d);
    if (d) {
      const info = getTodayInfo(d);
      setToday(info);
      const sessionLogs = await getAllSessionLogs();
      const weekly = computeWeeklyStats(sessionLogs, []);
      const thisWeek = weekly.find((w) => w.week === info.weekNumber);
      const overall = computeOverallStats(sessionLogs, []);
      setStats({
        consistencyPct: thisWeek?.consistencyPct ?? 0,
        streak: computeCurrentStreak(sessionLogs, d),
        totalCompleted: overall.totalSessionsCompleted,
        programPct: computeProgramCompletionPct(info.daysSinceStart),
        hasAnyData: overall.totalSessionsCompleted > 0,
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return null;
  if (!startDate) return <Onboarding onDone={load} />;
  if (!today || !stats) return null;

  const {
    weekNumber,
    weeklyTemplateEntry,
    weekRow,
    isRestDay,
    isProgramComplete,
    dayIndex,
  } = today;
  const sessionKey = weeklyTemplateEntry.session_key;
  const session = program.sessions[sessionKey];
  const minutes = !isRestDay ? estimateMinutes(sessionKey) : 0;
  const nextWorkout = isRestDay ? getNextWorkoutLabel(dayIndex) : null;

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <p className="text-sm text-slate-400">{greeting()}</p>
        <p className="text-xs text-slate-600">{formattedDate()}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mt-4"
      >
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">
            Week {weekNumber} · Day {dayIndex + 1}
          </h1>
          {weekRow && (
            <span
              className={
                weekRow.deload
                  ? "rounded-full bg-yellow-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-yellow-400"
                  : "rounded-full bg-orange-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-400"
              }
            >
              {weekRow.deload ? "Deload" : weekRow.phase}
            </span>
          )}
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-orange-500 transition-all duration-700"
            style={{ width: `${stats.programPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {stats.programPct}% through your 12-week program
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        {isProgramComplete ? (
          <Card className="mt-5 border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center gap-2">
              <PartyPopper size={20} className="text-emerald-400" />
              <h2 className="text-lg font-bold text-white">Program Complete</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              You've finished all 12 weeks. Retest your benchmarks and consider
              starting a new cycle with a notch more tempo, pause, or unilateral
              work from day one.
            </p>
          </Card>
        ) : isRestDay ? (
          <Card className="mt-5">
            <div className="flex items-center gap-2">
              <Moon size={18} className="text-blue-400" />
              <p className="text-xs font-bold uppercase text-slate-400">
                Today
              </p>
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">
              Rest / Mobility
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Spend 5 minutes on ankle, hip hinge, shoulder, and thoracic
              mobility. Full training resumes tomorrow.
            </p>
            {nextWorkout && (
              <div className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 text-xs text-slate-500">
                <ArrowRight size={12} />
                Next up:{" "}
                <span className="font-semibold text-slate-300">
                  {nextWorkout}
                </span>
              </div>
            )}
          </Card>
        ) : (
          <Card className="mt-5 border-blue-500/20 bg-gradient-to-br from-[var(--color-bg-raised)] to-[#182647]">
            <div className="flex items-center gap-2">
              <Dumbbell size={18} className="text-blue-400" />
              <p className="text-xs font-bold uppercase text-slate-400">
                Today's Workout
              </p>
            </div>
            <h2 className="mt-1 text-2xl font-extrabold text-white">
              {session?.title.split("—")[0].trim() ?? weeklyTemplateEntry.label}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Estimated time · {minutes} min · {session?.exercises.length ?? 0}{" "}
              exercises
            </p>
            <Button
              className="mt-5"
              onClick={() => navigate(`/workout/${sessionKey}`)}
            >
              Start Workout
            </Button>
          </Card>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        {stats.hasAnyData ? (
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <StatCard label="This Week" value={`${stats.consistencyPct}%`} />
            <StatCard
              label="Streak"
              value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
              icon={
                stats.streak > 0 ? (
                  <Flame size={14} className="text-orange-400" />
                ) : undefined
              }
              accent={stats.streak > 0}
            />
            <StatCard
              label="Total Workouts"
              value={String(stats.totalCompleted)}
            />
            <StatCard label="Program" value={`${stats.programPct}%`} />
          </div>
        ) : (
          <Card className="mt-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/15">
              <Trophy size={18} className="text-blue-400" />
            </div>
            <p className="text-sm text-slate-400">
              Your stats — streak, consistency, total workouts — start tracking
              the moment you finish your first session.
            </p>
          </Card>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/[0.04] p-3.5"
      >
        <Lightbulb size={16} className="mt-0.5 shrink-0 text-yellow-500/70" />
        <p className="text-xs leading-relaxed text-slate-400">
          {tipOfTheDay()}
        </p>
      </motion.div>
    </div>
  );
}
