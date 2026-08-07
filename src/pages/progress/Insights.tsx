import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { HeartPulse, Lock, Sparkles, Target, TrendingUp } from 'lucide-react';
import { getAllSessionLogs, getAllSetLogs, getAllMeasurements, getProgramStartDate } from '@/lib/db';
import { onDataChanged } from '@/lib/events';
import { TRAINING_SESSIONS_PER_WEEK } from '@/lib/data';
import { getEquipmentProfile } from '@/lib/equipment';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import { getTodayInfo } from '@/lib/programEngine';
import {
  RECOVERY_LEVEL_META,
  CONFIDENCE_META,
  IMPORTANCE_META,
  FACTOR_DIRECTION_META,
  trendDirectionMeta,
} from '@/lib/presentation';
import {
  buildCoachSummary,
  buildRecommendations,
  computeRecoveryScore,
  computeTrendReport,
  groupRecommendations,
  type Confidence,
  type MetricTrend,
  type Recommendation,
  type RecommendationGroup,
  type RecommendationImportance,
  type RecoveryAnalysis,
  type TrendReport,
} from '@/services/index';
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';

type ImportanceFilter = RecommendationImportance | 'all';

const IMPORTANCE_FILTERS: { key: ImportanceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
];

interface InsightsData {
  sessionLogs: SessionLog[];
  setLogs: SetLog[];
  measurements: MeasurementEntry[];
  startDate: string;
  availableWeights: number[];
}

interface Insights {
  coachSummary: string;
  recommendations: Recommendation[];
  recovery: RecoveryAnalysis;
  trends: TrendReport;
  focus: string;
  phase: string;
}

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const conf = CONFIDENCE_META[confidence];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        conf.chip,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', conf.color)} />
      {conf.label} confidence
    </span>
  );
}

function CoachSummaryCard({ paragraph }: { paragraph: string }) {
  return (
    <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-blue-400" />
        <h3 className="text-sm font-bold text-white">Coach&apos;s Summary</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">Today</span>
      </div>
      <p className="mt-2.5 text-[15px] font-medium leading-relaxed text-slate-100">{paragraph}</p>
      <p className="mt-2 text-[11px] text-slate-500">
        Compiled from your recovery, milestones, and recommendations.
      </p>
    </Card>
  );
}

