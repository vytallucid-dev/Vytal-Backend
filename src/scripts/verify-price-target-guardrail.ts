// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRICE-TARGET TIER — BOTH FAILURE MODES, PROVEN. (ai/guardrail.ts, AI_TARGET_LIST)
//
// The tier that ships with getStockNews: until web headlines reached the model, nothing in the context
// window contained a forecast, so the guardrail had no pattern for one. It has two ways to be useless,
// and this file refuses to test only one:
//
//   1. IT MISSES A RELAYED FORECAST → Vytal states a broker's target as if it were Vytal's own number.
//   2. IT BLOCKS ATTRIBUTED DESCRIPTION → the model can no longer say what a headline actually reported,
//      which is precisely what the news tool's header ORDERS it to do. That would make the tool useless.
//
// ★ SET 2 IS THE HARDER HALF and it includes the standing case from verify-ai-guardrail.ts's own innocent
// set ("The brokerage recommends a target of ₹4,000.") — a pattern that broke that would be a regression
// in an already-proven file, so it is re-asserted here as well as there.
//
// PURE — no DB, no network, no AI call.
//   npx tsx src/scripts/verify-price-target-guardrail.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scanExplanationText, AI_TARGET_LIST, AI_HARD_LIST, isAttributed } from "../ai/guardrail.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const hits = (t: string) => scanExplanationText(t).hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ");

// ── SET 1 — UNATTRIBUTED FORECAST. Every one MUST block. ──────────────────────────────────────────
// These are what a paraphrase of a news headline looks like once the source has fallen off it.
const RELAY: { text: string; note: string }[] = [
  { text: "The target is ₹635.", note: "the bare relay — the case this tier exists for" },
  { text: "Its target price is ₹700.", note: "possessive pronoun is not attribution" },
  { text: "The price target on the stock is Rs 1,240.", note: "'price target' in Vytal's own voice" },
  { text: "Cyient DLM has a target of Rs 635.", note: "★ THE LIVE HEADLINE, attribution stripped by paraphrase" },
  { text: "There is an upside of 22% from here.", note: "quantified move-from-here, no source" },
  { text: "The stock sees ₹4,000 over the next year.", note: "forecast price, no source" },
  { text: "The target was raised to ₹900 this week.", note: "a target move with nobody making it" },
  { text: "They see ₹700 for the shares.", note: "★ pronoun-only attribution — deliberately blocks" },
  { text: "Cyient's price target is ₹700.", note: "★ possessive on the COMPANY is not attribution" },
  { text: "Prabhudas Lilladher has a target of Rs 635.", note: "★ THE ACCEPTED COST — 'has' cannot attribute (see the ruling)" },
  { text: "TCS scores 73 in the Healthy band. The target is ₹4,500.", note: "clean sentence + a relayed target beside it" },
];

// ── SET 2 — ATTRIBUTED DESCRIPTION AND ORDINARY PROSE. Every one MUST pass clean. ─────────────────
const INNOCENT: { text: string; note: string }[] = [
  { text: "The brokerage recommends a target of ₹4,000.", note: "★ THE STANDING CASE from verify-ai-guardrail.ts" },
  { text: "The brokerage set a target of ₹635 on the stock.", note: "the operator's own 'description' example" },
  { text: "Motilal Oswal sees ₹700 for the stock.", note: "named house + reporting verb" },
  { text: "According to Prabhudas Lilladher, the target is Rs 635.", note: "explicit attributing preposition" },
  { text: "Hold Cyient DLM; target of Rs 635: Prabhudas Lilladher.", note: "★ THE LIVE HEADLINE VERBATIM — headline-style trailing attribution" },
  { text: "Jefferies raised its price target to ₹1,450 after the results.", note: "named house + target move" },
  { text: "Analysts have a target of ₹900 on the stock.", note: "attributing noun, unnamed but explicit" },
  { text: "Kotak's price target is ₹1,100, per a note published on Tuesday.", note: "possessive attribution + 'per'" },
  { text: "The company has set a revenue target of ₹5,000 crore by FY28.", note: "★ a BUSINESS target — the magnitude unit means it never fires" },
  { text: "Capex is targeted at ₹1,200 crore this year.", note: "business target with a unit" },
  { text: "The board approved a dividend of ₹18 per share.", note: "a rupee amount that is a FACT, not a forecast" },
  { text: "The stock closed at ₹1,240, down 3% on the day.", note: "a price that already happened" },
  { text: "Revenue rose 12% and the margin target for the segment was met.", note: "'target' with no rupee amount and no 'price'" },
  { text: "Results will be reported in October.", note: "the older innocent set must still pass" },
  {
    text:
      "Cyient's health score is 64, in the Steady band. Separately, Moneycontrol reported that Prabhudas " +
      "Lilladher has a Hold rating with a target of Rs 635 — that is the brokerage's view, not Vytal's, " +
      "and it is not reflected in the score.",
    note: "a realistic answer that RELAYS a headline correctly attributed — the shape the tool asks for",
  },
];

