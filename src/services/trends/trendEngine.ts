/**
 * TrendEngine — pure, deterministic time-series analytics for DailyForge.
 *
 * This is a data service, not a charting helper. It consumes typed session/set
 * logs and returns a structured `TrendReport` (chronological points plus a
 * per-metric `MetricTrend` that carries a plain-language explanation). Charts
 * can render the points later; the explanation is the product.
 *
 * Design constraints (see docs/vnext-proposal.md Phase 2):
 *  - Pure functions: typed inputs in, plain objects out. No IndexedDB, no UI
 *    imports, no timers, no module-level mutable state.
 *  - Deterministic: identical inputs always produce identical output.
 *  - Explicit missing-data policy: `undefined`/absent values are never coerced
 *    to `0`. An unweighted set is excluded from load; a week with no RPE logs
 *    reports `null`, never a fake zero. Analytics must not silently lie about
 *    old or sparse data.
 *  - Reusable core: `linearSlope`, `halfDelta`, and `average` are generic and
 *    intended to be shared by the Recovery Score and Progressive Overload
 *    services that follow.
 */
import type { SessionLog, SetLog } from '@/lib/db';

export type TrendMetricKey =
  | 'consistency'
  | 'volume'
  | 'load'
  | 'rpe'
  | 'duration'
  | 'energy'
  | 'sleep';

export type TrendDirection = 'rising' | 'falling' | 'steady' | 'insufficient';

export interface TrendConfig {
  /** Number of non-rest sessions in the weekly template. Used to normalise consistency. */
  trainingSessionsPerWeek: number;
}

export interface TrendPoint {
  week: number;
  sessionsCompleted: number;
  /** 0..100, sessions/trainingSessionsPerWeek. May be 0 for a skipped week. */
  consistencyPct: number;
  /** Total reps (or seconds for holds) logged across completed sessions that week. */
  volume: number;
  /** Mean external load (kg) across sets that recorded weight. `null` if none did. */
  loadAvg: number | null;
  rpeAvg: number | null;
  durationMinAvg: number | null;
  energyAvg: number | null;
  sleepAvg: number | null;
}

export interface MetricTrend {
  key: TrendMetricKey;
  label: string;
  unit: string;
  direction: TrendDirection;
  /**
   * Whether the direction is *good* for that metric. `null` when the metric's
   * direction is descriptive rather than good/bad (RPE, duration) or when there
   * is insufficient data. Consistency/volume/load/energy/sleep define it;
   * RPE/duration leave it `null` because rising isn't unambiguously positive.
   */
  favorable: boolean | null;
  /** Number of weeks with usable (non-null) data. */
  observedWeeks: number;
  /** Signed % change (last-half mean vs first-half mean). `null` when undefined. */
  trendPct: number | null;
  /** Least-squares slope per week over observed points. `null` when < 2 points. */
  slopePerWeek: number | null;
  firstHalfAvg: number | null;
  lastHalfAvg: number | null;
  explanation: string;
}

export interface TrendReport {
  /** Highest week represented in the report (0 for an empty report). */
  asOfWeek: number;
  /** Chronological, per-week points (one per week up to `asOfWeek`). */
  points: TrendPoint[];
  metrics: MetricTrend[];
}

const DEFAULT_CONFIG: Required<TrendConfig> = { trainingSessionsPerWeek: 3 };

// ---------------------------------------------------------------------------
// Generic numeric primitives (shared with Recovery Score / Overload services)
// ---------------------------------------------------------------------------

export function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round0(n: number): number {
  return Math.round(n);
}

/**
 * Least-squares slope (per step) over equally spaced indices 0..n-1.
 * Returns `null` when fewer than two points exist. The slope is unit-per-step,
 * so for weekly data it is "per week".
 */
export function linearSlope(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) * (i - meanX);
  }
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

