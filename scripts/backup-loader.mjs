import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolvePath(fileURLToPath(import.meta.url), '..', '..');
const stubUrl = pathToFileURL(resolvePath(repoRoot, 'scripts', 'backup-db-stub.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
  const rel = specifier.slice(2);
  if (rel === 'lib/db') return { url: stubUrl, shortCircuit: true };
  const url = pathToFileURL(resolvePath(repoRoot, 'src', rel) + '.ts').href;
  return { url, shortCircuit: true };
}