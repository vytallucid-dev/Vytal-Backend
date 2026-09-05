// ═══════════════════════════════════════════════════════════════════════
// GEMINI ADAPTER — the first real AI provider, implemented ENTIRELY behind the
// AiProvider interface. Every Google-Gen-AI-SDK detail lives in THIS file; the
// registry and callers gain ZERO Gemini knowledge. If this file were deleted the
// core would still compile — that is the abstraction test.
//
// SECRET HYGIENE: GEMINI_API_KEY is read LAZILY in the factory (never at module
// load) and fail-CLOSED — an absent key throws HERE, it does not crash boot. The
// key, request bodies and response bodies are NEVER logged.
// ═══════════════════════════════════════════════════════════════════════
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import type { Content, FunctionCall, FunctionDeclaration, GenerateContentResponse, Part, Tool } from "@google/genai";
import {
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiGenerateStructuredRequest,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
  type AiToolSpec,
  type TokenUsage,
  type AiStructuredResult,
} from "../../types.js";

// ── THE PINNED MODEL ─────────────────────────────────────────────────────
// The ONE place the default Gemini model version is chosen. Swap this string (or
// set AI_MODEL) to change model versions in a single edit. Intended target:
// Gemini 3.5 Flash. Confirm the exact id against Google's current model list.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

/** Resolve the model to use: explicit request → AI_MODEL env → pinned default. */
function resolveModel(reqModel?: string): string {
  return reqModel ?? process.env.AI_MODEL ?? DEFAULT_GEMINI_MODEL;
}

// ── Neutral → Gemini mapping (BOTH directions of tool calling live in THIS file) ──────────
// These three helpers are the entire Gemini-specific tool contract. They are pure (no client,
// no network) and EXPORTED for the proof harness, so the request/response mapping can be
// asserted without a key or a live call. Nothing they touch escapes this module — the callers
// speak only the neutral AiToolSpec / AiToolCall / AiToolResult.

/** Map neutral messages to Gemini contents, including tool turns:
 *   · a tool-RESULT message → a `user` Content with a functionResponse part (Gemini has no
 *     "tool" role; Content.role is user|model, and function responses ride under "user");
 *   · a tool-CALL (assistant) message → a `model` Content with functionCall parts;
 *   · anything else → a plain text part (its assistant role becomes Gemini's "model").
 *
 *  ⚠ A TOOL RESULT IS MAPPED FIELD BY FIELD — `name`, `response`, `id`, AND NOTHING ELSE. That is a
 *  load-bearing omission, not an oversight: `AiToolResult.effects` (which domains that call changed)
 *  is persisted alongside the result so the transcript can be read back, and it must NEVER become
 *  prompt content. An enumeration here (`...r`) would silently start shipping it — and every future
 *  non-model field with it — to the provider on every replay. Add fields explicitly or not at all. */
export function toGeminiContents(messages: AiMessage[]): Content[] {
  return messages.map((m): Content => {
    if (m.toolResult) {
      const r = m.toolResult;
      return {
        role: "user",
        parts: [{ functionResponse: { name: r.name, response: r.response, ...(r.id ? { id: r.id } : {}) } }],
      };
    }
    if (m.toolCalls && m.toolCalls.length) {
      // ★ THE THOUGHT SIGNATURE RIDES BACK ON THE PART. Gemini 3.x REQUIRES the opaque signature it
      // issued with a functionCall to be replayed with that call; omit it and the follow-up request is
      // rejected 400 INVALID_ARGUMENT ("Function call is missing a thought_signature"), which kills the
      // loop at exactly the moment it tries to use a tool result. Never synthesised — echoed verbatim.
      const parts: Part[] = m.toolCalls.map((c) => ({
        functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) },
        ...(c.signature ? { thoughtSignature: c.signature } : {}),
      }));
      return { role: "model", parts };
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
}

/** Map neutral tool specs to Gemini's single-Tool functionDeclarations form. The JSON-Schema
 *  `parameters` rides on `parametersJsonSchema` — the SDK field that takes a raw JSON Schema
 *  verbatim (as opposed to the enum-typed `Schema`), so our closed-world schemas pass through
 *  unchanged. */
export function toGeminiTools(specs: AiToolSpec[]): Tool[] {
  return [
    {
      functionDeclarations: specs.map(
        (s): FunctionDeclaration => ({ name: s.name, description: s.description, parametersJsonSchema: s.parameters }),
      ),
    },
  ];
}

/** Concatenate the first candidate's TEXT parts, excluding thought parts and any non-text
 *  (functionCall) parts. Same result as the SDK's `.text` getter — but WITHOUT its console
 *  warning ("there are non-text parts…"), which fires on every tool-call turn. On a tool-only
 *  response this returns "" (the AiGenerateResult.text-may-be-empty contract). */
export function textFromGeminiResponse(response: GenerateContentResponse): string {
  const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
  let out = "";
  for (const p of parts) if (typeof p.text === "string" && !p.thought) out += p.text;
  return out;
}

/**
 * Extract neutral tool calls from a response's PARTS. A nameless call is DROPPED — a provider must
 * never be able to make us dispatch a tool with no name. Undefined ⇒ no tool was called this turn.
 *
 * ⚠ WHY THIS WALKS THE PARTS INSTEAD OF USING THE SDK's `functionCalls` GETTER. That getter returns
 * `FunctionCall[]`, and the thought signature does NOT live on the FunctionCall — it lives on the PART
 * that wraps it. Reading the getter therefore silently discards a token the next request is REQUIRED to
 * echo (see toGeminiContents), which is invisible until the second generation is rejected. The parts are
 * the only place both halves are available together.
 */
export function parseGeminiToolCallsFromParts(parts: Part[] | undefined): AiToolCall[] | undefined {
  if (!parts || !parts.length) return undefined;
  const mapped: AiToolCall[] = [];
  for (const p of parts) {
    const c = p.functionCall;
    if (!c || typeof c.name !== "string" || !c.name.length) continue;
    mapped.push({
      name: c.name,
      args: (c.args ?? {}) as Record<string, unknown>,
      ...(c.id ? { id: c.id } : {}),
      ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}),
    });
  }
  return mapped.length ? mapped : undefined;
}

