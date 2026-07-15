import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getExercisesForSession, resolveIllustrationSrc, isPortraitExercise, program } from '@/lib/data';
import { db, upsertSessionLog, getProgramStartDate, getAllSetLogs, getAllSessionLogs } from '@/lib/db';
import { computeCurrentStreak } from '@/lib/analytics';
import { getTodayInfo, todayIso } from '@/lib/programEngine';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { RestTimer, parseRestSeconds, ensureRestAudio } from '@/components/RestTimer';
import { Flame, ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function parseTargetSets(setsField: string): number {
  const numbers = setsField.match(/\d+/g);
  if (!numbers) return 3;
  return parseInt(numbers[numbers.length - 1], 10);
}

function parseTargetReps(repsField: string): number {
  const numbers = repsField.match(/\d+/g);
  if (!numbers) return 10;
  return parseInt(numbers[0], 10);
}

type Phase = 'exercise' | 'resting' | 'summary';

function ExerciseDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i < current ? 'w-4 bg-blue-500' : i === current ? 'w-4 bg-blue-500' : 'w-1.5 bg-white/15',
          )}
        />
      ))}
    </div>
  );
}

export function WorkoutMode() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const navigate = useNavigate();
  const exercises = useMemo(
    () => (sessionKey ? getExercisesForSession(sessionKey) : []),
    [sessionKey]
  );
  const session = sessionKey ? program.sessions[sessionKey] : undefined;

  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setIndex, setSetIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('exercise');
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  const [repsInput, setRepsInput] = useState<number>(0);
  const [showExitDialog, setShowExitDialog] = useState(false);

  useEffect(() => {
    getProgramStartDate().then((d) => {
      if (d) setWeekNumber(getTodayInfo(d).weekNumber);
    });
  }, []);

  const exercisesList = exercises;
  useEffect(() => {
    const current = exercisesList[exerciseIndex];
    if (current) setRepsInput(parseTargetReps(current.reps));
  }, [exerciseIndex, exercisesList]);

  if (!sessionKey || exercises.length === 0) {
    return (
      <div className="p-6 text-white">
        No session found.
        <button onClick={() => navigate('/')} className="ml-2 text-orange-400">
          Go home
        </button>
      </div>
    );
  }

  const ex = exercises[exerciseIndex];
  const targetSets = parseTargetSets(ex.sets);
  const img = resolveIllustrationSrc(ex);
  const portrait = isPortraitExercise(ex);
  const isLastSetOfExercise = setIndex >= targetSets - 1;
  const isLastExercise = exerciseIndex >= exercises.length - 1;

  async function logSet() {
    ensureRestAudio();
    await db.setLogs.add({
      date: todayIso(),
      sessionKey: sessionKey!,
      exerciseId: ex.id,
      setIndex,
      repsCompleted: repsInput,
      completedAt: new Date().toISOString(),
    });
    setPhase('resting');
  }

  async function afterRest() {
    if (isLastSetOfExercise) {
      if (isLastExercise) {
        await upsertSessionLog({
          date: todayIso(),
          weekNumber: weekNumber ?? 1,
          sessionKey: sessionKey!,
          completed: true,
        });
        setPhase('summary');
      } else {
        setExerciseIndex((i) => i + 1);
        setSetIndex(0);
        setPhase('exercise');
      }
    } else {
      setSetIndex((s) => s + 1);
      setPhase('exercise');
    }
  }

  if (phase === 'summary') {
    return (
      <SessionSummary
        sessionKey={sessionKey}
        weekNumber={weekNumber ?? 1}
        onDone={() => navigate('/')}
      />
    );
  }

  return (
    <motion.div
      key={exerciseIndex + '-' + setIndex}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="safe-top safe-bottom min-h-screen px-5 pb-10 pt-14 text-white"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExitDialog(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-slate-400 transition hover:bg-white/10 active:scale-90"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-orange-400">
            {session?.title.split('—')[0].trim()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ExerciseDots total={exercises.length} current={exerciseIndex} />
          <p className="text-xs tabular-nums text-slate-500">
            {exerciseIndex + 1} of {exercises.length}
          </p>
        </div>
      </div>

      {showExitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-5">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[var(--color-bg-raised)] p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Exit Workout?</h3>
              <button onClick={() => setShowExitDialog(false)} className="text-slate-500">
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Your progress in this session will be saved as completed sets, but the session itself won't be marked as complete.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setShowExitDialog(false)}
                className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
              >
                Resume Workout
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
              >
                Exit
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <h1 className="mt-2 text-2xl font-extrabold leading-tight">{ex.name}</h1>

      <div
        className={cn(
          'mt-4 overflow-hidden rounded-2xl',
          portrait ? 'relative aspect-[3/4] bg-[#0d1528]' : 'aspect-[4/3] bg-gradient-to-br from-[#101B34] to-[#16213E]',
        )}
      >
        {img && (portrait ? (
          <>
            <img src={img} alt="" className="absolute inset-0 h-full w-full scale-[2] object-cover blur-3xl opacity-30" />
            <img src={img} alt={ex.illustration.alt} className="relative h-full w-full object-contain" />
          </>
        ) : (
          <img src={img} alt={ex.illustration.alt} className="h-full w-full object-contain" />
        ))}
      </div>

      <div className="mt-4 flex gap-1.5">
        <Chip variant="accent">{`Set ${setIndex + 1} / ${targetSets}`}</Chip>
        <Chip variant="slate">{`${ex.reps} reps`}</Chip>
        <Chip variant="slate">{`Tempo ${ex.tempo}`}</Chip>
      </div>

      {phase === 'exercise' && (
        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
            Reps completed
          </p>
          <div className="mt-3 flex items-center gap-5">
            <button
              onClick={() => setRepsInput((r) => Math.max(0, r - 1))}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-xl font-bold transition active:scale-90"
            >
              &minus;
            </button>
            <span className="w-14 text-center text-4xl font-bold tabular-nums text-white">
              {repsInput}
            </span>
            <button
              onClick={() => setRepsInput((r) => r + 1)}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-xl font-bold transition active:scale-90"
            >
              +
            </button>
          </div>
          <Button className="mt-6" size="lg" onClick={logSet}>
            Complete Set
          </Button>
        </div>
      )}

      {phase === 'resting' && (
        <div className="mt-8">
          <RestTimer seconds={parseRestSeconds(ex.rest)} onDone={afterRest} />
        </div>
      )}
    </motion.div>
  );
}

function SessionSummary({
  sessionKey,
  weekNumber,
  onDone,
}: {
  sessionKey: string;
  weekNumber: number;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const session = sessionKey ? program.sessions[sessionKey] : undefined;

  const [rpe, setRpe] = useState(7);
  const [durationMin, setDurationMin] = useState(40);
  const [energy, setEnergy] = useState(3);
  const [notes, setNotes] = useState('');
  const [totalReps, setTotalReps] = useState(0);
  const [streak, setStreak] = useState(0);
  const [weekDone, setWeekDone] = useState(0);
  const [saving, setSaving] = useState(false);

  const todayLocal = todayIso();
  const trainingDaysPerWeek = program.weekly_template.filter((d) => d.session_key !== 'rest').length;

  useEffect(() => {
    (async () => {
      const [setLogs, sessionLogs, startDate] = await Promise.all([
        getAllSetLogs(),
        getAllSessionLogs(),
        getProgramStartDate(),
      ]);
      const mySetLogs = setLogs.filter((l) => l.date === todayLocal && l.sessionKey === sessionKey);
      const reps = mySetLogs.reduce((s, l) => s + (l.repsCompleted ?? 0), 0);
      setTotalReps(reps);

      if (mySetLogs.length > 0) {
        const first = mySetLogs[0];
        const last = mySetLogs[mySetLogs.length - 1];
        const elapsed = Math.round(
          (new Date(last.completedAt).getTime() - new Date(first.completedAt).getTime()) / 60000,
        );
        setDurationMin(Math.max(10, elapsed));
      }

      if (startDate) {
        setStreak(computeCurrentStreak(sessionLogs, startDate));
        const weekSessions = sessionLogs.filter(
          (l) => l.weekNumber === weekNumber && l.completed,
        );
        setWeekDone(weekSessions.length);
      }
    })();
  }, [sessionKey, weekNumber, todayLocal]);

  async function finish() {
    setSaving(true);
    await upsertSessionLog({
      date: todayLocal,
      weekNumber,
      sessionKey,
      completed: true,
      rpe,
      durationMin,
      energy,
      notes,
    });
    onDone();
  }

  const exerciseCount = session?.exercises.length ?? 0;

  const statCards = [
    { label: exerciseCount === 1 ? 'Exercise' : 'Exercises', value: String(exerciseCount) },
    { label: 'Duration', value: `${durationMin}<span class="text-sm font-medium text-slate-400">m</span>` },
    { label: 'Reps', value: String(totalReps) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="safe-top safe-bottom flex min-h-screen flex-col px-5 pb-10 pt-12 text-white"
    >
      <div className="flex flex-1 flex-col items-center text-center">
        <motion.svg
          viewBox="0 0 80 80"
          className="h-20 w-20"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <motion.circle
            cx="40" cy="40" r="36"
            fill="none" strokeWidth="3"
            className="stroke-emerald-400"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
          />
          <motion.path
            d="M24 40l12 12 20-24"
            fill="none" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="stroke-emerald-400"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.5 }}
          />
        </motion.svg>

        <motion.h1
          className="mt-5 text-3xl font-extrabold text-white"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.55 }}
        >
          Workout Complete
        </motion.h1>

        <motion.p
          className="mt-1.5 text-sm text-slate-400"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.6 }}
        >
          {session?.title.split('—')[0].trim() ?? sessionKey}
        </motion.p>

        <motion.div
          className="mt-8 grid w-full max-w-xs grid-cols-3 gap-3"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.07, delayChildren: 0.65 } },
          }}
        >
          {statCards.map((s) => (
            <motion.div
              key={s.label}
              className="rounded-xl bg-white/5 px-3 py-2.5"
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
              }}
            >
              <p className="text-lg font-extrabold tabular-nums text-white" dangerouslySetInnerHTML={{ __html: s.value }} />
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          className="mt-6 w-full max-w-xs space-y-2"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.07, delayChildren: 0.8 } },
          }}
        >
          <motion.div
            className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5"
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
            }}
          >
            <span className="text-xs font-semibold text-slate-300">Current Streak</span>
            <span className="flex items-center gap-1.5 text-sm font-extrabold tabular-nums text-orange-400">
              <Flame size={14} />{streak} {streak === 1 ? 'day' : 'days'}
            </span>
          </motion.div>
          <motion.div
            className="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-2.5"
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
            }}
          >
            <span className="text-xs font-semibold text-slate-300">Week Progress</span>
            <span className="text-sm font-extrabold tabular-nums text-emerald-400">
              {weekDone}/{trainingDaysPerWeek}
            </span>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.9 }}
        className="mx-auto w-full max-w-xs"
      >
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs font-semibold text-slate-400">Effort (RPE)</span>
              <span className="text-sm font-bold tabular-nums text-orange-400">{rpe}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(Number(e.target.value))}
              className="mt-1.5 w-full accent-orange-500"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-600">
              <span>Easy</span>
              <span>Max effort</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs font-semibold text-slate-400">Energy</span>
              <span className="text-sm font-bold tabular-nums text-white">{energy}/5</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={energy}
              onChange={(e) => setEnergy(Number(e.target.value))}
              className="mt-1.5 w-full accent-blue-500"
            />
          </div>

          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notes (optional)"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500/40 resize-none"
            />
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <Button
            size="lg"
            onClick={finish}
            disabled={saving}
            className="w-full"
          >
            {saving ? 'Saving\u2026' : 'Continue'}
          </Button>
          <button
            onClick={() => navigate('/progress')}
            className="flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-300"
          >
            View Progress
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
