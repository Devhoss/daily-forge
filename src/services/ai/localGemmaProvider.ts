/**
 * LocalGemmaProvider — the on-device provider for the AI coach.
 *
 * This is the TypeScript seam to the native Android LiteRT-LM plugin
 * (`AiCoachPlugin.kt`, registered as 'AiCoach'). It never ships the model
 * itself; it talks to the plugin over a typed interface. When the plugin is
 * absent (e.g. web dev, a build without the native module, or a device without
 * the downloaded model) the provider reports `unavailable` and `isAvailable()`
 * returns false — the rest of the app degrades gracefully with a structured
 * "coach not available" reply and the AI feature simply stays dormant.
 *
 * The provider intentionally exposes only the `AiProvider` contract; the
 * deterministic services that power the app never touch it.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  AiProvider,
  AiDiagnostics,
  ProviderStatus,
  GenerationRequest,
  GenerationResult,
} from './aiTypes.ts';

/** Native contract the AiCoach Capacitor plugin implements. */
export interface AiCoachPlugin {
  /** Whether a usable model file exists on this device (no engine load). */
  isAvailable(options?: { modelPath?: string }): Promise<{
    available: boolean;
    modelPath: string | null;
    modelSizeBytes: number;
  }>;
  /** Static + live model/runtime metadata for diagnostics. */
  getModelInfo(options?: { modelPath?: string }): Promise<{
    name: string;
    version: string | null;
    quantization: string | null;
    backend: string | null;
    runtime: string | null;
    format: string | null;
    modelPath: string | null;
    modelExists: boolean;
    modelSizeBytes: number;
    loaded: boolean;
    loadTimeMs: number | null;
    baselineMemoryKb: number | null;
    loadMemoryKb: number | null;
    lastError: string | null;
  }>;
  /** Whether the model is currently loaded into memory. */
  isLoaded(): Promise<{ loaded: boolean }>;
  /** Load the model (idempotent). May take seconds — the plugin runs it off-thread. */
  load(options?: { modelPath?: string }): Promise<{ ok: boolean; alreadyLoaded?: boolean; loadTimeMs?: number }>;
  /** Release the model and cancel any in-flight generation (idempotent). */
  unload(): Promise<void>;
  /** Best-effort cancel of the in-flight generation. */
  cancel(): Promise<{ cancelled: boolean }>;
  /** Run one generation. Must be called after load(). */
  generate(options: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    text: string;
    latencyMs: number;
    firstTokenMs: number | null;
    promptTokens: number;
    generatedTokens: number;
    prefillTokensPerSecond: number;
    decodeTokensPerSecond: number;
    timeToFirstTokenInSecond: number;
  }>;
}

const plugin = registerPlugin<AiCoachPlugin>('AiCoach');

const STATIC_MODEL = {
  name: 'Gemma 4 E2B-it',
  quantization: 'int4 (mixed-bit)',
};

class LocalGemmaProvider implements AiProvider {
  readonly id = 'local-gemma';
  readonly runtime = 'LiteRT-LM (com.google.ai.edge.litertlm)';
  readonly modelName = STATIC_MODEL.name;
  readonly modelVersion: string | null = null;
  readonly quantization = STATIC_MODEL.quantization;

  private status: ProviderStatus = 'unavailable';
  private loaded = false;
  private loadTimeMs: number | null = null;
  private lastRequestAt: string | null = null;
  private lastLatencyMs: number | null = null;
  private lastPromptTokens: number | null = null;
  private lastGeneratedTokens: number | null = null;
  private lastResponsePreview: string | null = null;
  private lastError: string | null = null;
  private lastCancelled: boolean | null = null;
  private runtimeVersion: string | null = null;
  private modelFormat: string | null = null;
  private backend: string | null = null;
  private modelPath: string | null = null;
  private modelExists: boolean | null = null;
  private modelSizeBytes: number | null = null;
  private baselineMemoryKb: number | null = null;
  private loadMemoryKb: number | null = null;
  private firstTokenMs: number | null = null;
  private prefillTokensPerSecond: number | null = null;
  private decodeTokensPerSecond: number | null = null;
  private timeToFirstTokenInSecond: number | null = null;

