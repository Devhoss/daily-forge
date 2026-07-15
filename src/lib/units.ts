import type { UnitSystem } from '@/lib/db';

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export function weightToDisplay(kg: number | undefined, system: UnitSystem): number | undefined {
  if (kg === undefined) return undefined;
  return system === 'imperial' ? round1(kg / KG_PER_LB) : round1(kg);
}

export function weightToStorage(displayValue: number, system: UnitSystem): number {
  return system === 'imperial' ? round1(displayValue * KG_PER_LB) : round1(displayValue);
}

export function lengthToDisplay(cm: number | undefined, system: UnitSystem): number | undefined {
  if (cm === undefined) return undefined;
  return system === 'imperial' ? round1(cm / CM_PER_IN) : round1(cm);
}

export function lengthToStorage(displayValue: number, system: UnitSystem): number {
  return system === 'imperial' ? round1(displayValue * CM_PER_IN) : round1(displayValue);
}

export function weightUnitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'lb' : 'kg';
}

export function lengthUnitLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'in' : 'cm';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
