# AI Coach — Privacy & On-Device Guarantees

The DailyForge AI Coach is designed around one hard requirement: **your
training data never leaves this device.** This document is the engineering
record of how that guarantee is kept, and the checklist used to verify it on a
real Android device (Milestone 1 smoke test).

## Non-negotiable principles

1. **No network requests.** The coach pipeline — deterministic context
   builder → prompt → LiteRT-LM inference → structured reply — runs entirely
   in the app process. There is no server, no REST call, no WebView network
   egress from the coach feature.
2. **No API key.** On-device inference requires no credentials. (Hugging Face
   is used only for the one-time, user-initiated model *download*, which is a
   download-only operation.)
3. **No telemetry.** The coach does not report usage, prompts, responses, or
   any other signal anywhere.
4. **Sanitized context.** The model only ever sees the output of
   `buildCoachContext()` — a bounded, deterministic snapshot that contains
   *no* raw database dump. Free-text session notes, internal ids, timestamps,
   and blobs are excluded.
5. **Determinism of decisions.** The model can never change the app's
   numbers. Recovery scores, recommendations, overload steps, streaks,
   milestones, and trends are all computed by the deterministic service layer
   *before* the prompt is assembled. The model is an explanation layer, not a
   decision maker.
6. **Local history only.** Conversation history lives in React state and is
   cleared on leaving the coach screen or via the "Clear conversation" action.
   Nothing is persisted to IndexedDB or anywhere else.

## Data-flow boundary

```
Dexie (session/set/measurement/settings)
        │  (read-only)
        ▼
deterministic services (recovery, recommendations, streaks,
trends, milestones, measurements, programEngine)
        │  (pure functions, sanitized)
        ▼
CoachContext  ──►  coachPrompt  ──►  LiteRT-LM engine (native, on-device)
                                        │
                                        ▼
                    responseParser  ◄──  raw text (kept only for Developer Mode)
        │
        ▼
CoachResponse (structured)
```

The only code that touches the native model is `localGemmaProvider`, which
speaks to a Capacitor plugin (`AiCoach`) over a narrow, typed interface. The
web/desktop build, and any device without the plugin or downloaded model,
reports the provider as `unavailable` and the app continues to work normally.

## Model & license

| Field | Value |
| --- | --- |
| Model | Gemma 4 E2B-it (multimodal, text-only use here) |
| Source model card | [`google/gemma-4-E2B-it`](https://huggingface.co/google/gemma-4-E2B-it) |
| Runtime artifact | [`litert-community/gemma-4-E2B-it-litert-lm`](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) |
| Format | `.litertlm` (LiteRT-LM), file size 2.58 GB |
| Quantization | int4 (mixed-bit) |
| License | Apache-2.0 |
| Download | user-initiated, direct HTTPS fetch to app storage |

DailyForge is distributed as a GitHub project. The model is distributed
separately (not bundled in the app binary) and its Apache-2.0 license is
preserved; the app downloads the artifact only with explicit user consent.
Inference runs entirely offline.

## What never leaves / never enters

| Category | Status |
| --- | --- |
| Session logs, set logs, measurements | read-only inputs, never transmitted |
| Free-text notes, photo blobs | excluded from CoachContext entirely |
| Recovery score & factors | computed deterministically, presented as facts |
| Recommendations & overload steps | computed deterministically, authoritative |
| Prompt text & model reply | in-process only; raw reply kept in memory for the debug panel |
| Conversation history | in-memory only; cleared on exit |
| Model weights (2.58 GB `.litertlm`) | user-initiated download to app storage; inference is offline |

## Verification checklist (run on a physical Android device)

1. **No network:** put the device in Airplane Mode (with WiFi off), then use
   the coach. A full Q&A must succeed entirely offline once the model is
   downloaded. This is the single most important test.
2. **Model download is download-only:** record that downloading the model
   performs a direct HTTPS fetch of the public Hugging Face artifact and
   stores it in app storage. No other host is contacted.
3. **App functional without AI:** on a device where the model is not
   downloaded (or the plugin is absent), the coach screen shows the structured
   "coach not available" fallback, and every other screen (Home, Workout,
   Progress, Settings) works exactly as before.
4. **Diagnostics honesty:** the AI Diagnostics panel reports the true status
   (`unavailable` when the plugin/model is missing; `ready` when loaded) with
   model, runtime, load time, latency, and token counts.
5. **Load/unload lifecycle:** opening the coach loads the model; leaving the
   screen unloads it. Confirm via the diagnostics `Loaded` field and via
   memory pressure returning to baseline after exit.
6. **Grounding spot-check:** with a fresh/empty history, ask "how many
   workouts have I done?" — the reply must say it's not recorded (from the
   `missing` markers), not invent a number.
7. **Determinism spot-check:** re-asking the same question with unchanged data
   should not change the recovery score or any recommendation the coach cites
   (the model may rephrase, but the underlying facts it references must stay
   stable).
8. **Structured reply:** responses render as the structured answer with
   keyPoints / suggestedAction / limitations; the "raw model response" toggle
   in the message reveals the JSON the parser consumed.

## Guardrails for the future

- If any new capability (e.g. Health Adapters for sleep/HRV) is added, it must
  feed the same deterministic pipeline and never be sent to a model directly.
- No cloud provider may ever be added to `aiProvider.ts`. The provider
  registry is intentionally local-only.
- Any change that would add a network call from a coach code path must fail
  review: the module boundary in `localGemmaProvider.ts` is the only place
  native inference is invoked.
