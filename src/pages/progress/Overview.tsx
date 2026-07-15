import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { motion } from 'framer-motion';
import { Flame, Dumbbell, Target, Zap, BarChart3 } from 'lucide-react';
import { getAllSessionLogs, getAllSetLogs } from '@/lib/db';
import { computeWeeklyStats, trimToLoggedWeeks, computeCurrentStreak, computeOverallStats, type WeeklyStat } from '@/lib/analytics';
import { getProgramStartDate } from '@/lib/db';
import { Card } from '@/components/ui/Card';

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

export function ProgressOverview() {
  const [stats, setStats] = useState<WeeklyStat[] | null>(null);
  const [overall, setOverall] = useState<{ totalReps: number; avgRpe: number | null; streak: number; programPct: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [sessionLogs, setLogs, startDate] = await Promise.all([getAllSessionLogs(), getAllSetLogs(), getProgramStartDate()]);
      const wStats = trimToLoggedWeeks(computeWeeklyStats(sessionLogs, setLogs));
      setStats(wStats);
      if (startDate) {
        const o = computeOverallStats(sessionLogs, setLogs);
        const streak = computeCurrentStreak(sessionLogs, startDate);
        const totalDays = 84;
        const daysSince = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000));
        setOverall({
          totalReps: o.totalReps,
          avgRpe: o.avgRpe,
          streak,
          programPct: Math.min(100, Math.round((daysSince / totalDays) * 100)),
        });
      }
    })();
  }, []);

  if (!stats) return null;

  const hasAnyData = stats.some((s) => s.sessionsCompleted > 0);

  if (!hasAnyData) {
    return (
      <Card className="flex items-center gap-3 bg-white/[0.03]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/15">
          <Dumbbell size={18} className="text-blue-400" />
        </div>
        <p className="text-sm leading-relaxed text-slate-400">
          No sessions logged yet. Finish a workout and your consistency,
          volume, and RPE trends will show up here week by week.
        </p>
      </Card>
    );
  }

  const latest = stats[stats.length - 1];

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 gap-2.5"
      >
        <MetricCard
          icon={<Flame size={16} className="text-orange-400" />}
          label="Current Streak"
          value={`${overall?.streak ?? 0}${overall?.streak === 1 ? ' day' : 'd'}`}
          sub="Training days"
          accent
        />
        <MetricCard
          icon={<Dumbbell size={16} className="text-blue-400" />}
          label="Workouts"
          value={String(latest.sessionsCompleted)}
          sub={`Week ${latest.week}`}
        />
        <MetricCard
          icon={<Target size={16} className="text-emerald-400" />}
          label="Average Effort"
          value={overall?.avgRpe != null ? String(overall.avgRpe) : '—'}
          sub="Last session"
        />
        <MetricCard
          icon={<Zap size={16} className="text-blue-400" />}
          label="Total Reps"
          value={overall?.totalReps != null ? String(overall.totalReps) : '0'}
          sub="All time"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Weekly Consistency</h3>
            <span className="text-xs text-slate-500">Last {stats.length} {stats.length === 1 ? 'week' : 'weeks'}</span>
          </div>
          <div className="mt-3 h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats} margin={{ left: -20, right: 10, top: 5, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} stroke="#64748B" fontSize={11} />
                <YAxis stroke="#64748B" fontSize={11} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#16213E', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 13 }}
                  labelFormatter={(w) => `Week ${w}`}
                  formatter={(v) => [`${v ?? 0}%`, 'Consistency']}
                />
                <Line type="monotone" dataKey="consistencyPct" stroke="#F97316" strokeWidth={2.5} dot={{ r: 3, fill: '#F97316' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3 text-xs text-slate-500">
            <BarChart3 size={12} />
            <span>
              {latest.consistencyPct}% consistency &middot; {stats.filter(s => s.sessionsCompleted > 0).length} of {stats.length} {stats.length === 1 ? 'week' : 'weeks'} completed
            </span>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