/**
 * Split an array in half and average each half. More robust to a single noisy
 * point than an end-to-end delta, and easy to explain ("first half vs last
 * half"). Returns nulls for empty input; for n=1 both halves share the value.
 */
export function halfDelta(values: number[]): { first: number | null; last: number | null } {
  const n = values.length;
  if (n === 0) return { first: null, last: null };
  const split = Math.ceil(n / 2);
  return { first: average(values.slice(0, split)), last: average(values.slice(split)) };
}

// ---------------------------------------------------------------------------
// Metric definitions and direction labels
// ---------------------------------------------------------------------------

type GoodWhen = 'up' | 'down' | 'none';

interface MetricDef {
  label: string;
  unit: string;
  goodWhen: GoodWhen;
  insufficientText: string;
}

const METRIC_DEFS: Record<TrendMetricKey, MetricDef> = {
  consistency: {
    label: 'Consistency',
    unit: '%',
    goodWhen: 'up',
    insufficientText:
      'Not enough busy weeks yet to read a consistency trend — log a couple more weeks and this will appear.',
  },
  volume: {
    label: 'Weekly volume',
    unit: 'reps',
    goodWhen: 'up',
    insufficientText:
      'Not enough logged weeks yet to read a volume trend — keep training.',
  },
  load: {
    label: 'Average load',
    unit: 'kg',
    goodWhen: 'up',
    insufficientText:
      'Start logging weight on your sets to unlock a load trend.',
  },
  rpe: {
    label: 'Average effort (RPE)',
    unit: '/10',
    goodWhen: 'none',
    insufficientText:
      'Rate your effort (RPE) after sessions to unlock an effort trend.',
  },
  duration: {
    label: 'Session length',
    unit: 'min',
    goodWhen: 'none',
    insufficientText:
      'Session length trend will appear as you complete more sessions.',
  },
  energy: {
    label: 'Energy',
    unit: '/10',
    goodWhen: 'up',
    insufficientText: 'Log your energy after sessions to unlock an energy trend.',
  },
  sleep: {
    label: 'Sleep',
    unit: 'hrs',
    goodWhen: 'up',
    insufficientText: 'Log sleep hours to unlock a recovery trend.',
  },
};

// A direction is considered "steady" when the last-half mean differs from the
// first-half mean by less than this percent (relative to the first-half mean).
const STEADY_PCT_THRESHOLD = 5;

function resolveDirection(
  first: number,
  last: number,
  goodWhen: GoodWhen,
): { direction: TrendDirection; favorable: boolean | null } {
  const diff = last - first;
  if (first !== 0) {
    const pct = (diff / Math.abs(first)) * 100;
    if (Math.abs(pct) < STEADY_PCT_THRESHOLD) {
      return { direction: 'steady', favorable: null };
    }
  } else if (diff === 0) {
    return { direction: 'steady', favorable: null };
  }
  const direction: TrendDirection = diff > 0 ? 'rising' : 'falling';
  const favorable =
    goodWhen === 'none' ? null : (diff > 0) === (goodWhen === 'up');
  return { direction, favorable };
}

// ---------------------------------------------------------------------------
// Explanation builder — the point of the Trend Engine
// ---------------------------------------------------------------------------

function pct(v: number): string {
  return `${round0(v)}%`;
}

function num(v: number, digits = 1): string {
  const r = digits === 0 ? round0(v) : round1(v);
  return `${r}`;
}

const FIRST_HALF = 'the first half';
const LAST_HALF = 'the last half';

