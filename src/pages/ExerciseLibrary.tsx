import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllCategories, getExercisesByCategory, resolveIllustrationSrc } from '@/lib/data';
import type { ExerciseCategory } from '@/types';
import { Card } from '@/components/ui/Card';
import { DifficultyDots } from '@/components/ui/DifficultyDots';
import { cn } from '@/lib/utils';

export function ExerciseLibrary() {
  const navigate = useNavigate();
  const categories = getAllCategories();
  const [active, setActive] = useState<ExerciseCategory>(categories[0]);
  const exercises = getExercisesByCategory(active);

  return (
    <div className="safe-top min-h-screen px-5 pb-28 pt-8">
      <h1 className="text-2xl font-bold text-white">Exercise Library</h1>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-semibold',
              active === cat ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {exercises.map((ex) => {
          const img = resolveIllustrationSrc(ex);
          return (
            <Card key={ex.id} onClick={() => navigate(`/exercise/${ex.id}`)} className="p-0 overflow-hidden">
              <div className="flex h-28 items-center justify-center bg-gradient-to-br from-[#101B34] to-[#16213E]">
                {img ? (
                  <img src={img} alt={ex.illustration.alt} className="h-full w-full object-contain" />
                ) : (
                  <span className="px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {ex.name}
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-white leading-tight">{ex.name}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{ex.muscles_primary[0]}</span>
                  <DifficultyDots level={ex.difficulty} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
