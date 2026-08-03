import { useEffect, useRef, useState } from 'react';
import { program } from '@/lib/data';
import { getPhotosForWeek, upsertPhoto, deletePhoto, type PhotoEntry } from '@/lib/db';
import { todayIso } from '@/lib/programEngine';
import { Card } from '@/components/ui/Card';
import { PhotoViewer } from '@/components/PhotoViewer';
import { takeProgressPhoto, saveBlobToGallery, shareBlob } from '@/lib/photoGallery';
import { useSettings } from '@/lib/SettingsContext';
import { Camera, ImagePlus } from 'lucide-react';

type Angle = 'front' | 'side' | 'back';
const ANGLES: Angle[] = ['front', 'side', 'back'];
type PhotoSource = 'camera' | 'gallery';

export function ProgressPhotos() {
  const { savePhotosToGallery } = useSettings();
  const [photosByWeek, setPhotosByWeek] = useState<Record<number, Partial<Record<Angle, PhotoEntry>>>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<{ week: number; angle: Angle } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function storePhoto(week: number, angle: Angle, blob: Blob, source: PhotoSource, exportedToGallery: boolean) {
    await upsertPhoto({
      week,
      angle,
      date: todayIso(),
      blob,
      source,
      exportedToGallery,
    });
    await reload();
  }

  /** Camera capture: save a copy to the gallery when the setting is on. */
  async function handleCameraCapture(week: number, angle: Angle, blob: Blob, savedInGallery: boolean) {
    let exported = savedInGallery;
    if (savePhotosToGallery && !exported) {
      exported = await saveBlobToGallery(blob);
    }
    await storePhoto(week, angle, blob, 'camera', exported);
  }

  /** Gallery pick: the original already exists in the gallery, so never duplicate it. */
  async function handleGalleryPick(week: number, angle: Angle, file: File) {
    await storePhoto(week, angle, file, 'gallery', true);
  }

  async function takePhoto(week: number, angle: Angle) {
    setBusy('camera');
    try {
      const cap = await takeProgressPhoto(savePhotosToGallery);
      await handleCameraCapture(week, angle, cap.blob, cap.savedToGallery);
    } catch (err) {
      console.warn('Capture failed:', err);
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveToGallery(week: number, angle: Angle) {
    const photo = photosByWeek[week]?.[angle];
    if (!photo) return;
    setBusy('save');
    try {
      const ok = await saveBlobToGallery(photo.blob);
      if (ok) {
        await upsertPhoto({ ...photo, exportedToGallery: true });
        await reload();
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleShare(week: number, angle: Angle) {
    const photo = photosByWeek[week]?.[angle];
    if (!photo) return;
    setBusy('share');
    try {
      await shareBlob(photo.blob);
    } finally {
      setBusy(null);
    }
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

  const viewingPhoto = viewing ? photosByWeek[viewing.week]?.[viewing.angle] : undefined;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {busy && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/70">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-blue-400" />
          <p className="text-sm font-semibold text-slate-200">
            {busy === 'camera' ? 'Opening camera\u2026' : busy === 'save' ? 'Saving to gallery\u2026' : 'Sharing\u2026'}
          </p>
        </div>
      )}

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
                onTakePhoto={() => takePhoto(week, angle)}
                onGalleryPick={(file) => handleGalleryPick(week, angle, file)}
                onView={() => setViewing({ week, angle })}
              />
            ))}
          </div>
        </Card>
      ))}

      {viewing && viewingPhoto && urls[`${viewing.week}-${viewing.angle}`] && (
        <PhotoViewer
          url={urls[`${viewing.week}-${viewing.angle}`]}
          label={`Week ${viewing.week} · ${viewing.angle}`}
          exportedToGallery={viewingPhoto.exportedToGallery}
          onClose={() => setViewing(null)}
          onRetake={() => {
            const { week, angle } = viewing;
            takePhoto(week, angle);
            setViewing(null);
          }}
          onReplaceGallery={(file) => {
            const { week, angle } = viewing;
            handleGalleryPick(week, angle, file);
            setViewing(null);
          }}
          onShare={() => handleShare(viewing.week, viewing.angle)}
          onSaveToGallery={() => handleSaveToGallery(viewing.week, viewing.angle)}
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
  onTakePhoto,
  onGalleryPick,
  onView,
}: {
  label: string;
  url?: string;
  onTakePhoto: () => void;
  onGalleryPick: (file: File) => void;
  onView: () => void;
}) {
  const galleryRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex aspect-[3/4] flex-col items-stretch overflow-hidden rounded-xl border border-dashed border-white/20 bg-white/5">
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onGalleryPick(file);
        }}
      />
      {url ? (
        <button onClick={onView} className="flex-1 overflow-hidden">
          <img src={url} className="h-full w-full object-cover" alt={label} />
        </button>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-3">
          <span className="text-[10px] font-medium capitalize text-slate-500">{label}</span>
          <button
            onClick={onTakePhoto}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 py-2 text-[11px] font-semibold text-slate-200 transition active:scale-[0.97]"
          >
            <Camera size={14} /> Take Photo
          </button>
          <button
            onClick={() => galleryRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-[11px] font-semibold text-slate-400 transition active:scale-[0.97]"
          >
            <ImagePlus size={14} /> Gallery
          </button>
        </div>
      )}
    </div>
  );
}