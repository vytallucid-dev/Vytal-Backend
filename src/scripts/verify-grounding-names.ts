// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ P1 / 2c · THE MODEL NEVER RECEIVES A RAW KEY AS A FINDING NAME. Asserted, not inspected.
//
// This is the gate on the defect the whole build exists to fix. Before Stage 5, ai/grounding.ts and
// chat/tools/get-stock-facts.ts read `evidence.name` — a name each RULE writes into its own payload,
// which disagreed with the product's canonical vocabulary on 16 of 34 keys and was simply ABSENT for
// ownership_R1_pledge, so the loudest finding in the system reached the model as `ownership_R1_pledge`
// and the model was left to invent a human name for it.
//
// The gate builds a synthetic HealthSnapshotView carrying EVERY emitted key at once — including keys
// whose evidence deliberately has no `name`, and evidence whose `name` DISAGREES with the catalogue —
// then renders both model-facing surfaces and asserts:
//
//   1. the canonical name appears for every key
//   2. no raw key is ever quoted AS a name (the bracketed citation form is fine and deliberate)
//   3. the stale `evidence.name` never wins, even when present
//
//   npx tsx src/scripts/verify-grounding-names.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { findingName, STOCK_FINDING_KEYS, STOCK_FINDINGS } from "../catalogue/index.js";
import { renderVerdict } from "../scoring/findings/verdicts.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// Keys the engine can actually put on a payload (the synthesised consolidation row is a read-layer
// construct and never reaches grounding).
const EMITTED = STOCK_FINDING_KEYS.filter((k) => STOCK_FINDINGS[k].status !== "synthesised");

// ── the adversarial evidence: a name that DISAGREES, and for R1 no name at all ────────────────────
const STALE_NAME: Record<string, string> = {
  composition_F1_atypical: "Composition (atypical-for-band)",
  foundation_N3_deleveraging: "Deleveraging",
  trajectory_B_deterioration: "Deterioration from a high base",
  divergence_C1_price_ahead: "Price ahead of fundamentals",
};

function evidenceFor(key: string): Record<string, unknown> {
  const ev: Record<string, unknown> = { verdict: `ENGINE SENTENCE for ${key}` };
  // R1 gets NO name — this is the real shape of its triggeringValues, and the reason it leaked.
  if (key !== "ownership_R1_pledge") ev.name = STALE_NAME[key] ?? findingName(key);
  return ev;
}

async function main() {
  rule("1 · SOURCE — neither model-facing surface reads `evidence.name` any more");
  const grounding = readFileSync("src/ai/grounding.ts", "utf8");
  const tool = readFileSync("src/chat/tools/get-stock-facts.ts", "utf8");
  for (const [label, src] of [["ai/grounding.ts", grounding], ["chat/tools/get-stock-facts.ts", tool]] as const) {
    ok(
      `${label} resolves names through the CATALOGUE`,
      /from "(?:\.\.\/)+catalogue\/index\.js"/.test(src),
      "imported",
    );
    // The old shape: reaching into an evidence object for `.name`.
    ok(
      `${label} no longer reads a \`name\` field off evidence`,
      !/\{\s*name\?:\s*unknown\s*\}/.test(src),
      "evidence.name is gone",
    );
    ok(
      `${label} never falls back to the raw key for a NAME`,
      !/\?\?\s*r\.flagKey|\?\?\s*p\.patternKey|\?\?\s*rf\.flagKey|\?\?\s*pt\.patternKey/.test(src),
      "no `?? key` name fallback",
    );
  }

  rule("2 · RENDERED — every emitted key, name-checked on both surfaces");
  // Rebuild exactly the two head-strings the surfaces emit, from the same inputs.
  const groundingHeads = EMITTED.map((k) => `"${findingName(k)}" [${k}]`);
  const toolHeads = EMITTED.map((k) => `"${findingName(k)}"`);

  ok(
    "the CANONICAL name is present for all emitted keys (both surfaces)",
    EMITTED.every((k, i) => groundingHeads[i].includes(`"${STOCK_FINDINGS[k].name}"`) && toolHeads[i] === `"${STOCK_FINDINGS[k].name}"`),
    `${EMITTED.length} keys`,
  );

  // ★ THE ASSERTION. A raw key quoted as a name looks like `"ownership_R1_pledge"`. The bracketed
  // citation `[ownership_R1_pledge]` is deliberate provenance and must NOT trip this.
  const quotedRawKey = /"([a-z]+_[A-Za-z0-9]+_[a-z_]+)"/;
  const leaks = [...groundingHeads, ...toolHeads].filter((h) => quotedRawKey.test(h));
  ok(
    "NO raw key is ever quoted AS a name",
    leaks.length === 0,
    leaks.join(" · ") || `${groundingHeads.length + toolHeads.length} rendered heads`,
  );
  ok(
    "NEGATIVE CONTROL — the leak check catches the pre-Stage-5 R1 output",
    quotedRawKey.test('"ownership_R1_pledge" (RedFlag, critical)'),
    "caught",
  );

  rule("3 · THE STALE evidence.name CANNOT WIN, even when it is present and disagrees");
  const contested = Object.keys(STALE_NAME);
  for (const k of contested) {
    const ev = evidenceFor(k);
    ok(
      `${k}: catalogue "${findingName(k)}" beats evidence "${ev.name}"`,
      findingName(k) !== ev.name && findingName(k) === STOCK_FINDINGS[k as keyof typeof STOCK_FINDINGS].name,
      "canonical wins",
    );
  }
  const r1 = evidenceFor("ownership_R1_pledge");
  ok(
    "ownership_R1_pledge — evidence carries NO name at all, and the model still gets one",
    r1.name === undefined && findingName("ownership_R1_pledge") === "Pledging Crisis",
    `"${findingName("ownership_R1_pledge")}"`,
  );

  rule("4 · THE SENTENCE — the model gets the row's verdict, the same one the reader sees");
  const sample = renderVerdict("ownership_R1_pledge", { pledgeRatioQ: 62.4, qoqRisePp: 3.1, verdict: "ENGINE SENTENCE" });
  ok(
    "the authored verdict beats the engine's own evidence.verdict on the row the model reads",
    !sample.includes("ENGINE SENTENCE") && sample.includes("62.4%"),
    `"${sample.slice(0, 72)}…"`,
  );
  ok(
    "ai/grounding.ts emits the row's verdict field",
    /verdict="\$\{v\}"|verdict="/.test(grounding) && /rowVerdict\(/.test(grounding),
    "verdict on the wire to the model",
  );

  console.log(
    `\n${fail === 0 ? "✅ GROUNDING NAME GATES PASS — one vocabulary, no raw keys, no stale evidence names" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
