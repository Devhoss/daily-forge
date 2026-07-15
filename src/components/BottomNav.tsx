import { NavLink } from 'react-router-dom';
import { Home, Dumbbell, BookOpen, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/library', label: 'Library', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: LineChart },
  { to: '/book', label: 'Book', icon: BookOpen },
];

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[var(--color-bg)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium',
                isActive ? 'text-orange-400' : 'text-slate-400'
              )
            }
          >
            <Icon size={20} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
