/**
 * measurementDeltas — pure measurement lookup and week-over-week deltas.
 *
 * Reusable by the Weekly Report (M2), trend/recovery surfaces, and the coach.
 * Keeps the measurement math out of the report builder.
 */
import type { MeasurementEntry } from '@/lib/db';

export interface MeasurementField {
  key: string;
  label: string;
  unit: string;
}

export const MEASUREMENT_FIELDS: MeasurementField[] = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'chest', label: 'Chest', unit: 'cm' },
  { key: 'waist', label: 'Waist', unit: 'cm' },
  { key: 'hips', label: 'Hips', unit: 'cm' },
  { key: 'leftArm', label: 'Left arm', unit: 'cm' },
  { key: 'rightArm', label: 'Right arm', unit: 'cm' },
  { key: 'leftThigh', label: 'Left thigh', unit: 'cm' },
  { key: 'rightThigh', label: 'Right thigh', unit: 'cm' },
  { key: 'calves', label: 'Calves', unit: 'cm' },
  { key: 'neck', label: 'Neck', unit: 'cm' },
];

export interface MeasurementDelta {
  key: string;
  label: string;
  unit: string;
  /** Value in the earlier recording (null = baseline, none recorded before). */
  prev: number | null;
  /** Value in the later recording. */
  curr: number | null;
  /** curr - prev, rounded to 0.1. Null when either side is missing. */
  change: number | null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/**
 * Compare two measurement entries field-by-field. `null` fields are skipped on
 * both sides; a field present only in `curr` is reported as a baseline
 * (`prev: null`, `change: null`) rather than a fake 0→x jump.
 */
export function measurementDelta(
  prev: MeasurementEntry | null,
  curr: MeasurementEntry | null,
): MeasurementDelta[] {
  const deltas: MeasurementDelta[] = [];
  for (const f of MEASUREMENT_FIELDS) {
    const pv = prev ? asNumber(prev[f.key as keyof MeasurementEntry]) : null;
    const cv = curr ? asNumber(curr[f.key as keyof MeasurementEntry]) : null;
    if (pv == null && cv == null) continue;
    deltas.push({
      key: f.key,
      label: f.label,
      unit: f.unit,
      prev: pv,
      curr: cv,
      change: pv == null || cv == null ? null : Math.round((cv - pv) * 10) / 10,
    });
  }
  return deltas;
}

/**
 * The most recent measurement recorded at or before `week` (there is at most
 * one per week). Returns `null` when nothing has been recorded yet.
 */
export function latestMeasurementAtOrBefore(
  measurements: MeasurementEntry[],
  week: number,
): MeasurementEntry | null {
  let best: MeasurementEntry | null = null;
  for (const m of measurements) {
    if (m.week <= week && (best == null || m.week > best.week)) best = m;
  }
  return best;
}
