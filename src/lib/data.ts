import exercisesRaw from '@/data/exercises.json';
import programRaw from '@/data/program.json';
import type { Exercise, Program, ExerciseCategory } from '@/types';

export const exercises = exercisesRaw as Exercise[];
export const program = programRaw as Program;

const exerciseById = new Map(exercises.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return exerciseById.get(id);
}

export function getExercisesByCategory(category: ExerciseCategory): Exercise[] {
  return exercises.filter((e) => e.category === category);
}

export function getExercisesForSession(sessionKey: string): Exercise[] {
  const session = program.sessions[sessionKey];
  if (!session) return [];
  return session.exercises
    .map((id) => getExercise(id))
    .filter((e): e is Exercise => Boolean(e));
}

export function getWeekRow(weekNumber: number) {
  return program.week_table.find((w) => w.week === weekNumber);
}

export function getAllCategories(): ExerciseCategory[] {
  return ['Push', 'Pull', 'Legs', 'Core'];
}

export function getAlphabeticalIndex(): Record<string, Exercise[]> {
  const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
  const grouped: Record<string, Exercise[]> = {};
  for (const ex of sorted) {
    const letter = ex.name[0].toUpperCase();
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(ex);
  }
  return grouped;
}

export function resolveIllustrationSrc(ex: Exercise): string | null {
  if (!ex.illustration.image) return null;
  return `/illustrations/${ex.illustration.image}`;
}
