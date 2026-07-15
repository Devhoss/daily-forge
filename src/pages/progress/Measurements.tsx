import { useEffect, useRef, useState } from 'react';
import { program } from '@/lib/data';
import {
  getAllMeasurements,
  upsertMeasurement,
  getUnitSystem,
  setUnitSystem,
  type MeasurementEntry,
  type UnitSystem,
} from '@/lib/db';
import {
  weightToDisplay,
  weightToStorage,
  lengthToDisplay,
  lengthToStorage,
  weightUnitLabel,
  lengthUnitLabel,
} from '@/lib/units';
import { todayIso } from '@/lib/programEngine';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type FieldKey = Exclude<keyof MeasurementEntry, 'id' | 'date' | 'week' | 'notes'>;

const WEIGHT_FIELDS: FieldKey[] = ['weight'];

const FIELD_ORDER: { key: FieldKey; label: string }[] = [
  { key: 'weight', label: 'Weight' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'leftArm', label: 'Left Arm' },
  { key: 'rightArm', label: 'Right Arm' },
  { key: 'leftThigh', label: 'Left Thigh' },
  { key: 'rightThigh', label: 'Right Thigh' },
  { key: 'calves', label: 'Calves' },
  { key: 'neck', label: 'Neck' },
];

export function ProgressMeasurements() {
  const [entries, setEntries] = useState<Record<number, MeasurementEntry>>({});
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [units, setUnits] = useState<UnitSystem>('metric');

  async function reload() {
    const all = await getAllMeasurements();
    const byWeek: Record<number, MeasurementEntry> = {};
    for (const e of all) byWeek[e.week] = e;
    setEntries(byWeek);
  }

  useEffect(() => {
    reload();
    getUnitSystem().then(setUnits);
  }, []);

  async function changeUnits(next: UnitSystem) {
    setUnits(next);
    await setUnitSystem(next);
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Card className="flex items-center justify-between p-3">
        <p className="text-sm font-semibold text-white">Units</p>
        <div className="flex gap-1 rounded-full bg-white/5 p-1">
          {(['metric', 'imperial'] as UnitSystem[]).map((u) => (
            <button
              key={u}
              onClick={() => changeUnits(u)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold capitalize',
                units === u ? 'bg-blue-600 text-white' : 'text-slate-400'
              )}
            >
              {u === 'metric' ? 'Metric (cm/kg)' : 'Imperial (in/lb)'}
            </button>
          ))}
        </div>
      </Card>

      {program.progress_checkpoints.map((week) => (
        <Card key={week} className="p-0 overflow-hidden">
          <button
            onClick={() => setOpenWeek(openWeek === week ? null : week)}
            className="flex w-full items-center justify-between p-4"
          >
            <div className="text-left">
              <p className="text-sm font-bold text-white">Week {week} Measurements</p>
              <p className="text-xs text-slate-400">
                {entries[week] ? 'Logged' : 'Not logged yet'}
              </p>
            </div>
            {openWeek === week ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {openWeek === week && (
            <MeasurementForm
              week={week}
              existing={entries[week]}
              units={units}
              onSaved={() => {
                reload();
                setOpenWeek(null);
              }}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

function MeasurementForm({
  week,
  existing,
  units,
  onSaved,
}: {
  week: number;
  existing?: MeasurementEntry;
  units: UnitSystem;
  onSaved: () => void;
}) {
  // Internal state always holds DISPLAY values (converted from metric storage
  // once, on mount) — converted back to metric only at save time.
  const [display, setDisplay] = useState<Partial<Record<FieldKey, number>>>(() => {
    const out: Partial<Record<FieldKey, number>> = {};
    for (const { key } of FIELD_ORDER) {
      const stored = existing?.[key] as number | undefined;
      out[key] = WEIGHT_FIELDS.includes(key)
        ? weightToDisplay(stored, units)
        : lengthToDisplay(stored, units);
    }
    return out;
  });
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const refs = useRef<Record<FieldKey, HTMLInputElement | null>>({} as Record<FieldKey, HTMLInputElement | null>);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  function focusNext(index: number) {
    const next = FIELD_ORDER[index + 1];
    if (next) {
      refs.current[next.key]?.focus();
    } else {
      notesRef.current?.focus();
    }
  }

  async function save() {
    const metricValues: Partial<MeasurementEntry> = {};
    for (const { key } of FIELD_ORDER) {
      const v = display[key];
      if (v === undefined || Number.isNaN(v)) continue;
      (metricValues as Record<string, number>)[key] = WEIGHT_FIELDS.includes(key)
        ? weightToStorage(v, units)
        : lengthToStorage(v, units);
    }
    await upsertMeasurement({
      ...metricValues,
      week,
      date: existing?.date ?? todayIso(),
      notes,
    } as MeasurementEntry);
    onSaved();
  }

  return (
    <div className="border-t border-white/10 p-4">
      <div className="grid grid-cols-2 gap-3">
        {FIELD_ORDER.map(({ key, label }, index) => {
          const unitLabel = WEIGHT_FIELDS.includes(key)
            ? weightUnitLabel(units)
            : lengthUnitLabel(units);
          return (
            <label key={key} className="text-xs text-slate-400">
              {label}{' '}
              <span className="text-slate-600">({unitLabel})</span>
              <input
                ref={(el) => { refs.current[key] = el; }}
                type="number"
                inputMode="decimal"
                step="0.1"
                enterKeyHint={index === FIELD_ORDER.length - 1 ? 'done' : 'next'}
                value={display[key] ?? ''}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (index === FIELD_ORDER.length - 1) {
                      save();
                    } else {
                      focusNext(index);
                    }
                  }
                }}
                onChange={(e) =>
                  setDisplay((v) => ({
                    ...v,
                    [key]: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-white"
              />
            </label>
          );
        })}
      </div>
      <label className="mt-3 block text-xs text-slate-400">
        Notes
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onFocus={(e) =>
            e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
          rows={2}
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-white"
        />
      </label>
      <Button className="mt-3" onClick={save}>
        Save Week {week}
      </Button>
    </div>
  );
}
