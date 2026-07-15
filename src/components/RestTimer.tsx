import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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

function generateBeepBlob(): Blob {
  const sampleRate = 44100;
  const duration = 0.35;
  const freq = 880;
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
    const s = Math.sin(2 * Math.PI * freq * t) * 0.3 * env;
    view.setInt16(44 + i * 2, s * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function playChime() {
  try {
    if (!restAudioCtx) ensureRestAudio();
    if (restAudioCtx && restAudioCtx.state !== 'closed') {
      if (restAudioCtx.state === 'suspended') restAudioCtx.resume();
      const osc = restAudioCtx.createOscillator();
      const gain = restAudioCtx.createGain();
      osc.connect(gain);
      gain.connect(restAudioCtx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, restAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, restAudioCtx.currentTime + 0.4);
      osc.start(restAudioCtx.currentTime);
      osc.stop(restAudioCtx.currentTime + 0.4);
      return;
    }
  } catch (err) {
    console.warn('playChime oscillator failed:', err);
  }
  try {
    const blob = generateBeepBlob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch((e) => console.warn('playChime fallback failed:', e));
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (err) {
    console.warn('playChime fallback failed:', err);
  }
}

function vibrate() {
  try {
    navigator.vibrate?.(80);
  } catch (err) {
    console.warn('vibrate failed:', err);
  }
}

export function RestTimer({
  seconds,
  onDone,
}: {
  seconds: number;
  onDone?: () => void;
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

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(intervalRef.current!);
          return 0;
        }
        return r - 1;
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
      vibrate();
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
      className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 p-8"
    >
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-400">
        {completed ? "Rest Complete" : "Rest"}
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
            ? `Continuing in ${autoCountdown}…`
            : ""
          : "Take a short break"}
      </p>

      {completed ? (
        <button
          onClick={handleNext}
          className="rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
        >
          Next Set
        </button>
      ) : (
        <div className="flex w-full gap-2">
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
        </div>
      )}
    </motion.div>
  );
}
