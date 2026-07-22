// ═══════════════════════════════════════════════════════════════════════
// AI PROVIDER — the provider-agnostic core abstraction (mirrors src/brokers/).
//
// GOVERNING PRINCIPLE: every AI call in Vytal routes through THIS interface.
// Swapping providers (Gemini → Claude → …) is a registry line + an adapter file;
// no caller ever learns which provider it is talking to.
//
// This module is DUMB TRANSPORT: ZERO Vytal business logic, ZERO prompt content,
// ZERO user-data handling — those live in future callers. It has ZERO dependency
// on any provider SDK, and the boundary speaks plain JSON-serialisable values so a
// provider's SDK types never leak outward.
// ═══════════════════════════════════════════════════════════════════════

// ── Provider identity ────────────────────────────────────────────────────
/** Every AI provider the platform can model. The registry (registry.ts) is the
 *  ONE place an id binds to a concrete adapter — the only provider-specific branch. */
export const AI_PROVIDER_IDS = ["gemini", "mock"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** True when `id` is a modelled AiProviderId (enum-safe narrowing for env / request input). */
export function isAiProviderId(id: string): id is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(id);
}

// ── Model identity ───────────────────────────────────────────────────────
/** A provider model identifier, e.g. "gemini-3.5-flash". Deliberately an open
 *  string, NOT an enum: model ids are provider-specific, churn often, and are
 *  chosen by config — never hardcoded in logic. The concrete default lives in the
 *  adapter (adapters/gemini.ts), overridable via the AI_MODEL env var. */
export type AiModelId = string;

// ── Token usage ──────────────────────────────────────────────────────────
/** Per-call token accounting. Field names map 1:1 onto the `ai_summaries` columns
 *  (prisma model AiSummary) so a caller can persist usage verbatim:
 *  promptTokens · outputTokens · cachedTokens · cacheHit · modelVersion. */
export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's context cache (billed cheaper). 0 if none. */
  cachedTokens: number;
  /** Convenience flag: cachedTokens > 0. */
  cacheHit: boolean;
  /** The model that actually served the call (provider-reported when available,
   *  else the requested/default model id). */
  modelVersion: string;
}

// ── Messages ─────────────────────────────────────────────────────────────
/** Neutral chat roles. Provider-specific role names (Gemini's "model", etc.) are
 *  mapped inside the adapter — callers never see them. */
export type AiRole = "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

// ── Requests / results ───────────────────────────────────────────────────
export interface AiGenerateRequest {
  /** The conversation, oldest-first. */
  messages: AiMessage[];
  /** Model id. Optional: the adapter falls back to its configured default
   *  (AI_MODEL env → the adapter's pinned constant) when omitted. */
  model?: AiModelId;
  /** Provider-neutral system instruction (kept OUT of `messages`). */
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiGenerateResult {
  text: string;
  usage: TokenUsage;
}

/** Structured variant. `jsonSchema` is an optional response-shape hint the adapter
 *  passes to the provider's JSON mode (e.g. Gemini responseSchema). The generic T is
 *  the caller's expected parsed shape — this module does NOT validate beyond
 *  JSON.parse; schema validation belongs to the caller. */
export interface AiGenerateStructuredRequest extends AiGenerateRequest {
  jsonSchema?: Record<string, unknown>;
}

// ── The interface every adapter implements ───────────────────────────────
export interface AiProvider {
  /** Free-form text generation. Throws (contextual message) on any provider failure. */
  generate(req: AiGenerateRequest): Promise<AiGenerateResult>;

  /** JSON generation — returns parsed data + usage. Throws if the provider fails or
   *  the model does not return valid JSON. */
  generateStructured<T>(
    req: AiGenerateStructuredRequest,
  ): Promise<{ data: T; usage: TokenUsage }>;

  /** Cheap liveness / key-validity check. Resolves true if the provider is reachable
   *  and configured, false otherwise. Never throws. */
  ping(): Promise<boolean>;

  // NOTE: embed() is deliberately deferred until the retrieval layer needs it.
}
