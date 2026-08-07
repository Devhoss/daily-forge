import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getExercisesForSession, resolveIllustrationSrc, isPortraitExercise, isTimeBasedExercise, parseHoldDuration, program } from '@/lib/data';
import { upsertSessionLog, addSetLog, getProgramStartDate, getAllSetLogs, getAllSessionLogs } from '@/lib/db';
import { computeCurrentStreak } from '@/services/streaks/streakEngine';
import { getTodayInfo, todayIso } from '@/lib/programEngine';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { RestTimer, parseRestSeconds, ensureRestAudio } from '@/components/RestTimer';
import { CoachBar, CoachSheet } from '@/components/ExerciseCoach';
import { startWorkoutNotification, updateExerciseNotification, updateRestNotification, stopWorkoutNotification } from '@/lib/workoutNotification';
import { saveWorkoutState, loadWorkoutState, clearWorkoutState } from '@/lib/workoutState';
import { getEquipmentProfile } from '@/lib/equipment';
import { recommendWeight } from '@/lib/weights';
import type { OverloadStep } from '@/services/recommendations/recommendationEngine';
import { Flame, ChevronLeft, X, ChevronDown, Sparkles } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import type { Exercise } from '@/types';

const REST_NOTIFICATION_ID = 8888;

interface ApplyRecommendation {
  exerciseId: string;
  step: OverloadStep;
}

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

