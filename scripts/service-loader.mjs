// Module resolver for service tests. Maps the bundler aliases (`@/lib/db`,
// `@/data/*.json`, `@/types`) to real files so `src/services` orchestrators that
// compose `src/lib/*` can run in Node's native TS type-stripping environment.
import { resolve as resolvePath } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolvePath(fileURLToPath(import.meta.url), '..', '..');

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
  const rel = specifier.slice(2);
  const base = resolvePath(repoRoot, 'src', rel);

  const candidates = [
    base + '.ts',
    base + '.tsx',
    base + '.mts',
    resolvePath(base, 'index.ts'),
    resolvePath(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  // Exact file path (e.g. `@/data/exercises.json`).
  try {
    if (statSync(base).isFile()) {
      return { url: pathToFileURL(base).href, shortCircuit: true };
    }
  } catch {
    /* not a file */
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const path = fileURLToPath(url);
  if (path.endsWith('.json')) {
    const source = await readFile(path, 'utf8');
    return { format: 'module', source: `export default ${source};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
