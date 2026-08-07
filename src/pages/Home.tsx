import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  getProgramStartDate,
  getAllSessionLogs,
  getAllSetLogs,
  getAllMeasurements,
} from "@/lib/db";
import { onDataChanged } from "@/lib/events";
import {
  getTodayInfo,
  todayIso,
  getNextWorkoutLabel,
  type TodayInfo,
} from "@/lib/programEngine";
import { program, getExercisesForSession, getTotalWorkouts } from "@/lib/data";
import {
  buildRecommendations,
  findNextSessionForExercise,
  computeRecoveryScore,
  type Recommendation,
  type RecoveryAnalysis,
} from "@/services/index";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Onboarding } from "@/pages/Onboarding";
import { useSettings } from "@/lib/SettingsContext";
import { RECOVERY_LEVEL_META, CONFIDENCE_META } from "@/lib/presentation";
import { formatDuration, cn } from "@/lib/utils";
import { getEquipmentProfile } from "@/lib/equipment";
import { WeeklyTimeline } from "@/components/WeeklyTimeline";
import type { SessionLog } from "@/lib/db";
import {
  PartyPopper,
  Moon,
  ArrowRight,
  Sparkles,
  HeartPulse,
  Target,
  CheckCircle2,
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

function Skeleton() {
  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8">
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-48 animate-pulse rounded bg-white/5" />
      </div>
      <div className="mt-6 h-56 animate-pulse rounded-2xl bg-white/8" />
      <div className="mt-5 h-32 animate-pulse rounded-2xl bg-white/8" />
      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-white/8" />
    </div>
  );
}

interface CoachData {
  top: Recommendation | null;
  recovery: RecoveryAnalysis;
  focus: string;
  hasAnyData: boolean;
}

export function Home() {
  const navigate = useNavigate();
  const { refreshNav } = useSettings();
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [today, setToday] = useState<TodayInfo | null>(null);
  const [sessionLogs, setSessionLogs] = useState<SessionLog[]>([]);
  const [coach, setCoach] = useState<CoachData | null>(null);

  const load = useCallback(async () => {
    const d = await getProgramStartDate();
    setStartDate(d);
    if (d) {
      const info = getTodayInfo(d);
      setToday(info);
      const [logs, sets, meas, eq] = await Promise.all([
        getAllSessionLogs(),
        getAllSetLogs(),
        getAllMeasurements(),
        getEquipmentProfile(),
      ]);
      setSessionLogs(logs);

      const asOf = new Date();
      const recommendations = buildRecommendations(logs, sets, meas, {
        startIso: d,
        asOf,
        availableWeights: eq.dumbbells,
      });
      const top =
        recommendations.find(
          (r) => r.importance === "critical" || r.importance === "high",
        ) ?? null;

      setCoach({
        top,
        recovery: computeRecoveryScore(logs, sets, { startIso: d, asOf }),
        focus: info.weekRow?.focus ?? "",
        hasAnyData: logs.some((s) => s.completed),
      });
    }
    setLoading(false);
    refreshNav();
  }, [refreshNav]);

  useEffect(() => { load(); }, [load]);

  // Recompute coaching data whenever any data mutation is committed — this is
  // the event-driven guarantee that Home always reflects the latest state.
  useEffect(() => onDataChanged(load), [load]);

  if (loading) return <Skeleton />;
  if (!startDate) return <Onboarding onDone={load} />;
  if (!today || !coach) return null;

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

  const { top, recovery, focus, hasAnyData } = coach;

  const applyAction =
    top?.action.type === "overload"
      ? {
          exerciseId: top.action.exerciseId,
          step: top.action.step,
          session: findNextSessionForExercise(top.action.exerciseId, dayIndex),
        }
      : null;

  function applyRecommendation() {
    if (!applyAction || !applyAction.session) return;
    navigate(`/workout/${applyAction.session.sessionKey}`, {
      state: {
        applyRecommendation: {
          exerciseId: applyAction.exerciseId,
          step: applyAction.step,
        },
      },
    });
  }

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
              <CheckCircle2 size={20} className="text-emerald-400" />
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

      {!isProgramComplete && hasAnyData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
        >
          {/* What's Next Today — the single highest-value recommendation */}
          <Card className="mt-5 border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-blue-400" />
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-400">
                What&apos;s Next Today
              </p>
            </div>
            {top ? (
              <>
                <h2 className="mt-2 text-xl font-extrabold text-white">
                  {top.title}
                </h2>
                <p className="mt-1.5 text-sm font-medium text-slate-200">
                  {top.decision}
                </p>
                <div className="mt-3 rounded-xl bg-white/[0.04] px-3.5 py-3">
                  <p className="text-xs leading-relaxed text-slate-400">
                    {top.reasoning.join(" ")}
                  </p>
                </div>
                <div className="mt-3.5 flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      CONFIDENCE_META[top.confidence].chip,
                    )}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_META[top.confidence].color}`} />
                    {CONFIDENCE_META[top.confidence].label} confidence
                  </span>
                  {applyAction && applyAction.session && (
                    <Button
                      size="md"
                      className="w-auto px-4 py-2.5 text-xs"
                      onClick={applyRecommendation}
                    >
                      Apply Recommendation
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2 className="mt-2 text-xl font-extrabold text-white">
                  All Clear
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  Nothing needs your attention today — keep following your plan
                  and show up for your training.
                </p>
              </>
            )}
            <button
              onClick={() => navigate("/progress", { state: { tab: "insights" } })}
              className="mt-3.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
            >
              View all insights
              <ArrowRight size={12} />
            </button>
          </Card>

          {/* Recovery — coach hierarchy: level + score, then what to do, then why */}
          <Card className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HeartPulse size={16} className={RECOVERY_LEVEL_META[recovery.level].color} />
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Recovery
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  CONFIDENCE_META[recovery.confidence].chip,
                )}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_META[recovery.confidence].color}`} />
                {CONFIDENCE_META[recovery.confidence].label} confidence
              </span>
            </div>
            <p
              className={`mt-2.5 text-2xl font-extrabold tabular-nums leading-none ${RECOVERY_LEVEL_META[recovery.level].color}`}
            >
              {RECOVERY_LEVEL_META[recovery.level].label}{" "}
              <span className="font-semibold">&middot;</span> {recovery.score}
              <span className="text-sm font-semibold text-slate-500">/100</span>
            </p>
            {hasAnyData &&
              sessionLogs.some((l) => l.date === todayIso() && l.completed) && (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  Reflects today&apos;s completed session
                </p>
              )}
            <p className="mt-2.5 text-sm font-semibold text-slate-200">
              {recovery.recommendation}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {recovery.explanation}
            </p>
          </Card>

          {/* Weekly Focus — evolves with the program's week table */}
          <Card className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-orange-400" />
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Weekly Focus
                </p>
              </div>
              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-400">
                Week {weekNumber} &middot;{" "}
                {weekRow?.deload ? "Deload" : (weekRow?.phase ?? "Training")}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-200">{focus}</p>
          </Card>
        </motion.div>
      )}

      {!isProgramComplete && !hasAnyData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
        >
          <Card className="mt-5 flex items-center gap-3 bg-white/[0.03]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-blue-600/15">
              <Target size={18} className="text-blue-400" />
            </div>
            <p className="text-sm leading-snug text-slate-400">
              Complete your first workout to begin your journey.
            </p>
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
            style={{ width: `${Math.round((sessionLogs.filter((s) => s.completed).length / getTotalWorkouts()) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {sessionLogs.filter((s) => s.completed).length} / {getTotalWorkouts()} workouts completed
        </p>
      </motion.div>
    </div>
  );
}
