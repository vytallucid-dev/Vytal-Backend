// ═══════════════════════════════════════════════════════════════════════
// MOCK AI ADAPTER — the reference provider. Implements AiProvider with NO network
// and NO key, so the AI-agnostic core (and every future caller) can be exercised
// end-to-end before a real key exists.
//
// It is the SAFE DEFAULT the registry falls back to (AI_PROVIDER unset ⇒ mock), so a
// misconfigured deploy degrades to a stub rather than accidentally hitting a paid API.
// Responses are DETERMINISTIC (a function of the input) and usage is synthetic but
// well-shaped, so a caller persisting TokenUsage sees a realistic row.
// ═══════════════════════════════════════════════════════════════════════
import {
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiGenerateStructuredRequest,
  type AiProvider,
  type TokenUsage,
} from "../types.js";

const MOCK_MODEL_VERSION = "mock-ai-1";

/** Synthetic token count from text length (chars/4 ≈ tokens) so usage varies with
 *  input like a real provider — deterministic, never random. */
function synthUsage(promptChars: number, outputChars: number): TokenUsage {
  return {
    promptTokens: Math.ceil(promptChars / 4),
    outputTokens: Math.ceil(outputChars / 4),
    cachedTokens: 0,
    cacheHit: false,
    modelVersion: MOCK_MODEL_VERSION,
  };
}

/** Total input characters across the conversation + system instruction. */
function promptCharCount(req: AiGenerateRequest): number {
  const messageChars = req.messages.reduce((n, m) => n + m.content.length, 0);
  return messageChars + (req.system?.length ?? 0);
}

/** The most recent user turn (what a real model would primarily respond to). */
function lastUserContent(req: AiGenerateRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === "user") return req.messages[i].content;
  }
  return "";
}

export function createMockAdapter(): AiProvider {
  return {
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const text = `[mock] ${lastUserContent(req)}`.trim();
      return { text, usage: synthUsage(promptCharCount(req), text.length) };
    },

    async generateStructured<T>(
      req: AiGenerateStructuredRequest,
    ): Promise<{ data: T; usage: TokenUsage }> {
      // Deterministic canned object. NOT schema-aware — callers validate the shape.
      const payload = { ok: true, echo: lastUserContent(req) };
      const outputChars = JSON.stringify(payload).length;
      return {
        data: payload as unknown as T,
        usage: synthUsage(promptCharCount(req), outputChars),
      };
    },

    async ping(): Promise<boolean> {
      return true;
    },
  };
}
