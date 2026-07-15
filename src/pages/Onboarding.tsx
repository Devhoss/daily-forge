import { useState } from "react";
import { setProgramStartDate } from "@/lib/db";
import { todayIso } from "@/lib/programEngine";
import { Button } from "@/components/ui/Button";
import logo from "@/assets/logo.png";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(todayIso());

  async function handleStart() {
    await setProgramStartDate(date);
    onDone();
  }

  return (
    <div className="safe-top flex min-h-screen flex-col justify-center gap-6 px-6">
      {/* Brand */}
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt="Daily Forge" className="h-20 w-20" />

        <h1 className="mt-6 text-3xl font-black text-white sm:text-4xl">
          Daily Forge
        </h1>

        <p className="mt-2 text-lg font-semibold text-orange-400">
          Forge yourself,
          <br />
          one day at a time.
        </p>

        <p className="mt-6 max-w-sm text-base leading-7 text-slate-400">
          Choose your start date and we'll guide you through every workout of
          your 12-week program.
        </p>
      </div>
      <label className="flex flex-col gap-2">
        <span className="mb-3 block text-xs font-bold uppercase tracking-wider text-orange-400">
          Program Start Date
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="
                w-full
                rounded-xl
                border
                border-white/10
                bg-slate-900/70
                px-4
                py-3
                text-white
                outline-none
                transition
                focus:border-orange-400
                focus:ring-2
                focus:ring-orange-400/20
              "
        />
      </label>
      <Button onClick={handleStart} className="mt-5 w-full">
        Start My Journey
      </Button>
    </div>
  );
}
