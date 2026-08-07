/**
 * DailyForge Data Changed — the single source of truth for data freshness.
 *
 * Every data mutation (workout completion, workout edit/delete, restore/
 * import, measurements, coaching-affecting settings) emits a data-changed
 * event. Coaching consumers — Home, Insights, Overview, the notification
 * rescheduler, and any future surface — subscribe via `onDataChanged` and
 * recompute from the latest data. Services stay pure; this module is pure
 * orchestration wiring with no business logic.
 *
 * Evolution path: the emitter is built on a generic event core so future
 * typed events (WorkoutCompleted, MeasurementsUpdated, HealthDataUpdated,
 * BackupRestored, ...) can be published internally without changing the
 * public API (`onDataChanged` / `emitDataChanged`). Subscribers that only care
 * that "something changed" keep working unchanged.
 */

export type DataChangedEventType = 'data-changed' | (string & {});

export interface DataChangedEvent {
  type: DataChangedEventType;
  /** ISO timestamp of when the mutation was committed. */
  at: string;
}

type DataChangedListener = (event: DataChangedEvent) => void;

const listeners = new Set<DataChangedListener>();
let version = 0;

function publish(type: DataChangedEventType): void {
  version += 1;
  const event: DataChangedEvent = { type, at: new Date().toISOString() };
  const snapshot = [...listeners];
  for (const listener of snapshot) listener(event);
}

/**
 * Subscribe to data changes. Returns an unsubscribe function. Fires whenever
 * any data mutation is committed.
 */
export function onDataChanged(listener: () => void): () => void {
  const wrapped: DataChangedListener = () => listener();
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

/** Emit a data-changed event after a mutation commits. */
export function emitDataChanged(): void {
  publish('data-changed');
}

/** Monotonic freshness counter, incremented on every emit. */
export function getDataVersion(): number {
  return version;
}
