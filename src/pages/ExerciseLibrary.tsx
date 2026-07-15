import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getAllCategories, getExercisesByCategory, resolveIllustrationSrc, isPortraitExercise } from '@/lib/data';
import type { ExerciseCategory } from '@/types';
import { Card } from '@/components/ui/Card';
import { DifficultyDots } from '@/components/ui/DifficultyDots';
import { cn } from '@/lib/utils';

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export function ExerciseLibrary() {
  const navigate = useNavigate();
  const categories = getAllCategories();
  const [active, setActive] = useState<ExerciseCategory>(categories[0]);
  const exercises = getExercisesByCategory(active);

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8">
      <h1 className="text-2xl font-bold text-white">Exercises</h1>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
              active === cat ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400 hover:text-slate-300'
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <motion.div
        key={active}
        variants={container}
        initial="hidden"
        animate="show"
        className="mt-8 grid grid-cols-2 gap-3"
      >
        {exercises.map((ex) => {
          const img = resolveIllustrationSrc(ex);
          const portrait = isPortraitExercise(ex);
          return (
            <motion.div key={ex.id} variants={item} className="h-full">
              <Card onClick={() => navigate(`/exercise/${ex.id}`)} className="p-0 overflow-hidden">
                <div className={cn('aspect-[4/3]', portrait ? 'relative overflow-hidden bg-[#0d1528]' : 'bg-gradient-to-br from-[#101B34] to-[#16213E]')}>
                  {img ? (
                    portrait ? (
                      <>
                        <img src={img} alt="" className="absolute inset-0 h-full w-full scale-[2] object-cover blur-3xl opacity-30" />
                        <img src={img} alt={ex.illustration.alt} className="relative h-full w-full object-contain" />
                      </>
                    ) : (
                      <img src={img} alt={ex.illustration.alt} className="h-full w-full object-contain" />
                    )
                  ) : (
                    <span className="flex aspect-[4/3] items-center justify-center px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {ex.name}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold leading-snug text-white line-clamp-2">{ex.name}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">{ex.muscles_primary[0]}</span>
                    <DifficultyDots level={ex.difficulty} />
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
