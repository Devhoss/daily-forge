import { NavLink } from 'react-router-dom';
import { Home, Dumbbell, BookOpen, LineChart, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/library', label: 'Exercises', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: LineChart },
  { to: '/book', label: 'Book', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[var(--color-bg)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-200',
                isActive ? 'text-orange-400' : 'text-slate-400'
              )
            }
          >
            {({ isActive }) => (
              <>
                <div
                  className={cn(
                    'absolute -top-px left-4 right-4 h-0.5 rounded-full bg-orange-400 transition-all duration-200',
                    isActive ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
                  )}
                />
                <div
                  className={cn(
                    'transition-transform duration-200',
                    isActive ? '-translate-y-0.5' : 'translate-y-0'
                  )}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
