import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  Copy,
  Check,
  Download,
  Eraser,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  getProgramStartDate,
  db,
} from "@/lib/db";
import { getEquipmentProfile } from "@/lib/equipment";
import { Capacitor } from "@capacitor/core";
import { downloadBackup } from "@/lib/backup";
import { saveTextViaDocumentPicker } from "@/lib/documentSave";
import { buildCoachContext } from "@/services/ai/coachContext";
import { askCoach, type AskCoachResult } from "@/services/ai/coachService";
import { getDefaultProvider, providerStatusLabel } from "@/services/ai/aiProvider";
import type { AiDiagnostics, CoachContext, CoachResponse, ProviderStatus } from "@/services/ai/aiTypes";

type BadgeTone = "emerald" | "rose" | "amber" | "blue" | "violet" | "slate";

const BADGE_TONES: Record<BadgeTone, string> = {
  emerald: "bg-emerald-500/15 text-emerald-400",
  rose: "bg-rose-500/15 text-rose-400",
  amber: "bg-amber-500/15 text-amber-400",
  blue: "bg-blue-500/15 text-blue-400",
  violet: "bg-violet-500/15 text-violet-400",
  slate: "bg-white/10 text-slate-400",
};

function Badge({ tone = "slate", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

function statusTone(status: ProviderStatus): BadgeTone {
  switch (status) {
    case "ready": return "emerald";
    case "loading": return "amber";
    case "error": return "rose";
    case "unavailable": return "slate";
    case "idle": return "blue";
  }
}

function confidenceTone(c: CoachResponse["confidence"]): BadgeTone {
  switch (c) {
    case "high": return "emerald";
    case "medium": return "amber";
    case "low": return "slate";
  }
}

function formatFullTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function KeyValue({ k, v, mono }: { k: string; v: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="shrink-0 text-sm text-slate-400">{k}</span>
      <span className={cn("min-w-0 truncate text-right text-sm font-medium text-white", mono && "font-mono text-xs")}>
        {v === null || v === undefined || v === "" ? "—" : String(v)}
      </span>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "How is my recovery today?",
  "What should I work on this week?",
  "Am I ready to push intensity?",
  "How close am I to my next milestone?",
];

export function CoachPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const provider = useMemo(() => getDefaultProvider(), []);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [diag, setDiag] = useState<AiDiagnostics | null>(null);
  const [context, setContext] = useState<CoachContext | null>(null);
  const [contextJson, setContextJson] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [conversation, setConversation] = useState<{ question: string; result: AskCoachResult }[]>([]);

  const refreshDiagnostics = useCallback(() => {
    setDiag(provider.getDiagnostics());
  }, [provider]);

  // Build the deterministic context once on mount (and whenever the app data
  // version bumps) so the prompt is always grounded in fresh facts.
  const loadContext = useCallback(async () => {
    try {
      const startIso = await getProgramStartDate();
      if (!startIso) {
        setError("Start the program first — the coach has no plan to advise on.");
        return;
      }
      const [sessionLogs, setLogs, measurements, equipment] = await Promise.all([
        db.sessionLogs.orderBy("date").toArray(),
        db.setLogs.orderBy("date").toArray(),
        db.measurements.orderBy("week").toArray(),
        getEquipmentProfile(),
      ]);
      const built = buildCoachContext(sessionLogs, setLogs, measurements, {
        startIso,
        asOf: new Date(),
        equipment,
      });
      setContext(built);
      setContextJson(JSON.stringify(built));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext, refreshTick]);

  useEffect(() => {
    refreshDiagnostics();
    return () => {
      // Unload the model when leaving the coach screen — the app stays fully
      // functional with the model out of memory.
      void provider.unload();
    };
  }, [provider, refreshDiagnostics]);

  async function ask(questionText: string) {
    const q = questionText.trim();
    if (!q || asking || !context) return;
    setAsking(true);
    setError(null);
    try {
      const res = await askCoach(context, q, { provider });
      setConversation((c) => [...c, { question: q, result: res }]);
      refreshDiagnostics();
    } catch (e) {
      setError(String(e));
    } finally {
      setAsking(false);
    }
  }

  function handleSend() {
    if (!question.trim()) return;
    void ask(question);
    setQuestion("");
  }

  async function exportDebugSnapshot() {
    const payload = {
      exportedAt: new Date().toISOString(),
      provider: diag,
      context: contextJson ? JSON.parse(contextJson) : null,
      conversation: conversation.map((c) => ({
        question: c.question,
        ok: c.result.ok,
        raw: c.result.raw,
        response: c.result.response,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const filename = `dailyforge-ai-debug-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
      const ok = await saveTextViaDocumentPicker(text, filename);
      showToast(ok ? "AI debug snapshot saved." : "Save cancelled.", { kind: ok ? "success" : "info" });
    } else {
      downloadBackup(text, filename);
      showToast("AI debug snapshot downloaded.", { kind: "success" });
    }
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
        <h1 className="text-xl font-bold text-white">AI Coach</h1>
        <Badge tone="violet">dev</Badge>
      </div>

      <div className="mt-3 px-5">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
          <Shield size={14} className="mt-0.5 shrink-0 text-emerald-500" />
          100% on-device. No network requests, no API keys, no telemetry — your data never leaves this device.
        </p>
      </div>

      {error && (
        <div className="mt-4 px-5">
          <Card>
            <p className="text-sm text-rose-400">{error}</p>
          </Card>
        </div>
      )}

      {!context && !error && (
        <div className="mt-6 px-5">
          <Card>
            <p className="text-sm text-slate-400">Loading your training context…</p>
          </Card>
        </div>
      )}

      {context && (
        <>
          <Card className="mx-5 mt-4">
            <label htmlFor="coach-question" className="mb-1.5 block text-xs font-semibold text-slate-400">
              Ask your coach
            </label>
            <div className="flex gap-2">
              <input
                id="coach-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="How is my recovery today?"
                className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 [color-scheme:dark]"
              />
              <Button onClick={handleSend} disabled={asking || !question.trim()} className="w-auto shrink-0 px-4">
                {asking ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => void ask(q)}
                  disabled={asking}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:border-blue-400/40 hover:text-blue-300 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </Card>

          {conversation.length > 0 && (
            <div className="mt-4 space-y-3 px-5">
              {[...conversation].reverse().map((c, i) => (
                <CoachMessage key={`${c.question}-${i}`} question={c.question} result={c.result} />
              ))}
            </div>
          )}

          <div className="mt-4 px-5">
            <Card>
              <button
                onClick={() => setShowDiag((v) => !v)}
                aria-expanded={showDiag}
                className="flex w-full items-center gap-3 rounded-lg py-1"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                  <Terminal size={18} className="text-violet-400" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-bold text-white">AI Diagnostics</p>
                  <p className="truncate text-xs text-slate-400">
                    {diag ? `${diag.modelName} · ${providerStatusLabel(diag.status)}` : "Runtime status"}
                  </p>
                </div>
                <ChevronDown size={18} className={cn("text-slate-500 transition-transform", showDiag && "rotate-180")} />
              </button>

              {showDiag && diag && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={statusTone(diag.status)}>{providerStatusLabel(diag.status)}</Badge>
                    <Badge tone="blue">{diag.runtime}</Badge>
                  </div>
                  <div className="mt-2">
                    <KeyValue k="Model" v={diag.modelName} />
                    <KeyValue k="Version" v={diag.modelVersion} mono />
                    <KeyValue k="Quantization" v={diag.quantization} mono />
                    <KeyValue k="Backend" v={diag.backend} />
                    <KeyValue k="Provider" v={diag.providerId} mono />
                    <KeyValue k="Loaded" v={diag.loaded ? "yes" : "no"} />
                    <KeyValue k="Load time" v={diag.loadTimeMs != null ? formatMs(diag.loadTimeMs) : null} mono />
                    <KeyValue k="Prompt tokens" v={diag.promptTokens} mono />
                    <KeyValue k="Generated tokens" v={diag.generatedTokens} mono />
                    <KeyValue k="Latency" v={diag.latencyMs != null ? formatMs(diag.latencyMs) : null} mono />
                    <KeyValue k="Last request" v={formatFullTime(diag.lastRequestAt)} />
                    <KeyValue k="Last error" v={diag.lastError} />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" size="md" onClick={() => { void loadContext(); setRefreshTick((t) => t + 1); refreshDiagnostics(); }} className="flex-1">
                      <RefreshCw size={15} /> Refresh
                    </Button>
                    <Button variant="secondary" size="md" onClick={exportDebugSnapshot} className="flex-1">
                      <Download size={15} /> Export AI Debug Snapshot
                    </Button>
                  </div>
                  <button
                    onClick={() => {
                      setConversation([]);
                      showToast("Coach conversation cleared.", { kind: "success" });
                    }}
                    className="mt-3 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-sm font-semibold text-slate-400 transition hover:text-slate-200"
                  >
                    <Eraser size={15} /> Clear conversation
                  </button>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {!context && !error && (
        <div className="mt-6 px-5">
          <Card>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Sparkles size={16} className="text-blue-400" /> Building coach context…
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

function CoachMessage({ question, result }: { question: string; result: AskCoachResult }) {
  const r = result.response;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await copyToClipboard(r.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  }

  return (
    <Card className="border-violet-500/10">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
          <Bot size={16} className="text-violet-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-400">{question}</p>
            <Badge tone={result.ok ? "emerald" : "amber"}>{result.ok ? "parsed" : "fallback"}</Badge>
            <Badge tone={confidenceTone(r.confidence)}>{r.confidence} confidence</Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{r.answer}</p>

          {r.keyPoints.length > 0 && (
            <ul className="mt-3 space-y-1">
              {r.keyPoints.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                  {p}
                </li>
              ))}
            </ul>
          )}

          {r.suggestedAction && (
            <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-blue-400">Suggested next step</p>
              <p className="mt-0.5 text-sm text-blue-200">{r.suggestedAction}</p>
            </div>
          )}

          {r.referencedFacts.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Referenced facts</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.referencedFacts.map((f, i) => (
                  <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {r.limitations.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Limitations</p>
              <ul className="mt-1 list-inside list-disc text-[11px] text-slate-500">
                {r.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          {result.raw && result.raw !== r.answer && (
            <RawResponse raw={result.raw} />
          )}
        </div>
        <button
          onClick={() => void copy()}
          aria-label="Copy answer"
          title="Copy answer"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>
    </Card>
  );
}

function RawResponse({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] font-semibold text-slate-500 transition hover:text-slate-300"
      >
        <MessageSquare size={12} /> {open ? "Hide" : "Show"} raw model response
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="mt-1 overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-slate-400">
          {raw}
        </pre>
      )}
    </div>
  );
}
