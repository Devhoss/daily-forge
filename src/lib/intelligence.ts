import type { SetLog } from '@/lib/db';
import { getExercise } from '@/lib/data';
import { getEquipmentProfile } from '@/lib/equipment';

export interface SetAnalysis {
  exerciseId: string;
  exerciseName: string;
  targetReps: number;
  actualReps: number;
  metTarget: boolean;
  weightUsed: number | null;
}

export interface ExerciseRecommendation {
  exerciseId: string;
  exerciseName: string;
  action: 'maintain' | 'increase_weight' | 'increase_reps' | 'progress_variation';
  reason: string;
}

export interface SessionRecommendation {
  sessionKey: string;
  exercises: ExerciseRecommendation[];
  overallNote: string | null;
}

/** Analyze all completed sets for an exercise across history. */
export function analyzeExerciseHistory(
  setLogs: SetLog[],
  exerciseId: string,
): SetAnalysis[] {
  const ex = getExercise(exerciseId);
  if (!ex) return [];

  const numbers = ex.reps.match(/(\d+)/g);
  const targetReps = numbers ? parseInt(numbers[numbers.length - 1], 10) : 10;

  return setLogs
    .filter((s) => s.exerciseId === exerciseId)
    .map((s) => ({
      exerciseId,
      exerciseName: ex.name,
      targetReps,
      actualReps: s.repsCompleted ?? s.holdDurationSeconds ?? 0,
      metTarget: (s.repsCompleted ?? 0) >= targetReps,
      weightUsed: null,
    }));
}

/** Recommend progression for each exercise in a session based on history.
 *  Future: this will become adaptive as more sets are logged. */
export async function recommendProgression(
  sessionKey: string,
  setLogs: SetLog[],
): Promise<SessionRecommendation> {
  const { sessions } = await import('@/lib/data').then((m) => ({ sessions: m.program.sessions }));
  const session = sessions[sessionKey];
  if (!session) return { sessionKey, exercises: [], overallNote: null };

  const profile = await getEquipmentProfile();
  const recommendations: ExerciseRecommendation[] = [];
  let overallNote: string | null = null;

  for (const exId of session.exercises) {
    const ex = getExercise(exId);
    if (!ex) continue;

    const history = analyzeExerciseHistory(setLogs, exId);
    const recent = history.slice(-3);
    const allMetTarget = recent.length > 0 && recent.every((s) => s.metTarget);

    if (allMetTarget && profile.dumbbells.length > 0) {
      const hasHeavier = profile.dumbbells.some((w) => w > profile.dumbbells[0]);
      if (hasHeavier) {
        recommendations.push({
          exerciseId: exId,
          exerciseName: ex.name,
          action: 'increase_weight',
          reason: 'You completed the target reps consistently. Try a heavier weight.',
        });
      } else {
        recommendations.push({
          exerciseId: exId,
          exerciseName: ex.name,
          action: 'increase_reps',
          reason: 'Max weight reached. Increase reps for progressive overload.',
        });
      }
    } else if (history.length > 0) {
      recommendations.push({
        exerciseId: exId,
        exerciseName: ex.name,
        action: 'maintain',
        reason: 'Keep building volume at this weight before advancing.',
      });
    }
  }

  return { sessionKey, exercises: recommendations, overallNote };
}
