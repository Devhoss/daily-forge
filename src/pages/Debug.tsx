import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Braces,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Database,
  Download,
  Eraser,
  HeartPulse,
  Lightbulb,
  RefreshCw,
  Search,
  X,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  exportSnapshot,
  installDebugInterface,
  type DebugSnapshot,
} from "@/lib/debug";
import type { RecoveryFactorTrace } from "@/services/recovery/recoveryScore";
import type { CoachedNotification } from "@/services/notifications/notificationEngine";
import type { Recommendation } from "@/services/recommendations/recommendationEngine";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface DebugPageData {
  snapshot: DebugSnapshot | null;
  error: string | null;
}

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

function levelTone(level: string): BadgeTone {
  switch (level) {
    case "fresh":
      return "emerald";
    case "ready":
      return "blue";
    case "tired":
      return "amber";
    case "overtraining_risk":
      return "rose";
    default:
      return "slate";
  }
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return iso;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      showToast(`${label} copied.`, { kind: "success" });
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.warn(err);
      showToast("Copy failed.", { kind: "error" });
    }
  }, [text, label, showToast]);

  return (
    <button
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
    >
      {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
    </button>
  );
}

function KeyValue({ k, v, mono }: { k: string; v: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="shrink-0 text-sm text-slate-400">{k}</span>
      <span className={cn("min-w-0 truncate text-right text-sm font-medium text-white", mono && "font-mono text-xs")}>
        {v === null || v === undefined ? "—" : String(v)}
      </span>
    </div>
  );
}

