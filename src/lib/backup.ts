import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { saveTextViaDocumentPicker } from '@/lib/documentSave';
import { db, type PhotoEntry, type SessionLog, type SetLog, type SettingRow, type MeasurementEntry } from '@/lib/db';
import { emitDataChanged } from '@/lib/events';

const BACKUP_VERSION = 1;
export const BACKUP_FILENAME_PREFIX = 'dailyforge-backup';
const MILESTONE_STORAGE_KEY = 'milestone_unlock_dates';

/**
 * The backup format version is independent of the IndexedDB schema version.
 * It only changes when the exported shape changes (a new field, a renamed part).
 *
 * - `MIN_BACKUP_VERSION`: oldest shape this build can still meaningfully import
 *   (currently 1 — nothing older has ever shipped).
 * - `MAX_BACKUP_VERSION`: newest shape this build can export.
 *
 * Import is deliberately forward AND backward tolerant: any version number is
 * accepted, unknown fields are dropped, and missing fields fall back to
 * defaults, so a backup made today can be restored by DailyForge v2/v3 later.
 */
const MIN_BACKUP_VERSION = 1;
const MAX_BACKUP_VERSION = BACKUP_VERSION;

/** The current backup format version — surfaced in Settings so users know
 *  what a file's version means before they trust it. */
export const BACKUP_FORMAT_VERSION = BACKUP_VERSION;

const LAST_BACKUP_SETTING_KEY = 'lastBackupAt';

/** Record the timestamp of a successful backup so Settings can show when the
 *  last export happened. */
export async function recordBackupTime(iso: string): Promise<void> {
  await db.settings.put({ key: LAST_BACKUP_SETTING_KEY, value: iso });
}

export async function getLastBackupTime(): Promise<string | null> {
  const row = await db.settings.get(LAST_BACKUP_SETTING_KEY);
  return row?.value ?? null;
}

export interface BackupPhoto {
  id?: number;
  date: string;
  week: number;
  angle: 'front' | 'side' | 'back';
  source?: 'camera' | 'gallery';
  exportedToGallery?: boolean;
  dataUrl: string;
}

export interface BackupData {
  settings: SettingRow[];
  sessionLogs: SessionLog[];
  setLogs: SetLog[];
  measurements: MeasurementEntry[];
  photos: BackupPhoto[];
  milestones: Record<string, string>;
}

export interface BackupFile {
  app: 'dailyforge';
  version: number;
  exportedAt: string;
  data: BackupData;
}

/* ---------- file / blob helpers ---------- */

function readResult(reader: FileReader): Promise<string> {
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return readResult((() => {
    const r = new FileReader();
    r.readAsDataURL(blob);
    return r;
  })());
}

function utf8ToBase64(text: string): Promise<string> {
  return readResult((() => {
    const r = new FileReader();
    r.readAsDataURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    return r;
  })()).then((d) => d.slice(d.indexOf(',') + 1));
}

function dataURLToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(meta)?.[1] ?? 'application/octet-stream';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function loadMilestones(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MILESTONE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/* ---------- export ---------- */

/** Gather every bit of user data into a single serializable backup object. */
export async function buildBackup(): Promise<BackupFile> {
  const settings = (await db.settings.toArray()).filter((s) => s.key !== 'workoutState');
  const sessionLogs = await db.sessionLogs.toArray();
  const setLogs = await db.setLogs.toArray();
  const measurements = await db.measurements.toArray();

  const photos: BackupPhoto[] = [];
  for (const p of await db.photos.toArray()) {
    const dataUrl = await blobToDataURL(p.blob);
    photos.push({
      id: p.id,
      date: p.date,
      week: p.week,
      angle: p.angle,
      source: p.source,
      exportedToGallery: p.exportedToGallery,
      dataUrl,
    });
  }

  return {
    app: 'dailyforge',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { settings, sessionLogs, setLogs, measurements, photos, milestones: loadMilestones() },
  };
}

/** Web: trigger a download. Returns true to indicate success. */
export function downloadBackup(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** Share the backup via the OS share sheet (secondary path). */
export async function shareBackup(text: string, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    downloadBackup(text, filename);
    return true;
  }
  try {
    const base64 = await utf8ToBase64(text);
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    await Share.share({
      files: [result.uri],
      title: 'DailyForge Backup',
      dialogTitle: 'DailyForge backup',
    });
    return true;
  } catch (err) {
    console.warn('Backup share failed', err);
    return false;
  }
}

/**
 * Save the backup to a real location: Android uses the Storage Access Framework
 * (Downloads / Documents / SD card / cloud providers); web downloads the file;
 * other native platforms fall back to the share sheet.
 */
export async function saveBackupToDocument(text: string, filename: string): Promise<boolean> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const saved = await saveTextViaDocumentPicker(text, filename);
    if (saved) return true;
    // Cancelled or failed — treat as "not saved" (user may retry via Share).
    return false;
  }
  if (!Capacitor.isNativePlatform()) {
    downloadBackup(text, filename);
    return true;
  }
  return shareBackup(text, filename);
}

