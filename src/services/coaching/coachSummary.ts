/**
 * Coach Summary — a deterministic orchestrator, not an AI.
 *
 * Builds one short coaching paragraph from the existing service layer
 * (recovery, recommendations, milestone progress). It never re-derives
 * numbers: every sentence is composed from the outputs of the same services
 * the rest of the app uses, so the Home screen, Insights, notifications, and
 * the future offline Gemma coach all describe the same situation.
 *
 * Determinism: `asOf` is injected, all inputs are plain data, and no module
 * reads or writes storage.
 */
import type { SessionLog, SetLog, MeasurementEntry } from '@/lib/db';
import type { RecoveryLevel } from '@/services/recovery/recoveryScore';
import { computeRecoveryScore } from '@/services/recovery/recoveryScore';
import { buildRecommendations } from '@/services/recommendations/recommendationEngine';
import {
  gatherMilestoneData,
  getMilestoneProgress,
} from '@/lib/milestones';

export interface CoachSummary {
  /** Ordered coaching sentences (short, coach-style, no jargon). */
  sentences: string[];
  /** `sentences` joined — ready for inline or notification use. */
  paragraph: string;
}

export interface CoachSummaryConfig {
  /** ISO date the program started. */
  startIso: string;
  /** "Now". Deterministic output requires the caller to fix this date. */
  asOf: Date;
  /** Cap on the number of sentences. Defaults to 3. */
  maxSentences?: number;
  /** Dumbbell weights (kg) the user owns — keeps the paragraph honest about
   *  what load progression is actually available. */
  availableWeights?: number[];
}

function recoverySentence(level: RecoveryLevel): string {
  switch (level) {
    case 'fresh':
      return 'Recovery is excellent — you\u2019re primed to push hard today.';
    case 'ready':
      return 'Recovery looks good \u2014 a solid day to train.';
    case 'tired':
      return 'Recovery is a little tired \u2014 keep today\u2019s session light.';
    case 'overtraining_risk':
      return 'Recovery is in the red \u2014 prioritize rest today.';
  }
}

/**
 * Compose a short coaching paragraph from the existing services. Recovery
 * always leads; milestone progress and the top non-recovery recommendation
 * follow. De-duplicates: a milestone/measurement/consistency signal is stated
 * once, from whichever service carries it.
 */
export function buildCoachSummary(
  sessionLogs: SessionLog[],
  setLogs: SetLog[],
  measurements: MeasurementEntry[],
  config: CoachSummaryConfig,
): CoachSummary {
  const recovery = computeRecoveryScore(sessionLogs, setLogs, {
    startIso: config.startIso,
    asOf: config.asOf,
  });
  const recommendations = buildRecommendations(sessionLogs, setLogs, measurements, {
    startIso: config.startIso,
    asOf: config.asOf,
    maxResults: 5,
    availableWeights: config.availableWeights,
  });
  const progress = getMilestoneProgress(
    gatherMilestoneData(sessionLogs, setLogs, config.startIso, config.asOf),
  );

  const sentences: string[] = [recoverySentence(recovery.level)];

  const closeMilestones = progress.filter(
    (p) =>
      p.id !== 'first-workout' &&
      p.progressCurrent < p.progressTarget &&
      p.progressTarget - p.progressCurrent <= 2,
  );
  if (closeMilestones.length === 1) {
    const p = closeMilestones[0];
    const remaining = p.progressTarget - p.progressCurrent;
    sentences.push(
      `${remaining === 1 ? 'One session' : `${remaining} sessions`} to unlock \u201c${p.title}\u201d.`,
    );
  } else if (closeMilestones.length >= 2) {
    sentences.push(`You\u2019re close to unlocking ${closeMilestones.length} milestones.`);
  }

  const top = recommendations.find((r) => r.key !== 'recovery' && r.key !== 'milestone');
  if (top) {
    sentences.push(top.decision);
  }

  const capped = sentences.slice(0, config.maxSentences ?? 3);
  return { sentences: capped, paragraph: capped.join(' ') };
}
