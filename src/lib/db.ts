import Dexie, { type EntityTable } from 'dexie';

export interface SettingRow {
  key: string;
  value: string;
}

export interface SessionLog {
  id?: number;
  date: string;
  weekNumber: number;
  sessionKey: string;
  completed: boolean;
  rpe?: number;
  durationMin?: number;
  energy?: number;
  sleepHours?: number;
  water?: string;
  bodyWeight?: number;
  notes?: string;
}

export interface SetLog {
  id?: number;
  date: string;
  sessionKey: string;
  exerciseId: string;
  setIndex: number;
  repsCompleted?: number;
  holdDurationSeconds?: number;
  completedAt: string;
}

export interface MeasurementEntry {
  id?: number;
  date: string;
  week: number;
  weight?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  leftArm?: number;
  rightArm?: number;
  leftThigh?: number;
  rightThigh?: number;
  calves?: number;
  neck?: number;
  notes?: string;
}

export interface PhotoEntry {
  id?: number;
  date: string;
  week: number;
  angle: 'front' | 'side' | 'back';
  blob: Blob;
  source?: 'camera' | 'gallery';
  exportedToGallery?: boolean;
}

class BlueprintDB extends Dexie {
  settings!: EntityTable<SettingRow, 'key'>;
  sessionLogs!: EntityTable<SessionLog, 'id'>;
  setLogs!: EntityTable<SetLog, 'id'>;
  measurements!: EntityTable<MeasurementEntry, 'id'>;
  photos!: EntityTable<PhotoEntry, 'id'>;

  constructor() {
    super('home-dumbbell-blueprint');
    this.version(1).stores({
      settings: 'key',
      sessionLogs: '++id, date, weekNumber, sessionKey',
      setLogs: '++id, date, sessionKey, exerciseId',
      measurements: '++id, date, week',
      photos: '++id, date, week, angle',
    });
  }
}

export const db = new BlueprintDB();

const PROGRAM_START_DATE_KEY = 'programStartDate';

export async function getProgramStartDate(): Promise<string | null> {
  const row = await db.settings.get(PROGRAM_START_DATE_KEY);
  return row?.value ?? null;
}

export async function setProgramStartDate(isoDate: string): Promise<void> {
  await db.settings.put({ key: PROGRAM_START_DATE_KEY, value: isoDate });
}

const NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';

export async function getNotificationsEnabled(): Promise<boolean> {
  const row = await db.settings.get(NOTIFICATIONS_ENABLED_KEY);
  return row?.value === 'true';
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await db.settings.put({ key: NOTIFICATIONS_ENABLED_KEY, value: String(enabled) });
}

export type UnitSystem = 'metric' | 'imperial';
const UNIT_SYSTEM_KEY = 'unitSystem';

export async function getUnitSystem(): Promise<UnitSystem> {
  const row = await db.settings.get(UNIT_SYSTEM_KEY);
  return row?.value === 'imperial' ? 'imperial' : 'metric';
}

export async function setUnitSystem(system: UnitSystem): Promise<void> {
  await db.settings.put({ key: UNIT_SYSTEM_KEY, value: system });
}

const REMINDER_TIME_KEY = 'reminderTime';
const DEFAULT_REMINDER_TIME = '18:00';

/** Returns the reminder time as "HH:MM" (24-hour), e.g. "07:30" or "18:00". */
export async function getReminderTime(): Promise<string> {
  const row = await db.settings.get(REMINDER_TIME_KEY);
  return row?.value ?? DEFAULT_REMINDER_TIME;
}

export async function setReminderTime(time: string): Promise<void> {
  await db.settings.put({ key: REMINDER_TIME_KEY, value: time });
}

const SAVE_PHOTOS_TO_GALLERY_KEY = 'savePhotosToGallery';

/** Whether camera-captured progress photos should also be written to the device gallery. Defaults to ON. */
export async function getSavePhotosToGallery(): Promise<boolean> {
  const row = await db.settings.get(SAVE_PHOTOS_TO_GALLERY_KEY);
  return row ? row.value === 'true' : true;
}

export async function setSavePhotosToGallery(value: boolean): Promise<void> {
  await db.settings.put({ key: SAVE_PHOTOS_TO_GALLERY_KEY, value: String(value) });
}

export async function getSessionLog(
  date: string,
  sessionKey: string
): Promise<SessionLog | undefined> {
  return db.sessionLogs.where({ date, sessionKey }).first();
}

export async function upsertSessionLog(entry: SessionLog): Promise<number> {
  const existing = await getSessionLog(entry.date, entry.sessionKey);
  if (existing?.id) {
    await db.sessionLogs.update(existing.id, entry);
    return existing.id;
  }
  const newId = await db.sessionLogs.add(entry);
  return newId as number;
}

export async function getSessionLogsForWeek(weekNumber: number): Promise<SessionLog[]> {
  return db.sessionLogs.where('weekNumber').equals(weekNumber).toArray();
}

export async function getAllSessionLogs(): Promise<SessionLog[]> {
  return db.sessionLogs.orderBy('date').toArray();
}

export async function getAllSetLogs(): Promise<SetLog[]> {
  return db.setLogs.orderBy('date').toArray();
}

// ---- Measurement helpers ----

export async function getMeasurementForWeek(week: number): Promise<MeasurementEntry | undefined> {
  return db.measurements.where('week').equals(week).first();
}

export async function upsertMeasurement(entry: MeasurementEntry): Promise<number> {
  const existing = await getMeasurementForWeek(entry.week);
  if (existing?.id) {
    await db.measurements.update(existing.id, entry);
    return existing.id;
  }
  const newId = await db.measurements.add(entry);
  return newId as number;
}

export async function getAllMeasurements(): Promise<MeasurementEntry[]> {
  return db.measurements.orderBy('week').toArray();
}

// ---- Photo helpers ----

export async function getPhotosForWeek(week: number): Promise<PhotoEntry[]> {
  return db.photos.where('week').equals(week).toArray();
}

export async function upsertPhoto(entry: PhotoEntry): Promise<number> {
  const existing = await db.photos.where({ week: entry.week, angle: entry.angle }).first();
  if (existing?.id) {
    await db.photos.update(existing.id, entry);
    return existing.id;
  }
  const newId = await db.photos.add(entry);
  return newId as number;
}

export async function deletePhoto(id: number): Promise<void> {
  await db.photos.delete(id);
}

export async function getWeeksWithAnyPhoto(): Promise<number[]> {
  const all = await db.photos.toArray();
  return [...new Set(all.map((p) => p.week))].sort((a, b) => a - b);
}

export async function resetProgress(): Promise<void> {
  await db.sessionLogs.clear();
  await db.setLogs.clear();
  await db.measurements.clear();
  await db.photos.clear();
}

export async function resetAllData(): Promise<void> {
  await db.settings.clear();
  await db.sessionLogs.clear();
  await db.setLogs.clear();
  await db.measurements.clear();
  await db.photos.clear();
}
