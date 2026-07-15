import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

export function parseRestSeconds(rest: string): number {
  const match = rest.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 60;
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
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    setRemaining(seconds);
    setRunning(true);
  }, [seconds]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(intervalRef.current!);
          onDone?.();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/5 p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-orange-400">
        Rest Time
      </p>
      <div className="text-5xl font-bold tabular-nums text-white">
        {mm}:{String(ss).padStart(2, '0')}
      </div>
      <div className="flex w-full gap-2">
        <Button variant="secondary" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : 'Resume'}
        </Button>
        <Button variant="secondary" onClick={() => setRemaining(seconds)}>
          Reset
        </Button>
        <Button variant="primary" onClick={() => { setRunning(false); onDone?.(); }}>
          Skip
        </Button>
      </div>
    </div>
  );
}
