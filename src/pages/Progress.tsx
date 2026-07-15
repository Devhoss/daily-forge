import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ProgressOverview } from '@/pages/progress/Overview';
import { ProgressMeasurements } from '@/pages/progress/Measurements';
import { ProgressPhotos } from '@/pages/progress/Photos';
import { NotificationCard } from '@/components/NotificationCard';

type Tab = 'overview' | 'measurements' | 'photos';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'photos', label: 'Photos' },
];

export function Progress() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8 text-white">
      <h1 className="text-2xl font-bold">Progress</h1>

      <div className="mt-5 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              tab === t.key ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <ProgressOverview />
          <NotificationCard />
        </>
      )}
      {tab === 'measurements' && <ProgressMeasurements />}
      {tab === 'photos' && <ProgressPhotos />}
    </div>
  );
}
