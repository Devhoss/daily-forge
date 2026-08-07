/**
 * Central presentation metadata for the coaching UI.
 *
 * Labels and colors are presentation-only (no logic). They live here so Home,
 * Insights, and any future screen render the same words for the same states.
 */
import type { Confidence, RecommendationImportance } from '@/services/recommendations/recommendationEngine';
import type { RecoveryLevel, RecoveryFactorDirection } from '@/services/recovery/recoveryScore';
import type { TrendDirection } from '@/services/trends/trendEngine';

export const RECOVERY_LEVEL_META: Record<RecoveryLevel, { label: string; color: string; dot: string }> = {
  fresh: { label: 'Fresh', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  ready: { label: 'Ready', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  tired: { label: 'Tired', color: 'text-amber-400', dot: 'bg-amber-400' },
  overtraining_risk: { label: 'Overtraining risk', color: 'text-rose-400', dot: 'bg-rose-400' },
};

export const CONFIDENCE_META: Record<Confidence, { label: string; color: string; chip: string }> = {
  high: { label: 'High', color: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-400' },
  medium: { label: 'Medium', color: 'text-amber-400', chip: 'bg-amber-500/15 text-amber-400' },
  low: { label: 'Low', color: 'text-slate-400', chip: 'bg-white/5 text-slate-400' },
};

export const IMPORTANCE_META: Record<
  RecommendationImportance,
  { label: string; badge: string; dot: string }
> = {
  critical: { label: 'Critical', badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30', dot: 'bg-rose-400' },
  high: { label: 'High', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  normal: { label: 'Normal', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-400' },
  low: { label: 'Low', badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' },
};

export const FACTOR_DIRECTION_META: Record<
  RecoveryFactorDirection,
  { label: string; chip: string }
> = {
  straining: { label: 'Strain', chip: 'bg-rose-500/10 text-rose-400' },
  recovering: { label: 'Recovery', chip: 'bg-emerald-500/10 text-emerald-400' },
  neutral: { label: 'Neutral', chip: 'bg-white/5 text-slate-400' },
  informational: { label: 'Info', chip: 'bg-white/5 text-slate-400' },
};

export function trendDirectionMeta(m: {
  direction: TrendDirection;
  favorable: boolean | null;
}): { label: string; chip: string } {
  switch (m.direction) {
    case 'insufficient':
      return { label: 'Not enough data', chip: 'bg-white/5 text-slate-500' };
    case 'steady':
      return { label: 'Steady', chip: 'bg-white/5 text-slate-300' };
    case 'rising': {
      if (m.favorable === true) return { label: 'Rising', chip: 'bg-emerald-500/15 text-emerald-400' };
      if (m.favorable === false) return { label: 'Rising', chip: 'bg-rose-500/15 text-rose-400' };
      return { label: 'Rising', chip: 'bg-blue-500/15 text-blue-400' };
    }
    case 'falling': {
      if (m.favorable === true) return { label: 'Falling', chip: 'bg-rose-500/15 text-rose-400' };
      if (m.favorable === false) return { label: 'Falling', chip: 'bg-emerald-500/15 text-emerald-400' };
      return { label: 'Falling', chip: 'bg-blue-500/15 text-blue-400' };
    }
  }
}