function DebugSection({
  id,
  icon,
  title,
  subtitle,
  open,
  onToggle,
  copyText,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  copyText?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <Card className="mt-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">{title}</p>
            {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
          </div>
          {copyText && <CopyButton text={copyText} label={title} />}
          <button
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Collapse section" : "Expand section"}
            className="rounded-lg p-1 text-slate-500 transition hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            <ChevronDown size={18} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        </div>
        {open && <div className="mt-3 border-t border-white/10 pt-3">{children}</div>}
      </Card>
    </div>
  );
}

function FactorRow({ trace }: { trace: RecoveryFactorTrace }) {
  const present = trace.factor !== null;
  const dir = trace.factor?.direction;
  const impact = trace.factor?.impact;
  return (
    <div className="border-b border-white/5 py-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-white">{trace.key}</span>
        {!present ? (
          <Badge tone="slate">no data</Badge>
        ) : (
          <Badge
            tone={
              impact != null && impact > 0
                ? "emerald"
                : impact != null && impact < 0
                  ? "rose"
                  : "slate"
            }
          >
            {dir ?? ""} {impact != null && impact > 0 ? `+${impact}` : impact}
          </Badge>
        )}
      </div>
      {present && trace.factor && (
        <p className="mt-1 text-xs text-slate-400">{trace.factor.detail}</p>
      )}
      <pre className="mt-1 overflow-x-auto rounded-md bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-slate-500">
        {JSON.stringify(trace.raw)}
      </pre>
    </div>
  );
}

function NotificationCardView({ n }: { n: CoachedNotification }) {
  return (
    <div className="border-b border-white/5 py-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-white">{n.title}</span>
        <Badge tone="blue">{n.category}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-400">{n.body}</p>
      <p className="mt-1 text-xs text-slate-500">
        scheduledFor {n.scheduledFor} · importance {n.importance}
      </p>
      {n.reason.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-slate-500">
          {n.reason.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecRow({ r }: { r: Recommendation }) {
  return (
    <div className="border-b border-white/5 py-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-white">{r.title}</span>
        <Badge tone="amber">{r.importance}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-300">{r.decision}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{r.source} · priority {r.priority.toFixed(2)}</p>
    </div>
  );
}

function JsonBlock({ label, data }: { label?: string; data: unknown }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div>
      {label && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
          <CopyButton text={text} label={label} />
        </div>
      )}
      <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-slate-400">
        {text}
      </pre>
    </div>
  );
}

export function DebugPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [data, setData] = useState<DebugPageData>({ snapshot: null, error: null });
  const [saving, setSaving] = useState(false);
  const [traceQuery, setTraceQuery] = useState("");
  const [openState, setOpenState] = useState<Record<string, boolean>>({
    app: true,
    recovery: true,
    recommendations: true,
    coach: true,
    notifications: true,
    latest: true,
    traces: true,
    raw: false,
  });

  const refresh = useCallback(async () => {
    try {
      installDebugInterface();
      const snapshot = await exportSnapshot();
      setData({ snapshot, error: null });
    } catch (e) {
      setData({ snapshot: null, error: String(e) });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    setOpenState((s) => (hash in s ? { ...s, [hash]: true } : s));
    const timer = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const toggleSection = useCallback((id: string) => {
    setOpenState((s) => ({ ...s, [id]: !s[id] }));
  }, []);

  const saveFile = async () => {
    setSaving(true);
    try {
      installDebugInterface();
      const res = await window.dailyforgeDebug?.saveSnapshotToFile();
      if (res?.ok) {
        showToast(`Snapshot saved — ${res.filename}`, { kind: "success" });
      } else {
        showToast("Save cancelled.");
      }
    } catch (e) {
      console.warn(e);
      showToast(`Save failed: ${String(e)}`, { kind: "error" });
    }
    setSaving(false);
  };

  const clearTraces = () => {
    installDebugInterface();
    window.dailyforgeDebug?.clearRecoveryDebugTraces();
    showToast("Trace history cleared.", { kind: "success" });
    refresh();
  };

  const s = data.snapshot;

  const visibleTraces = useMemo(() => {
    if (!s) return [];
    const reversed = [...s.recoveryTraces].reverse();
    const q = traceQuery.trim().toLowerCase();
    if (!q) return reversed;
    return reversed.filter(
      (t) =>
        t.at.toLowerCase().includes(q) ||
        `${t.output.score}/100 ${t.output.level}`.toLowerCase().includes(q) ||
        t.factors.some((f) => f.key.toLowerCase().includes(q)),
    );
  }, [s, traceQuery]);

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
        <h1 className="text-xl font-bold text-white">Debug Console</h1>
        <Badge tone="violet">dev</Badge>
      </div>

      {data.error ? (
        <div className="mt-6 px-5">
          <Card>
            <p className="text-sm text-rose-400">Failed to load snapshot</p>
            <pre className="mt-2 overflow-x-auto font-mono text-xs text-slate-400">{data.error}</pre>
          </Card>
        </div>
      ) : !s ? (
        <div className="mt-6 px-5">
          <Card>
            <p className="text-sm text-slate-400">Loading live debug snapshot…</p>
          </Card>
        </div>
      ) : (
        <>
          <Card className="mx-5 mt-6">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={refresh} className="flex-1">
                <RefreshCw size={16} /> Refresh
              </Button>
              <Button onClick={saveFile} disabled={saving} className="flex-1">
                <Download size={16} /> {saving ? "Saving…" : "Export JSON"}
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Snapshot at {formatFullTime(s.exportedAt)} · {s.db.sessionLogCount} sessions ·{" "}
              {s.db.setLogCount} sets
            </p>
          </Card>

          <DebugSection
            id="app"
            icon={<Bug size={18} className="text-blue-400" />}
            title="App"
            subtitle="Version, build & data footprint"
            open={openState.app}
            onToggle={() => toggleSection("app")}
            copyText={JSON.stringify({ app: s.app, dataVersion: s.dataVersion, config: s.config, db: s.db }, null, 2)}
          >
            <KeyValue k="Version" v={`${s.app.version} (${s.app.phase})`} />
            <KeyValue k="Build" v={s.app.phase} />
            <KeyValue k="Data version" v={s.dataVersion} mono />
            <KeyValue k="Program start" v={s.config.startIso} mono />
            <KeyValue k="Reminder time" v={s.config.reminderTime} mono />
            <div className="mt-2 border-t border-white/10 pt-2">
              <KeyValue k="Session logs" v={s.db.sessionLogCount} mono />
              <KeyValue k="Set logs" v={s.db.setLogCount} mono />
              <KeyValue k="Measurements" v={s.db.measurementCount} mono />
            </div>
          </DebugSection>

          <DebugSection
            id="recovery"
            icon={<HeartPulse size={18} className="text-blue-400" />}
            title="Recovery"
            subtitle="Current readiness analysis"
            open={openState.recovery}
            onToggle={() => toggleSection("recovery")}
            copyText={JSON.stringify(s.recovery, null, 2)}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-3xl font-bold text-white">
                  {s.recovery.score}
                  <span className="text-lg text-slate-500">/100</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={levelTone(s.recovery.level)}>{s.recovery.level}</Badge>
                  <Badge
                    tone={s.recovery.confidence === "high" ? "emerald" : s.recovery.confidence === "medium" ? "amber" : "slate"}
                  >
                    {s.recovery.confidence} confidence
                  </Badge>
                </div>
              </div>
              <div className="text-right text-xs">
                <KeyValue k="today included" v={String(s.recoveryTraces.at(-1)?.inputs.todayCompletedIncluded ?? false)} />
                <KeyValue k="asOf" v={s.config.asOfIso.slice(0, 10)} />
                <KeyValue k="traces kept" v={s.recoveryTraces.length} />
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">{s.recovery.explanation}</p>
            <p className="mt-1 text-sm text-slate-400">{s.recovery.recommendation}</p>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Factor breakdown (latest run)
            </p>
            <div className="mt-2">
              {s.recoveryTraces.length === 0 ? (
                <p className="text-sm text-slate-500">No recovery computation captured yet in this session.</p>
              ) : (
                (s.recoveryTraces.at(-1)?.factors ?? []).map((f) => <FactorRow key={f.key} trace={f} />)
              )}
            </div>
          </DebugSection>

          <DebugSection
            id="recommendations"
            icon={<Lightbulb size={18} className="text-amber-400" />}
            title="Recommendations"
            subtitle="Recommendation engine output"
            open={openState.recommendations}
            onToggle={() => toggleSection("recommendations")}
            copyText={JSON.stringify(s.recommendations, null, 2)}
          >
            {s.recommendations.length === 0 ? (
              <p className="text-sm text-slate-500">No recommendations.</p>
            ) : (
              s.recommendations.map((r) => <RecRow key={r.id} r={r} />)
            )}
          </DebugSection>

          <DebugSection
            id="coach"
            icon={<Zap size={18} className="text-violet-400" />}
            title="Coach Summary"
            subtitle="Current coach paragraph"
            open={openState.coach}
            onToggle={() => toggleSection("coach")}
            copyText={s.coachSummary.paragraph}
          >
            <p className="text-sm text-slate-300">
              {s.coachSummary.paragraph || "No coach summary (no program started)."}
            </p>
          </DebugSection>

          <DebugSection
            id="notifications"
            icon={<Bell size={18} className="text-blue-400" />}
            title="Notifications"
            subtitle="Today's coached payload"
            open={openState.notifications}
            onToggle={() => toggleSection("notifications")}
            copyText={JSON.stringify(s.notification, null, 2)}
          >
            <KeyValue k="Pending OS notifications" v={s.notification.pendingCount} mono />
            {s.notification.payload.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No coached notification today.</p>
            ) : (
              s.notification.payload.map((n, i) => <NotificationCardView key={i} n={n} />)
            )}
          </DebugSection>

          <DebugSection
            id="latest"
            icon={<Database size={18} className="text-emerald-400" />}
            title="Latest Session & Set Logs"
            subtitle="Most recent logged entries"
            open={openState.latest}
            onToggle={() => toggleSection("latest")}
            copyText={JSON.stringify({ sessionLog: s.latestSessionLog, setLog: s.latestSetLog }, null, 2)}
          >
            <JsonBlock label="Session log" data={s.latestSessionLog} />
            <div className="mt-3" />
            <JsonBlock label="Set log" data={s.latestSetLog} />
          </DebugSection>

          <DebugSection
            id="traces"
            icon={<RefreshCw size={18} className="text-slate-300" />}
            title="Recent Recovery Traces"
            subtitle={`${s.recoveryTraces.length} computations kept in this session`}
            open={openState.traces}
            onToggle={() => toggleSection("traces")}
            copyText={JSON.stringify(s.recoveryTraces, null, 2)}
          >
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
                <input
                  value={traceQuery}
                  onChange={(e) => setTraceQuery(e.target.value)}
                  placeholder="Filter by factor, level or time…"
                  className="w-full rounded-lg border border-white/10 bg-slate-900/70 py-2 pr-8 pl-8 text-xs text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 [color-scheme:dark]"
                />
                {traceQuery && (
                  <button
                    onClick={() => setTraceQuery("")}
                    aria-label="Clear filter"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-0.5 text-slate-500 transition hover:text-slate-300"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                onClick={clearTraces}
                aria-label="Clear trace history"
                title="Clear trace history"
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-slate-200"
              >
                <Eraser size={16} />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {visibleTraces.length} of {s.recoveryTraces.length} traces
            </p>

            <div className="mt-1">
              {s.recoveryTraces.length === 0 ? (
                <p className="text-sm text-slate-500">No recovery computations captured yet in this session.</p>
              ) : visibleTraces.length === 0 ? (
                <p className="text-sm text-slate-500">No traces match “{traceQuery}”.</p>
              ) : (
                visibleTraces.map((t, i) => (
                  <div key={t.at} className="border-b border-white/5 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-400">
                        {i === 0 ? "latest" : `${s.recoveryTraces.length - 1 - i} runs ago`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={levelTone(t.output.level)}>{t.output.level}</Badge>
                        <span className="text-xs font-semibold text-white">{t.output.score}/100</span>
                      </div>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-slate-500" title={formatFullTime(t.at)}>
                      {formatRelative(t.at)} · today included: {String(t.inputs.todayCompletedIncluded)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.factors.map((f) => (
                        <span
                          key={f.key}
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono text-[10px]",
                            f.factor == null
                              ? "bg-white/5 text-slate-500"
                              : (f.factor.impact ?? 0) > 0
                                ? "bg-emerald-500/10 text-emerald-400"
                                : (f.factor.impact ?? 0) < 0
                                  ? "bg-rose-500/10 text-rose-400"
                                  : "bg-white/5 text-slate-400",
                          )}
                        >
                          {f.key}:{f.factor?.impact ?? "n/a"}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </DebugSection>

          <DebugSection
            id="raw"
            icon={<Braces size={18} className="text-slate-400" />}
            title="Raw Snapshot"
            subtitle="Full live snapshot as JSON"
            open={openState.raw}
            onToggle={() => toggleSection("raw")}
            copyText={JSON.stringify(s, null, 2)}
          >
            <JsonBlock data={s} />
          </DebugSection>
        </>
      )}
    </div>
  );
}
