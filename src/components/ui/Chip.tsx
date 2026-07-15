import { cn } from '@/lib/utils';

type ChipVariant = 'accent' | 'slate' | 'emerald';

const variantClasses: Record<ChipVariant, string> = {
  accent: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  slate: 'bg-white/5 text-slate-300 border-white/10',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

export function Chip({
  children,
  variant = 'slate',
}: {
  children: string;
  variant?: ChipVariant;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold',
        variantClasses[variant]
      )}
    >
      {children}
    </span>
  );
}
