import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ProgressOverview } from '@/pages/progress/Overview';
import { ProgressMeasurements } from '@/pages/progress/Measurements';
import { ProgressPhotos } from '@/pages/progress/Photos';

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
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-2xl font-bold">Progress</h1>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="mt-5 flex gap-2"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              tab === t.key ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:text-slate-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </motion.div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-5"
      >
        {tab === 'overview' && <ProgressOverview />}
        {tab === 'measurements' && <ProgressMeasurements />}
        {tab === 'photos' && <ProgressPhotos />}
      </motion.div>
    </div>
  );
}
