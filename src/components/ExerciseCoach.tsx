import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { Exercise } from '@/types';

function compactTips(ex: Exercise): string[] {
  const tips: string[] = [];
  for (const step of ex.execution.slice(0, 3)) {
    tips.push(step.replace(/^-\s*/, ''));
  }
  if (ex.breathing && tips.length < 4) {
    tips.push(ex.breathing.replace(/^-\s*/, ''));
  }
  return tips;
}

export function CoachBar({
  exercise,
  onExpand,
}: {
  exercise: Exercise;
  onExpand: () => void;
}) {
  const tips = compactTips(exercise);
  return (
    <button
      onClick={onExpand}
      className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left transition active:scale-[0.99]"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-400">
        Technique
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-slate-500/50" />
            {tip}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] font-medium text-slate-600">
        Tap for full coaching
      </p>
    </button>
  );
}

export function CoachSheet({
  exercise,
  open,
  onClose,
}: {
  exercise: Exercise;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#0a0f1f] p-5 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{exercise.name}</h3>
              <button onClick={onClose} className="text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <Section title="Setup">
                <p className="text-sm leading-relaxed text-slate-400">{exercise.setup}</p>
              </Section>

              <Section title="Execution">
                <ol className="list-inside list-decimal space-y-1">
                  {exercise.execution.map((step, i) => (
                    <li key={i} className="text-sm leading-relaxed text-slate-400">
                      {step}
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="Breathing">
                <p className="text-sm leading-relaxed text-slate-400">{exercise.breathing}</p>
              </Section>

              {exercise.mistakes.length > 0 && (
                <Section title="Common Mistakes">
                  <ul className="space-y-1">
                    {exercise.mistakes.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-red-400/80">
                        <span className="mt-[3px] text-xs">&times;</span>
                        {m}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Safety">
                <p className="text-sm leading-relaxed text-amber-400/80">{exercise.safety}</p>
              </Section>

              {exercise.pro_tips.length > 0 && (
                <Section title="Pro Tips">
                  <ul className="space-y-1">
                    {exercise.pro_tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-emerald-400/80">
                        <span className="mt-[3px] text-xs">+</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
