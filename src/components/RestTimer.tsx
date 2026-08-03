import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Exercise } from "@/types";

let restAudioCtx: AudioContext | null = null;

export function ensureRestAudio(): void {
  try {
    if (!restAudioCtx) {
      restAudioCtx = new AudioContext();
    }
    if (restAudioCtx.state === 'suspended') {
      restAudioCtx.resume();
    }
  } catch (err) {
    console.warn('ensureRestAudio failed:', err);
  }
}

export function parseRestSeconds(rest: string): number {
  const match = rest.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 60;
}

function generateBeepBlob(freq = 880, duration = 0.5, volume = 0.5): Blob {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const write = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.max(0, 1 - t / duration);
    const s = Math.sin(2 * Math.PI * freq * t) * volume * env;
    view.setInt16(44 + i * 2, s * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function playChime() {
  const playBeep = (freq: number, delay: number) => {
    try {
      if (!restAudioCtx) ensureRestAudio();
      if (restAudioCtx && restAudioCtx.state !== 'closed') {
        if (restAudioCtx.state === 'suspended') restAudioCtx.resume();
        const osc = restAudioCtx.createOscillator();
        const gain = restAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(restAudioCtx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        const t = restAudioCtx.currentTime + delay;
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
        return;
      }
    } catch (err) {
      console.warn('playBeep oscillator failed:', err);
    }
    try {
      const blob = generateBeepBlob(freq, 0.5, 0.5);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.7;
      setTimeout(() => audio.play().catch(() => {}), delay * 1000);
      setTimeout(() => URL.revokeObjectURL(url), 2000 + delay * 1000);
    } catch (err) {
      console.warn('playBeep fallback failed:', err);
    }
  };

  playBeep(880, 0);
  playBeep(1100, 0.25);

  try {
    navigator.vibrate?.([100, 80, 100]);
  } catch (err) {
    console.warn('vibrate failed:', err);
  }
}

export function RestTimer({
  seconds,
  onDone,
  onTick,
  nextExercise,
  currentSetIndex,
  currentSetReps,
  targetSets,
  isLastExercise,
}: {
  seconds: number;
  onDone?: () => void;
  onTick?: (remaining: number) => void;
  nextExercise?: Exercise | null;
  currentSetIndex?: number;
  currentSetReps?: number;
  targetSets?: number;
  isLastExercise?: boolean;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const autoRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  const hasTriggeredRef = useRef(false);
  onDoneRef.current = onDone;

  useEffect(() => {
    setRemaining(seconds);
    setRunning(true);
    setCompleted(false);
    setAutoCountdown(0);
    hasTriggeredRef.current = false;
  }, [seconds]);

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(intervalRef.current!);
          return 0;
        }
        const next = r - 1;
        onTickRef.current?.(next);
        return next;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [running]);

  useEffect(() => {
    if (remaining === 0 && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      setCompleted(true);
      playChime();
      setAutoCountdown(2);
    }
  }, [remaining]);

  useEffect(() => {
    if (autoCountdown <= 0 || !completed) return;
    autoRef.current = window.setTimeout(() => {
      setAutoCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => {
      if (autoRef.current) window.clearTimeout(autoRef.current);
    };
  }, [autoCountdown, completed]);

  useEffect(() => {
    if (completed && autoCountdown === 0 && remaining === 0) {
      setRunning(false);
      onDoneRef.current?.();
    }
  }, [completed, autoCountdown, remaining]);

  function handleNext() {
    if (autoRef.current) window.clearTimeout(autoRef.current);
    setRunning(false);
    onDoneRef.current?.();
  }

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const isLastTen = remaining > 0 && remaining <= 10;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-6"
    >
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-400">
        {completed
          ? "Ready!"
          : isLastExercise
            ? "Final Rest"
            : "Rest"}
      </p>

      <motion.div
        animate={
          completed
            ? { scale: [1, 1.08, 1] }
            : isLastTen
              ? { scale: [1, 1.06, 1] }
              : {}
        }
        transition={
          completed
            ? { duration: 0.5, ease: "easeOut" }
            : isLastTen
              ? { repeat: Infinity, duration: 0.8, ease: "easeInOut" }
              : {}
        }
        className={cn(
          "text-6xl font-bold tabular-nums tracking-tight",
          completed && "text-emerald-400",
          isLastTen && "text-orange-400",
          !completed && !isLastTen && "text-white",
        )}
      >
        {completed ? (
          <span className="flex items-center gap-1">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="inline">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          `${mm}:${String(ss).padStart(2, "0")}`
        )}
      </motion.div>

      <p className="text-sm text-slate-500">
        {completed
          ? autoCountdown > 0
            ? `Starting ${isLastExercise ? "summary" : (nextExercise?.name ?? "next exercise")} in ${autoCountdown}\u2026`
            : ""
          : !running
            ? "Paused"
            : "Take a short break"}
      </p>

      {/* Last set summary */}
      {currentSetIndex != null && currentSetReps != null && (
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5">
          <span className="text-[11px] font-semibold text-slate-400">
            Set {currentSetIndex + 1} Complete
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-[11px] font-bold tabular-nums text-slate-300">
            {currentSetReps} {currentSetReps === 1 ? "rep" : "reps"}
          </span>
        </div>
      )}

      {/* Upcoming exercise preview (visible throughout rest) */}
      {isLastExercise ? (
        completed ? (
          <p className="text-sm font-medium text-emerald-400">
            Workout Summary is next
          </p>
        ) : null
      ) : nextExercise ? (
        <div className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Next Exercise
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {nextExercise.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {targetSets != null ? `${targetSets} \u00d7 ` : ""}
            {nextExercise.reps}
          </p>
        </div>
      ) : null}

      <div className="mt-1 flex w-full gap-2">
        {completed ? (
          <button
            onClick={handleNext}
            className="flex-1 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
          >
            {isLastExercise ? "View Summary" : "Next Set"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setRunning((r) => !r)}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
            >
              {running ? "Pause" : "Resume"}
            </button>
            <button
              onClick={() => setRemaining(seconds)}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
            >
              Reset
            </button>
            <button
              onClick={handleNext}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
            >
              Skip
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
