import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'w-full rounded-xl py-3 font-semibold text-sm transition-transform active:scale-[0.98] disabled:opacity-40',
        variant === 'primary' && 'bg-blue-600 text-white',
        variant === 'secondary' && 'bg-white/10 text-white border border-white/15',
        variant === 'ghost' && 'bg-transparent text-slate-300',
        className
      )}
      {...props}
    />
  );
}
