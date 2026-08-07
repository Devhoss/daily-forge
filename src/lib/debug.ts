/**
 * DailyForge developer debug interface.
 *
 * Registered on `window.dailyforgeDebug` so a developer can inspect the live
 * running app (on a device or in a browser) without touching the UI: current
 * recovery analysis, recommendation engine output, coach summary, data
 * version, latest session/set logs, the notification payload, and a full
 * JSON snapshot that can be exported.
 *
 * Also exposes the recovery debug mode (see recoveryScore.ts): a developer
 * can enable it here to have every `computeRecoveryScore()` call log its
 * inputs, per-factor evaluation, and output to the console, while the recent
 * traces are always kept in memory so the state before/after a workout can be
 * compared.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  db,
  getProgramStartDate,
  getReminderTime,
  type SessionLog,
  type SetLog,
} from '@/lib/db';
import { getDataVersion } from '@/lib/events';
import { getEquipmentProfile } from '@/lib/equipment';
import { APP_VERSION, APP_PHASE } from '@/lib/version';
import { saveTextViaDocumentPicker } from '@/lib/documentSave';
import { downloadBackup, shareBackup } from '@/lib/backup';
import {
  computeRecoveryScore,
  getRecoveryDebugTraces,
  setRecoveryDebugEnabled,
  isRecoveryDebugEnabled,
  setRecoveryTracingEnabled,
  isRecoveryTracingEnabled,
  clearRecoveryDebugTraces,
  type RecoveryAnalysis,
  type RecoveryDebugTrace,
} from '@/services/recovery/recoveryScore';
import { buildRecommendations, type Recommendation } from '@/services/recommendations/recommendationEngine';
import { buildCoachSummary, type CoachSummary } from '@/services/coaching/coachSummary';
import { buildDailyNotifications, type CoachedNotification } from '@/services/notifications/notificationEngine';

export interface DebugSnapshot {
  exportedAt: string;
  app: { version: string; phase: string };
  dataVersion: number;
  config: { startIso: string | null; asOfIso: string; reminderTime: string };
  db: { sessionLogCount: number; setLogCount: number; measurementCount: number };
  latestSessionLog: SessionLog | null;
  latestSetLog: SetLog | null;
  recovery: RecoveryAnalysis;
  recoveryTraces: RecoveryDebugTrace[];
  recommendations: Recommendation[];
  coachSummary: CoachSummary;
  notification: { payload: CoachedNotification[]; pendingCount: number };
}

export interface DailyForgeDebugApi {
  /** Current recovery analysis computed from live DB data. */
  getRecoveryAnalysis(): Promise<RecoveryAnalysis | null>;
  /** Current recommendation engine output (ranked list). */
  getRecommendations(): Promise<Recommendation[]>;
  /** Current coach summary paragraph. */
  getCoachSummary(): Promise<CoachSummary | null>;
  /** Current data version (monotonic change counter) + app version. */
  getDataVersion(): Promise<{ appVersion: string; phase: string; dataVersion: number }>;
  /** Most recently recorded session log (by date). */
  getLatestSessionLog(): Promise<SessionLog | null>;
  /** Most recently recorded set log (by date). */
  getLatestSetLog(): Promise<SetLog | null>;
  /** Current notification engine payload + pending OS notification count. */
  getNotificationPayload(): Promise<{ payload: CoachedNotification[]; pendingCount: number }>;
  /** Enable/disable verbose console logging of every recovery computation. */
  setRecoveryDebug(enabled: boolean): void;
  isRecoveryDebugEnabled(): boolean;
  /** Enable/disable the in-memory recovery trace ring buffer (dev tooling). */
  setRecoveryTracing(enabled: boolean): void;
  isRecoveryTracingEnabled(): boolean;
  getRecoveryDebugTraces(): readonly RecoveryDebugTrace[];
  clearRecoveryDebugTraces(): void;
  /** Build a complete debug snapshot object. */
  exportSnapshot(): Promise<DebugSnapshot>;
  /** Save the debug snapshot JSON to a file (SAF on Android, download on web). */
  saveSnapshotToFile(): Promise<{ ok: boolean; filename: string }>;
}

async function loadLiveData() {
  const startIso = await getProgramStartDate();
  const [sessionLogs, setLogs, equipment, reminderTime] = await Promise.all([
    db.sessionLogs.orderBy('date').toArray(),
    db.setLogs.orderBy('date').toArray(),
    getEquipmentProfile(),
    getReminderTime(),
  ]);
  const measurementCount = await db.measurements.count();
  return { startIso, sessionLogs, setLogs, measurementCount, equipment, reminderTime };
}

async function getNotificationPayload(startIso: string, reminderTime: string): Promise<CoachedNotification[]> {
  if (!startIso) return [];
  const [sessionLogs, setLogs, equipment] = await Promise.all([
    db.sessionLogs.orderBy('date').toArray(),
    db.setLogs.orderBy('date').toArray(),
    getEquipmentProfile(),
  ]);
  return buildDailyNotifications(sessionLogs, setLogs, await db.measurements.toArray(), {
    startIso,
    asOf: new Date(),
    reminderTime,
    availableWeights: equipment.dumbbells,
  });
}

