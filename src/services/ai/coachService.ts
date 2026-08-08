/**
 * CoachService — orchestrates a single "ask your coach" request.
 *
 * Pipeline (all deterministic inputs, one provider call):
 *   deterministic CoachContext → system + user prompt → provider.generate →
 *   parseCoachResponse → validated CoachResponse (+ raw text + diagnostics).
 *
 * Failure modes are first-class: an unavailable provider, a load failure, or
 * an unparseable reply all produce a *structured* CoachResponse with a clear
 * limitation instead of a thrown error, so the UI can always render something
 * honest. `provider` is injected (tests use a fake); the default is the local
 * Gemma provider.
 */
import type { AiProvider, AiDiagnostics, CoachContext, CoachResponse, ProviderStatus } from './aiTypes.ts';
import { buildSystemPrompt, buildUserPrompt } from './coachPrompt.ts';
import { parseCoachResponse } from './responseParser.ts';
import { getDefaultProvider } from './aiProvider.ts';

export interface AskCoachOptions {
  provider?: AiProvider;
}

export interface AskCoachResult {
  ok: boolean;
  /** True when the generation was user-cancelled (the response explains so). */
  cancelled?: boolean;
  response: CoachResponse;
  raw: string;
  diagnostics: AiDiagnostics;
}

function unavailableResponse(reason: string): CoachResponse {
  return {
    answer:
      "The on-device AI coach isn't available on this device right now. " +
      'DailyForge is fully functional without it — your recovery, recommendations, and program are all computed on-device regardless.',
    keyPoints: [
      'The AI coach needs the on-device model runtime, which is not available here.',
      'All your training data and analysis stays on this device and is unaffected.',
    ],
    referencedFacts: [],
    suggestedAction: null,
    confidence: 'low',
    limitations: [`AI coach unavailable: ${reason}.`],
  };
}

/**
 * Ask the coach a question grounded in the given deterministic context.
 * Returns a structured result; callers should render `response` and may show
 * `raw` / `diagnostics` in the Developer Mode panel.
 */
export async function askCoach(
  context: CoachContext,
  question: string,
  options: AskCoachOptions = {},
): Promise<AskCoachResult> {
  const provider = options.provider ?? getDefaultProvider();

  let available = false;
  try {
    available = await provider.isAvailable();
  } catch {
    available = false;
  }

  if (!available) {
    return {
      ok: false,
      response: unavailableResponse('provider reported unavailable'),
      raw: '',
      diagnostics: provider.getDiagnostics(),
    };
  }

  // Load (idempotent) if not already ready. Load failures degrade to the
  // structured fallback rather than throwing to the UI.
  try {
    const status: ProviderStatus = provider.getStatus();
    if (status !== 'ready' && status !== 'loading') {
      await provider.load();
    }
  } catch (err) {
    return {
      ok: false,
      response: unavailableResponse(err instanceof Error ? err.message : 'model load failed'),
      raw: '',
      diagnostics: provider.getDiagnostics(),
    };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(context, question);

  let text: string;
  try {
    const result = await provider.generate({ systemPrompt, userPrompt });
    text = result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'generation failed';
    const cancelled = /cancell/i.test(message);
    return {
      ok: false,
      cancelled,
      response: cancelled
        ? {
            answer: 'Generation stopped.',
            keyPoints: ['The response was cancelled before it finished.'],
            referencedFacts: [],
            suggestedAction: null,
            confidence: 'low',
            limitations: ['The previous generation was cancelled by the user.'],
          }
        : {
            answer: "I couldn't produce a response for that question just now.",
            keyPoints: [],
            referencedFacts: [],
            suggestedAction: null,
            confidence: 'low',
            limitations: [message],
          },
      raw: '',
      diagnostics: provider.getDiagnostics(),
    };
  }

  const parsed = parseCoachResponse(text);
  return {
    ok: parsed.ok,
    response: parsed.response,
    raw: text,
    diagnostics: provider.getDiagnostics(),
  };
}
