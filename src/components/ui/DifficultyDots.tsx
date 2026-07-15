export function DifficultyDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i <= level ? 'bg-orange-500' : 'bg-white/15'
          }`}
        />
      ))}
    </div>
  );
}
