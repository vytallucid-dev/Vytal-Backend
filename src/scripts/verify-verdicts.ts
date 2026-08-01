// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERDICT GATES — Stage 3.
//
//   1. COVERAGE        — every emitted key that has an authored renderer renders; nothing is silently
//                        left to the generic fallback without that being visible in the report.
//   2. NON-EMPTY       — renderVerdict NEVER returns "". A blank verdict on a finding row is a card
//                        with a title and no sentence, which reads as a rendering bug to a reader.
//   3. BRANCHES        — every discriminated renderer is exercised BOTH ways (3d: C2 subtype, C3
//                        floorLed, plus P7 negative-OCF, P8 revenue-fell, P13 direction, B's three
//                        variants, D pillar/composite, G resolution type, H lean, and the plurals).
//   4. PRECEDENCE      — authored renderer > engine's evidence.verbatim/verdict > generic. Asserted
//                        directly, because moving the module must not silently reorder the two
//                        authorities — that would change the sentence on every stock page.
//   5. §8.3 GUARD      — a Family-N verdict with a missing evidence key renders the DESCRIPTION,
//                        never "…for undefined straight years".
//   6. NO INTERPOLATION HOLES — no rendered sentence contains "undefined", "null" or "NaN".
//
// PURE. No DB.
//   npx tsx src/scripts/verify-verdicts.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { VERDICTS, renderVerdict, PILLAR_LABEL } from "../scoring/findings/verdicts.js";
import { STOCK_FINDING_KEYS, STOCK_FINDINGS } from "../catalogue/index.js";
import { VERDICT_FIXTURES } from "./lib/verdict-fixtures.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · COVERAGE — which catalogue keys have an authored File-1 renderer, and which do not");
  const authored = STOCK_FINDING_KEYS.filter((k) => VERDICTS[k] !== undefined);
  const unauthored = STOCK_FINDING_KEYS.filter((k) => VERDICTS[k] === undefined);
  console.log(`  authored renderers: ${authored.length} of ${STOCK_FINDING_KEYS.length} catalogue keys`);
  console.log(`  no renderer:        ${unauthored.join(", ") || "none"}`);
  ok(
    "every key WITHOUT a renderer is explained (only the synthesised consolidation row, which composes its sub-types' sentences)",
    unauthored.every((k) => STOCK_FINDINGS[k].status === "synthesised"),
    unauthored.map((k) => `${k} [${STOCK_FINDINGS[k].status}]`).join(" · ") || "none",
  );
  // The other direction: a renderer for a key the catalogue does not carry would be dead copy.
  const orphanRenderers = Object.keys(VERDICTS).filter((k) => !(STOCK_FINDING_KEYS as readonly string[]).includes(k));
  ok(
    "no renderer exists for a key the catalogue does not carry (no dead verdict copy)",
    orphanRenderers.length === 0,
    orphanRenderers.join(",") || `${Object.keys(VERDICTS).length} renderers, all catalogued`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2–3 · EVERY FIXTURE RENDERS · every branch exercised BOTH ways");
  const rendered = VERDICT_FIXTURES.map((fx) => ({ fx, out: renderVerdict(fx.key, fx.evidence) }));

  ok(
    "renderVerdict NEVER returns an empty string",
    rendered.every((r) => r.out.trim().length > 0),
    rendered.filter((r) => !r.out.trim()).map((r) => r.fx.label).join(" · ") || `${rendered.length} fixtures`,
  );
  const wrongBranch = rendered.filter((r) => r.fx.expectContains && !r.out.includes(r.fx.expectContains));
  ok(
    "every fixture rendered the EXPECTED branch",
    wrongBranch.length === 0,
    wrongBranch.map((r) => `${r.fx.label}: expected "${r.fx.expectContains}" · got "${r.out}"`).join("\n       ") ||
      `${rendered.filter((r) => r.fx.expectContains).length} branch assertions`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · PRECEDENCE — the authored renderer wins; the engine's own sentence is the FALLBACK");
  //
  // ⚠ THIS IS THE ASSERTION THAT PROTECTS THE MOVE. Every rule already writes its own assembled
  // sentence into evidence.verdict / evidence.verbatim. The frontend's renderers overrode it. If the
  // relocated module read the engine's string first — a change that looks like a simplification —
  // every stock page in the product would start showing a different sentence with no copy edited.
  const withEngine = renderVerdict("trajectory_I_band_transition", {
    toBand: "Healthy",
    verdict: "ENGINE SENTENCE — must not win",
    verbatim: "ENGINE VERBATIM — must not win either",
  });
  ok(
    "an authored renderer BEATS both evidence.verdict and evidence.verbatim",
    withEngine === "Crossed into Healthy." && !withEngine.includes("ENGINE"),
    `"${withEngine}"`,
  );
  const noRenderer = renderVerdict("lens_lm7_CASA", { verbatim: "ENGINE VERBATIM", verdict: "ENGINE VERDICT" });
  ok(
    "with NO authored renderer, evidence.verbatim wins over evidence.verdict",
    noRenderer === "ENGINE VERBATIM",
    `"${noRenderer}"`,
  );
  const verdictOnly = renderVerdict("lens_lp2_foundation", { verdict: "ENGINE VERDICT" });
  ok("…and evidence.verdict when there is no verbatim", verdictOnly === "ENGINE VERDICT", `"${verdictOnly}"`);
  const genericA = renderVerdict("ownership_R9_unknown", {});
  const genericE = renderVerdict("foundation_P99_unknown", {});
  ok(
    "with nothing at all, the generic last resort — family-aware (A reads as an override, others as conditional)",
    genericA.includes("override condition") && genericE.includes("conditional signal"),
    `A: "${genericA.slice(0, 48)}…"`,
  );
  // A renderer that THROWS must fall through, not break the response.
  const threw = renderVerdict("composition_F1_atypical", { band: null, get composite() { throw new Error("boom"); } } as never);
  ok(
    "a renderer that THROWS falls through to the engine sentence / generic — never breaks the row",
    typeof threw === "string" && threw.length > 0,
    `"${threw.slice(0, 56)}…"`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · §8.3 GUARD — a Family-N verdict with missing evidence renders the DESCRIPTION");
  const N_KEYS = STOCK_FINDING_KEYS.filter((k) => STOCK_FINDINGS[k].family === "N");
  const guarded = N_KEYS.map((k) => ({ k, out: renderVerdict(k, {}) }));
  ok(
    "all seven N verdicts fall back to their static description when evidence is absent",
    guarded.every((g) => g.out === STOCK_FINDINGS[g.k].description),
    guarded.filter((g) => g.out !== STOCK_FINDINGS[g.k].description).map((g) => g.k).join(",") || `${N_KEYS.length}/7`,
  );
  ok(
    "…and not one of them interpolated a missing value",
    guarded.every((g) => !/undefined|null|NaN/.test(g.out)),
    "no holes",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · NO INTERPOLATION HOLES — no rendered sentence leaks undefined / null / NaN");
  const holes = rendered.filter((r) => /\b(undefined|NaN)\b|\bnull\b/.test(r.out));
  ok(
    "zero interpolation holes across every fixture",
    holes.length === 0,
    holes.map((h) => `${h.fx.label}: "${h.out}"`).join(" · ") || `${rendered.length} sentences`,
  );
  // NEGATIVE CONTROL — an unguarded template really would leak, which is why the guard exists.
  const unguarded = ((ev: Record<string, unknown>) => `for ${ev.years} straight years`)({});
  ok(
    "NEGATIVE CONTROL — an UNGUARDED template leaks 'undefined' (this is what §8.3 prevents)",
    /undefined/.test(unguarded),
    `"${unguarded}"`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · ONE HOME — the renderers are not duplicated anywhere backend-side");
  const svc = readFileSync("src/scoring/read/health-view.service.ts", "utf8");
  ok(
    "health-view.service imports renderVerdict rather than authoring sentences",
    /from "\.\.\/findings\/verdicts\.js"/.test(svc),
    "imported",
  );
  const wl = readFileSync("src/controllers/me/watchlist-enrich.ts", "utf8");
  ok(
    "watchlist-enrich reuses the CANONICAL row type + the same renderer (was a structural clone)",
    /health-view\.types\.js/.test(wl) && /findings\/verdicts\.js/.test(wl),
    "converged",
  );
  ok(
    "PILLAR_LABEL covers all four pillars (the renderers' only display map)",
    ["foundation", "momentum", "market", "ownership"].every((p) => !!PILLAR_LABEL[p]),
    Object.values(PILLAR_LABEL).join(" · "),
  );

  rule("8 · THE RENDERED SENTENCES");
  for (const r of rendered) console.log(`  ${r.fx.label}\n      ${r.out}`);

  console.log(
    `\n${fail === 0 ? `✅ VERDICT GATES PASS — ${rendered.length} fixtures, every branch, precedence preserved` : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
