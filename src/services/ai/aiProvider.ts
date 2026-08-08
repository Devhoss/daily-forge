/**
 * AIProvider registry — the single place that knows which `AiProvider`
 * implementations exist and which one is the default. The rest of the app
 * depends only on the `AiProvider` interface (aiTypes.ts), never on a concrete
 * runtime, so swapping or adding a provider (local Gemma today; others later)
 * is a one-line change here.
 */
import type { AiProvider, ProviderStatus } from './aiTypes.ts';
import { localGemmaProvider } from './localGemmaProvider.ts';

/** All registered providers, in preference order. */
export const providers: readonly AiProvider[] = [localGemmaProvider];

/** The default provider for coach requests. */
export function getDefaultProvider(): AiProvider {
  return providers[0];
}

/** Find a provider by id, falling back to the default. */
export function resolveProvider(id?: string): AiProvider {
  if (!id) return getDefaultProvider();
  return providers.find((p) => p.id === id) ?? getDefaultProvider();
}

/** Human label for the current provider status (diagnostics panel). */
export function providerStatusLabel(status: ProviderStatus): string {
  switch (status) {
    case 'unavailable': return 'Unavailable';
    case 'idle': return 'Idle';
    case 'loading': return 'Loading…';
    case 'ready': return 'Ready';
    case 'error': return 'Error';
  }
}
