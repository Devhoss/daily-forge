#!/usr/bin/env node
/**
 * Syncs shared content from the book project into this app so both stay
 * driven by the exact same data — the app is a different presentation layer
 * for the same data, never a second copy of the content.
 *
 * Usage:
 *   node scripts/sync-data.mjs [path-to-home-dumbbell-blueprint]
 *
 * Defaults to ../home-dumbbell-blueprint (sibling folder) if no path given.
 */
import { existsSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");
const BOOK_ROOT =
  process.argv[2] || join(APP_ROOT, "..", "home-dumbbell-blueprint");

if (!existsSync(BOOK_ROOT)) {
  console.error(`Book project not found at: ${BOOK_ROOT}`);
  console.error(
    "Pass the correct path: node scripts/sync-data.mjs /path/to/home-dumbbell-blueprint",
  );
  process.exit(1);
}

function copyFile(rel, fromRoot, toRoot) {
  const from = join(fromRoot, rel);
  const to = join(toRoot, rel);
  if (!existsSync(from)) {
    console.warn(`  skip (not found): ${rel}`);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`  synced: ${rel}`);
}

console.log(`Syncing data from ${BOOK_ROOT} ...`);

copyFile("data/exercises.json", BOOK_ROOT, join(APP_ROOT, "src"));
copyFile("data/program.json", BOOK_ROOT, join(APP_ROOT, "src"));

const pdfFrom = join(BOOK_ROOT, "export", "The-Home-Dumbbell-Blueprint-A4.pdf");
const pdfTo = join(APP_ROOT, "public", "book", "blueprint.pdf");
if (existsSync(pdfFrom)) {
  mkdirSync(dirname(pdfTo), { recursive: true });
  copyFileSync(pdfFrom, pdfTo);
  console.log(
    "  synced: export/The-Home-Dumbbell-Blueprint-A4.pdf -> public/book/blueprint.pdf",
  );
} else {
  console.warn(
    "  skip (not found): export/The-Home-Dumbbell-Blueprint-A4.pdf (run the book's build.py first)",
  );
}

// Illustrations: copy every PNG referenced in exercises.json
const illusFrom = join(BOOK_ROOT, "assets", "illustrations");
const illusTo = join(APP_ROOT, "public", "illustrations");
if (existsSync(illusFrom)) {
  mkdirSync(illusTo, { recursive: true });
  const files = readdirSync(illusFrom).filter((f) =>
    f.toLowerCase().endsWith(".png"),
  );
  for (const f of files) {
    copyFileSync(join(illusFrom, f), join(illusTo, f));
  }
  console.log(`  synced: ${files.length} illustration PNG(s)`);
} else {
  console.warn("  skip: assets/illustrations not found in book project");
}

console.log("Done. Restart `npm run dev` if it was already running.");
