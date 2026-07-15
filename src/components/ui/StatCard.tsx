import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function StatCard({
  label,
  value,
  icon,
  accent = false,
  delay = 0,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="rounded-xl bg-white/5 px-3.5 py-3"
    >
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className="shrink-0">{icon}</span>
        )}
        <span
          className={
            accent
              ? "text-xl font-extrabold tabular-nums text-orange-400"
              : "text-xl font-extrabold tabular-nums text-white"
          }
        >
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
    </motion.div>
  );
}
