import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getProgramStartDate, getAllSessionLogs } from "@/lib/db";
import {
  getTodayInfo,
  todayIso,
  getNextWorkoutLabel,
  type TodayInfo,
} from "@/lib/programEngine";
import { program, getExercisesForSession, getTotalWorkouts } from "@/lib/data";
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
import { useSettings } from "@/lib/SettingsContext";
import { formatDuration } from "@/lib/utils";
import { WeeklyTimeline } from "@/components/WeeklyTimeline";
import type { SessionLog } from "@/lib/db";
import {
  Flame,
  Lightbulb,
  PartyPopper,
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

function useCountUp(target: number, duration = 700): number {
  const [count, setCount] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const startTime = performance.now();
    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return count;
}

interface DashboardStats {
  consistencyPct: number;
  streak: number;
  totalCompleted: number;
  programPct: number;
  hasAnyData: boolean;
}

function Skeleton() {
  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8">
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-48 animate-pulse rounded bg-white/5" />
      </div>
      <div className="mt-6 h-56 animate-pulse rounded-2xl bg-white/8" />
      <div className="mt-6 space-y-2">
        <div className="h-3 w-40 animate-pulse rounded bg-white/10" />
        <div className="h-2.5 w-full animate-pulse rounded-full bg-white/8" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <div className="h-16 animate-pulse rounded-xl bg-white/8" />
        <div className="h-16 animate-pulse rounded-xl bg-white/8" />
        <div className="h-16 animate-pulse rounded-xl bg-white/8" />
        <div className="h-16 animate-pulse rounded-xl bg-white/8" />
      </div>
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { refreshNav } = useSettings();
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [today, setToday] = useState<TodayInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [sessionLogs, setSessionLogs] = useState<SessionLog[]>([]);

  const load = useCallback(async () => {
    const d = await getProgramStartDate();
    setStartDate(d);
    if (d) {
      const info = getTodayInfo(d);
      setToday(info);
      const sessionLogs = await getAllSessionLogs();
      setSessionLogs(sessionLogs);
      const weekly = computeWeeklyStats(sessionLogs, []);
      const thisWeek = weekly.find((w) => w.week === info.weekNumber);
      const overall = computeOverallStats(sessionLogs, []);
      const s = {
        consistencyPct: thisWeek?.consistencyPct ?? 0,
        streak: computeCurrentStreak(sessionLogs, d),
        totalCompleted: overall.totalSessionsCompleted,
        programPct: computeProgramCompletionPct(overall.totalSessionsCompleted),
        hasAnyData: overall.totalSessionsCompleted > 0,
      };
      setStats(s);
    }
    setLoading(false);
    refreshNav();
  }, [refreshNav]);

  useEffect(() => { load(); }, [load]);

  const animatedConsistency = useCountUp(stats?.consistencyPct ?? 0);
  const animatedStreak = useCountUp(stats?.streak ?? 0);
  const animatedTotal = useCountUp(stats?.totalCompleted ?? 0);
  const animatedProgram = useCountUp(stats?.programPct ?? 0);

  if (loading) return <Skeleton />;
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
  const todayLog = sessionLogs.find(
    (l) => l.date === todayIso() && l.sessionKey === sessionKey && l.completed
  );
  const isTodayComplete = !!todayLog && !isRestDay && !isProgramComplete;
  const nextWorkout = (isRestDay || isTodayComplete) ? getNextWorkoutLabel(dayIndex) : null;

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <p className="text-sm font-medium text-slate-400">{greeting()}</p>
        <p className="text-xs text-slate-600">{formattedDate()}</p>
      </motion.div>

      {isProgramComplete ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <Card className="mt-5 border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent">
            <div className="flex items-center gap-2">
              <PartyPopper size={20} className="text-emerald-400" />
              <h2 className="text-lg font-bold text-white">Program Complete</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              You&apos;ve finished all 12 weeks. Retest your benchmarks and
              consider starting a new cycle with a notch more tempo, pause, or
              unilateral work from day one.
            </p>
          </Card>
        </motion.div>
      ) : isTodayComplete ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <Card className="mt-5 border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 to-transparent">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-emerald-400">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-400">
                Today&apos;s Workout
              </p>
            </div>
            <h2 className="mt-1.5 text-[28px] font-extrabold leading-tight text-white">
              Workout Complete
            </h2>
            <p className="mt-0.5 text-sm font-medium text-slate-400">
              Today's workout is complete.
            </p>
            {nextWorkout && (
              <div className="mt-3 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <ArrowRight size={12} />
                  Tomorrow
                </div>
                <div className="mt-0.5 pl-[22px] font-semibold text-slate-300">
                  {nextWorkout}
                </div>
              </div>
            )}
            <Button
              size="lg"
              className="mt-6"
              onClick={() => navigate(`/review/${todayIso()}/${sessionKey}`)}
            >
              Review Workout
            </Button>
          </Card>
        </motion.div>
      ) : isRestDay ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <Card className="mt-5">
            <div className="flex items-center gap-2">
              <Moon size={18} className="text-blue-400" />
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Today</p>
            </div>
            <h2 className="mt-1 text-2xl font-extrabold text-white">
              Rest &amp; Mobility
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Spend 5 minutes on ankle, hip hinge, shoulder, and thoracic
              mobility. Full training resumes tomorrow.
            </p>
            {nextWorkout && (
              <div className="mt-4 flex items-center gap-1.5 border-t border-white/10 pt-4 text-xs text-slate-500">
                <ArrowRight size={12} />
                Next up:{" "}
                <span className="font-semibold text-slate-300">
                  {nextWorkout}
                </span>
              </div>
            )}
          </Card>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <Card className="mt-4 border-blue-500/20 bg-gradient-to-br from-[#1a2d4f] to-[#0f1f3d]">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-400">
              Today&apos;s Workout
            </p>
            <h2 className="mt-1.5 text-[28px] font-extrabold leading-tight text-white">
              {session?.title.split("—")[0].trim() ?? weeklyTemplateEntry.label}
            </h2>
            <p className="mt-0.5 text-xs font-medium text-orange-400/80">
              {weekRow?.deload ? "Deload" : weekRow?.phase ?? "Training"} Phase
            </p>
            <div className="mt-1.5 text-sm text-slate-400">
              Est. {formatDuration(minutes)} &middot; {session?.exercises.length ?? 0} exercises
            </div>
            <Button
              size="lg"
              className="mt-6"
              onClick={() => navigate(`/workout/${sessionKey}`)}
            >
              Start Workout
            </Button>
          </Card>
        </motion.div>
      )}

      <div className="mt-5">
        <WeeklyTimeline
          startDate={startDate}
          weekNumber={weekNumber}
          dayIndex={dayIndex}
          sessionLogs={sessionLogs}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="mt-6"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
            Week {weekNumber} &middot; Day {dayIndex + 1}
          </p>
          {weekRow && !weekRow.deload && (
            <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-400">
              {weekRow.phase}
            </span>
          )}
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-orange-500 transition-all duration-1000 ease-out"
            style={{ width: `${stats.programPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {stats.totalCompleted} / {getTotalWorkouts()} workouts completed
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="mt-5"
      >
        {stats.hasAnyData ? (
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard
              label="This Week"
              value={`${animatedConsistency}%`}
              delay={0.05}
            />
            <StatCard
              label="Streak"
              value={`${animatedStreak} ${stats.streak === 1 ? "day" : "days"}`}
              icon={stats.streak > 0 ? <Flame size={14} className="text-orange-400" /> : undefined}
              accent={stats.streak > 0}
              delay={0.1}
            />
            <StatCard
              label="Total Workouts"
              value={String(animatedTotal)}
              delay={0.15}
            />
            <StatCard
              label="Program"
              value={`${animatedProgram}%`}
              delay={0.2}
            />
          </div>
        ) : (
          <Card className="flex items-center gap-3 bg-white/[0.03]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/15 self-center">
              <Trophy size={18} className="text-blue-400" />
            </div>
            <p className="text-sm leading-snug text-slate-400">
              Complete your first workout to begin your journey.
            </p>
          </Card>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.25 }}
        className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/[0.02] px-3.5 py-2.5"
      >
        <Lightbulb size={12} className="mt-0.5 shrink-0 text-yellow-500/50" />
        <p className="text-xs leading-relaxed text-slate-500">
          {tipOfTheDay()}
        </p>
      </motion.div>
    </div>
  );
}
