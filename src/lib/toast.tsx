import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastContextValue {
  showToast: (text: string, opts?: { kind?: ToastKind; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_KIND_STYLES: Record<ToastKind, { icon: ReactNode; className: string }> = {
  info: {
    icon: <Info size={16} className="shrink-0 text-blue-400" />,
    className: "border-blue-500/30 bg-blue-950/90 text-blue-100",
  },
  success: {
    icon: <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />,
    className: "border-emerald-500/30 bg-emerald-950/90 text-emerald-100",
  },
  error: {
    icon: <TriangleAlert size={16} className="shrink-0 text-red-400" />,
    className: "border-red-500/30 bg-red-950/90 text-red-100",
  },
};

const MAX_VISIBLE_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (text: string, opts?: { kind?: ToastKind; durationMs?: number }) => {
      const id = nextId.current++;
      const kind = opts?.kind ?? "info";
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE_TOASTS - 1)), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), opts?.durationMs ?? 2600);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-5">
        <AnimatePresence>
          {toasts.map((t) => {
            const style = TOAST_KIND_STYLES[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "flex max-w-md items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl",
                  style.className,
                )}
                role="status"
              >
                {style.icon}
                <span className="min-w-0">{t.text}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="ml-1 rounded-md p-0.5 opacity-60 transition hover:opacity-100"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
