/**
 * ResponseParser — turns a model's raw text reply into a validated
 * `CoachResponse`. Small models on device occasionally wrap JSON in prose or
 * markdown fences, so parsing is defensive: it extracts the first plausible
 * JSON object, validates and coerces each field, and never throws. When no
 * valid object can be extracted it returns a `fallback` response carrying the
 * raw text so the developer-mode diagnostics can still inspect the output.
 */
import type { CoachResponse } from './aiTypes.ts';

export interface ParseResult {
  response: CoachResponse;
  /** True when a well-formed JSON object was parsed (even if partially defaulted). */
  ok: boolean;
  /** Why parsing fell back, for diagnostics. */
  error: string | null;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

function asConfidence(v: unknown): CoachResponse['confidence'] {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

/** Extract the first JSON object (optionally inside a markdown fence) from text. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          return isPlainRecord(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function defaultResponse(raw: string, error: string): ParseResult {
  return {
    ok: false,
    error,
    response: {
      answer: raw.trim(),
      keyPoints: [],
      referencedFacts: [],
      suggestedAction: null,
      confidence: 'low',
      limitations: ['The coach reply could not be read as structured JSON.'],
    },
  };
}

/** Parse and validate a raw model reply into a structured CoachResponse. */
export function parseCoachResponse(raw: string): ParseResult {
  const text = typeof raw === 'string' ? raw : '';
  if (text.trim().length === 0) return defaultResponse(text, 'empty response');

  const obj = extractJsonObject(text);
  if (obj == null) return defaultResponse(text, 'no JSON object found');

  const answer = asString(obj.answer, '');
  if (!answer) {
    return defaultResponse(text, 'JSON had no non-empty answer');
  }

  const confidence = asConfidence(obj.confidence);
  const suggestedActionRaw = obj.suggestedAction;
  const suggestedAction =
    typeof suggestedActionRaw === 'string' && suggestedActionRaw.trim().length > 0
      ? suggestedActionRaw.trim()
      : null;

  return {
    ok: true,
    error: null,
    response: {
      answer,
      keyPoints: asStringArray(obj.keyPoints).slice(0, 8),
      referencedFacts: asStringArray(obj.referencedFacts).slice(0, 8),
      suggestedAction,
      confidence,
      limitations: asStringArray(obj.limitations).slice(0, 5),
    },
  };
}
