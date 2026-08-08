import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Calendar, Dumbbell, RotateCcw, Trash2, Info, Bell, AlertTriangle, Camera, Database, Download, Upload, Save, Share2, Terminal, Bug, Bot, Activity, Eraser, ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { NotificationCard } from "@/components/NotificationCard";
import { getProgramStartDate, setProgramStartDate, resetProgress, resetAllData } from "@/lib/db";
import { getEquipmentProfile, saveEquipmentProfile, ALL_DUMBBELL_WEIGHTS, type EquipmentProfile } from "@/lib/equipment";
import { exportBackup, saveBackupToDocument, shareBackup, readBackupFile, parseBackup, restoreBackup, recordBackupTime, getLastBackupTime, BACKUP_FORMAT_VERSION, type BackupFile } from "@/lib/backup";
import { installDebugInterface } from "@/lib/debug";
import { APP_VERSION, APP_PHASE } from "@/lib/version";
import { useSettings } from "@/lib/SettingsContext";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TAPS_TO_ENABLE_DEV_MODE = 7;

function formatIsoDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function Settings() {
  const navigate = useNavigate();
  const { savePhotosToGallery, setSavePhotosToGallery, developerMode, setDeveloperMode, verboseLogging, setVerboseLogging, recoveryTracing, setRecoveryTracing } = useSettings();
  const { showToast } = useToast();
  const [startDate, setStartDateState] = useState<string>("");
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"restart" | "reset" | null>(null);
  const [equipment, setEquipment] = useState<EquipmentProfile | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupFile | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ ok: boolean; text: string } | null>(null);
  const snackbarTimer = useRef<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const devTapCount = useRef(0);
  const devTapTimer = useRef<number | null>(null);
  const [confirmDevDisable, setConfirmDevDisable] = useState(false);
  const [devBusy, setDevBusy] = useState(false);

  useEffect(() => () => {
    if (snackbarTimer.current !== null) window.clearTimeout(snackbarTimer.current);
    if (devTapTimer.current !== null) window.clearTimeout(devTapTimer.current);
  }, []);

  function showSnackbar(ok: boolean, text: string) {
    if (snackbarTimer.current !== null) window.clearTimeout(snackbarTimer.current);
    setSnackbar({ ok, text });
    snackbarTimer.current = window.setTimeout(() => setSnackbar(null), 3200);
  }

  useEffect(() => {
    (async () => {
      const [d, eq, last] = await Promise.all([getProgramStartDate(), getEquipmentProfile(), getLastBackupTime()]);
      if (d) setStartDateState(d);
      setEquipment(eq);
      setLastBackup(last);
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

  async function handleExportSave() {
    setBackupBusy(true);
    setBackupMsg(null);
    setExportOpen(false);
    try {
      const { text, filename } = await exportBackup();
      const ok = await saveBackupToDocument(text, filename);
      if (ok) {
        const iso = new Date().toISOString();
        setLastBackup(iso);
        await recordBackupTime(iso);
      }
      showSnackbar(ok
        ? true
        : false, ok ? "Backup saved successfully." : "Backup not saved (cancelled or failed).");
    } catch (err) {
      console.warn(err);
      showSnackbar(false, "Backup failed. Please try again.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportShare() {
    setBackupBusy(true);
    setBackupMsg(null);
    setExportOpen(false);
    try {
      const { text, filename } = await exportBackup();
      const ok = await shareBackup(text, filename);
      if (ok) {
        const iso = new Date().toISOString();
        setLastBackup(iso);
        await recordBackupTime(iso);
      }
      showSnackbar(ok, ok ? "Backup shared successfully." : "Could not share the backup.");
    } catch (err) {
      console.warn(err);
      showSnackbar(false, "Backup failed. Please try again.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreFile(file: File) {
    try {
      const text = await readBackupFile(file);
      const parsed = parseBackup(text);
      setConfirmRestore(parsed);
      setBackupMsg(null);
    } catch (err) {
      setBackupMsg({ ok: false, text: err instanceof Error ? err.message : "Could not read backup." });
    }
  }

  async function handleConfirmRestore() {
    if (!confirmRestore) return;
    setBackupBusy(true);
    try {
      await restoreBackup(confirmRestore);
      setConfirmRestore(null);
      setBackupMsg({ ok: true, text: "Restore complete \u2014 refreshing\u2026" });
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      console.warn(err);
      setBackupMsg({ ok: false, text: "Restore failed. Your data was not changed." });
      setBackupBusy(false);
    }
  }

  function handleVersionTap() {
    if (developerMode) return;
    devTapCount.current += 1;
    if (devTapTimer.current !== null) window.clearTimeout(devTapTimer.current);
    devTapTimer.current = window.setTimeout(() => {
      devTapCount.current = 0;
    }, 2000);
    if (devTapCount.current >= TAPS_TO_ENABLE_DEV_MODE) {
      devTapCount.current = 0;
      if (devTapTimer.current !== null) window.clearTimeout(devTapTimer.current);
      showToast("Developer Mode enabled.", { kind: "success" });
      void setDeveloperMode(true);
      return;
    }
    const remaining = TAPS_TO_ENABLE_DEV_MODE - devTapCount.current;
    showToast(`${remaining} ${remaining === 1 ? "tap" : "taps"} away\u2026`);
  }

  async function handleExportDebugSnapshot() {
    setDevBusy(true);
    try {
      installDebugInterface();
      const res = await window.dailyforgeDebug?.saveSnapshotToFile();
      showToast(res?.ok ? `Snapshot saved \u2014 ${res.filename}` : "Snapshot export cancelled.", {
        kind: res?.ok ? "success" : "info",
      });
    } catch (err) {
      console.warn(err);
      showToast("Snapshot export failed.", { kind: "error" });
    } finally {
      setDevBusy(false);
    }
  }

  function handleClearDebugTraces() {
    installDebugInterface();
    window.dailyforgeDebug?.clearRecoveryDebugTraces();
    showToast("Recovery debug traces cleared.", { kind: "success" });
  }

  function handleDisableDeveloperMode() {
    void setDeveloperMode(false);
    setConfirmDevDisable(false);
    showToast("Developer Mode disabled.");
  }

  return (
    <div className="safe-top min-h-screen pb-28 pt-8">
      <div className="flex items-center gap-3 px-5">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back to previous screen"
          className="rounded-lg p-1 text-slate-400 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
        >
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
            aria-expanded={showStartDatePicker}
            aria-controls="program-start-date-picker"
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
            <div id="program-start-date-picker" className="mt-4 border-t border-white/10 pt-4">
              <label htmlFor="program-start-date-input" className="mb-1.5 block text-xs font-semibold text-slate-400">
                Choose the day your 12-week program begins
              </label>
              <input
                id="program-start-date-input"
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
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      const next = selected
                        ? equipment.dumbbells.filter((d) => d !== w)
                        : [...equipment.dumbbells, w].sort((a, b) => a - b);
                      const updated = { ...equipment, dumbbells: next };
                      setEquipment(updated);
                      saveEquipmentProfile(updated);
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60',
                      selected
                        ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                        : 'border-white/10 bg-white/5 text-slate-500',
                    )}
                  >
                    {w} kg
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
              ] as const).map(({ key, label }) => {
                const value = equipment[key];
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => {
                        const updated = { ...equipment, [key]: !value };
                        setEquipment(updated);
                        saveEquipmentProfile(updated);
                      }}
                      className="h-4 w-4 accent-blue-500"
                    />
                    <span className="text-sm text-slate-300">{label}</span>
                  </label>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}

      <div className="mt-8 px-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
          <Camera size={14} /> Photos
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.18 }}
        className="mt-3 px-5"
      >
        <Card>
          <label className="flex cursor-pointer items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
              <Camera size={18} className="text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Save photos to device gallery</p>
              <p className="text-xs text-slate-400">
                Camera captures are copied to the device gallery (Pictures/DailyForge).
              </p>
            </div>
            <button
              role="switch"
              aria-checked={savePhotosToGallery}
              aria-label="Save photos to device gallery"
              onClick={() => setSavePhotosToGallery(!savePhotosToGallery)}
              className={cn(
                "relative h-7 w-12 shrink-0 appearance-none overflow-hidden rounded-full border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/60",
                savePhotosToGallery ? "bg-blue-500" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform",
                  savePhotosToGallery ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </label>
        </Card>
      </motion.div>

      <div className="mt-8 px-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
          <Database size={14} /> Data &amp; Backup
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="mt-3 px-5"
      >
        <Card>
          <div className="space-y-1">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={backupBusy}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99] disabled:opacity-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                <Download size={18} className="text-blue-400" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">Export Backup</p>
                <p className="text-xs text-slate-400">
                  {backupBusy ? "Exporting\u2026" : "Your full training history in one file"}
                </p>
              </div>
              <ChevronLeft size={16} className={cn("text-slate-500 transition-transform", exportOpen && "-rotate-90")} />
            </button>

            {exportOpen && !backupBusy && (
              <div className="mt-1 space-y-1 rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
                <button
                  onClick={handleExportSave}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 transition active:scale-[0.99]"
                >
                  <Save size={16} className="text-blue-400" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">Save to device…</p>
                    <p className="text-xs text-slate-500">Choose where to save it</p>
                  </div>
                </button>
                <button
                  onClick={handleExportShare}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 transition active:scale-[0.99]"
                >
                  <Share2 size={16} className="text-emerald-400" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">Share…</p>
                    <p className="text-xs text-slate-500">Send it anywhere</p>
                  </div>
                </button>
              </div>
            )}
            <button
              onClick={() => restoreInputRef.current?.click()}
              disabled={backupBusy}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99] disabled:opacity-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                <Upload size={18} className="text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">Restore Backup</p>
                <p className="text-xs text-slate-400">Restore from an earlier file</p>
              </div>
            </button>
          </div>

          {confirmRestore && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-400" />
                This will replace all current data with the backup. It cannot be undone.
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Backup made {formatIsoDate(confirmRestore.exportedAt)} &middot; format v
                {confirmRestore.version}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleConfirmRestore}
                  disabled={backupBusy}
                  className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white transition active:scale-[0.97] disabled:opacity-50"
                >
                  Yes, Restore
                </button>
                <button
                  onClick={() => setConfirmRestore(null)}
                  disabled={backupBusy}
                  className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {backupMsg && !confirmRestore && (
            <p
              className={cn(
                "mt-3 text-xs font-medium",
                backupMsg.ok ? "text-emerald-400" : "text-red-400",
              )}
            >
              {backupMsg.text}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-slate-500">
            <span>Last backup: {formatIsoDate(lastBackup)}</span>
            <span>Backup format v{BACKUP_FORMAT_VERSION}</span>
          </div>

          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRestoreFile(file);
              e.target.value = "";
            }}
          />
        </Card>
      </motion.div>

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
                This will permanently delete all your data including sessions, measurements, photos, and settings. This cannot be undone. Tip: use <span className="font-semibold text-white">Export Backup</span> in Data &amp; Backup first.
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
            <button
              type="button"
              onClick={handleVersionTap}
              aria-label="DailyForge version"
              className="block min-w-0 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              <p className="text-sm font-bold text-white">Daily Forge</p>
              <p className="text-xs text-slate-400">
                v{APP_VERSION} ({APP_PHASE}) &middot; A 12-week home dumbbell program
              </p>
            </button>
          </div>
        </Card>
      </motion.div>

      {developerMode && (
        <>
          <div className="mt-8 px-5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-violet-400">
              <Terminal size={14} /> Developer
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="mt-3 px-5"
          >
            <Card className="border-violet-500/20">
              <button
                onClick={() => navigate("/debug")}
                className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                  <Bug size={18} className="text-violet-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-white">Open Debug Console</p>
                  <p className="text-xs text-slate-400">Recovery, notifications, traces &amp; snapshot</p>
                </div>
                <ChevronRight size={16} className="text-slate-500" />
              </button>

              <div className="mt-1 space-y-1 border-t border-white/10 pt-2">
                <button
                  onClick={() => navigate("/coach")}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Bot size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">AI Coach</p>
                    <p className="text-xs text-slate-400">Ask your on-device Gemma coach</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500" />
                </button>
                <button
                  onClick={() => navigate("/debug#recovery")}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Activity size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">Recovery Debug</p>
                    <p className="text-xs text-slate-400">Score, factor breakdown &amp; traces</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500" />
                </button>
                <button
                  onClick={() => navigate("/debug#notifications")}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Bell size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">Notifications Debug</p>
                    <p className="text-xs text-slate-400">Today&apos;s coached payload &amp; pending OS count</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500" />
                </button>
                <button
                  onClick={handleExportDebugSnapshot}
                  disabled={devBusy}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99] disabled:opacity-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Download size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-white">
                      {devBusy ? "Exporting\u2026" : "Export Debug Snapshot"}
                    </p>
                    <p className="text-xs text-slate-400">Full live snapshot as JSON</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500" />
                </button>
              </div>

              <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Database size={18} className="text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Verbose recovery logging</p>
                    <p className="text-xs text-slate-400">Log every recovery computation to the console</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={verboseLogging}
                    aria-label="Verbose recovery logging"
                    onClick={() => setVerboseLogging(!verboseLogging)}
                    className={cn(
                      "relative h-7 w-12 shrink-0 appearance-none overflow-hidden rounded-full border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400/60",
                      verboseLogging ? "bg-violet-500" : "bg-white/10",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform",
                        verboseLogging ? "translate-x-5" : "translate-x-0",
                      )}
                    />
                  </button>
                </label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Activity size={18} className="text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">Recovery tracing</p>
                    <p className="text-xs text-slate-400">Keep in-memory traces for before/after comparison</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={recoveryTracing}
                    aria-label="Recovery tracing"
                    onClick={() => setRecoveryTracing(!recoveryTracing)}
                    className={cn(
                      "relative h-7 w-12 shrink-0 appearance-none overflow-hidden rounded-full border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400/60",
                      recoveryTracing ? "bg-violet-500" : "bg-white/10",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition-transform",
                        recoveryTracing ? "translate-x-5" : "translate-x-0",
                      )}
                    />
                  </button>
                </label>
              </div>

              <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                <button
                  onClick={handleClearDebugTraces}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                    <Eraser size={18} className="text-violet-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white">Clear debug traces</p>
                    <p className="text-xs text-slate-400">Empty the in-memory recovery trace buffer</p>
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDevDisable((v) => !v)}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2 transition active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                    <ShieldOff size={18} className="text-red-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-white">Disable Developer Mode</p>
                    <p className="text-xs text-slate-400">Hide this section and all developer tools</p>
                  </div>
                </button>
              </div>

              {confirmDevDisable && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-400" />
                    This hides the Developer section and tools. Your data is not affected.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleDisableDeveloperMode}
                      className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition active:scale-[0.97]"
                    >
                      Yes, Disable
                    </button>
                    <button
                      onClick={() => setConfirmDevDisable(false)}
                      className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold text-slate-300 transition active:scale-[0.97]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}

      {snackbar && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-5"
        >
          <div
            className={cn(
              "flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl",
              snackbar.ok
                ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-300"
                : "border-red-500/30 bg-red-950/90 text-red-300",
            )}
          >
            {snackbar.ok ? <Download size={16} /> : <AlertTriangle size={16} />}
            {snackbar.text}
          </div>
        </motion.div>
      )}
    </div>
  );
}