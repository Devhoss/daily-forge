import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition-transform active:scale-[0.97] disabled:opacity-40',
        size === 'md' && 'py-3 text-sm',
        size === 'lg' && 'py-3.5 text-base',
        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-500',
        variant === 'secondary' && 'bg-white/10 text-white border border-white/15 hover:bg-white/15',
        variant === 'ghost' && 'bg-transparent text-slate-300 hover:text-white',
        className
      )}
      {...props}
    />
  );
}
