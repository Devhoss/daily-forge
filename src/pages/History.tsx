import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getAllSessionLogs, getAllSetLogs } from '@/lib/db';
import { program } from '@/lib/data';
import type { SessionLog, SetLog } from '@/lib/db';
import { Search, ChevronRight, Filter } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';

type CategoryFilter = 'All' | 'Push' | 'Pull' | 'Legs' | 'Core';

const CATEGORIES: CategoryFilter[] = ['All', 'Push', 'Pull', 'Legs', 'Core'];

function sessionCategory(sessionKey: string): CategoryFilter {
  if (sessionKey.startsWith('push')) return 'Push';
  if (sessionKey.startsWith('pull')) return 'Pull';
  if (sessionKey.startsWith('legs') || sessionKey.startsWith('glute')) return 'Legs';
  if (sessionKey.startsWith('core') || sessionKey.startsWith('abs')) return 'Core';
  return 'All';
}

interface HistoryRow {
  log: SessionLog;
  sessionTitle: string;
  category: CategoryFilter;
  totalReps: number;
  setCount: number;
}

export function History() {
  const navigate = useNavigate();
  const [sessionLogs, setSessionLogs] = useState<SessionLog[]>([]);
  const [allSetLogs, setAllSetLogs] = useState<SetLog[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const [sl, sets] = await Promise.all([getAllSessionLogs(), getAllSetLogs()]);
      setSessionLogs(sl.filter((l) => l.completed).reverse());
      setAllSetLogs(sets);
    })();
  }, []);

  const rows: HistoryRow[] = useMemo(() => {
    const setMap = new Map<string, SetLog[]>();
    for (const s of allSetLogs) {
      const key = s.date + '|' + s.sessionKey;
      if (!setMap.has(key)) setMap.set(key, []);
      setMap.get(key)!.push(s);
    }
    return sessionLogs.map((log) => {
      const key = log.date + '|' + log.sessionKey;
      const sets = setMap.get(key) ?? [];
      const session = program.sessions[log.sessionKey];
      return {
        log,
        sessionTitle: session?.title.split('—')[0].trim() ?? log.sessionKey,
        category: sessionCategory(log.sessionKey),
        totalReps: sets.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0),
        setCount: sets.length,
      };
    });
  }, [sessionLogs, allSetLogs]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter !== 'All') list = list.filter((r) => r.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.sessionTitle.toLowerCase().includes(q) ||
          r.log.sessionKey.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, filter, search]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="safe-top min-h-screen px-5 pb-28 pt-8 text-white"
    >
      <h1 className="text-2xl font-bold">Workout History</h1>

      <div className="mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workouts\u2026"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500/40"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as CategoryFilter)}
            className="appearance-none rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-8 text-sm text-white outline-none focus:border-blue-500/40"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-[#0a0f1f]">
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-sm text-slate-500">
          {sessionLogs.length === 0
            ? 'No workouts yet. Complete your first session to see it here.'
            : 'No workouts match this filter.'}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((row) => (
            <motion.button
              key={row.log.date + row.log.sessionKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => navigate(`/review/${row.log.date}/${row.log.sessionKey}`)}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-bg-raised)] p-4 text-left transition active:scale-[0.99]"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">
                    {row.sessionTitle}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {new Date(row.log.date + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {row.log.durationMin != null && (
                      <> &middot; {formatDuration(row.log.durationMin)}</>
                    )}
                    {row.log.rpe != null && <> &middot; RPE {row.log.rpe}</>}
                  </p>
                </div>
                <ChevronRight size={16} className="mt-1 shrink-0 text-slate-600" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  {row.setCount} {row.setCount === 1 ? 'set' : 'sets'}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  {row.totalReps} {row.totalReps === 1 ? 'rep' : 'reps'}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  Week {row.log.weekNumber}
                </span>
                <CategoryBadge category={row.category} />
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CategoryBadge({ category }: { category: CategoryFilter }) {
  const colors: Record<CategoryFilter, string> = {
    All: 'bg-white/5 text-slate-400',
    Push: 'bg-orange-500/15 text-orange-400',
    Pull: 'bg-blue-500/15 text-blue-400',
    Legs: 'bg-emerald-500/15 text-emerald-400',
    Core: 'bg-purple-500/15 text-purple-400',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium',
        colors[category],
      )}
    >
      {category}
    </span>
  );
}