async function getPendingCount(): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications.length;
  } catch {
    return 0;
  }
}

function defaultSnapshotFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `dailyforge-debug-${date}.json`;
}

export async function exportSnapshot(): Promise<DebugSnapshot> {
  const { startIso, sessionLogs, setLogs, measurementCount, equipment, reminderTime } = await loadLiveData();
  const asOf = new Date();

  const recovery = startIso
    ? computeRecoveryScore(sessionLogs, setLogs, { startIso, asOf })
    : null;
  const recommendations = startIso
    ? buildRecommendations(sessionLogs, setLogs, await db.measurements.toArray(), {
        startIso,
        asOf,
        maxResults: 5,
        availableWeights: equipment.dumbbells,
      })
    : [];
  const coachSummary = startIso
    ? buildCoachSummary(sessionLogs, setLogs, await db.measurements.toArray(), {
        startIso,
        asOf,
        maxSentences: 3,
        availableWeights: equipment.dumbbells,
      })
    : null;

  const snapshot: DebugSnapshot = {
    exportedAt: new Date().toISOString(),
    app: { version: APP_VERSION, phase: APP_PHASE },
    dataVersion: getDataVersion(),
    config: {
      startIso,
      asOfIso: asOf.toISOString(),
      reminderTime,
    },
    db: { sessionLogCount: sessionLogs.length, setLogCount: setLogs.length, measurementCount },
    latestSessionLog: sessionLogs.at(-1) ?? null,
    latestSetLog: setLogs.at(-1) ?? null,
    recovery: recovery ?? {
      score: 0,
      level: 'ready',
      contributors: [],
      explanation: 'No program started.',
      recommendation: '',
      confidence: 'low',
    },
    recoveryTraces: [...getRecoveryDebugTraces()],
    recommendations,
    coachSummary: coachSummary ?? { sentences: [], paragraph: '' },
    notification: {
      payload: startIso ? await getNotificationPayload(startIso, reminderTime) : [],
      pendingCount: await getPendingCount(),
    },
  };
  return snapshot;
}

function createDebugApi(): DailyForgeDebugApi {
  return {
    async getRecoveryAnalysis() {
      const { startIso, sessionLogs, setLogs } = await loadLiveData();
      if (!startIso) return null;
      return computeRecoveryScore(sessionLogs, setLogs, { startIso, asOf: new Date() });
    },
    async getRecommendations() {
      const { startIso, sessionLogs, setLogs, equipment } = await loadLiveData();
      if (!startIso) return [];
      return buildRecommendations(sessionLogs, setLogs, await db.measurements.toArray(), {
        startIso,
        asOf: new Date(),
        maxResults: 5,
        availableWeights: equipment.dumbbells,
      });
    },
    async getCoachSummary() {
      const { startIso, sessionLogs, setLogs, equipment } = await loadLiveData();
      if (!startIso) return null;
      return buildCoachSummary(sessionLogs, setLogs, await db.measurements.toArray(), {
        startIso,
        asOf: new Date(),
        maxSentences: 3,
        availableWeights: equipment.dumbbells,
      });
    },
    async getDataVersion() {
      return { appVersion: APP_VERSION, phase: APP_PHASE, dataVersion: getDataVersion() };
    },
    async getLatestSessionLog() {
      return (await db.sessionLogs.orderBy('date').last()) ?? null;
    },
    async getLatestSetLog() {
      return (await db.setLogs.orderBy('date').last()) ?? null;
    },
    async getNotificationPayload() {
      const { startIso, reminderTime } = await loadLiveData();
      return {
        payload: startIso ? await getNotificationPayload(startIso, reminderTime) : [],
        pendingCount: await getPendingCount(),
      };
    },
    setRecoveryDebug(enabled) {
      setRecoveryDebugEnabled(enabled);
    },
    isRecoveryDebugEnabled() {
      return isRecoveryDebugEnabled();
    },
    setRecoveryTracing(enabled) {
      setRecoveryTracingEnabled(enabled);
    },
    isRecoveryTracingEnabled() {
      return isRecoveryTracingEnabled();
    },
    getRecoveryDebugTraces() {
      return getRecoveryDebugTraces();
    },
    clearRecoveryDebugTraces() {
      clearRecoveryDebugTraces();
    },
    exportSnapshot,
    async saveSnapshotToFile() {
      const snapshot = await exportSnapshot();
      const text = JSON.stringify(snapshot, null, 2);
      const filename = defaultSnapshotFilename();
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        const saved = await saveTextViaDocumentPicker(text, filename);
        return { ok: saved, filename };
      }
      if (!Capacitor.isNativePlatform()) {
        downloadBackup(text, filename);
        return { ok: true, filename };
      }
      return { ok: await shareBackup(text, filename), filename };
    },
  };
}

declare global {
  interface Window {
    /** Developer-only debug hook. Always available but hidden from the UI. */
    dailyforgeDebug?: DailyForgeDebugApi;
  }
}

let installed = false;

/** Register `window.dailyforgeDebug`. Safe to call more than once. */
export function installDebugInterface(): void {
  if (installed) return;
  installed = true;
  window.dailyforgeDebug = createDebugApi();
}
