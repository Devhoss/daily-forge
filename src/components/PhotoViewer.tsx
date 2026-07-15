import { useRef, useState } from 'react';
import { X, RefreshCw, Trash2 } from 'lucide-react';

export function PhotoViewer({
  url,
  label,
  onClose,
  onReplace,
  onDelete,
}: {
  url: string;
  label: string;
  onClose: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="safe-top flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold capitalize text-white">{label}</p>
        <button onClick={onClose} className="rounded-full bg-white/10 p-2">
          <X size={18} className="text-white" />
        </button>
      </div>

      <div
        className="flex flex-1 items-center justify-center overflow-hidden"
        onClick={() => setZoomed((z) => !z)}
      >
        <img
          src={url}
          alt={label}
          className={
            zoomed
              ? 'max-w-none scale-[1.8] cursor-zoom-out object-contain transition-transform'
              : 'max-h-full max-w-full cursor-zoom-in object-contain transition-transform'
          }
        />
      </div>

      <p className="pb-2 text-center text-[11px] text-slate-500">
        Tap the photo to {zoomed ? 'zoom out' : 'zoom in'}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onReplace(file);
        }}
      />

      <div className="safe-bottom flex gap-2 p-4">
        <button
          onClick={() => inputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 py-3 text-sm font-semibold text-white"
        >
          <RefreshCw size={16} /> Retake / Replace
        </button>
        {confirmingDelete ? (
          <button
            onClick={onDelete}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
          >
            Confirm Delete
          </button>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/15 py-3 text-sm font-semibold text-red-400"
          >
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
