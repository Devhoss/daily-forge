import { useEffect, useRef, useState } from 'react';
import { program } from '@/lib/data';
import { getPhotosForWeek, upsertPhoto, deletePhoto, type PhotoEntry } from '@/lib/db';
import { todayIso } from '@/lib/programEngine';
import { Card } from '@/components/ui/Card';
import { PhotoViewer } from '@/components/PhotoViewer';
import { Camera } from 'lucide-react';

type Angle = 'front' | 'side' | 'back';
const ANGLES: Angle[] = ['front', 'side', 'back'];

export function ProgressPhotos() {
  const [photosByWeek, setPhotosByWeek] = useState<Record<number, Partial<Record<Angle, PhotoEntry>>>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<{ week: number; angle: Angle } | null>(null);

  async function reload() {
    const byWeek: Record<number, Partial<Record<Angle, PhotoEntry>>> = {};
    const newUrls: Record<string, string> = {};
    for (const week of program.progress_checkpoints) {
      const photos = await getPhotosForWeek(week);
      byWeek[week] = {};
      for (const p of photos) {
        byWeek[week][p.angle] = p;
        newUrls[`${week}-${p.angle}`] = URL.createObjectURL(p.blob);
      }
    }
    setPhotosByWeek(byWeek);
    setUrls(newUrls);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCapture(week: number, angle: Angle, file: File) {
    await upsertPhoto({ week, angle, date: todayIso(), blob: file });
    await reload();
  }

  async function handleDelete(week: number, angle: Angle) {
    const existing = photosByWeek[week]?.[angle];
    if (existing?.id) await deletePhoto(existing.id);
    setViewing(null);
    await reload();
  }

  const weeksWithPhotos = program.progress_checkpoints.filter(
    (w) => Object.keys(photosByWeek[w] ?? {}).length > 0
  );
  const compareFrom = weeksWithPhotos[0];
  const compareTo = weeksWithPhotos[weeksWithPhotos.length - 1];
  const canCompare = compareFrom !== undefined && compareFrom !== compareTo;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {canCompare && (
        <Card>
          <h3 className="text-sm font-bold text-white">
            Week {compareFrom} vs Week {compareTo}
          </h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {ANGLES.map((angle) => (
              <div key={angle} className="flex flex-col gap-1">
                <p className="text-center text-[10px] uppercase text-slate-500">{angle}</p>
                <div className="grid grid-cols-2 gap-1">
                  <PhotoThumb url={urls[`${compareFrom}-${angle}`]} />
                  <PhotoThumb url={urls[`${compareTo}-${angle}`]} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {program.progress_checkpoints.map((week) => (
        <Card key={week}>
          <p className="text-sm font-bold text-white">Week {week} Progress Photos</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {ANGLES.map((angle) => (
              <CaptureSlot
                key={angle}
                label={angle}
                url={urls[`${week}-${angle}`]}
                onCapture={(file) => handleCapture(week, angle, file)}
                onView={() => setViewing({ week, angle })}
              />
            ))}
          </div>
        </Card>
      ))}

      {viewing && urls[`${viewing.week}-${viewing.angle}`] && (
        <PhotoViewer
          url={urls[`${viewing.week}-${viewing.angle}`]}
          label={`Week ${viewing.week} · ${viewing.angle}`}
          onClose={() => setViewing(null)}
          onReplace={(file) => {
            handleCapture(viewing.week, viewing.angle, file);
            setViewing(null);
          }}
          onDelete={() => handleDelete(viewing.week, viewing.angle)}
        />
      )}
    </div>
  );
}

function PhotoThumb({ url }: { url?: string }) {
  return (
    <div className="aspect-[3/4] overflow-hidden rounded-lg bg-white/5">
      {url && <img src={url} className="h-full w-full object-cover" alt="" />}
    </div>
  );
}

function CaptureSlot({
  label,
  url,
  onCapture,
  onView,
}: {
  label: string;
  url?: string;
  onCapture: (file: File) => void;
  onView: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      onClick={() => (url ? onView() : inputRef.current?.click())}
      className="flex aspect-[3/4] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-white/20 bg-white/5"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onCapture(file);
        }}
      />
      {url ? (
        <img src={url} className="h-full w-full object-cover" alt={label} />
      ) : (
        <>
          <Camera size={18} className="text-slate-500" />
          <span className="text-[10px] capitalize text-slate-500">{label}</span>
        </>
      )}
    </button>
  );
}