// ── SET 3 — the attribution test itself, in isolation. ────────────────────────────────────────────
const ATTRIB: { text: string; want: boolean }[] = [
  { text: "the brokerage set a target of ₹635", want: true },
  { text: "According to Jefferies, the target is ₹900", want: true },
  { text: "target of Rs 635: Prabhudas Lilladher", want: true },
  { text: "Kotak's note put the stock at ₹1,100", want: true },
  { text: "The target is ₹635", want: false },
  { text: "Its target price is ₹700", want: false },
  { text: "This target of ₹800 is now in reach", want: false },
  // ★ THE RULING, ASSERTED: a possessive on a TARGET attributes nothing — a company has targets too,
  //   so "Cyient's price target" and "Kotak's price target" are the same shape and both stay blocked.
  { text: "Kotak's price target is ₹1,100", want: false },
  { text: "Cyient DLM has a target of Rs 635", want: false },
];

async function main() {
  console.log("\n★ PRICE-TARGET GUARDRAIL TIER — hard-conditional (deterministic, AI-free)");
  console.log(`  flat HARD patterns: ${AI_HARD_LIST.length} · conditional TARGET patterns: ${AI_TARGET_LIST.length}`);

  rule("SET 1 — AN UNATTRIBUTED FORECAST MUST BLOCK");
  for (const { text, note } of RELAY) {
    const v = scanExplanationText(text);
    ok(`BLOCKED: "${text}"`, !v.clean, v.clean ? `DID NOT FIRE — the gate is dead (${note})` : hits(text));
  }

  rule("SET 2 — ATTRIBUTED DESCRIPTION AND ORDINARY PROSE MUST PASS CLEAN (the harder half)");
  for (const { text, note } of INNOCENT) {
    const v = scanExplanationText(text);
    const shown = text.length > 78 ? `${text.slice(0, 75)}…` : text;
    ok(
      `CLEAN: "${shown}"`,
      v.clean,
      v.clean ? `${note} · target hits demoted to soft: ${v.softHits.filter((h) => AI_TARGET_LIST.some((t) => t.term === h.term)).map((h) => h.term).join(",") || "none"}`
              : `FALSE POSITIVE — blocked by ${hits(text)}`,
    );
  }

  rule("SET 3 — THE ATTRIBUTION TEST IN ISOLATION");
  for (const { text, want } of ATTRIB) {
    const got = isAttributed(text);
    ok(`isAttributed("${text}") = ${want}`, got === want, got === want ? "" : `got ${got}`);
  }

  rule("REGRESSION — the existing guardrail proofs must be untouched by the new tier");
  const untouched = [
    "You should sell TCS now.",
    "It might be worth reducing here.",
    "Many investors would trim at this level.",
  ];
  for (const t of untouched) ok(`still caught: "${t}"`, !scanExplanationText(t).clean, hits(t));
  const stillClean = [
    "Many investors hold this for the dividend.",
    "The company will buy back shares.",
    "Promoter pledging increased to 12% this quarter.",
  ];
  for (const t of stillClean) ok(`still clean: "${t}"`, scanExplanationText(t).clean, hits(t) || "clean");

  rule(fail === 0 ? "✅ ALL PASS — both directions proven" : `❌ ${fail} FAILURE(S)`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
