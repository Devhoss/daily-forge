import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-white/10 bg-[var(--color-bg-raised)] p-4',
        onClick && 'active:scale-[0.98] transition-transform cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}
