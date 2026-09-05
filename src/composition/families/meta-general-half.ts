// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GENERAL HALF — the model explains what a measure IS, for Meta and Meta only.
//
// ── ★ THE BOUNDARY, AND WHY IT IS NOT A WEAKENING OF N-1 ──────────────────────────────────────────
// N-1 exists so the model never invents WHAT TCS EARNED. It was never meant to stop the model saying
// what a ratio measures. "What is ROCE" is not a company fact — it is general financial knowledge, and
// Meta is the one family whose subject IS that knowledge.
//
//   THE MODEL WRITES : what the measure is · why it matters · adapted to the reader's register
//   CODE SUPPLIES    : how VYTAL computes it · which pillar it sits in · every figure, as display
//                      strings · `doesntMean` where authored
//
// ⚠ THE CODE HALF IS NOT OPTIONAL AND THIS IS THE WHOLE REASON THE FILE EXISTS. Vytal's ROCE is
//   EBIT-based and POST-depreciation while its operating margin is EBITDA-style. A generic
//   explanation would most likely describe a pre-depreciation ROCE — so the reader would learn a
//   definition that does not match the number they are looking at. That is worse than no definition.
//   `CanonicalMetric.vytalBasis` is authored for exactly the metrics where that gap exists, and it is
//   handed to the model as a fact to state, never as something to work out.
//
// ── ★★ THE GUARDRAIL SHIPS IN THIS FILE, NOT IN A LATER ONE ───────────────────────────────────────
// `prosePasses` is the check that makes N-1 true of MODEL PROSE — the existing one from
// `compose/plan.ts`, exported and consumed rather than copied (N-5). Every sentence the model writes
// here goes through it: the guardrail scanner for advice and forward-looking claims, and a scan that
// rejects any digit that is not a period key. A model surface writing about real figures with no
// guardrail is the shape that produced stage 9's defect list, so there is no arrangement of this file
// in which the model's output reaches a reader unchecked — a failure returns null and the caller says
// plainly that we cannot explain it.
//
// ⚠ AND D-2 HOLDS. The prompt forbids naming any cut-off, band edge or threshold. A concept
//   explanation says what the measure is and how we score it, never the bar a company was measured
//   against.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prosePasses } from "../../compose/plan.js";
import type { ToneDirective } from "../../ai/tone.js";

export interface GeneralHalf {
  /** The model's explanation — two or three sentences, no figures, guardrail-passed. */
  readonly meaning: string;
  /** Whether Vytal's own basis was supplied and therefore must appear on the card. */
  readonly basisSupplied: boolean;
}

/**
 * ★ ONE ASK, TIGHTLY BOUNDED. The model is told what it may write and what it must not, and the
 *   authored basis is given as a sentence to INCLUDE rather than a hint to interpret.
 */
function buildAsk(name: string, pillar: string | null, basis: string | null, tone: ToneDirective): string {
  const parts = [
    `Explain, to a reader of an Indian stock-analysis product, what the financial measure "${name}" is.`,
    `Say what it measures and why it is worth looking at. Two or three sentences.`,
    // ⚠ N-1, STATED TO THE MODEL AS WELL AS ENFORCED AFTER IT. The check is the guarantee; the
    //   instruction is what stops most failures reaching it.
    `Write NO numbers, percentages, ratios or worked figures of any kind — not even as an example.`,
    // ⚠ D-2.
    `Do not mention any threshold, cut-off, band or "good"/"bad" level. Never say what value is healthy.`,
    `Do not give investment advice and do not predict anything.`,
  ];
  if (pillar) parts.push(`It is one of the measures inside our "${pillar}" pillar.`);
  if (basis) {
    // ★ THE BASIS IS QUOTED AT THE MODEL, and it is told to defer to it. Left to itself it would
    //   describe the textbook version, which for ROCE is the wrong one.
    parts.push(
      `IMPORTANT — this product computes it in a specific way, and your explanation must not `
      + `contradict this: ${basis} Do not restate that sentence; just make sure nothing you write `
      + `disagrees with it.`,
    );
  }
  parts.push(tone.systemDirective ? `Match this reader's register: ${tone.level}, ${tone.depth}, jargon ${tone.jargon}.` : "");
  return parts.filter(Boolean).join("\n");
}

/**
 * The model's half, or `null` — and `null` is a real answer the caller must handle by saying so.
 *
 * ⚠ EVERY FAILURE PATH RETURNS NULL RATHER THAN A DEGRADED SENTENCE: no provider, a spend refusal, an
 *   empty completion, or a guardrail rejection. A concept we cannot explain is a thing to state, not
 *   to approximate.
 */
export async function generalHalf(
  name: string,
  pillar: string | null,
  basis: string | null,
  tone: ToneDirective,
  reader: { userId: string } | null,
): Promise<GeneralHalf | null> {
  // ★ METERED THE SAME WAY THE ROUTER METERS, through `checkAndConsumeAiCall` — so this surface is
  //   counted by `ai_usage_counters` like every other real call, and a spend refusal degrades to the
  //   honest "we cannot explain it" rather than to a silent skip.
  let text: string;
  try {
    const { checkAndConsumeAiCall, recordAiTokens } = await import("../../ai/core/quota.js");
    const model = process.env.AI_MODEL ?? "gemini-3.5-flash-lite";
    const decision = await checkAndConsumeAiCall(
      model,
      reader ? { kind: "user", userId: reader.userId } : { kind: "system", job: "meta-general-half" },
    );
    if (!decision.allowed) return null;

    const { createAiProvider } = await import("../../ai/core/registry.js");
    const res = await createAiProvider().generate({
      system: "You explain financial measures plainly and accurately. You never give advice.",
      messages: [{ role: "user", content: buildAsk(name, pillar, basis, tone) }],
      // ⚠ TEMPERATURE 0 FOR THE SAME REASON THE ROUTER PINS IT: a definition is not a creative task,
      //   and the same reader asking twice must not get two different explanations of one measure.
      temperature: 0,
    } as never);
    const spent = (res.usage?.promptTokens ?? 0) + (res.usage?.outputTokens ?? 0);
    if (spent > 0) await recordAiTokens(model, spent);
    text = String(res?.text ?? "").trim();
  } catch {
    // ⚠ NOT AN ABSENCE. A provider failure is ours, and the caller says we could not explain it —
    //   never that no explanation exists.
    return null;
  }
  if (!text) return null;

  // ★★ THE GUARDRAIL. Same function `admitPlan` runs over planner prose; a hit means nothing ships.
  const bad = prosePasses(text);
  if (bad) {
    console.warn(`[meta/general-half] rejected the model's explanation of ${name}: ${bad}`);
    return null;
  }
  return { meaning: text, basisSupplied: basis !== null };
}
