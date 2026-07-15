import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { BookOpen, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { openBundledPdfNatively } from "@/lib/nativePdf";

const FEATURES = [
  "Complete 12-week program",
  "Nutrition Guide",
  "Recovery Guide",
  "Exercises",
  "Progress Tracking",
];

const PDF_WEB_PATH = "/book/blueprint.pdf";

export function Book() {
  const isNative = Capacitor.isNativePlatform();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setError(null);
    if (!isNative) {
      window.open(PDF_WEB_PATH, "_blank");
      return;
    }
    setOpening(true);
    try {
      await openBundledPdfNatively();
    } catch (e) {
      console.error("[book] Failed to open bundled PDF:", e);
      setError(
        "Could not open the manual. Make sure you have a PDF viewer app installed (e.g. Google Drive, Adobe Acrobat).",
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8 text-white">
      <h1 className="text-2xl font-bold">The Blueprint Book</h1>
      <p className="mt-1 text-sm text-slate-400">
        The complete reference manual. The app handles your day-to-day training
        — this is here whenever you want the full read.
      </p>

      <Card className="mt-6 border-blue-500/20 bg-gradient-to-br from-[var(--color-bg-raised)] to-[#182647]">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/20">
            <BookOpen size={22} className="text-blue-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Blueprint Manual</p>
            <p className="text-xs text-slate-500">Version 1.0</p>
          </div>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {FEATURES.map((f) => (
            <li
              key={f}
              className="flex items-center gap-2 text-sm text-slate-300"
            >
              <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
              {f}
            </li>
          ))}
        </ul>

        <div className="my-4 border-t border-white/10" />

        <button
          onClick={handleOpen}
          disabled={opening}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-center text-sm font-semibold text-white disabled:opacity-60"
        >
          {opening ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Opening…
            </>
          ) : (
            <>
              Open Manual <ArrowRight size={16} />
            </>
          )}
        </button>

        {error && (
          <p className="mt-3 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
            {error}
          </p>
        )}
      </Card>

      {!isNative && (
        <iframe
          title="The Home Dumbbell Blueprint"
          src={PDF_WEB_PATH}
          className="mt-6 h-[55vh] w-full rounded-2xl border border-white/10"
        />
      )}
    </div>
  );
}
