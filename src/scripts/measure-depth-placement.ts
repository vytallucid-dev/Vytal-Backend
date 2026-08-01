// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PART 1c — WHAT EACH PLACEMENT COSTS. Exact token counts (Gemini's own `countTokens`, not chars/4),
// and the two cost SHAPES, which are what actually decide the placement.
//
// ★ THE TWO SHAPES ARE NOT THE SAME KIND OF NUMBER, and reporting a single "tokens added" for both
// would hide the whole finding:
//   · SYSTEM PROMPT (tone.ts) — one copy per GENERATION. Linear in generations. A 10-turn session with
//     25 generations pays 25D and that is the end of it.
//   · TOOL RESULT — one copy per tool CALL, and every copy is PERSISTED into history (sessions.ts
//     `loadHistoryForModel` replays tool_call/tool_result rows) and therefore RESENT on every later
//     generation of the session. Copy i is paid (generations after i) times. That is quadratic in the
//     session, not linear, and it is invisible in a single-turn measurement.
//
//   npx tsx src/scripts/measure-depth-placement.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { GoogleGenAI } from "@google/genai";
import { resolveTone, COMPANY_ANSWER_SHAPE, EXPLANATORY_DEPTH, NON_ADVISORY_SPINE } from "../ai/tone.js";
import { buildSystemPrompt } from "../chat/voice.js";
import { VYTAL_CONTEXT_LAYER } from "../ai/context-layer.js";
import { toolSpecs } from "../chat/tools/registry.js";

const MODEL = process.env.AI_CHAT_MODEL ?? "gemini-3.5-flash-lite";
const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.AI_API_KEY ?? "";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/** Exact count where a key is available; the chars/4 estimate (clearly labelled) where it is not. */
async function count(text: string): Promise<{ n: number; exact: boolean }> {
  if (!ai) return { n: Math.round(text.length / 4), exact: false };
  try {
    const r = await ai.models.countTokens({ model: MODEL, contents: text });
    return { n: r.totalTokens ?? Math.round(text.length / 4), exact: true };
  } catch {
    return { n: Math.round(text.length / 4), exact: false };
  }
}

const row = (label: string, n: number, note = ""): void =>
  console.log(`  ${label.padEnd(46)}${String(n).padStart(8)}  ${note}`);

async function main() {
  const balanced = resolveTone(null, null);
  const fixed = buildSystemPrompt(balanced.systemDirective);

  const [D, fx, cl, ed, sp, specs] = await Promise.all([
    count(COMPANY_ANSWER_SHAPE),
    count(fixed),
    count(VYTAL_CONTEXT_LAYER),
    count(EXPLANATORY_DEPTH),
    count(NON_ADVISORY_SPINE),
    count(JSON.stringify(toolSpecs())),
  ]);

  console.log("═".repeat(96));
  console.log(`TOKEN SIZES — ${D.exact ? `EXACT (${MODEL} countTokens)` : "ESTIMATED (chars/4 — no API key)"}\n`);
  row("THE FIXED BLOCK (system prompt, per generation)", fx.n);
  row("  · of which VYTAL_CONTEXT_LAYER", cl.n);
  row("  · of which EXPLANATORY_DEPTH", ed.n, "the sibling shape rule");
  row("  · of which NON_ADVISORY_SPINE", sp.n);
  row("★ COMPANY_ANSWER_SHAPE (the new directive)", D.n, `${((D.n / (fx.n - D.n)) * 100).toFixed(1)}% on top of the block without it`);
  row("the 33 tool declarations (also per generation)", specs.n);

  // ── The session model. Shape read from the measured BEFORE arm where available, so the multipliers
  //    are this system's, not a guess. ──
  let genPerTurn = 3, toolResultsPerTurn = 2;
  try {
    const arm = JSON.parse(readFileSync(`${process.env.TEMP ?? "."}/depth-before.json`.replace(/\\/g, "/"), "utf8")) as {
      rounds: number; tools: string[];
    }[];
    const stockTurns = arm.filter((t) => t.rounds > 0);
    genPerTurn = stockTurns.reduce((n, t) => n + t.rounds + 1, 0) / Math.max(1, stockTurns.length);
    toolResultsPerTurn = stockTurns.reduce((n, t) => n + t.tools.length, 0) / Math.max(1, stockTurns.length);
    console.log(`\n  session shape read from the MEASURED before-arm: ${genPerTurn.toFixed(1)} generations and ${toolResultsPerTurn.toFixed(1)} tool results per data turn`);
  } catch {
    console.log(`\n  ⚠ before-arm file absent — session shape assumed (${genPerTurn} generations, ${toolResultsPerTurn} tool results per data turn)`);
  }

  console.log(`\n${"═".repeat(96)}`);
  console.log("WHAT EACH PLACEMENT COSTS OVER A SESSION\n");
  console.log(`  ${"turns".padEnd(9)}${"generations".padEnd(14)}${"A · system prompt".padEnd(22)}${"B · tool result".padEnd(22)}ratio B/A`);
  console.log("  " + "─".repeat(80));
  for (const turns of [1, 3, 5, 10, 20]) {
    const G = Math.round(turns * genPerTurn);
    const A = G * D.n;
    // Copy k is produced partway through turn k and resent by every LATER generation in the session.
    let B = 0;
    for (let t = 0; t < turns; t++) {
      const producedAtGen = Math.round((t + 0.5) * genPerTurn);
      B += Math.round(toolResultsPerTurn) * D.n * Math.max(1, G - producedAtGen + 1);
    }
    console.log(
      `  ${String(turns).padEnd(9)}${String(G).padEnd(14)}${A.toLocaleString().padEnd(22)}${B.toLocaleString().padEnd(22)}${(B / A).toFixed(1)}×`,
    );
  }
  console.log(
    `\n  ⚠ B also has a floor A does not: the directive is emitted once per TOOL CALL, and a turn that calls\n` +
      `    ${Math.round(toolResultsPerTurn)} tools pays ${Math.round(toolResultsPerTurn)} copies of it in the same context window — the model reads the same\n` +
      `    instruction ${Math.round(toolResultsPerTurn)} times before writing one answer.\n` +
      `  ★ A has a floor B does not: it is paid on "hey" and "thanks" too, where B is exactly 0.`,
  );
  console.log("═".repeat(96));
}
main();
