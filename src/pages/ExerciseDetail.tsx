import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Play } from "lucide-react";
import { getExercise, resolveIllustrationSrc } from "@/lib/data";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DifficultyDots } from "@/components/ui/DifficultyDots";

export function ExerciseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ex = id ? getExercise(id) : undefined;

  if (!ex) {
    return (
      <div className="p-6 text-white">
        Exercise not found.
        <button onClick={() => navigate(-1)} className="ml-2 text-orange-400">
          Go back
        </button>
      </div>
    );
  }

  const img = resolveIllustrationSrc(ex);

  return (
    <div className="safe-top min-h-screen pb-28">
      <div className="flex items-center gap-3 px-5 pt-6">
        <button onClick={() => navigate(-1)} className="text-slate-400">
          <ChevronLeft size={22} />
        </button>
        <p className="text-xs font-bold uppercase tracking-wide text-blue-400">
          {ex.category} · Exercise Encyclopedia
        </p>
      </div>

      <div className="px-5">
        <div className="mt-2 flex items-start justify-between">
          <h1 className="text-3xl font-extrabold text-white">{ex.name}</h1>
          <DifficultyDots level={ex.difficulty} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {ex.muscles_primary.map((m) => (
            <Chip key={m} variant="accent">
              {m}
            </Chip>
          ))}
          {ex.muscles_secondary.map((m) => (
            <Chip key={m} variant="slate">
              {m}
            </Chip>
          ))}
          {ex.equipment.map((m) => (
            <Chip key={m} variant="emerald">
              {m}
            </Chip>
          ))}
        </div>

        <div className="mt-4 aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-[#101B34] to-[#16213E]">
          {img ? (
            <img
              src={img}
              alt={ex.illustration.alt}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
              Illustration coming soon
            </div>
          )}
        </div>

        <a
          href={ex.video.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-semibold text-white"
        >
          <Play size={16} fill="currentColor" /> Watch Demo
        </a>

        <Section title="Setup">
          <p className="text-sm text-slate-300">{ex.setup}</p>
        </Section>

        <Section title="Execution">
          <ol className="space-y-2">
            {ex.execution.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-300">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Breathing">
          <p className="text-sm text-slate-300">{ex.breathing}</p>
        </Section>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Spec label="Tempo" value={ex.tempo} note={ex.tempo_note} />
          <Spec label="Sets" value={ex.sets} />
          <Spec label="Reps" value={ex.reps} note={ex.reps_note} />
          <Spec label="Rest" value={ex.rest} />
        </div>

        <Section title="Common Mistakes">
          <ul className="list-disc space-y-1 pl-4 text-sm text-red-300/90">
            {ex.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Section>

        <Section title="Pro Tips">
          <ul className="list-disc space-y-1 pl-4 text-sm text-emerald-300/90">
            {ex.pro_tips.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Section>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Card>
            <h4 className="text-sm font-bold text-white">Progressions</h4>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-400">
              {ex.progressions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <h4 className="text-sm font-bold text-white">Regressions</h4>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-400">
              {ex.regressions.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="mt-4 border-yellow-500/30 bg-yellow-500/10">
          <h4 className="text-xs font-bold uppercase text-yellow-400">
            Safety
          </h4>
          <p className="mt-1 text-sm text-yellow-100/90">{ex.safety}</p>
        </Card>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Spec({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
      {note && <p className="mt-1 text-[11px] italic text-slate-500">{note}</p>}
    </div>
  );
}
