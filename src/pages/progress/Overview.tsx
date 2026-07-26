import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Dumbbell, Target, Zap, Trophy, Clock, TrendingUp, Calendar, Lock, CheckCircle } from 'lucide-react';
import { getAllSessionLogs, getAllSetLogs, getProgramStartDate } from '@/lib/db';
import { computeWeeklyStats, trimToLoggedWeeks, computeCurrentStreak, computeOverallStats, computeProgramCompletionPct, type WeeklyStat } from '@/lib/analytics';
import { getExercise } from '@/lib/data';
import { Card } from '@/components/ui/Card';
import { gatherMilestoneData, computeMilestoneStates, getMilestonesByCategory, type MilestoneWithState } from '@/lib/milestones';
import type { SessionLog, SetLog } from '@/lib/db';

/* ---------- helpers ---------- */

function isoOf(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Group exercises into broad muscle groups for volume display. */
function muscleGroup(exerciseId: string): string {
  const ex = getExercise(exerciseId);
  if (!ex) return 'Other';
  const primary = ex.muscles_primary[0]?.toLowerCase() ?? '';

  if (primary.includes('chest')) return 'Chest';
  if (primary.includes('shoulder') || primary.includes('delt')) return 'Shoulders';
  if (primary.includes('back') || primary.includes('trap') || primary.includes('lat') || primary.includes('rhomboid') || primary.includes('erector') || primary.includes('spinal')) return 'Back';
  if (primary.includes('triceps') || primary.includes('biceps') || primary.includes('brachialis') || primary.includes('forearm')) return 'Arms';
  if (primary.includes('quad') || primary.includes('hamstring') || primary.includes('glute') || primary.includes('calf') || primary.includes('adductor') || primary.includes('gastrocnemius')) return 'Legs';
  if (primary.includes('core') || primary.includes('ab') || primary.includes('oblique')) return 'Core';

  return 'Other';
}

/* ---------- MetricCard ---------- */

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className={accent ? 'text-xl font-extrabold text-orange-400 tabular-nums' : 'text-xl font-extrabold text-white tabular-nums'}>
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

/* ---------- Calendar heatmap (GitHub-style) ---------- */

function CalendarHeatmap({ completedDates, weeks = 12 }: { completedDates: Set<string>; weeks?: number }) {
  const cells = useMemo(() => {
    const today = new Date();
    const out: { date: string; done: boolean }[] = [];
    for (let i = weeks * 7 - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = isoOf(d);
      out.push({ date: dateStr, done: completedDates.has(dateStr) });
    }
    return out;
  }, [completedDates, weeks]);

  const cols: { week: string[] }[] = useMemo(() => {
    const c: { week: string[] }[] = [];
    let current: string[] = [];
    for (const cell of cells) {
      current.push(cell.date);
      if (current.length === 7) { c.push({ week: current }); current = []; }
    }
    if (current.length > 0) c.push({ week: current });
    return c;
  }, [cells]);

  if (cells.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.week.map((dateStr) => {
              const done = completedDates.has(dateStr);
              return (
                <div
                  key={dateStr}
                  className={done ? 'h-3 w-3 rounded-sm bg-emerald-500' : 'h-3 w-3 rounded-sm bg-white/[0.06]'}
                  title={dateStr}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Muscle volume bars ---------- */

const GROUP_ORDER = ['Chest', 'Shoulders', 'Back', 'Arms', 'Legs', 'Core', 'Other'];
const GROUP_COLORS: Record<string, string> = {
  Chest: 'bg-orange-500',
  Shoulders: 'bg-blue-500',
  Back: 'bg-emerald-500',
  Arms: 'bg-purple-500',
  Legs: 'bg-cyan-500',
  Core: 'bg-rose-500',
  Other: 'bg-slate-500',
};

function muscleGroupFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('chest')) return 'Chest';
  if (lower.includes('shoulder') || lower.includes('delt')) return 'Shoulders';
  if (lower.includes('back') || lower.includes('trap') || lower.includes('lat') || lower.includes('rhomboid') || lower.includes('erector') || lower.includes('spinal')) return 'Back';
  if (lower.includes('triceps') || lower.includes('biceps') || lower.includes('brachialis') || lower.includes('forearm')) return 'Arms';
  if (lower.includes('quad') || lower.includes('hamstring') || lower.includes('glute') || lower.includes('calf') || lower.includes('adductor') || lower.includes('gastrocnemius')) return 'Legs';
  if (lower.includes('core') || lower.includes('ab') || lower.includes('oblique')) return 'Core';
  return 'Other';
}

function MuscleVolume({ setLogs }: { setLogs: SetLog[] }) {
  const groups = useMemo(() => {
    const credits: Record<string, number> = {};

    for (const sl of setLogs) {
      const ex = getExercise(sl.exerciseId);
      if (!ex) {
        const g = muscleGroup(sl.exerciseId);
        credits[g] = (credits[g] ?? 0) + 1;
        continue;
      }

      const weighted = new Map<string, number>();

      for (const m of ex.muscles_primary) {
        const g = muscleGroupFromName(m);
        weighted.set(g, (weighted.get(g) ?? 0) + 1.0);
      }
      for (const m of ex.muscles_secondary) {
        const g = muscleGroupFromName(m);
        weighted.set(g, (weighted.get(g) ?? 0) + 0.5);
      }

      for (const [g, w] of weighted) {
        credits[g] = (credits[g] ?? 0) + w;
      }
    }

    const max = Math.max(...Object.values(credits), 1);
    return GROUP_ORDER.filter((g) => credits[g] != null && credits[g] > 0).map((g) => ({
      group: g,
      pct: ((credits[g] ?? 0) / max) * 100,
    }));
  }, [setLogs]);

  if (groups.length === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Dumbbell size={16} className="text-blue-400" />
        <h3 className="text-sm font-bold text-white">Training Emphasis</h3>
      </div>
      <div className="mt-3 space-y-2">
        {groups.map((g) => (
          <div key={g.group}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">{g.group}</span>
            </div>
            <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full ${GROUP_COLORS[g.group] ?? 'bg-slate-500'} transition-all duration-700`}
                style={{ width: `${g.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Personal Records ---------- */

interface PRs {
  longestDuration: number;
  highestReps: number;
  bestStreak: number;
  fastestSession: number;
  totalTrainingTime: number;
}

function computePRs(sessionLogs: SessionLog[], setLogs: SetLog[], streak: number): PRs {
  const completed = sessionLogs.filter((s) => s.completed);
  let longestDuration = 0;
  let highestReps = 0;
  let fastestSession = Infinity;
  let totalTrainingTime = 0;

  for (const sl of completed) {
    const sets = setLogs.filter((l) => l.date === sl.date && l.sessionKey === sl.sessionKey);
    const reps = sets.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
    const dur = sl.durationMin ?? 0;
    if (dur > longestDuration) longestDuration = dur;
    if (reps > highestReps) highestReps = reps;
    if (dur > 0 && dur < fastestSession) fastestSession = dur;
    totalTrainingTime += dur;
  }

  return {
    longestDuration,
    highestReps,
    bestStreak: streak,
    fastestSession: fastestSession === Infinity ? 0 : fastestSession,
    totalTrainingTime,
  };
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function PRCard({ prs }: { prs: PRs }) {
  const items = [
    { icon: <Clock size={14} className="text-orange-400" />, label: 'Longest Session', value: formatMinutes(prs.longestDuration) },
    { icon: <Zap size={14} className="text-blue-400" />, label: 'Most Reps (Session)', value: String(prs.highestReps) },
    { icon: <Flame size={14} className="text-orange-400" />, label: 'Best Streak', value: `${prs.bestStreak} ${prs.bestStreak === 1 ? 'day' : 'days'}` },
    { icon: <TrendingUp size={14} className="text-emerald-400" />, label: 'Fastest Session', value: formatMinutes(prs.fastestSession) },
  ];

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-yellow-400" />
        <h3 className="text-sm font-bold text-white">Personal Records</h3>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg bg-white/[0.03] px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {item.icon}
              {item.label}
            </div>
            <p className="mt-0.5 text-base font-extrabold tabular-nums text-white">{item.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Milestones ---------- */

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const CATEGORY_ORDER: MilestoneWithState['category'][] = ['Consistency', 'Performance', 'Program'];

function MilestoneRow({ m }: { m: MilestoneWithState }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
      {m.unlocked ? (
        <CheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-400" />
      ) : (
        <Lock size={14} className="mt-0.5 shrink-0 text-slate-600" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-medium ${m.unlocked ? 'text-white' : 'text-slate-500'}`}>
            {m.title}
          </span>
          {m.unlocked && m.unlockDate && (
            <span className="shrink-0 text-[10px] text-slate-600">{formatDate(m.unlockDate)}</span>
          )}
        </div>
        {!m.unlocked && m.progressTarget > 1 && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-slate-500 transition-all duration-500"
              style={{ width: `${(m.progressCurrent / m.progressTarget) * 100}%` }}
            />
          </div>
        )}
        <p className={`mt-0.5 text-[11px] leading-tight ${m.unlocked ? 'text-slate-600' : 'text-slate-600'}`}>
          {m.description}
        </p>
      </div>
    </div>
  );
}

function MilestonesView({ milestoneStates }: { milestoneStates: MilestoneWithState[] }) {
  const byCategory = getMilestonesByCategory(milestoneStates);

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((cat) => {
        const items = byCategory[cat];
        if (items.length === 0) return null;
        return (
          <Card key={cat}>
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-yellow-400" />
              <h3 className="text-sm font-bold text-white">{cat}</h3>
            </div>
            <div className="mt-3 space-y-1.5">
              {items.map((m) => (
                <MilestoneRow key={m.id} m={m} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- Main component ---------- */

export function ProgressOverview() {
  const [stats, setStats] = useState<WeeklyStat[] | null>(null);
  const [sessionLogs, setSessionLogs] = useState<SessionLog[]>([]);
  const [allSetLogs, setAllSetLogs] = useState<SetLog[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [sl, sets, sd] = await Promise.all([getAllSessionLogs(), getAllSetLogs(), getProgramStartDate()]);
      setSessionLogs(sl);
      setAllSetLogs(sets);
      setStartDate(sd);
      setStats(trimToLoggedWeeks(computeWeeklyStats(sl, sets)));
    })();
  }, []);

  const completedDates = useMemo(() => new Set(sessionLogs.filter((s) => s.completed).map((s) => s.date)), [sessionLogs]);
  const totalReps = useMemo(() => allSetLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0), [allSetLogs]);
  const streaks = useMemo(() => {
    if (!startDate) return { current: 0, longest: 0 };
    const s = computeCurrentStreak(sessionLogs, startDate);
    const completed = sessionLogs.filter((l) => l.completed);
    let longest = 0;
    let run = 0;
    let prevDate: string | null = null;
    const sorted = [...new Set(completed.map((l) => l.date))].sort();
    for (const d of sorted) {
      if (prevDate) {
        const prev = new Date(prevDate + 'T00:00:00');
        const curr = new Date(d + 'T00:00:00');
        const diff = (curr.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) { run++; } else { run = 1; }
      } else { run = 1; }
      if (run > longest) longest = run;
      prevDate = d;
    }
    return { current: s, longest };
  }, [sessionLogs, startDate]);

  const overall = useMemo(() => computeOverallStats(sessionLogs, allSetLogs), [sessionLogs, allSetLogs]);
  const programPct = useMemo(() => computeProgramCompletionPct(overall.totalSessionsCompleted), [overall.totalSessionsCompleted]);

  const prs = useMemo(() => computePRs(sessionLogs, allSetLogs, streaks.current), [sessionLogs, allSetLogs, streaks.current]);
  const milestoneStates = useMemo(() => {
    if (!startDate) return [];
    const data = gatherMilestoneData(sessionLogs, allSetLogs, startDate);
    return computeMilestoneStates(data);
  }, [sessionLogs, allSetLogs, startDate]);

  if (!stats) return null;
  const hasAnyData = stats.some((s) => s.sessionsCompleted > 0);

  if (!hasAnyData) {
    return (
      <Card className="flex items-center gap-3 bg-white/[0.03]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/15">
          <Dumbbell size={18} className="text-blue-400" />
        </div>
        <p className="text-sm leading-relaxed text-slate-400">
          No sessions logged yet. Finish a workout and your consistency, volume, and RPE trends will show up here week by week.
        </p>
      </Card>
    );
  }

  const latest = stats[stats.length - 1];

  return (
    <div className="space-y-5">
      {/* Overview metrics */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 gap-2.5"
      >
        <MetricCard icon={<Flame size={16} className="text-orange-400" />} label="Current Streak" value={`${streaks.current}d`} sub={`Best: ${streaks.longest}d`} accent />
        <MetricCard icon={<Target size={16} className="text-blue-400" />} label="Completed" value={String(overall.totalSessionsCompleted)} sub={`${programPct}% of program`} />
        <MetricCard icon={<Zap size={16} className="text-emerald-400" />} label="Total Reps" value={String(totalReps)} sub={`Avg RPE ${overall.avgRpe ?? '—'}`} />
        <MetricCard icon={<Clock size={16} className="text-blue-400" />} label="Training Time" value={formatMinutes(prs.totalTrainingTime)} sub={`${latest.consistencyPct}% this week`} />
      </motion.div>

      {/* Calendar heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <Card>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-blue-400" />
            <h3 className="text-sm font-bold text-white">Activity</h3>
            <span className="ml-auto text-[10px] text-slate-500">Past 12 weeks</span>
          </div>
          <div className="mt-3">
            <CalendarHeatmap completedDates={completedDates} />
          </div>
        </Card>
      </motion.div>

      {/* Muscle group volume */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <MuscleVolume setLogs={allSetLogs} />
      </motion.div>

      {/* Personal records */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <PRCard prs={prs} />
      </motion.div>

      {/* Milestones */}
      {milestoneStates.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <MilestonesView milestoneStates={milestoneStates} />
        </motion.div>
      )}
    </div>
  );
}
