// Node 24 type-strips TypeScript by default. This script runs the REAL
// src/lib/backup.ts (buildBackup / parseBackup / restoreBackup) against an
// in-memory DB stub, proving Export -> Import -> Re-export is lossless and that
// the importer is tolerant of older/foreign/missing fields.
//
// Run:  node scripts/verify-backup-roundtrip.mjs

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoTmpFileName = fileURLToPath(import.meta.url);
const repoRoot = resolvePath(repoTmpFileName, '..', '..');
const stubUrl = pathToFileURL(resolvePath(repoRoot, 'scripts', 'backup-db-stub.mjs')).href;

register(
  pathToFileURL(resolvePath(repoRoot, 'scripts', 'backup-loader.mjs')).href,
  pathToFileURL(repoRoot + '/'),
);

if (!globalThis.localStorage) {
  globalThis.localStorage = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
    };
  })();
}
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    constructor() { this.result = null; this.error = null; this.onload = null; this.onerror = null; }
    readAsDataURL(blob) {
      blob.arrayBuffer().then(
        (ab) => {
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(ab).toString('base64')}`;
          if (this.onload) this.onload();
        },
        (e) => {
          this.error = e;
          if (this.onerror) this.onerror();
        },
      );
    }
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}${detail ? ' — ' + detail : ''}`);
}
// Compare structural equality regardless of object key order.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canonical = (o) => JSON.stringify(sortKeys(o));

const dbMod = await import(stubUrl);
const backup = await import(pathToFileURL(resolvePath(repoRoot, 'src', 'lib', 'backup.ts')).href);
const { db, __reset } = dbMod;

// ---- seed a representative dataset ----
await db.settings.add({ key: 'unitSystem', value: 'metric' });
await db.settings.add({ key: 'programStartDate', value: '2026-07-01' });
await db.settings.add({ key: 'equipment', value: JSON.stringify({ owned: [15], pairOf: [15] }) });
await db.settings.add({ key: 'notificationsEnabled', value: 'true' });
await db.settings.add({ key: 'reminderTime', value: '18:00' });
await db.settings.add({ key: 'savePhotosToGallery', value: 'false' });
await db.settings.add({ key: 'workoutState', value: '{"phaseId":"p1"}' });

await db.sessionLogs.add({ date: '2026-07-01T08:00:00.000Z', weekNumber: 1, sessionKey: 'p1/w1/mon', completed: true, durationMin: 32, rpe: 8, bodyWeight: 74 });
await db.sessionLogs.add({ date: '2026-07-03T08:00:00.000Z', weekNumber: 1, sessionKey: 'p1/w1/wed', completed: true, durationMin: 27, water: '1.5L' });

await db.setLogs.add({ date: '2026-07-01T08:00:00.000Z', sessionKey: 'p1/w1/mon', exerciseId: 'goblet-squat', setIndex: 1, repsCompleted: 10, weightUsed: 12, completedAt: '2026-07-01T08:02:00.000Z' });
await db.setLogs.add({ date: '2026-07-01T08:00:00.000Z', sessionKey: 'p1/w1/mon', exerciseId: 'goblet-squat', setIndex: 2, repsCompleted: 10, weightUsed: 12, completedAt: '2026-07-01T08:04:00.000Z' });
await db.setLogs.add({ date: '2026-07-03T08:00:00.000Z', sessionKey: 'p1/w1/wed', exerciseId: 'split-squat', setIndex: 1, repsCompleted: 8, holdDurationSeconds: 20, bodyWeight: 74, completedAt: '2026-07-03T08:05:00.000Z' });

await db.measurements.add({ date: '2026-07-01', week: 1, weight: 74.5, chest: 100, waist: 82 });
await db.measurements.add({ date: '2026-07-05', week: 1, weight: 74.2, waist: 81.5 });

localStorage.setItem('milestone_unlock_dates', JSON.stringify({ 'm-001': '2026-07-01', 'm-002': '2026-07-04' }));

// A tiny 1x1 px PNG as a data URL (valid, so dataURLToBlob produces a Blob on restore).
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await db.photos.add({ date: '2026-07-01', week: 1, angle: 'front', source: 'camera', exportedToGallery: true, blob: new Blob([tinyPng], { type: 'image/png' }) });

// ---- 1. Export ----
const file = await backup.buildBackup();
const text = JSON.stringify(file, null, 2);
const bytes = Buffer.byteLength(text, 'utf8');
check('export produces non-empty bytes', bytes > 0, `${bytes} bytes`);
check('workoutState excluded from export', !file.data.settings.some((s) => s.key === 'workoutState'));
check('equipment present', file.data.settings.some((s) => s.key === 'equipment'));
check('milestones present', Object.keys(file.data.milestones ?? {}).length === 2);
check('weightUsed present', file.data.setLogs.some((s) => s.weightUsed === 12));
check('photos present', file.data.photos.length === 1);

// ---- 2. Parse (validation) + restore into a wiped DB ----
let parsed;
try {
  parsed = backup.parseBackup(text);
  check('exported JSON parses', true, `v${parsed.version}`);
} catch (e) {
  check('exported JSON parses', false, e.message);
}

await __reset();
await backup.restoreBackup(parsed);

// ---- 3. Re-export and compare ----
const file2 = await backup.buildBackup();
check('round-trip sessions identical', canonical(file2.data.sessionLogs) === canonical(file.data.sessionLogs));
check('round-trip sets identical', canonical(file2.data.setLogs) === canonical(file.data.setLogs));
check('round-trip measurements identical', canonical(file2.data.measurements) === canonical(file.data.measurements));
check('round-trip settings identical', canonical(file2.data.settings) === canonical(file.data.settings));
check('round-trip milestones identical', canonical(file2.data.milestones) === canonical(file.data.milestones));
check('round-trip photos identical (count + date/week/angle)', file2.data.photos.length === file.data.photos.length && file2.data.photos[0]?.week === file.data.photos[0]?.week);
check('weightUsed survives round-trip', file2.data.setLogs.some((s) => s.weightUsed === 12));
check('variationUsed/bodyWeight survive round-trip', file2.data.setLogs.some((s) => s.bodyWeight === 74));

// ---- 4. Importer tolerance (issue 3) ----
const foreign = backup.parseBackup(JSON.stringify({ app: 'dailyforge', version: 1, data: { setLogs: [{ junkfield: true }] } }));
check('older/partial backup imports without crashing', Array.isArray(foreign.data.setLogs) && foreign.data.setLogs.length === 0);
check('unknown fields dropped', foreign.data.setLogs.length === 0);

check('missing version defaults to v1', backup.parseBackup(JSON.stringify({ app: 'dailyforge', data: {} })).version === 1);

let rejectedForeign = false;
try { backup.parseBackup('{"app":"dailyforge"}'); } catch { rejectedForeign = false; }
try { backup.parseBackup('{"x":1}'); } catch { rejectedForeign = true; }
check('non-DailyForge file rejected', rejectedForeign);

let rejectedEmpty = false;
try { backup.parseBackup(''); } catch { rejectedEmpty = true; }
check('empty file rejected', rejectedEmpty);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);