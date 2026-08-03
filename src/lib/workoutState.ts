import { db } from '@/lib/db';

const STATE_KEY = 'workoutState';
const STALE_MS = 24 * 60 * 60 * 1000;

export interface WorkoutState {
  sessionKey: string;
  exerciseIndex: number;
  setIndex: number;
  phase: 'exercise' | 'resting';
  repsInput: number;
  holdDurationTarget?: number;
  restEndTime?: number;
  restDuration?: number;
  /** Wall-clock epoch (ms) when the workout was started, for accurate elapsed duration. */
  startedAt?: number;
  timestamp: number;
}

export async function saveWorkoutState(state: WorkoutState): Promise<void> {
  await db.settings.put({ key: STATE_KEY, value: JSON.stringify(state) });
}

export async function loadWorkoutState(): Promise<WorkoutState | null> {
  const row = await db.settings.get(STATE_KEY);
  if (!row) return null;
  const state: WorkoutState = JSON.parse(row.value);
  if (Date.now() - state.timestamp > STALE_MS || state.timestamp > Date.now() + 60000) {
    await clearWorkoutState();
    return null;
  }
  return state;
}

export async function clearWorkoutState(): Promise<void> {
  await db.settings.delete(STATE_KEY);
}
