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
import { GoogleGenAI } from "@google/genai";
import {
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiGenerateStructuredRequest,
  type AiMessage,
  type AiProvider,
  type TokenUsage,
} from "../types.js";

// ── THE PINNED MODEL ─────────────────────────────────────────────────────
// The ONE place the default Gemini model version is chosen. Swap this string (or
// set AI_MODEL) to change model versions in a single edit. Intended target:
// Gemini 3.5 Flash. Confirm the exact id against Google's current model list.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

/** Resolve the model to use: explicit request → AI_MODEL env → pinned default. */
function resolveModel(reqModel?: string): string {
  return reqModel ?? process.env.AI_MODEL ?? DEFAULT_GEMINI_MODEL;
}

/** Map neutral messages to Gemini's content shape (its assistant role is "model"). */
function toGeminiContents(messages: AiMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
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
          },
        });
        return {
          text: response.text ?? "",
          usage: toTokenUsage(response.usageMetadata, response.modelVersion ?? model),
        };
      } catch (err) {
        // Collapse any SDK error shape into a single contextual throw.
        throw new Error(`Gemini generate failed: ${(err as Error).message}`);
      }
    },

    async generateStructured<T>(
      req: AiGenerateStructuredRequest,
    ): Promise<{ data: T; usage: TokenUsage }> {
      const model = resolveModel(req.model);
      let raw: string;
      let usage: TokenUsage;
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
      } catch (err) {
        throw new Error(`Gemini generateStructured failed: ${(err as Error).message}`);
      }
      // Parse OUTSIDE the network try so a bad-JSON error is not mislabelled as an
      // API failure.
      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch {
        throw new Error("Gemini generateStructured: model did not return valid JSON");
      }
      return { data, usage };
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
