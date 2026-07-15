import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { setProgramStartDate } from "@/lib/db";
import { todayIso } from "@/lib/programEngine";
import { Button } from "@/components/ui/Button";
import { Dumbbell, Clock, Map, Flame, ChevronRight, ChevronLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const STEPS = ["Welcome", "What You'll Need", "Your Start Date"];

const REQUIREMENTS = [
  { icon: Dumbbell, label: "Adjustable Dumbbells", desc: "Or a set of fixed-weight pairs covering 2-25 kg" },
  { icon: Clock, label: "30–45 Minutes", desc: "Each session fits within your lunch break" },
  { icon: Map, label: "A Mat & Space", desc: "Just enough room to lie down and extend your arms" },
  { icon: Flame, label: "Consistency", desc: "Show up. The program does the rest." },
];

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 200 : -200, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -200 : 200, opacity: 0 }),
};

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(0);
  const [date, setDate] = useState(todayIso());

  async function handleStart() {
    await setProgramStartDate(date);
    onDone();
  }

  function goNext() {
    if (step < STEPS.length - 1) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      handleStart();
    }
  }

  function goBack() {
    if (step > 0) {
      setDir(-1);
      setStep((s) => s - 1);
    }
  }

  return (
    <div className="safe-top flex min-h-screen flex-col px-6 pb-10 pt-16 safe-bottom">
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-6 rounded-full transition-all duration-300 ${i === step ? "bg-blue-500" : i < step ? "bg-blue-500/40" : "bg-white/15"}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="mt-14 flex-1"
          >
            {step === 0 && (
              <div className="flex flex-col items-center text-center">
                <img src={logo} alt="Daily Forge" className="h-24 w-24" />
                <h1 className="mt-8 text-4xl font-black text-white">
                  Daily Forge
                </h1>
                <p className="mt-3 text-lg font-semibold text-orange-400">
                  Forge yourself,
                  <br />
                  one day at a time.
                </p>
                <p className="mt-6 max-w-sm text-base leading-relaxed text-slate-400">
                  A 12-week home dumbbell program designed to build strength,
                  consistency, and control — no gym required.
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="px-2">
                <h2 className="text-2xl font-bold text-white">What You&apos;ll Need</h2>
                <p className="mt-1.5 text-sm text-slate-400">
                  Nothing fancy. Just the basics and a willingness to show up.
                </p>
                <div className="mt-6 space-y-4">
                  {REQUIREMENTS.map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5">
                        <Icon size={20} className="text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{label}</p>
                        <p className="mt-0.5 text-sm text-slate-400">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="px-2">
                <h2 className="text-2xl font-bold text-white">Your Start Date</h2>
                <p className="mt-1.5 text-sm text-slate-400">
                  Pick a day and we&apos;ll guide you through every workout of
                  your 12-week program.
                </p>
                <label className="mt-8 flex flex-col gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Choose Date
                  </span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3.5 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 [color-scheme:dark]"
                  />
                </label>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-auto flex items-center gap-3 pt-6">
        {step > 0 && (
          <button
            onClick={goBack}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition active:scale-95"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <Button onClick={goNext}>
          {step < STEPS.length - 1 ? (
            <span className="flex items-center justify-center gap-2">
              Continue <ChevronRight size={16} />
            </span>
          ) : (
            "Begin Your Journey"
          )}
        </Button>
      </div>

    </div>
  );
}
