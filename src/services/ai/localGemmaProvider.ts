/**
 * LocalGemmaProvider — the on-device provider for the AI coach.
 *
 * This is the TypeScript seam to the (planned) native Android LiteRT-LM
 * plugin. It never ships the model itself; it talks to a Capacitor plugin
 * registered as 'AiCoach'. When the plugin is absent (e.g. web dev, a build
 * without the native module, or a device without the downloaded model) the
 * provider reports `unavailable` and `isAvailable()` returns false — the rest
 * of the app degrades gracefully with a structured "coach not available"
 * reply and the AI feature simply stays dormant.
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

/** Native contract the LiteRT-LM plugin must implement (not built yet — see milestone report). */
export interface AiCoachPlugin {
  /** Load the model into memory. Resolves when ready. */
  load(): Promise<{ ok: boolean }>;
  /** Release the model. */
  unload(): Promise<void>;
  /** Whether the model is currently loaded. */
  isLoaded(): Promise<{ loaded: boolean }>;
  /** Whether the model file exists and the runtime is usable on this device. */
  isAvailable(): Promise<{ available: boolean }>;
  /** Run one generation. Must be called after load(). */
  generate(options: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; promptTokens?: number; generatedTokens?: number; latencyMs?: number }>;
  /** Static model metadata for diagnostics. */
  getModelInfo(): Promise<{
    name: string;
    version?: string;
    quantization?: string;
    backend?: string;
  }>;
}

const plugin = registerPlugin<AiCoachPlugin>('AiCoach');

const STATIC_MODEL = {
  name: 'Gemma 4 E2B-it',
  version: null,
  quantization: 'int4 (mixed-bit)',
  backend: null,
};

class LocalGemmaProvider implements AiProvider {
  readonly id = 'local-gemma';
  readonly runtime = 'LiteRT-LM (com.google.ai.edge.litertlm)';
  readonly modelName = STATIC_MODEL.name;
  readonly modelVersion = STATIC_MODEL.version;
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
      await plugin.load();
      this.loaded = true;
      this.loadTimeMs = Math.round(performance.now() - started);
      this.status = 'ready';
      this.lastError = null;
    } catch (err) {
      this.loaded = false;
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'load failed';
      throw err;
    }
  }

  async unload(): Promise<void> {
    if (!this.loaded) return;
    try {
      await plugin.unload();
    } finally {
      this.loaded = false;
      this.status = 'idle';
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.loaded) {
      this.lastError = 'model not loaded';
      throw new Error('Local Gemma is not loaded.');
    }
    this.lastRequestAt = new Date().toISOString();
    this.lastError = null;
    try {
      const started = performance.now();
      const res = await plugin.generate({
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        temperature: 0.7,
        maxTokens: 800,
      });
      this.lastLatencyMs = res.latencyMs ?? Math.round(performance.now() - started);
      this.lastPromptTokens = res.promptTokens ?? null;
      this.lastGeneratedTokens = res.generatedTokens ?? null;
      this.lastResponsePreview = res.text.slice(0, 200);
      return { text: res.text };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'generation failed';
      throw err;
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
      modelVersion: this.modelVersion,
      quantization: this.quantization,
      backend: STATIC_MODEL.backend,
      status: this.status,
      loaded: this.loaded,
      loadTimeMs: this.loadTimeMs,
      promptTokens: this.lastPromptTokens,
      generatedTokens: this.lastGeneratedTokens,
      latencyMs: this.lastLatencyMs,
      lastRequestAt: this.lastRequestAt,
      lastResponsePreview: this.lastResponsePreview,
      lastError: this.lastError,
    };
  }
}

/** Singleton provider the rest of the app uses. */
export const localGemmaProvider: AiProvider = new LocalGemmaProvider();
