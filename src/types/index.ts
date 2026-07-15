export type ExerciseCategory = 'Push' | 'Pull' | 'Legs' | 'Core';

export interface ExerciseIllustration {
  image: string | null;
  alt: string;
  prompt: string;
}

export interface ExerciseVideo {
  slug: string;
  url: string;
  qr: string | null;
}

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  difficulty: number;
  equipment: string[];
  muscles_primary: string[];
  muscles_secondary: string[];
  setup: string;
  execution: string[];
  breathing: string;
  tempo: string;
  tempo_note?: string;
  sets: string;
  reps: string;
  reps_note?: string;
  rest: string;
  mistakes: string[];
  pro_tips: string[];
  progressions: string[];
  regressions: string[];
  safety: string;
  illustration: ExerciseIllustration;
  video: ExerciseVideo;
}

export interface ProgramPhase {
  phase_number: number;
  name: string;
  weeks: string;
  goal: string;
  sets: string;
  reps: string;
  tempo: string;
  rest: string;
  technique_focus: string;
}

export interface DeloadProtocol {
  sets: string;
  reps: string;
  tempo: string;
  rest: string;
  note: string;
}

export interface BenchmarkTest {
  exercise: string;
  test: string;
}

export interface WeeklyTemplateDay {
  day: string;
  label: string;
  session_key: string;
}

export interface Session {
  title: string;
  exercises: string[];
}

export interface WeekTableRow {
  week: number;
  phase: string;
  focus: string;
  sets: string;
  reps: string;
  tempo: string;
  rest: string;
  deload: boolean;
}

export interface Program {
  progress_checkpoints: number[];
  principle_statement: string;
  phases: ProgramPhase[];
  deload_weeks: number[];
  deload_protocol: DeloadProtocol;
  benchmark_tests: BenchmarkTest[];
  weekly_template: WeeklyTemplateDay[];
  sessions: Record<string, Session>;
  week_table: WeekTableRow[];
}
