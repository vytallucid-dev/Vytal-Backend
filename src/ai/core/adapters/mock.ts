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
  type AiToolCall,
  type TokenUsage,
  type AiStructuredResult,
} from "../../types.js";

const MOCK_MODEL_VERSION = "mock-ai-1";

// ── SCRIPTED TOOL-CALL MODE — the seam that lets the proof harness drive the TOOL LOOP with no
// key. The default generate() echoes the last user message; when a script is installed, each
// generate() call instead consumes the NEXT step (FIFO) — an optional text and/or tool calls —
// so a harness can say "turn 1: call getStockFacts; turn 2: answer". Exhausted or unset ⇒ the
// echo behaviour is restored, so nothing that exists today changes. Deterministic, never random.
export interface MockStep {
  /** The assistant text for this step. Omit (or "") to model a pure tool-call turn. */
  text?: string;
  /** Tool calls the mock "model" requests this step. */
  toolCalls?: AiToolCall[];
}
let scriptedSteps: MockStep[] | null = null;
let scriptCursor = 0;
/** Install a FIFO script of generate() responses (or clear it with null). Resets the cursor —
 *  so a harness can re-script between scenarios. */
export function __setMockScript(steps: MockStep[] | null): void {
  scriptedSteps = steps;
  scriptCursor = 0;
}

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
      // Scripted step (proof harness) takes precedence; falls through to the echo when the
      // script is unset or exhausted.
      if (scriptedSteps && scriptCursor < scriptedSteps.length) {
        const step = scriptedSteps[scriptCursor++];
        const text = step.text ?? "";
        const outChars = text.length + (step.toolCalls ? JSON.stringify(step.toolCalls).length : 0);
        return {
          text,
          usage: synthUsage(promptCharCount(req), outChars),
          ...(step.toolCalls && step.toolCalls.length ? { toolCalls: step.toolCalls } : {}),
        };
      }
      const text = `[mock] ${lastUserContent(req)}`.trim();
      return { text, usage: synthUsage(promptCharCount(req), text.length) };
    },

    async generateStructured<T>(
      req: AiGenerateStructuredRequest,
    ): Promise<AiStructuredResult<T>> {
      // Deterministic canned object. NOT schema-aware — callers validate the shape.
      const payload = { ok: true, echo: lastUserContent(req) };
      const outputChars = JSON.stringify(payload).length;
      return {
        ok: true,
        data: payload as unknown as T,
        usage: synthUsage(promptCharCount(req), outputChars),
        // The mock never truncates and never fails to parse, so it reports the clean terminal state
        // rather than null — a caller branching on finishReason must exercise the same shape here.
        finishReason: "STOP",
      };
    },

    async ping(): Promise<boolean> {
      return true;
    },
  };
}
