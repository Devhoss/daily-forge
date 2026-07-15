const TIPS: string[] = [
  "The load never changes. Tempo, pauses, and range of motion are how you keep progressing.",
  "A slow 3-second lowering phase turns the same 12 reps into a completely different stimulus.",
  "One arm at a time is not a harder version of an exercise — for this program, it's the actual progression.",
  "RPE below 6 for two sessions in a row is your cue to add a pause or move to the next progression.",
  "Deload weeks aren't optional. Skipping one is the most common way people stall around week 6.",
  "Consistency beats intensity — six imperfect sessions beat one perfect one and five skipped ones.",
  "Sleep is the highest-leverage recovery tool you have, and it's free.",
  "The floor is your depth limiter on the Dumbbell Floor Press — it's what makes it safer than a bench press with no spotter.",
  "Full range of motion at 5kg recruits more muscle fiber than a fast, partial rep ever could.",
];

export function tipOfTheDay(): string {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000
  );
  return TIPS[dayOfYear % TIPS.length];
}
