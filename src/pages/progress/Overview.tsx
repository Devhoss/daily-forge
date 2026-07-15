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
import { getAllSessionLogs, getAllSetLogs } from '@/lib/db';
import { computeWeeklyStats, trimToLoggedWeeks, type WeeklyStat } from '@/lib/analytics';
import { Card } from '@/components/ui/Card';

export function ProgressOverview() {
  const [stats, setStats] = useState<WeeklyStat[] | null>(null);

  useEffect(() => {
    (async () => {
      const [sessionLogs, setLogs] = await Promise.all([getAllSessionLogs(), getAllSetLogs()]);
      setStats(trimToLoggedWeeks(computeWeeklyStats(sessionLogs, setLogs)));
    })();
  }, []);

  if (!stats) return null;

  const hasAnyData = stats.some((s) => s.sessionsCompleted > 0);

  if (!hasAnyData) {
    return (
      <Card className="mt-4">
        <p className="text-sm text-slate-400">
          No sessions logged yet. Finish a workout in Workout Mode and your
          consistency, reps, and RPE trends will show up here week by week.
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <ChartCard title="Weekly Consistency %" dataKey="consistencyPct" data={stats} color="#F97316" suffix="%" />
      <ChartCard title="Total Reps Logged" dataKey="totalReps" data={stats} color="#2563EB" />
      <ChartCard title="Average RPE" dataKey="avgRpe" data={stats} color="#10B981" domain={[0, 10]} />
    </div>
  );
}

function ChartCard({
  title,
  dataKey,
  data,
  color,
  suffix = '',
  domain,
}: {
  title: string;
  dataKey: keyof WeeklyStat;
  data: WeeklyStat[];
  color: string;
  suffix?: string;
  domain?: [number, number];
}) {
  return (
    <Card>
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <div className="mt-3 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -20, right: 10, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="week"
              tickFormatter={(w) => `W${w}`}
              stroke="#64748B"
              fontSize={11}
            />
            <YAxis stroke="#64748B" fontSize={11} domain={domain} />
            <Tooltip
              contentStyle={{ background: '#16213E', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelFormatter={(w) => `Week ${w}`}
              formatter={(v) => [`${v ?? ''}${suffix}`, '']}
            />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
