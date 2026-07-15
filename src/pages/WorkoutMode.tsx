import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getExercisesForSession, resolveIllustrationSrc, program } from '@/lib/data';
import { db, upsertSessionLog, getProgramStartDate } from '@/lib/db';
import { getTodayInfo, todayIso } from '@/lib/programEngine';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { RestTimer, parseRestSeconds } from '@/components/RestTimer';

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

  useEffect(() => {
    getProgramStartDate().then((d) => {
      if (d) setWeekNumber(getTodayInfo(d).weekNumber);
    });
  }, []);

  const exercisesList = exercises; // stable alias for the effect below
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
  const isLastSetOfExercise = setIndex >= targetSets - 1;
  const isLastExercise = exerciseIndex >= exercises.length - 1;

  async function logSet() {
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

  function afterRest() {
    if (isLastSetOfExercise) {
      if (isLastExercise) {
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
    <div className="safe-top min-h-screen px-5 pb-10 pt-6 text-white">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-orange-400">
          {session?.title.split('—')[0].trim()}
        </p>
        <p className="text-xs text-slate-400">
          Exercise {exerciseIndex + 1} / {exercises.length}
        </p>
      </div>

      <h1 className="mt-1 text-2xl font-extrabold">{ex.name}</h1>

      <div className="mt-4 aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-[#101B34] to-[#16213E]">
        {img && <img src={img} alt={ex.illustration.alt} className="h-full w-full object-cover" />}
      </div>

      <div className="mt-4 flex gap-2">
        <Chip variant="accent">{`Set ${setIndex + 1} / ${targetSets}`}</Chip>
        <Chip variant="slate">{`${ex.reps} reps`}</Chip>
        <Chip variant="slate">{`Tempo ${ex.tempo}`}</Chip>
      </div>

      {phase === 'exercise' && (
        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Reps completed this set
          </p>
          <div className="mt-2 flex items-center gap-4">
            <button
              onClick={() => setRepsInput((r) => Math.max(0, r - 1))}
              className="h-11 w-11 rounded-xl bg-white/10 text-xl font-bold"
            >
              −
            </button>
            <span className="w-12 text-center text-3xl font-bold tabular-nums">
              {repsInput}
            </span>
            <button
              onClick={() => setRepsInput((r) => r + 1)}
              className="h-11 w-11 rounded-xl bg-white/10 text-xl font-bold"
            >
              +
            </button>
          </div>
          <Button className="mt-5" onClick={logSet}>
            Complete Set
          </Button>
        </div>
      )}

      {phase === 'resting' && (
        <div className="mt-8">
          <RestTimer seconds={parseRestSeconds(ex.rest)} onDone={afterRest} />
        </div>
      )}
    </div>
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
  const [rpe, setRpe] = useState(7);
  const [durationMin, setDurationMin] = useState(40);
  const [energy, setEnergy] = useState(3);
  const [sleepHours, setSleepHours] = useState<number | ''>('');
  const [notes, setNotes] = useState('');

  async function finish() {
    await upsertSessionLog({
      date: todayIso(),
      weekNumber,
      sessionKey,
      completed: true,
      rpe,
      durationMin,
      energy,
      sleepHours: sleepHours === '' ? undefined : Number(sleepHours),
      notes,
    });
    onDone();
  }

  return (
    <div className="safe-top min-h-screen px-5 pb-10 pt-8 text-white">
      <h1 className="text-2xl font-extrabold">Session Complete 💪</h1>
      <p className="mt-1 text-sm text-slate-400">Quick log before you go.</p>

      <label className="mt-6 block text-sm">
        RPE (1-10): {rpe}
        <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} className="mt-2 w-full" />
      </label>

      <label className="mt-4 block text-sm">
        Duration (minutes)
        <input
          type="number"
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2"
        />
      </label>

      <label className="mt-4 block text-sm">
        Energy (1-5): {energy}
        <input type="range" min={1} max={5} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="mt-2 w-full" />
      </label>

      <label className="mt-4 block text-sm">
        Sleep last night (hours)
        <input
          type="number"
          value={sleepHours}
          onChange={(e) => setSleepHours(e.target.value === '' ? '' : Number(e.target.value))}
          className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2"
        />
      </label>

      <label className="mt-4 block text-sm">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2"
        />
      </label>

      <Button className="mt-6" onClick={finish}>
        Save & Finish
      </Button>
    </div>
  );
}
