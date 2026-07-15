import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function StatCard({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl bg-white/5 px-3 py-3"
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span
          className={
            accent
              ? "text-xl font-extrabold text-orange-400"
              : "text-xl font-extrabold text-white"
          }
        >
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
    </motion.div>
  );
}
