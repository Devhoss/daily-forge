/**
 * Shared types for the DailyForge AI Coach.
 *
 * The coach is an *explanation layer*, never a decision maker. The app's
 * deterministic services (recovery, recommendations, streaks, trends,
 * milestones) compute the numbers; the AI model only turns a structured
 * `CoachContext` into natural-language coaching. This split is non-negotiable:
 * the model must never compute or override a recovery score, an overload
 * step, a streak, a PR, or a recommendation.
 *
 * The provider abstraction keeps the rest of the app decoupled from any one
 * runtime. `AiProvider` is the seam the on-device LiteRT-LM plugin (and any
 * future provider) implements; `coachService` composes a prompt from a
 * deterministic context, calls a provider, and parses the structured reply.
 */

/** Everything the model is allowed to see, pre-computed by deterministic services. */
export interface CoachContext {
  /** Local calendar date the context was built for (`YYYY-MM-DD`). */
  asOfIso: string;
  /** Which deterministic service produced each section (traceability). */
  program: CoachProgramSection;
  today: CoachTodaySection;
  recovery: CoachRecoverySection;
  recentWorkouts: CoachWorkoutSection[];
  recommendations: CoachRecommendationSection[];
  trends: CoachTrendSection[];
  streak: CoachStreakSection;
  milestones: CoachMilestoneSection[];
  measurements: CoachMeasurementsSection;
  equipment: CoachEquipmentSection;
  /** Explicit missing-data markers — the model must say "not recorded", never invent. */
  missing: string[];
}

export interface CoachProgramSection {
  startIso: string;
  weekNumber: number;
  weekRow: { phase: string; focus: string; isDeload: boolean } | null;
  isProgramComplete: boolean;
  nextSessionLabel: string | null;
}

export interface CoachTodaySection {
  isRestDay: boolean;
  sessionKey: string | null;
  sessionLabel: string | null;
  exercises: string[];
}

export interface CoachRecoverySection {
  score: number;
  level: string;
  explanation: string;
  recommendation: string;
  confidence: 'low' | 'medium' | 'high';
  contributors: { label: string; direction: string; detail: string }[];
}

export interface CoachWorkoutSection {
  date: string;
  sessionLabel: string;
  rpe: number | null;
  durationMin: number | null;
  energy: number | null;
  exercises: string[];
  /** Sum of reps (or hold-seconds) recorded for the session. */
  volume: number;
  /** Sum of weightUsed × reps for loaded sets. */
  load: number;
}

export interface CoachRecommendationSection {
  title: string;
  decision: string;
  reasoning: string[];
  confidence: 'low' | 'medium' | 'high';
  actionType: string;
}

export interface CoachTrendSection {
  key: string;
  label: string;
  direction: string;
  explanation: string;
}

export interface CoachStreakSection {
  current: number;
  longest: number;
  consecutive: number;
  lastTrainingDate: string | null;
}

export interface CoachMilestoneSection {
  id: string;
  title: string;
  current: number;
  target: number;
}

export interface CoachMeasurementsSection {
  latest: { date: string; weight: number | null } | null;
  deltas: { label: string; change: number | null; unit: string }[];
}

export interface CoachEquipmentSection {
  dumbbellsKg: number[];
  hasBench: boolean;
  hasBands: boolean;
  hasPullUpBar: boolean;
  hasMat: boolean;
  hasKettlebell: boolean;
}

/** Structured reply the model is asked to produce (parsed + validated). */
export interface CoachResponse {
  answer: string;
  keyPoints: string[];
  referencedFacts: string[];
  suggestedAction: string | null;
  confidence: 'low' | 'medium' | 'high';
  limitations: string[];
}

export type ProviderStatus = 'unavailable' | 'idle' | 'loading' | 'ready' | 'error';

/** Cross-runtime diagnostics surfaced in the Developer Mode AI panel. */
export interface AiDiagnostics {
  providerId: string;
  runtime: string;
  modelName: string;
  modelVersion: string | null;
  quantization: string | null;
  backend: string | null;
  status: ProviderStatus;
  loaded: boolean;
  loadTimeMs: number | null;
  promptTokens: number | null;
  generatedTokens: number | null;
  latencyMs: number | null;
  lastRequestAt: string | null;
  lastResponsePreview: string | null;
  lastError: string | null;
}

export interface GenerationRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface GenerationResult {
  text: string;
  promptTokens?: number;
  generatedTokens?: number;
  latencyMs?: number;
}

/**
 * The provider seam. Implementations wrap a concrete runtime (the on-device
 * LiteRT-LM plugin today). A provider must be able to report "unavailable"
 * honestly so the app degrades gracefully when the model or plugin is absent.
 */
export interface AiProvider {
  readonly id: string;
  readonly runtime: string;
  readonly modelName: string;
  readonly modelVersion: string | null;
  readonly quantization: string | null;
  getStatus(): ProviderStatus;
  /** True when the provider can serve requests right now. */
  isAvailable(): Promise<boolean>;
  /** Load the model into memory (idempotent). May take seconds — call off the main thread. */
  load(): Promise<void>;
  /** Release the model. The app is fully functional with the model unloaded. */
  unload(): Promise<void>;
  /** Run a single generation. Provider must already be loaded and available. */
  generate(request: GenerationRequest): Promise<GenerationResult>;
  getDiagnostics(): AiDiagnostics;
}