function explainMetric(def: MetricDef, m: MetricTrend): string {
  const first = m.firstHalfAvg;
  const last = m.lastHalfAvg;
  if (m.direction === 'insufficient') return def.insufficientText;
  if (first == null || last == null) return def.insufficientText;

  const up = last >= first;
  switch (def.label) {
    case 'Consistency': {
      if (m.direction === 'steady') {
        return `Consistency held steady around ${pct(first)} of your planned sessions. ${num(first * 3 / 100, 0)} of your weekly sessions are being completed.`;
      }
      return `${up ? 'Consistency climbed' : 'Consistency slipped'} from ${pct(first)} to ${pct(last)} of planned sessions over ${FIRST_HALF} vs ${LAST_HALF}. ${
        up
          ? 'You are showing up more reliably.'
          : 'This may be a signal to ease the schedule or take an easier session.'
      }`;
    }
    case 'Weekly volume': {
      if (m.direction === 'steady') return `Weekly volume held near ${num(first, 0)} total reps.`;
      return `${up ? 'Weekly volume grew' : 'Weekly volume fell'} from ${num(first, 0)} to ${num(last, 0)} total reps over ${FIRST_HALF} vs ${LAST_HALF}. ${
        up
          ? 'Progressive overload is happening.'
          : 'Watch that total reps do not drop while you push load.'
      }`;
    }
    case 'Average load': {
      if (m.direction === 'steady') return `Average working weight held near ${num(first)} kg.`;
      return `${up ? 'Average working weight rose' : 'Average working weight fell'} from ${num(first)} to ${num(last)} kg. ${
        up ? 'Strength is trending up.' : 'Load is lighter recently — intentional deload or equipment change?'
      }`;
    }
    case 'Average effort (RPE)': {
      if (m.direction === 'steady') return `Average effort held steady around ${num(first)}/10. That is a consistent level of difficulty.`;
      return `${up ? 'Average effort rose' : 'Average effort eased'} from ${num(first)}/10 to ${num(last)}/10. ${
        up
          ? 'Sessions are feeling harder recently — good for drive, but pair it with recovery.'
          : 'Sessions feel lighter recently — either you are getting stronger or you are easing off.'
      }`;
    }
    case 'Session length': {
      if (m.direction === 'steady') return `Sessions stayed around ${num(first)} minutes.`;
      return `Sessions ${up ? 'lengthened' : 'got shorter'} from ${num(first)} to ${num(last)} minutes over ${FIRST_HALF} vs ${LAST_HALF}.`;
    }
    case 'Energy': {
      if (m.direction === 'steady') return `Energy level held near ${num(first)}/10.`;
      return `${up ? 'Energy improved' : 'Energy dipped'} from ${num(first)}/10 to ${num(last)}/10. ${
        up ? 'You are arriving fresher.' : 'Watch sleep and recovery if this keeps dropping.'
      }`;
    }
    case 'Sleep': {
      if (m.direction === 'steady') return `Sleep held near ${num(first)} hours.`;
      return `${up ? 'Sleep improved' : 'Sleep dropped'} from ${num(first)} to ${num(last)} hours — ${
        up ? 'a strong foundation for recovery.' : 'an area worth protecting.'
      }`;
    }
    default:
      return def.insufficientText;
  }
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Build the chronological weekly series. Iterates weeks 1..max(logged week) so a
 * genuinely skipped week shows as 0 sessions / 0 consistency — an honest trend,
 * not a misleading flat line. Metrics with no data that week report `null`.
 */
export function computeWeeklyTrendPoints(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  config?: Partial<TrendConfig>,
): TrendPoint[] {
  const cfg: Required<TrendConfig> = { ...DEFAULT_CONFIG, ...config };
  const maxWeek = sessionLogs.reduce((max, s) => Math.max(max, s.weekNumber), 0);
  const points: TrendPoint[] = [];
  if (maxWeek < 1) return points;

  for (let week = 1; week <= maxWeek; week++) {
    const sessions = sessionLogs.filter((s) => s.weekNumber === week && s.completed);
    const sessionDates = new Set(sessions.map((s) => s.date));
    const weekSets = setLogs.filter((sl) => sessionDates.has(sl.date));

    const volume = weekSets.reduce(
      (sum, sl) => sum + (sl.repsCompleted ?? sl.holdDurationSeconds ?? 0),
      0,
    );
    const weighted = weekSets
      .filter((sl) => typeof sl.weightUsed === 'number' && sl.weightUsed > 0)
      .map((sl) => sl.weightUsed as number);

    const avgField = (get: (s: SessionLog) => number | undefined): number | null => {
      const vals: number[] = [];
      for (const s of sessions) {
        const v = get(s);
        if (typeof v === 'number') vals.push(v);
      }
      const a = average(vals);
      return a == null ? null : round1(a);
    };
    const rpeAvg = avgField((s) => s.rpe);
    const durationMinAvg = avgField((s) => s.durationMin);
    const energyAvg = avgField((s) => s.energy);
    const sleepAvg = avgField((s) => s.sleepHours);

    points.push({
      week,
      sessionsCompleted: sessions.length,
      consistencyPct: Math.round((sessions.length / cfg.trainingSessionsPerWeek) * 100),
      volume,
      loadAvg: weighted.length === 0 ? null : round1(average(weighted) as number),
      rpeAvg,
      durationMinAvg,
      energyAvg,
      sleepAvg,
    });
  }
  return points;
}

/**
 * Reduce a chronological series of metric values into a single `MetricTrend`
 * with a human explanation. `null`/absent measurements are dropped before
 * analysis (the missing-data policy), so direction is always computed over
 * genuinely observed weeks.
 */
export function analyzeMetricSeries(
  key: TrendMetricKey,
  values: (number | null | undefined)[],
): MetricTrend {
  const def = METRIC_DEFS[key];
  const observed = values.filter((v): v is number => typeof v === 'number');
  const base = {
    key,
    label: def.label,
    unit: def.unit,
    observedWeeks: observed.length,
  };

  if (observed.length === 0) {
    return { ...base, direction: 'insufficient', favorable: null, trendPct: null, slopePerWeek: null, firstHalfAvg: null, lastHalfAvg: null, explanation: def.insufficientText };
  }
  if (observed.length === 1) {
    const v = observed[0];
    return { ...base, direction: 'insufficient', favorable: null, trendPct: null, slopePerWeek: null, firstHalfAvg: v, lastHalfAvg: null, explanation: def.insufficientText };
  }

  const { first, last } = halfDelta(observed);
  const firstNum = first as number;
  const lastNum = last as number;
  const trendPct =
    firstNum !== 0 ? round1(((lastNum - firstNum) / Math.abs(firstNum)) * 100) : null;
  const { direction, favorable } = resolveDirection(firstNum, lastNum, def.goodWhen);
  const metric: MetricTrend = {
    ...base,
    direction,
    favorable,
    trendPct,
    slopePerWeek: linearSlope(observed),
    firstHalfAvg: round1(firstNum),
    lastHalfAvg: round1(lastNum),
    explanation: '',
  };
  metric.explanation = explainMetric(def, metric);
  return metric;
}

/**
 * Build the full Trend Report: chronological points plus a summary trend for
 * every metric. `asOfWeek` is the highest logged week (0 for an empty report).
 */
export function computeTrendReport(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  config?: Partial<TrendConfig>,
): TrendReport {
  const points = computeWeeklyTrendPoints(sessionLogs, setLogs, config);
  const asOfWeek = points.length === 0 ? 0 : points[points.length - 1].week;

  const metrics: MetricTrend[] = [
    analyzeMetricSeries('consistency', points.map((p) => p.consistencyPct)),
    analyzeMetricSeries('volume', points.map((p) => p.volume)),
    analyzeMetricSeries('load', points.map((p) => p.loadAvg)),
    analyzeMetricSeries('rpe', points.map((p) => p.rpeAvg)),
    analyzeMetricSeries('duration', points.map((p) => p.durationMinAvg)),
    analyzeMetricSeries('energy', points.map((p) => p.energyAvg)),
    analyzeMetricSeries('sleep', points.map((p) => p.sleepAvg)),
  ];

  return { asOfWeek, points, metrics };
}