/** Convenience wrapper: the tool calls of a whole response (first candidate). */
export function parseGeminiToolCalls(response: GenerateContentResponse): AiToolCall[] | undefined {
  return parseGeminiToolCallsFromParts(response.candidates?.[0]?.content?.parts);
}

/** Gemini's usageMetadata → the provider-neutral TokenUsage. */
function toTokenUsage(
  usage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      }
    | undefined,
  modelVersion: string,
): TokenUsage {
  const cachedTokens = usage?.cachedContentTokenCount ?? 0;
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    cachedTokens,
    cacheHit: cachedTokens > 0,
    modelVersion,
  };
}

export function createGeminiAdapter(): AiProvider {
  // Lazy + fail-closed: read the key only when an adapter is actually constructed.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set — cannot use the Gemini AI provider");
  }
  const client = new GoogleGenAI({ apiKey });

  return {
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const model = resolveModel(req.model);
      try {
        const response = await client.models.generateContent({
          model,
          contents: toGeminiContents(req.messages),
          config: {
            ...(req.system ? { systemInstruction: req.system } : {}),
            ...(req.temperature != null ? { temperature: req.temperature } : {}),
            ...(req.maxTokens != null ? { maxOutputTokens: req.maxTokens } : {}),
            // Tools are additive: absent ⇒ config is byte-identical to the pre-tool call. When
            // present we declare them and pin AUTO (model decides whether to call) — the
            // default, stated explicitly so a future forced-call mode is a one-line change.
            ...(req.tools && req.tools.length
              ? { tools: toGeminiTools(req.tools), toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } }
              : {}),
          },
        });
        // ★ text may be "" when the model only called tools — that is not an error (see the
        // AiGenerateResult doc). toolCalls is omitted entirely on a plain text answer. Text is
        // read from the parts directly (textFromGeminiResponse) rather than the `.text` getter,
        // which would warn on every tool-call turn.
        const toolCalls = parseGeminiToolCalls(response);
        return {
          text: textFromGeminiResponse(response),
          usage: toTokenUsage(response.usageMetadata, response.modelVersion ?? model),
          ...(toolCalls ? { toolCalls } : {}),
        };
      } catch (err) {
        // Collapse any SDK error shape into a single contextual throw.
        throw new Error(`Gemini generate failed: ${(err as Error).message}`);
      }
    },

    async generateStructured<T>(
      req: AiGenerateStructuredRequest,
    ): Promise<AiStructuredResult<T>> {
      const model = resolveModel(req.model);
      let raw: string;
      let usage: TokenUsage;
      let finishReason: string | null;
      try {
        const response = await client.models.generateContent({
          model,
          contents: toGeminiContents(req.messages),
          config: {
            ...(req.system ? { systemInstruction: req.system } : {}),
            ...(req.temperature != null ? { temperature: req.temperature } : {}),
            ...(req.maxTokens != null ? { maxOutputTokens: req.maxTokens } : {}),
            responseMimeType: "application/json",
            ...(req.jsonSchema ? { responseSchema: req.jsonSchema } : {}),
          },
        });
        raw = response.text ?? "";
        usage = toTokenUsage(response.usageMetadata, response.modelVersion ?? model);
        // ★ CARRIED OUT OF THE ADAPTER, WHICH IS NEW. "MAX_TOKENS" here is the only thing that
        // distinguishes output we cut off from output the model got wrong, and both arrive at the
        // caller as a JSON.parse failure. It has always been on the response and was never read.
        finishReason = (response.candidates?.[0]?.finishReason as string | undefined) ?? null;
      } catch (err) {
        // A provider/network failure STILL throws — that is a different fact from a bad answer.
        throw new Error(`Gemini generateStructured failed: ${(err as Error).message}`);
      }
      // Parse OUTSIDE the network try so a bad-JSON answer is never mislabelled as an API failure —
      // and is returned as data, so the caller can tell truncation from nonsense and retry each
      // differently.
      try {
        return { ok: true, data: JSON.parse(raw) as T, usage, finishReason };
      } catch {
        return { ok: false, reason: "unparseable", raw, usage, finishReason };
      }
    },

    async ping(): Promise<boolean> {
      try {
        await client.models.generateContent({
          model: resolveModel(),
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          config: { maxOutputTokens: 1 },
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
