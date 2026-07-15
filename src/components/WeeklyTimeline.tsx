import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { program } from '@/lib/data';
import type { SessionLog } from '@/lib/db';

function getDayAbbr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];
}

interface DayInfo {
  label: string;
  sessionKey: string;
  status: 'completed' | 'today' | 'upcoming-workout' | 'upcoming-rest';
  dayAbbr: string;
  isCalendarToday: boolean;
}

function localDateStr(base: string, addDays: number): string {
  const [y, m, d] = base.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + addDays);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function WeeklyTimeline({
  startDate,
  weekNumber,
  dayIndex,
  sessionLogs,
}: {
  startDate: string;
  weekNumber: number;
  dayIndex: number;
  sessionLogs: SessionLog[];
}) {
  const weekRow = program.week_table.find((w) => w.week === weekNumber);

  const days: DayInfo[] = useMemo(() => {
    const base = (weekNumber - 1) * 7;

    const raw = program.weekly_template.map((entry, i) => {
      const dateStr = localDateStr(startDate, base + i);
      const hasLog = sessionLogs.some(
        (l) => l.date === dateStr && l.sessionKey === entry.session_key && l.completed,
      );
      return { label: entry.label, sessionKey: entry.session_key, isRest: entry.session_key === 'rest', hasLog, i, dateStr };
    });

    return raw.map((d) => {
      let status: DayInfo['status'];
      if (d.hasLog) {
        status = 'completed';
      } else if (d.i === dayIndex) {
        status = 'today';
      } else if (d.isRest) {
        status = 'upcoming-rest';
      } else {
        status = 'upcoming-workout';
      }

      return {
        label: d.label,
        sessionKey: d.sessionKey,
        status,
        dayAbbr: getDayAbbr(d.dateStr),
        isCalendarToday: d.i === dayIndex,
      };
    });
  }, [startDate, weekNumber, dayIndex, sessionLogs]);

  const completedCount = days.filter((d) => d.status === 'completed').length;
  const trainingDays = days.filter((d) => d.sessionKey !== 'rest').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 }}
      layout
    >
      <div className="rounded-2xl border border-white/10 bg-[var(--color-bg-raised)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
              Week {weekNumber}
            </span>
            {weekRow && !weekRow.deload && (
              <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-400">
                {weekRow.phase}
              </span>
            )}
          </div>
          {completedCount > 0 && (
            <span className="text-[11px] text-slate-500">
              <AnimatedCount value={completedCount} /> of {trainingDays} completed
            </span>
          )}
        </div>

        <div className="mt-3 space-y-1">
          <AnimatePresence mode="popLayout">
            {days.map((day) => {
              const isToday = day.status === 'today';
              const isCompleted = day.status === 'completed';
              const isRest = day.status === 'upcoming-rest';
              const isWorkout = day.status === 'upcoming-workout';

              return (
                <motion.div
                  key={day.dayAbbr + '-' + day.status}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2.5 py-1.5',
                    isToday && 'bg-blue-500/10',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-300',
                      isCompleted && 'bg-emerald-500/25 text-emerald-400',
                      isToday && 'bg-blue-500 text-white',
                      isWorkout && 'border border-dashed border-white/20 text-slate-500',
                      isRest && 'text-slate-600',
                    )}
                  >
                    {isCompleted ? (
                      <motion.svg
                        width="12" height="12" viewBox="0 0 12 12" fill="none"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      >
                        <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </motion.svg>
                    ) : isRest ? (
                      <span className="text-[9px]">&middot;</span>
                    ) : isToday ? (
                      <motion.span
                        className="text-[10px]"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                      >
                        &bull;
                      </motion.span>
                    ) : (
                      <span />
                    )}
                  </span>

                  <span
                    className={cn(
                      'flex items-center gap-1 text-[11px] font-semibold',
                      isToday ? 'text-blue-300' : 'text-slate-500',
                    )}
                  >
                    {day.dayAbbr}
                    {day.isCalendarToday && (
                      <span className="h-0.5 w-0.5 rounded-full bg-current" />
                    )}
                  </span>

                  <span
                    className={cn(
                      'text-sm font-medium leading-tight',
                      isCompleted && 'text-emerald-400',
                      isToday && 'text-white',
                      isRest && 'text-slate-600',
                      isWorkout && 'text-slate-400',
                    )}
                  >
                    {day.label}
                  </span>

                  {isToday && (
                    <motion.span
                      className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-blue-400"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      today
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function AnimatedCount({ value }: { value: number }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -4, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {value}
    </motion.span>
  );
}