export function defaultBackupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${BACKUP_FILENAME_PREFIX}-${date}.json`;
}

export async function exportBackup(): Promise<{ text: string; filename: string }> {
  const file = await buildBackup();
  return { text: JSON.stringify(file, null, 2), filename: defaultBackupFilename() };
}

/* ---------- import ---------- */

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Normalize a parsed (untrusted) backup into clean, typed rows. This is what
 * makes the importer crash-proof against older or foreign backups:
 *   - unknown fields are dropped instead of written to the DB / re-exported
 *   - missing newer fields fall back to sensible defaults (undefined here means
 *     "not recorded"; the DB schema rejects nothing extra)
 *   - rows without enough identity to be meaningful are skipped, never throwing
 */
function sanitizeRows<T>(rows: unknown, map: (r: unknown) => T | undefined): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = map(rows[i]);
    if (row !== undefined && row !== null) out.push(row);
  }
  return out;
}

function sanitizeSettings(raw: unknown): SettingRow[] {
  return sanitizeRows(raw, (r) => {
    const o = asObj(r);
    const key = asString(o.key);
    const value = asString(o.value);
    if (key === undefined || value === undefined) return undefined;
    return { key, value };
  }) as SettingRow[];
}

function sanitizeSessionLogs(raw: unknown): SessionLog[] {
  return sanitizeRows(raw, (r) => {
    const o = asObj(r);
    const date = asString(o.date);
    if (date === undefined) return undefined;
    const out: SessionLog = {
      date,
      weekNumber: asNum(o.weekNumber) ?? 0,
      sessionKey: asString(o.sessionKey) ?? '',
      completed: asBool(o.completed) ?? true,
    };
    out.id = asNum(o.id);
    out.rpe = asNum(o.rpe);
    out.durationMin = asNum(o.durationMin);
    out.energy = asNum(o.energy);
    out.sleepHours = asNum(o.sleepHours);
    out.water = asString(o.water);
    out.bodyWeight = asNum(o.bodyWeight);
    out.notes = asString(o.notes);
    return out;
  });
}

function sanitizeSetLogs(raw: unknown): SetLog[] {
  return sanitizeRows(raw, (r) => {
    const o = asObj(r);
    const date = asString(o.date);
    const sessionKey = asString(o.sessionKey);
    const exerciseId = asString(o.exerciseId);
    if (date === undefined || sessionKey === undefined || exerciseId === undefined) return undefined;
    const out: SetLog = {
      date,
      sessionKey,
      exerciseId,
      setIndex: asNum(o.setIndex) ?? 0,
      completedAt: asString(o.completedAt) ?? date,
    };
    out.id = asNum(o.id);
    out.repsCompleted = asNum(o.repsCompleted);
    out.holdDurationSeconds = asNum(o.holdDurationSeconds);
    // weightUsed/variationUsed/bodyWeight are optional: absent => "not recorded".
    out.weightUsed = asNum(o.weightUsed);
    out.variationUsed = asString(o.variationUsed);
    out.bodyWeight = asNum(o.bodyWeight);
    return out;
  });
}

function sanitizeMeasurements(raw: unknown): MeasurementEntry[] {
  return sanitizeRows(raw, (r) => {
    const o = asObj(r);
    const date = asString(o.date);
    if (date === undefined) return undefined;
    const out: MeasurementEntry = { date, week: asNum(o.week) ?? 0 };
    out.id = asNum(o.id);
    out.weight = asNum(o.weight);
    out.chest = asNum(o.chest);
    out.waist = asNum(o.waist);
    out.hips = asNum(o.hips);
    out.leftArm = asNum(o.leftArm);
    out.rightArm = asNum(o.rightArm);
    out.leftThigh = asNum(o.leftThigh);
    out.rightThigh = asNum(o.rightThigh);
    out.calves = asNum(o.calves);
    out.neck = asNum(o.neck);
    out.notes = asString(o.notes);
    return out;
  });
}

function sanitizePhotos(raw: unknown): BackupPhoto[] {
  return sanitizeRows(raw, (r) => {
    const o = asObj(r);
    const date = asString(o.date);
    const dataUrl = asString(o.dataUrl);
    const angle = o.angle === 'front' || o.angle === 'side' || o.angle === 'back' ? o.angle : undefined;
    if (date === undefined || dataUrl === undefined || angle === undefined) return undefined;
    const out: BackupPhoto = { date, week: asNum(o.week) ?? 0, angle, dataUrl };
    out.id = asNum(o.id);
    out.source = o.source === 'camera' || o.source === 'gallery' ? o.source : undefined;
    out.exportedToGallery = asBool(o.exportedToGallery);
    return out;
  }) as unknown as BackupPhoto[];
}

/**
 * Validate and parse a backup file, returning a *normalized* backup that is
 * safe to import. Throws only when the file is not recognizably a DailyForge
 * backup (bad JSON, wrong app marker, or missing data). Version tolerance is
 * handled by dropping unknown fields and defaulting missing ones, never by
 * rejecting.
 */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  const file = asObj(parsed);
  if (file.app !== 'dailyforge') throw new Error('Not a DailyForge backup.');
  if (!file.data) throw new Error('Backup file is missing its data.');
  const dataObj = asObj(file.data);

  // Older builds always wrote a numeric version; treat a missing one as v1 so
  // any backlog file keeps importing. A future (higher) version is still
  // importable best-effort — the sanitizers drop fields it doesn't know about.
  const version = typeof file.version === 'number' ? file.version : 1;
  if (version < MIN_BACKUP_VERSION) {
    throw new Error(`This backup was made by an older app version (v${version}) that can no longer be restored.`);
  }
  if (version > MAX_BACKUP_VERSION) {
    console.warn(`Restoring a backup from a newer app version (v${version}). Fields introduced after v${MAX_BACKUP_VERSION} will be ignored.`);
  }

  return {
    app: 'dailyforge',
    version,
    exportedAt: asString(file.exportedAt),
    data: {
      settings: sanitizeSettings(dataObj.settings),
      sessionLogs: sanitizeSessionLogs(dataObj.sessionLogs),
      setLogs: sanitizeSetLogs(dataObj.setLogs),
      measurements: sanitizeMeasurements(dataObj.measurements),
      photos: sanitizePhotos(dataObj.photos),
      milestones: asObj(dataObj.milestones) as Record<string, string>,
    },
  } as BackupFile;
}

/**
 * Replace all user data with the contents of a backup. Destructive — callers must
 * confirm first. Transient workout state is intentionally NOT restored (see note).
 *
 * RE-COMPUTED vs. STORED (lossless notes):
 *   - Don't get Stored — recomputed from setLogs on demand: exercise PR records,
 *     per-exercise charts, weekly trend summaries. They are derived state.
 *   - Bodyweight, held/weighted loads, durations, photos, milestones (with their
 *     unlock dates), equipment, program start date and notification prefs (all
 *     settings rows) ARE stored and round-trip losslessly.
 *   - `workoutState` (an in-progress session) is intentionally excluded: it's
 *     transient and exporting it could resurrect a stale mid-workout screen.
 */
export async function restoreBackup(file: BackupFile): Promise<void> {
  const data = normalizeBackupData(file.data);
  await db.transaction(
    'rw',
    db.settings,
    db.sessionLogs,
    db.setLogs,
    db.measurements,
    db.photos,
    async () => {
      await db.settings.clear();
      await db.sessionLogs.clear();
      await db.setLogs.clear();
      await db.measurements.clear();
      await db.photos.clear();

      const settings = data.settings.filter((s: { key: string }) => s.key !== 'workoutState');
      if (settings.length) await db.settings.bulkPut(settings);
      if (data.sessionLogs.length) await db.sessionLogs.bulkAdd(data.sessionLogs);
      if (data.setLogs.length) await db.setLogs.bulkAdd(data.setLogs);
      if (data.measurements.length) await db.measurements.bulkAdd(data.measurements);
      if (data.photos.length) {
        const entries: PhotoEntry[] = data.photos
          .map((p: BackupPhoto) => ({
            id: p.id,
            date: p.date,
            week: p.week,
            angle: p.angle,
            source: p.source,
            exportedToGallery: p.exportedToGallery,
            blob: dataURLToBlob(p.dataUrl),
          }))
          .filter(hasBlob);
        if (entries.length) await db.photos.bulkAdd(entries);
      }
    },
  );

  if (data.milestones && Object.keys(data.milestones).length > 0) {
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(data.milestones));
  }

  emitDataChanged();
}

function hasBlob(p: { blob?: Blob }): p is { blob: Blob } {
  return p.blob instanceof Blob;
}

/** Idempotently normalize raw backup data into the current shape (never throws). */
export function normalizeBackupData(raw: unknown): BackupData {
  const o = asObj(raw);
  return {
    settings: sanitizeSettings(o.settings),
    sessionLogs: sanitizeSessionLogs(o.sessionLogs),
    setLogs: sanitizeSetLogs(o.setLogs),
    measurements: sanitizeMeasurements(o.measurements),
    photos: sanitizePhotos(o.photos),
    milestones: asObj(o.milestones) as Record<string, string>,
  };
}

/** Read the text of a selected backup file via a File/FileReader. */
export function readBackupFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read backup file.'));
    reader.readAsText(file);
  });
}