function RecoverySection({ recovery }: { recovery: RecoveryAnalysis }) {
  const level = RECOVERY_LEVEL_META[recovery.level];

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse size={16} className={level.color} />
          <h3 className="text-sm font-bold text-white">Recovery</h3>
        </div>
        <ConfidenceChip confidence={recovery.confidence} />
      </div>
      <p className={cn('mt-3 text-2xl font-extrabold tabular-nums leading-none', level.color)}>
        {level.label} <span className="font-semibold">&middot;</span>{' '}
        <span className="text-slate-300">{recovery.score}</span>
        <span className="text-sm font-semibold text-slate-500">/100</span>
      </p>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-200">
        {recovery.recommendation}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{recovery.explanation}</p>

      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          What&apos;s driving this
        </p>
        <div className="mt-2 space-y-1.5">
          {recovery.contributors.map((f) => {
            const dir = FACTOR_DIRECTION_META[f.direction];
            return (
              <div key={f.key} className="flex items-start gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">{f.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', dir.chip)}>
                      {dir.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{f.detail}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-xs font-bold tabular-nums',
                    f.impact > 0 ? 'text-emerald-400' : f.impact < 0 ? 'text-rose-400' : 'text-slate-600',
                  )}
                >
                  {f.impact > 0 ? `+${f.impact}` : f.impact}
                </span>
              </div>
            );
          })}
          {recovery.contributors.length === 0 && (
            <p className="text-xs text-slate-500">
              Not enough data yet — recovery factors appear as you log sessions.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function WeeklyFocusSection({
  focus,
  phase,
  weekNumber,
}: {
  focus: string;
  phase: string;
  weekNumber: number;
}) {
  return (
    <Card className="border-orange-500/15">
      <div className="flex items-center gap-2">
        <Target size={16} className="text-orange-400" />
        <h3 className="text-sm font-bold text-white">Weekly Focus</h3>
        <span className="ml-auto rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-400">
          Week {weekNumber} &middot; {phase}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-200">{focus}</p>
    </Card>
  );
}

function RecCard({ rec }: { rec: Recommendation }) {
  const imp = IMPORTANCE_META[rec.importance];
  return (
    <Card className="border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            imp.badge,
          )}
        >
          {imp.label}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{rec.source}</span>
      </div>
      <h4 className="mt-2 text-base font-bold text-white">{rec.title}</h4>
      <p className="mt-1 text-sm font-medium text-slate-200">{rec.decision}</p>
      <ul className="mt-2 space-y-1">
        {rec.reasoning.map((line, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-slate-400">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-2.5">
        <ConfidenceChip confidence={rec.confidence} />
      </div>
    </Card>
  );
}

function GroupItem({ rec }: { rec: Recommendation }) {
  if (rec.key === 'milestone' && rec.action.type === 'milestone') {
    const a = rec.action;
    return (
      <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">{a.milestoneTitle}</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-300">
            {a.progressCurrent}/{a.progressTarget}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {a.remaining} more {a.remaining === 1 ? 'session' : 'sessions'}
        </p>
      </div>
    );
  }

  if (rec.key === 'overload' && rec.action.type === 'overload') {
    const s = rec.action.step;
    return (
      <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-white">{s.exerciseName}</span>
          {s.current.holdSeconds != null && s.target.holdSeconds != null && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-300">
              {s.current.holdSeconds}s &rarr; {s.target.holdSeconds}s
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{rec.decision}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
      <p className="text-sm font-semibold text-white">{rec.title}</p>
      <p className="mt-0.5 text-xs text-slate-400">{rec.decision}</p>
    </div>
  );
}

function GroupCard({ group }: { group: RecommendationGroup }) {
  const imp = IMPORTANCE_META[group.importance];
  return (
    <Card className="border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            imp.badge,
          )}
        >
          {imp.label}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <h4 className="mt-2 text-base font-bold text-white">{group.title}</h4>
      <div className="mt-2.5 space-y-1.5">
        {group.items.map((item) => (
          <GroupItem key={item.id} rec={item} />
        ))}
      </div>
    </Card>
  );
}

function RecommendationsSection({ recommendations }: { recommendations: Recommendation[] }) {
  const [filter, setFilter] = useState<ImportanceFilter>('all');
  const filtered = useMemo(
    () =>
      filter === 'all'
        ? recommendations
        : recommendations.filter((r) => r.importance === filter),
    [recommendations, filter],
  );
  const groups = useMemo(() => groupRecommendations(filtered), [filtered]);

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-blue-400" />
          <h3 className="text-sm font-bold text-white">Recommendations</h3>
        </div>
        <span className="text-[11px] text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {IMPORTANCE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-slate-300',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">
            {filter === 'all'
              ? 'No recommendations right now — keep following your plan.'
              : `No ${filter} recommendations right now — keep following your plan.`}
          </p>
        </Card>
      ) : (
        groups.map((group) => (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {group.items.length === 1 ? (
              <RecCard rec={group.items[0]} />
            ) : (
              <GroupCard group={group} />
            )}
          </motion.div>
        ))
      )}
    </section>
  );
}

function TrendRow({ metric }: { metric: MetricTrend }) {
  const dir = trendDirectionMeta(metric);
  const showValues = metric.firstHalfAvg != null && metric.lastHalfAvg != null;

  if (metric.direction === 'insufficient') {
    return (
      <div className="rounded-xl bg-white/[0.03] px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Lock size={13} className="text-slate-500" />
            {metric.label}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', dir.chip)}>
            Locked
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{metric.explanation}</p>
        <p className="mt-1.5 text-[11px] font-medium text-blue-300/80">
          {metric.observedWeeks >= 1
            ? 'One more week of logging unlocks this trend.'
            : 'A couple of weeks of consistent logging unlocks this trend.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/[0.03] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{metric.label}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', dir.chip)}>
          {dir.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{metric.explanation}</p>
      {showValues && (
        <p className="mt-1 text-[11px] tabular-nums text-slate-500">
          {metric.firstHalfAvg} {metric.unit} &rarr; {metric.lastHalfAvg} {metric.unit}
        </p>
      )}
    </div>
  );
}

function TrendsSection({ trends }: { trends: TrendReport }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white">Trends</h3>
        <span className="text-[11px] text-slate-500">to week {trends.asOfWeek || '—'}</span>
      </div>
      <div className="space-y-2">
        {trends.metrics.map((m) => (
          <TrendRow key={m.key} metric={m} />
        ))}
      </div>
    </section>
  );
}

export function ProgressInsights() {
  const [data, setData] = useState<InsightsData | null>(null);

  const load = useCallback(async () => {
    const [sessionLogs, setLogs, measurements, startDate, eq] = await Promise.all([
      getAllSessionLogs(),
      getAllSetLogs(),
      getAllMeasurements(),
      getProgramStartDate(),
      getEquipmentProfile(),
    ]);
    setData({
      sessionLogs,
      setLogs,
      measurements,
      startDate: startDate ?? '',
      availableWeights: eq.dumbbells,
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recompute whenever any data mutation is committed.
  useEffect(() => onDataChanged(load), [load]);

  const insights = useMemo<Insights | null>(() => {
    if (!data?.startDate) return null;
    const asOf = new Date();
    const recommendations = buildRecommendations(data.sessionLogs, data.setLogs, data.measurements, {
      startIso: data.startDate,
      asOf,
      maxResults: 20,
      availableWeights: data.availableWeights,
    });
    const today = getTodayInfo(data.startDate, asOf);
    return {
      coachSummary: buildCoachSummary(data.sessionLogs, data.setLogs, data.measurements, {
        startIso: data.startDate,
        asOf,
        maxSentences: 3,
        availableWeights: data.availableWeights,
      }).paragraph,
      recommendations,
      recovery: computeRecoveryScore(data.sessionLogs, data.setLogs, {
        startIso: data.startDate,
        asOf,
      }),
      trends: computeTrendReport(data.sessionLogs, data.setLogs, {
        trainingSessionsPerWeek: TRAINING_SESSIONS_PER_WEEK,
      }),
      focus: today.weekRow?.focus ?? '',
      phase: today.weekRow?.deload ? 'Deload' : (today.weekRow?.phase ?? 'Training'),
    };
  }, [data]);

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  const hasAnyData = data.sessionLogs.some((s) => s.completed);
  if (!data.startDate || !hasAnyData || !insights) {
    return (
      <Card className="flex items-center gap-3 bg-white/[0.03]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/15">
          <Sparkles size={18} className="text-blue-400" />
        </div>
        <p className="text-sm leading-relaxed text-slate-400">
          No sessions logged yet. Finish a workout and your recovery, recommendations, and trends will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <CoachSummaryCard paragraph={insights.coachSummary} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <RecoverySection recovery={insights.recovery} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08 }}
      >
        <WeeklyFocusSection
          focus={insights.focus}
          phase={insights.phase}
          weekNumber={getTodayInfo(data.startDate, new Date()).weekNumber}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <RecommendationsSection recommendations={insights.recommendations} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <TrendsSection trends={insights.trends} />
      </motion.div>
    </div>
  );
}
