import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, Calendar, Dumbbell, RotateCcw, Trash2, Info, Bell, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { NotificationCard } from "@/components/NotificationCard";
import { getProgramStartDate, setProgramStartDate, resetProgress, resetAllData } from "@/lib/db";
import { getEquipmentProfile, saveEquipmentProfile, ALL_DUMBBELL_WEIGHTS, type EquipmentProfile } from "@/lib/equipment";
import { cn } from "@/lib/utils";

export function Settings() {
  const navigate = useNavigate();
  const [startDate, setStartDateState] = useState<string>("");
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"restart" | "reset" | null>(null);
  const [equipment, setEquipment] = useState<EquipmentProfile | null>(null);

  useEffect(() => {
    (async () => {
      const [d, eq] = await Promise.all([getProgramStartDate(), getEquipmentProfile()]);
      if (d) setStartDateState(d);
      setEquipment(eq);
    })();
  }, []);

  async function handleDateChange(date: string) {
    await setProgramStartDate(date);
    setStartDateState(date);
    setShowStartDatePicker(false);
  }

  async function handleRestart() {
    await resetAllData();
    navigate("/");
  }

  async function handleReset() {
    await resetProgress();
    setConfirmAction(null);
  }

  return (
    <div className="safe-top min-h-screen pb-28 pt-8">
      <div className="flex items-center gap-3 px-5">
        <button onClick={() => navigate(-1)} className="text-slate-400">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      <div className="mt-8 px-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
          <Bell size={14} /> Notifications
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mt-3 px-5"
      >
        <NotificationCard />
      </motion.div>

      <div className="mt-8 px-5">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">Program</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="mt-3 px-5"
      >
        <Card>
          <button
            onClick={() => setShowStartDatePicker(!showStartDatePicker)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                <Calendar size={18} className="text-blue-400" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">Program Start Date</p>
                <p className="text-xs text-slate-400">
                  {startDate
                    ? new Date(startDate + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "Not set"}
                </p>
              </div>
            </div>
            <ChevronLeft size={16} className={cn("text-slate-500 transition-transform", showStartDatePicker && "-rotate-90")} />
          </button>
          {showStartDatePicker && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 [color-scheme:dark]"
              />
            </div>
          )}
        </Card>
      </motion.div>

      <div className="mt-8 px-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
          <Dumbbell size={14} /> Equipment
        </p>
      </div>

      {equipment && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="mt-3 px-5"
        >
          <Card>
            <p className="text-xs font-semibold text-slate-400">Dumbbells (kg)</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ALL_DUMBBELL_WEIGHTS.map((w) => {
                const selected = equipment.dumbbells.includes(w);
                return (
                  <button
                    key={w}
                    onClick={() => {
                      const next = selected
                        ? equipment.dumbbells.filter((d) => d !== w)
                        : [...equipment.dumbbells, w].sort((a, b) => a - b);
                      const updated = { ...equipment, dumbbells: next };
                      setEquipment(updated);
                      saveEquipmentProfile(updated);
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                      selected
                        ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                        : 'border-white/10 bg-white/5 text-slate-500',
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              {([
                { key: 'hasBench', label: 'Bench' },
                { key: 'hasBands', label: 'Resistance Bands' },
                { key: 'hasPullUpBar', label: 'Pull-up Bar' },
                { key: 'hasMat', label: 'Exercise Mat' },
                { key: 'hasKettlebell', label: 'Kettlebell' },
              ] as const).map(({ key, label }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={(equipment as any)[key] as boolean}
                    onChange={() => {
                      const updated = { ...equipment, [key]: !(equipment as any)[key] };
                      setEquipment(updated);
                      saveEquipmentProfile(updated);
                    }}
                    className="h-4 w-4 accent-blue-500"
                  />
                  <span className="text-sm text-slate-300">{label}</span>
                </label>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <div className="mt-8 px-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-red-400">
          <AlertTriangle size={14} /> Danger Zone
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="mt-3 px-5"
      >
        <Card className="border-red-500/20">
          <button
            onClick={() => setConfirmAction("restart")}
            className="flex w-full items-center gap-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15">
              <RotateCcw size={18} className="text-orange-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-white">Restart Program</p>
              <p className="text-xs text-slate-400">Clear all data and start fresh</p>
            </div>
          </button>
          {confirmAction === "restart" && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-400" />
                This will permanently delete all your data including sessions, measurements, photos, and settings. This cannot be undone.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleRestart}
                  className="flex-1 rounded-xl bg-orange-600 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
                >
                  Yes, Restart
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="mt-3 px-5"
      >
        <Card className="border-red-500/20">
          <button
            onClick={() => setConfirmAction("reset")}
            className="flex w-full items-center gap-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15">
              <Trash2 size={18} className="text-red-400" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-white">Reset Progress</p>
              <p className="text-xs text-slate-400">Keep settings, clear sessions & measurements</p>
            </div>
          </button>
          {confirmAction === "reset" && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                This will clear all sessions, measurements, and photos. Your settings, start date, and preferences will be kept. This cannot be undone.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
                >
                  Yes, Reset
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      <div className="mt-8 px-5">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">About</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.25 }}
        className="mt-3 px-5"
      >
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
              <Info size={18} className="text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Daily Forge</p>
              <p className="text-xs text-slate-400">v1.0 &middot; A 12-week home dumbbell program</p>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}