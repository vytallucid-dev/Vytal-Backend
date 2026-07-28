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
  /** Free-form text. ★ MAY BE "" on a pure tool turn — a message that carries ONLY a tool
   *  call (assistant) or a tool result (user) and no prose. Consumers must tolerate empty. */
  content: string;
  /** Present on an ASSISTANT turn where the model requested one or more tool calls — the
   *  neutral carrier of the provider's function-call parts. */
  toolCalls?: AiToolCall[];
  /** Present on a tool-RESULT turn: the output of ONE executed tool, fed back to the model.
   *  Rides on role "user" — the neutral roles are user|assistant, there is NO separate "tool"
   *  role; the adapter maps this to the provider's function-response part. */
  toolResult?: AiToolResult;
}

// ── Tool calling (a.k.a. function calling) ─────────────────────────────────
// The neutral vocabulary for tools. Like the rest of this module it is DUMB TRANSPORT: a
// spec carries NO handler (execution is the caller's business), and nothing here validates
// arguments or results. The adapter maps these three shapes to/from the provider's own
// function-calling contract; no caller ever learns the provider's shape.

/** A tool DECLARATION handed to the provider so the model can decide whether to call it.
 *  `description` is WHAT THE MODEL SEES (prompt engineering, not documentation). `parameters`
 *  is a JSON-Schema object for the arguments, passed through to the provider verbatim. The
 *  chat layer's richer ChatTool (name/klass/description/parameters/handler) projects DOWN to
 *  this — the handler and class never cross into transport. */
export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema (an object schema) for the call arguments. */
  parameters: Record<string, unknown>;
}

/** A tool call the model REQUESTED, parsed out of a generation. `id` is the provider's call
 *  id when it issues one (used to match a result back to its call); absent on providers that
 *  don't. `args` is the parsed JSON argument object — never a string. */
export interface AiToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * ★ AN OPAQUE PROVIDER TOKEN THAT MUST BE ECHOED BACK VERBATIM on the next generation, when the
   * provider issues one. We never read it, never parse it, and never generate one — it is carried
   * through history and handed straight back.
   *
   * ⚠ IT IS LOAD-BEARING, NOT DECORATION. A provider that issues these REJECTS the follow-up
   * generation outright when a tool call is replayed without its token (Gemini 3.x answers
   * 400 INVALID_ARGUMENT), so a tool loop that drops it can call a tool exactly once and then dies
   * on the very next request. It must therefore survive PERSISTENCE too, not just the in-memory
   * turn: a resumed conversation replays its stored tool calls.
   *
   * Deliberately named for what it IS to this layer (an opaque signature) rather than for any one
   * provider's word for it — providers that need no such token simply omit the field.
   */
  signature?: string;
}

/** A tool RESULT fed back to the model on the next generation. `response` is a
 *  JSON-serialisable object; the caller's convention is `{ output }` on success / `{ error }`
 *  on failure, but transport does not enforce it. */
export interface AiToolResult {
  id?: string;
  name: string;
  response: Record<string, unknown>;
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
  /** Tool declarations the model MAY call this turn. Omitted/empty ⇒ a plain text
   *  generation, exactly as before — tools are strictly additive, so every existing caller
   *  is unaffected. */
  tools?: AiToolSpec[];
}

export interface AiGenerateResult {
  /** The generated text. ★ MAY BE "" when the model chose to call tools instead of
   *  answering — an empty string here is NOT an error, and every consumer must handle it. */
  text: string;
  usage: TokenUsage;
  /** The tool calls the model requested this turn, if any. Undefined ⇒ a plain text answer.
   *  When present, the caller executes them and generates again with the results appended. */
  toolCalls?: AiToolCall[];
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
  /** Free-form text generation. When `req.tools` is supplied the model may answer with tool
   *  calls instead of (or alongside) prose — the result carries `toolCalls` and `text` may be
   *  "". Throws (contextual message) on any provider failure. */
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
