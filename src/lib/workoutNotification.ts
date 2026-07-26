import { Capacitor } from '@capacitor/core';

type WorkoutNotificationPlugin = {
  startWorkout(options: { title: string; content: string }): Promise<void>;
  updateNotification(options: { title: string; content: string }): Promise<void>;
  stopWorkout(): Promise<void>;
};

function resolvePlugin(): WorkoutNotificationPlugin | null {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const plugin = (Capacitor as any).Plugins?.WorkoutNotification as WorkoutNotificationPlugin | undefined;
    return plugin ?? null;
  } catch {
    return null;
  }
}

export async function startWorkoutNotification(
  exerciseIndex: number,
  totalExercises: number,
): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  await p.startWorkout({
    title: 'Workout in Progress',
    content: `Exercise ${exerciseIndex + 1} of ${totalExercises}`,
  });
}

export async function updateExerciseNotification(
  exerciseIndex: number,
  totalExercises: number,
): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  await p.updateNotification({
    title: 'Workout in Progress',
    content: `Exercise ${exerciseIndex + 1} of ${totalExercises}`,
  });
}

export async function updateRestNotification(
  secondsRemaining: number,
): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  const mm = Math.floor(secondsRemaining / 60);
  const ss = secondsRemaining % 60;
  await p.updateNotification({
    title: 'Resting',
    content: `${mm}:${String(ss).padStart(2, '0')} remaining`,
  });
}

export async function stopWorkoutNotification(): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  await p.stopWorkout();
}