  private nativeSupported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async isAvailable(): Promise<boolean> {
    if (!this.nativeSupported()) {
      this.status = 'unavailable';
      return false;
    }
    try {
      const info = await plugin.isAvailable();
      this.modelPath = info.modelPath;
      this.modelExists = info.available;
      this.modelSizeBytes = info.modelSizeBytes;
      this.status = info.available ? (this.loaded ? 'ready' : 'idle') : 'unavailable';
      return info.available;
    } catch (err) {
      this.status = 'unavailable';
      this.lastError = err instanceof Error ? err.message : 'plugin unavailable';
      return false;
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.nativeSupported()) {
      this.status = 'unavailable';
      throw new Error('Local Gemma requires the native Android runtime.');
    }
    this.status = 'loading';
    const started = performance.now();
    try {
      const res = await plugin.load();
      this.loaded = true;
      this.loadTimeMs = res.loadTimeMs ?? Math.round(performance.now() - started);
      this.status = 'ready';
      this.lastError = null;
      await this.refreshModelInfo();
    } catch (err) {
      this.loaded = false;
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'load failed';
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (!this.loaded && !this.nativeSupported()) return;
    try {
      await plugin.unload();
    } catch {
      // Even if native unload fails, reset our local state so we retry cleanly.
    } finally {
      this.loaded = false;
      this.status = 'idle';
      this.loadTimeMs = null;
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.nativeSupported()) return false;
    try {
      const res = await plugin.cancel();
      return res.cancelled;
    } catch {
      return false;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.loaded) {
      this.lastError = 'model not loaded';
      throw new Error('Local Gemma is not loaded.');
    }
    this.lastRequestAt = new Date().toISOString();
    this.lastError = null;
    this.lastCancelled = null;
    try {
      const res = await plugin.generate({
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        temperature: 0.7,
        maxTokens: 800,
      });
      this.lastLatencyMs = res.latencyMs;
      this.firstTokenMs = res.firstTokenMs;
      this.lastPromptTokens = res.promptTokens >= 0 ? res.promptTokens : null;
      this.lastGeneratedTokens = res.generatedTokens >= 0 ? res.generatedTokens : null;
      this.prefillTokensPerSecond = res.prefillTokensPerSecond >= 0 ? res.prefillTokensPerSecond : null;
      this.decodeTokensPerSecond = res.decodeTokensPerSecond >= 0 ? res.decodeTokensPerSecond : null;
      this.timeToFirstTokenInSecond = res.timeToFirstTokenInSecond >= 0 ? res.timeToFirstTokenInSecond : null;
      this.lastResponsePreview = res.text.slice(0, 200);
      return { text: res.text };
    } catch (err) {
      const cancelled = err instanceof Error && /cancelled/i.test(err.message);
      this.lastCancelled = cancelled;
      this.lastError = err instanceof Error ? err.message : 'generation failed';
      throw err;
    }
  }

  private async refreshModelInfo(): Promise<void> {
    try {
      const info = await plugin.getModelInfo();
      this.runtimeVersion = info.version;
      this.modelFormat = info.format;
      this.backend = info.backend;
      this.modelPath = info.modelPath;
      this.modelExists = info.modelExists;
      this.modelSizeBytes = info.modelSizeBytes;
      this.loadTimeMs = info.loadTimeMs ?? this.loadTimeMs;
      this.baselineMemoryKb = info.baselineMemoryKb;
      this.loadMemoryKb = info.loadMemoryKb;
    } catch {
      // Non-fatal: diagnostics degrade gracefully.
    }
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  getDiagnostics(): AiDiagnostics {
    return {
      providerId: this.id,
      runtime: this.runtime,
      modelName: this.modelName,
      modelVersion: this.runtimeVersion,
      quantization: this.quantization,
      backend: this.backend,
      status: this.status,
      loaded: this.loaded,
      loadTimeMs: this.loadTimeMs,
      promptTokens: this.lastPromptTokens,
      generatedTokens: this.lastGeneratedTokens,
      latencyMs: this.lastLatencyMs,
      lastRequestAt: this.lastRequestAt,
      lastResponsePreview: this.lastResponsePreview,
      lastError: this.lastError,
      runtimeVersion: this.runtimeVersion,
      modelFormat: this.modelFormat,
      modelPath: this.modelPath,
      modelExists: this.modelExists,
      modelSizeBytes: this.modelSizeBytes,
      baselineMemoryKb: this.baselineMemoryKb,
      loadMemoryKb: this.loadMemoryKb,
      firstTokenMs: this.firstTokenMs,
      prefillTokensPerSecond: this.prefillTokensPerSecond,
      decodeTokensPerSecond: this.decodeTokensPerSecond,
      timeToFirstTokenInSecond: this.timeToFirstTokenInSecond,
      lastCancelled: this.lastCancelled,
    };
  }
}

/** Singleton provider the rest of the app uses. */
export const localGemmaProvider: AiProvider = new LocalGemmaProvider();
