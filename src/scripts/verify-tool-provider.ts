// ─────────────────────────────────────────────────────────────────────────────
// TOOL-PROVIDER VERIFY HARNESS (Stage 0, Phase A — provider wiring for tool calling).
//
// Proves, without a key and without the engine loop (that is Phase B):
//   1. NEUTRAL → GEMINI request mapping: tool specs → functionDeclarations (JSON Schema on
//      parametersJsonSchema); tool-call / tool-result / plain messages → the right Content parts.
//   2. GEMINI → NEUTRAL response parse, through the SDK's OWN `functionCalls` getter on a real
//      GenerateContentResponse object — so the parse is proven against the exact shape the live
//      path reads, not a hand-rolled fixture. Covers: a call, parallel calls, text-only (no
//      calls), text+calls together, the empty-text case, and the nameless-call drop.
//   3. The MOCK scripted-tool-call mode: a FIFO script drives generate() → first a tool call
//      (text ""), then a text answer, then the echo restored when the script is cleared.
//   4. The abstraction holds: the neutral result never carries a Gemini type.
//
// OPT-IN live check (a real, paid Gemini call — OFF by default): TOOL_PROVER_LIVE=1 npx tsx …
//
//   npx tsx src/scripts/verify-tool-provider.ts
// ─────────────────────────────────────────────────────────────────────────────
import { GenerateContentResponse } from "@google/genai";
import {
  toGeminiContents,
  toGeminiTools,
  parseGeminiToolCalls,
  createGeminiAdapter,
} from "../ai/core/adapters/gemini.js";
import { createMockAdapter, __setMockScript } from "../ai/core/adapters/mock.js";
import type { AiMessage, AiToolSpec } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

// A minimal getStockFacts-shaped declaration — closed-world object schema, one required string.
const GET_STOCK_FACTS_SPEC: AiToolSpec = {
  name: "getStockFacts",
  description: "Fetch Vytal's health facts for a covered stock by its ticker symbol.",
  parameters: {
    type: "object",
    properties: { symbol: { type: "string", description: "NSE ticker, e.g. INFY" } },
    required: ["symbol"],
    additionalProperties: false,
  },
};

/** Build a real SDK response object so `.functionCalls` / `.text` are exercised as in production. */
function sdkResponse(parts: Array<Record<string, unknown>>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), {
    candidates: [{ content: { role: "model", parts } }],
    modelVersion: "gemini-3.5-flash-lite",
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
  });
}

