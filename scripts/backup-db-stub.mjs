// In-memory stand-in for src/lib/db.ts, used only by verify-backup-roundtrip.mjs
// so the real backup.ts can run in Node without IndexedDB.
//
// Mirrors the real schema: the `settings` table is keyed by `key` (no auto id);
// the other tables use an auto-increment `id` primary key.

const stores = {
  settings: [],
  sessionLogs: [],
  setLogs: [],
  measurements: [],
  photos: [],
};
let seq = 0;

function table(name, useId) {
  return {
    name,
    async toArray() {
      return [...stores[name]];
    },
    async bulkPut(items) {
      const t = stores[name];
      for (const rec of items) {
        const i = t.findIndex((r) => (useId ? r.id === rec.id : r.key === rec.key));
        if (i >= 0) t[i] = rec;
        else {
          if (useId) rec.id = ++seq;
          t.push(rec);
        }
      }
    },
    async bulkAdd(items) {
      const t = stores[name];
      for (const rec of items) {
        if (useId && rec.id == null) rec.id = ++seq;
        t.push(rec);
      }
    },
    async add(item) {
      if (useId) item.id = ++seq;
      stores[name].push(item);
      return useId ? item.id : item.key;
    },
    async clear() {
      stores[name].length = 0;
    },
  };
}

export const db = {
  settings: table('settings', false),
  sessionLogs: table('sessionLogs', true),
  setLogs: table('setLogs', true),
  measurements: table('measurements', true),
  photos: table('photos', true),
  async transaction(_mode, ...args) {
    await args[args.length - 1]();
  },
};

export const __reset = () => {
  for (const k of Object.keys(stores)) stores[k].length = 0;
  seq = 0;
};