function HoldTimer({
  targetDuration,
  initialElapsed,
  onComplete,
}: {
  targetDuration: number;
  initialElapsed?: number;
  onComplete: (elapsed: number) => void;
}) {
  const [elapsed, setElapsed] = useState(initialElapsed ?? 0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const ee = Math.floor(elapsed / 60);
  const ss = elapsed % 60;

  return (
    <div className="mt-8 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-blue-400">
        Hold Timer
      </p>
      <p className="mt-5 text-5xl font-bold tabular-nums text-white">
        {ee}:{String(ss).padStart(2, '0')}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Target: {targetDuration}s
      </p>
      <Button className="mt-6" size="lg" onClick={() => onComplete(elapsed)}>
        Complete Hold
      </Button>
    </div>
  );
}

export function WorkoutMode() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const appliedRecRef = useRef<ApplyRecommendation | null>(
    (location.state as { applyRecommendation?: ApplyRecommendation } | null)
      ?.applyRecommendation ?? null,
  );
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
  const [showCoach, setShowCoach] = useState(false);
  const restEndRef = useRef<number | null>(null);
  const [restOverrideSeconds, setRestOverrideSeconds] = useState<number | null>(null);
  const [holdInitElapsed, setHoldInitElapsed] = useState(0);
  const startedAtRef = useRef<number>(Date.now());
  const [weightUsed, setWeightUsed] = useState<number | null>(null);
  const [weightOptions, setWeightOptions] = useState<number[]>([]);

  /* Persistent workout notification */
  useEffect(() => {
    startWorkoutNotification(exerciseIndex, exercises.length);
    return () => { stopWorkoutNotification(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'resting') return;
    updateExerciseNotification(exerciseIndex, exercises.length);
  }, [phase, exerciseIndex, exercises.length]);

  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] }).catch(() => {});
        if (phaseRef.current === 'resting' && restEndRef.current) {
          const remaining = Math.max(0, Math.round((restEndRef.current - Date.now()) / 1000));
          setRestOverrideSeconds(remaining);
          if (remaining <= 0) setRestOverrideSeconds(0);
        }
      } else if (phaseRef.current === 'resting' && restEndRef.current) {
        const remaining = Math.max(0, Math.round((restEndRef.current - Date.now()) / 1000));
        if (remaining > 0) {
          const idx = exerciseIndexRef.current;
          const nextEx = exercisesRef.current[idx + 1];
          const body = nextEx
            ? `Next:\n${nextEx.name}\nSet ${setIndexRef.current + 2} of ${targetSetsRef.current}`
            : 'Workout Summary is next';
          LocalNotifications.schedule({
            notifications: [{
              id: REST_NOTIFICATION_ID,
              title: 'Rest complete',
              body,
              schedule: { at: new Date(restEndRef.current) },
              channelId: 'training-reminders',
              smallIcon: 'ic_notification',
              iconColor: '#3B82F6',
              // extra data used by the notification tap listener
              ...(sessionKey ? { data: { sessionKey } } : {}),
            }],
          }).catch(() => {});
        }
      }
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Notification tap → return to workout */
  useEffect(() => {
    const handler = LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (n) => {
        const sk = n.notification.extra?.sessionKey as string | undefined;
        if (sk) navigate(`/workout/${sk}`, { replace: true });
      },
    );
    return () => { handler.then((h) => h.remove()); };
  }, [navigate]);

  useEffect(() => {
    getProgramStartDate().then((d) => {
      if (d) setWeekNumber(getTodayInfo(d).weekNumber);
    });
  }, []);

  /* Workout state recovery */
  useEffect(() => {
    if (!sessionKey) return;
    (async () => {
      const saved = await loadWorkoutState();
      if (saved && saved.sessionKey === sessionKey) {
        if (saved.startedAt) startedAtRef.current = saved.startedAt;
        if (saved.weightUsed != null) setWeightUsed(saved.weightUsed);
        setExerciseIndex(saved.exerciseIndex);
        setSetIndex(saved.setIndex);
        if (saved.repsInput > 0) setRepsInput(saved.repsInput);
        if (saved.phase === 'resting') {
          if (saved.restEndTime) {
            const remaining = Math.max(0, Math.round((saved.restEndTime - Date.now()) / 1000));
            restEndRef.current = saved.restEndTime;
            if (remaining > 0) {
              setRestOverrideSeconds(remaining);
            } else {
              setRestOverrideSeconds(0);
            }
          }
          setPhase('resting');
        }
        if (saved.holdDurationTarget) {
          setHoldInitElapsed(saved.holdDurationTarget);
        }
      }
    })();
  }, [sessionKey]);

  const exercisesList = exercises;
  useEffect(() => {
    const current = exercisesList[exerciseIndex];
    if (current && !isTimeBasedExercise(current)) {
      setRepsInput(parseTargetReps(current.reps));
    }
  }, [exerciseIndex, exercisesList]);

  // Reset weight selection per exercise; default to the recommended load when owned,
  // or to the applied recommendation's target when one was applied from Home.
  useEffect(() => {
    setWeightUsed(null);
    const current = exercisesList[exerciseIndex];
    if (!current) return;
    const applied = appliedRecRef.current;
    const isApplied = applied != null && applied.exerciseId === current.id;
    const weighted =
      current.recommendedLoads && Object.keys(current.recommendedLoads).length > 0;
    if (!weighted) {
      setWeightOptions([]);
      return;
    }
    (async () => {
      const profile = await getEquipmentProfile();
      const owned = [...profile.dumbbells].sort((a, b) => a - b);
      const rec = await recommendWeight(current);
      const desired =
        isApplied && applied.step.target.loadKg != null ? applied.step.target.loadKg : rec.weight;
      let def: number | null = null;
      if (desired > 0) {
        const exact = owned.find((w) => Math.abs(w - desired) < 1e-9);
        if (exact) {
          def = exact;
        } else if (owned.length) {
          def = owned.reduce((best, w) =>
            Math.abs(w - desired) < Math.abs(best - desired) ? w : best,
          );
        }
      }
      const opts = def == null || owned.includes(def) ? owned : [...owned, def].sort((a, b) => a - b);
      setWeightOptions(opts);
      setWeightUsed(def);
    })();
  }, [exerciseIndex, exercisesList]);

  const ex = exercises[exerciseIndex];
  const appliedRec = appliedRecRef.current;
  const isAppliedExercise = appliedRec != null && appliedRec.exerciseId === ex?.id;
  const targetSets = parseTargetSets(ex.sets);
  const isLastSetOfExercise = setIndex >= targetSets - 1;
  const isLastExercise = exerciseIndex >= exercises.length - 1;
  const nextEx: Exercise | null = isLastExercise ? null : exercises[exerciseIndex + 1];

  /* Refs holding latest values for background rest notifications (unconditional so hook order is stable) */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const exerciseIndexRef = useRef(exerciseIndex);
  exerciseIndexRef.current = exerciseIndex;
  const exercisesRef = useRef(exercises);
  exercisesRef.current = exercises;
  const setIndexRef = useRef(setIndex);
  setIndexRef.current = setIndex;
  const targetSetsRef = useRef(targetSets);
  targetSetsRef.current = targetSets;

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

  const img = resolveIllustrationSrc(ex);
  const portrait = isPortraitExercise(ex);
  const isTimeBased = isTimeBasedExercise(ex);

  async function logSet() {
    ensureRestAudio();
    await addSetLog({
      date: todayIso(),
      sessionKey: sessionKey!,
      exerciseId: ex.id,
      setIndex,
      repsCompleted: repsInput,
      weightUsed: weightUsed ?? undefined,
      completedAt: new Date().toISOString(),
    });
    restEndRef.current = Date.now() + parseRestSeconds(ex.rest) * 1000;
    setRestOverrideSeconds(null);
    setPhase('resting');
    saveWorkoutState({
      sessionKey: sessionKey!,
      exerciseIndex,
      setIndex,
      phase: 'resting',
      repsInput,
      restEndTime: restEndRef.current,
      restDuration: parseRestSeconds(ex.rest),
      startedAt: startedAtRef.current,
      weightUsed: weightUsed ?? undefined,
      timestamp: Date.now(),
    });
  }

  function logHold(durationSeconds: number) {
    ensureRestAudio();
    addSetLog({
      date: todayIso(),
      sessionKey: sessionKey!,
      exerciseId: ex.id,
      setIndex,
      holdDurationSeconds: durationSeconds,
      repsCompleted: durationSeconds,
      weightUsed: weightUsed ?? undefined,
      completedAt: new Date().toISOString(),
    });
    restEndRef.current = Date.now() + parseRestSeconds(ex.rest) * 1000;
    setRestOverrideSeconds(null);
    setPhase('resting');
    saveWorkoutState({
      sessionKey: sessionKey!,
      exerciseIndex,
      setIndex,
      phase: 'resting',
      repsInput: 0,
      restEndTime: restEndRef.current,
      restDuration: parseRestSeconds(ex.rest),
      startedAt: startedAtRef.current,
      weightUsed: weightUsed ?? undefined,
      timestamp: Date.now(),
    });
  }

  async function afterRest() {
    LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] }).catch(() => {});
    if (isLastSetOfExercise) {
      if (isLastExercise) {
        await clearWorkoutState();
        await upsertSessionLog({
          date: todayIso(),
          weekNumber: weekNumber ?? 1,
          sessionKey: sessionKey!,
          completed: true,
          durationMin: Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000)),
        });
        setPhase('summary');
      } else {
        setExerciseIndex((i) => i + 1);
        setSetIndex(0);
        setPhase('exercise');
        saveWorkoutState({
          sessionKey: sessionKey!,
          exerciseIndex: exerciseIndex + 1,
          setIndex: 0,
          phase: 'exercise',
          repsInput,
          startedAt: startedAtRef.current,
          weightUsed: weightUsed ?? undefined,
          timestamp: Date.now(),
        });
      }
    } else {
      setSetIndex((s) => s + 1);
      setPhase('exercise');
      saveWorkoutState({
        sessionKey: sessionKey!,
        exerciseIndex,
        setIndex: setIndex + 1,
        phase: 'exercise',
        repsInput,
        timestamp: Date.now(),
      });
    }
  }

  if (phase === 'summary') {
    return (
      <SessionSummary
        sessionKey={sessionKey}
        weekNumber={weekNumber ?? 1}
        startedAt={startedAtRef.current}
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
      <CoachSheet exercise={ex} open={showCoach} onClose={() => setShowCoach(false)} />

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
                onClick={() => {
                  saveWorkoutState({
                    sessionKey: sessionKey!,
                    exerciseIndex,
                    setIndex,
                    phase: phase === 'resting' ? 'resting' : 'exercise',
                    repsInput,
                    restEndTime: restEndRef.current ?? undefined,
                    restDuration: parseRestSeconds(ex.rest),
                    startedAt: startedAtRef.current,
                    weightUsed: weightUsed ?? undefined,
                    timestamp: Date.now(),
                  });
                  navigate('/');
                }}
                className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
              >
                Exit
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <h1 className="mt-2 text-2xl font-extrabold leading-tight">{ex.name}</h1>

      <CoachBar exercise={ex} onExpand={() => setShowCoach(true)} />

      <div
        className={cn(
          'mt-3 overflow-hidden rounded-2xl',
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

      <div className="mt-3 flex gap-1.5">
        <Chip variant="accent">{`Set ${setIndex + 1} / ${targetSets}`}</Chip>
        {isTimeBased ? (
          <Chip variant="emerald">{`Hold ${parseHoldDuration(ex.reps)}s`}</Chip>
        ) : (
          <Chip variant="slate">{`${ex.reps} reps`}</Chip>
        )}
        <Chip variant="slate">{`Tempo ${ex.tempo}`}</Chip>
      </div>

      {phase === 'exercise' && weightOptions.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
            Load
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {weightOptions.map((w) => (
              <button
                key={w}
                onClick={() => setWeightUsed(w)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition active:scale-95',
                  weightUsed === w
                    ? 'border-blue-500/40 bg-blue-500/20 text-blue-400'
                    : 'border-white/10 bg-white/5 text-slate-400',
                )}
              >
                {w} kg
              </button>
            ))}
          </div>
          {isAppliedExercise && appliedRec && (
            <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-blue-500/10 px-3 py-2 text-[11px] leading-relaxed text-blue-300">
              <Sparkles size={12} className="mt-0.5 shrink-0" />
              <span>
                Coach: aim for{" "}
                {appliedRec.step.target.loadKg != null
                  ? `${appliedRec.step.target.loadKg} kg`
                  : appliedRec.step.target.holdSeconds != null
                    ? `${appliedRec.step.target.holdSeconds}s holds`
                    : "the top of the rep range"}{" "}
                this session.
              </span>
            </div>
          )}
        </div>
      )}

      {phase === 'exercise' && nextEx && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
            <ChevronDown size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Up Next
            </p>
            <p className="truncate text-sm font-bold text-white">{nextEx.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold tabular-nums text-slate-300">
              {parseTargetSets(nextEx.sets)} &times; {nextEx.reps}
            </p>
            {nextEx.muscles_primary?.[0] && (
              <p className="text-[10px] text-slate-500">{nextEx.muscles_primary[0]}</p>
            )}
          </div>
        </div>
      )}

      {phase === 'exercise' && !isTimeBased && (
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

      {phase === 'exercise' && isTimeBased && (
        <HoldTimer
          targetDuration={parseHoldDuration(ex.reps)}
          initialElapsed={holdInitElapsed > 0 ? holdInitElapsed : undefined}
          onComplete={logHold}
        />
      )}

      {phase === 'resting' && (
        <div className="mt-8">
          <RestTimer
            seconds={restOverrideSeconds != null ? restOverrideSeconds : parseRestSeconds(ex.rest)}
            onDone={afterRest}
            onTick={(remaining) => { updateRestNotification(remaining); }}
            nextExercise={nextEx}
            currentSetIndex={setIndex}
            currentSetReps={repsInput}
            targetSets={targetSets}
            isLastExercise={isLastExercise && isLastSetOfExercise}
          />
        </div>
      )}
    </motion.div>
  );
}

function SessionSummary({
  sessionKey,
  weekNumber,
  startedAt,
  onDone,
}: {
  sessionKey: string;
  weekNumber: number;
  startedAt: number;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const session = sessionKey ? program.sessions[sessionKey] : undefined;

  const [rpe, setRpe] = useState(7);
  const durationMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
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
      const reps = mySetLogs.reduce((s, l) => s + (l.repsCompleted ?? l.holdDurationSeconds ?? 0), 0);
      setTotalReps(reps);

      if (startDate) {
        setStreak(computeCurrentStreak(sessionLogs, startDate, new Date()));
        const weekSessions = sessionLogs.filter(
          (l) => l.weekNumber === weekNumber && l.completed,
        );
        setWeekDone(weekSessions.length);
      }
    })();
  }, [sessionKey, weekNumber, todayLocal]);

  async function finish() {
    setSaving(true);
    const finalDuration = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    await upsertSessionLog({
      date: todayLocal,
      weekNumber,
      sessionKey,
      completed: true,
      rpe,
      durationMin: finalDuration,
      energy,
      notes,
    });
    onDone();
  }

  const exerciseCount = session?.exercises.length ?? 0;

  const statCards = [
    { label: exerciseCount === 1 ? 'Exercise' : 'Exercises', value: String(exerciseCount) },
    { label: 'Duration', value: formatDuration(durationMin) },
    { label: 'Total Work', value: String(totalReps) },
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