async function main() {
  // ══ 1. NEUTRAL → GEMINI: tool declarations ══
  section("1. Request mapping — tool declarations");
  const tools = toGeminiTools([GET_STOCK_FACTS_SPEC]);
  const decl = tools[0]?.functionDeclarations?.[0];
  ok("single Tool with one functionDeclaration", tools.length === 1 && (tools[0].functionDeclarations?.length ?? 0) === 1);
  ok("name carried", decl?.name === "getStockFacts");
  ok("description (what the model sees) carried", decl?.description === GET_STOCK_FACTS_SPEC.description);
  ok(
    "JSON Schema rides on parametersJsonSchema verbatim",
    JSON.stringify(decl?.parametersJsonSchema) === JSON.stringify(GET_STOCK_FACTS_SPEC.parameters),
  );

  // ══ 1b. NEUTRAL → GEMINI: messages (incl. tool turns) ══
  section("1b. Request mapping — messages & tool turns");
  const history: AiMessage[] = [
    { role: "user", content: "tell me about TCS" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "getStockFacts", args: { symbol: "TCS" } }] },
    { role: "user", content: "", toolResult: { id: "c1", name: "getStockFacts", response: { output: "…facts…" } } },
    { role: "assistant", content: "TCS looks steady." },
  ];
  const contents = toGeminiContents(history);
  ok("plain user → role user + text part", contents[0].role === "user" && contents[0].parts?.[0].text === "tell me about TCS");
  ok(
    "tool-call (assistant) → role model + functionCall part",
    contents[1].role === "model" &&
      contents[1].parts?.[0].functionCall?.name === "getStockFacts" &&
      (contents[1].parts?.[0].functionCall?.args as { symbol?: string })?.symbol === "TCS",
  );
  ok("call id passed through", contents[1].parts?.[0].functionCall?.id === "c1");
  ok(
    "tool-result → role user + functionResponse part (no 'tool' role)",
    contents[2].role === "user" &&
      contents[2].parts?.[0].functionResponse?.name === "getStockFacts" &&
      (contents[2].parts?.[0].functionResponse?.response as { output?: string })?.output === "…facts…",
  );
  ok("result id matches its call", contents[2].parts?.[0].functionResponse?.id === "c1");
  ok("plain assistant → role model + text part", contents[3].role === "model" && contents[3].parts?.[0].text === "TCS looks steady.");

  // ══ 2. GEMINI → NEUTRAL: response parse (walks the PARTS, not the functionCalls getter) ══
  section("2. Response parse — from the real SDK response parts");
  const oneCall = sdkResponse([{ functionCall: { name: "getStockFacts", args: { symbol: "INFY" } }, thoughtSignature: "SIG-ABC" }]);
  ok("SDK getter also sees the functionCall", (oneCall.functionCalls?.length ?? 0) === 1);
  const parsed = parseGeminiToolCalls(oneCall);
  ok(
    "parsed → 1 neutral AiToolCall {name, args}",
    parsed?.length === 1 && parsed[0].name === "getStockFacts" && (parsed[0].args as { symbol?: string }).symbol === "INFY",
  );
  // ★ THE REGRESSION THAT A LIVE CALL FOUND: the thought signature lives on the PART, not on the
  //   FunctionCall — so reading the SDK's functionCalls getter silently drops it and the NEXT request
  //   is rejected 400. These two assertions are the guard.
  ok("★ thought signature captured off the part (required for the follow-up request)", parsed?.[0].signature === "SIG-ABC");
  ok("★ the SDK functionCalls getter does NOT carry it (why we walk parts)", !("thoughtSignature" in (oneCall.functionCalls?.[0] ?? {})));
  ok("function-only response: SDK .text is undefined (adapter coerces to \"\")", oneCall.text === undefined);

  const parallel = sdkResponse([
    { functionCall: { name: "getStockFacts", args: { symbol: "INFY" } }, thoughtSignature: "SIG-1" },
    { functionCall: { name: "getStockPrice", args: { symbol: "TCS" } }, thoughtSignature: "SIG-2" },
  ]);
  const parsedPar = parseGeminiToolCalls(parallel);
  ok("parallel calls parsed (2)", parsedPar?.length === 2 && parsedPar[1].name === "getStockPrice");
  ok("each parallel call keeps its OWN signature", parsedPar?.[0].signature === "SIG-1" && parsedPar?.[1].signature === "SIG-2");

  const textOnly = sdkResponse([{ text: "Hello, here is the read." }]);
  ok("text-only: SDK getter → undefined", textOnly.functionCalls === undefined);
  ok("text-only: parse → undefined", parseGeminiToolCalls(textOnly) === undefined);
  ok("text-only: SDK .text carried", textOnly.text === "Hello, here is the read.");

  const mixed = sdkResponse([{ text: "Let me check." }, { functionCall: { name: "getStockFacts", args: { symbol: "INFY" } } }]);
  ok("text+call coexist: text present AND 1 call parsed", mixed.text === "Let me check." && parseGeminiToolCalls(mixed)?.length === 1);
  ok("a call with NO signature simply omits it (providers that issue none)", parseGeminiToolCalls(mixed)?.[0].signature === undefined);

  const nameless = sdkResponse([{ functionCall: { args: { symbol: "X" } } }]);
  ok("nameless call is DROPPED (never dispatch a nameless tool)", parseGeminiToolCalls(nameless) === undefined);

  // ── ROUND TRIP: parsed calls → back into a request, signature intact ──
  const replay = toGeminiContents([
    { role: "user", content: "how is INFY?" },
    { role: "assistant", content: "", toolCalls: parsed! },
    { role: "user", content: "", toolResult: { name: "getStockFacts", response: { output: "…" } } },
  ]);
  ok("★ replayed functionCall part carries thoughtSignature back to the provider", (replay[1].parts?.[0] as { thoughtSignature?: string })?.thoughtSignature === "SIG-ABC");

  // ══ 3. MOCK scripted mode — drive the loop with no key ══
  section("3. Mock scripted-tool-call mode");
  const mock = createMockAdapter();
  __setMockScript([
    { toolCalls: [{ name: "getStockFacts", args: { symbol: "TCS" } }] }, // step 1: a tool call, no prose
    { text: "TCS is Healthy." }, // step 2: the answer
  ]);
  const r1 = await mock.generate({ messages: [{ role: "user", content: "how is TCS?" }] });
  ok('step 1: text is "" AND a tool call is present (empty text is valid)', r1.text === "" && r1.toolCalls?.[0].name === "getStockFacts");
  const r2 = await mock.generate({ messages: [{ role: "user", content: "how is TCS?" }] });
  ok("step 2: text answer, no toolCalls", r2.text === "TCS is Healthy." && r2.toolCalls === undefined);
  __setMockScript(null);
  const r3 = await mock.generate({ messages: [{ role: "user", content: "ping" }] });
  ok("script cleared → echo behaviour restored", r3.text.startsWith("[mock]") && r3.toolCalls === undefined);

  // ══ 4. Abstraction: neutral result carries no Gemini type ══
  section("4. Abstraction boundary");
  const neutralKeys = Object.keys(r1).sort().join(",");
  ok("neutral result keys are text/usage/toolCalls only", neutralKeys === "text,toolCalls,usage");
  ok("a neutral tool call is a plain {name,args} (no SDK class)", r1.toolCalls?.[0].constructor === Object);

  // ══ 5. OPT-IN live Gemini call (paid — OFF by default) ══
  section("5. Live Gemini (opt-in: TOOL_PROVER_LIVE=1)");
  if (process.env.TOOL_PROVER_LIVE === "1") {
    try {
      const dotenv = await import("dotenv");
      dotenv.config();
      const gem = createGeminiAdapter();
      const live = await gem.generate({
        system: "You are a stock assistant. When asked about a specific stock, call getStockFacts.",
        messages: [{ role: "user", content: "What are the health facts for INFY?" }],
        tools: [GET_STOCK_FACTS_SPEC],
        maxTokens: 256,
      });
      const called = live.toolCalls?.some((c) => c.name === "getStockFacts");
      ok("live model returned a getStockFacts tool call, parsed to neutral", !!called, JSON.stringify(live.toolCalls ?? live.text.slice(0, 60)));
    } catch (e) {
      ok("live call", false, (e as Error).message);
    }
  } else {
    console.log("  ⏭  skipped (deterministic SDK-shape proof above covers the parse; set TOOL_PROVER_LIVE=1 for a paid live call)");
  }

  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
