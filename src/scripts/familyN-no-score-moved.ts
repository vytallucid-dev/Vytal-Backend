// FAMILY-N · NO-SCORE-MOVED PROOF (read-only, NO writes). The load-bearing check (Amendment §7):
// adding Family N must move NOTHING.
//
// ISOLATION — a drift-free in-process A/B. For each PG we run the SAME live findings pass TWICE
// on byte-identical data:
//   • WITH-N   = computePgScores(withFindings)                         (rule set = ALL_RULES)
//   • WITHOUT-N= computePgScores(withFindings, findingsRules=ALL−N)    (Family N removed)
// Because both runs read the same instant's data, ANY difference is attributable to Family N and
// nothing else (this removes the stale-committed-baseline / data-drift confound entirely). We
// then assert, per member:
//   • composite + band + all four pillar subtotals are IDENTICAL between the two runs (findings
//     are downstream of composite — N §347 runs after assembly §334 — so they must never differ);
//   • every non-N finding is byte-identical between the two runs (key set + displayState +
//     magnitude + direction + severity) — i.e. N perturbs no existing finding via dampen/lens;
//   • the ONLY delta is NEW Family-N pattern rows, all magnitude:null.
//
//   npx tsx src/scripts/familyN-no-score-moved.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { FILING_RULES, SCORING_RULES } from "../scoring/findings/engine.js";
import { ruleN1 } from "../scoring/findings/rules/n1-cash-backed-earnings.js";
import { ruleN2 } from "../scoring/findings/rules/n2-working-capital.js";
import { ruleN3 } from "../scoring/findings/rules/n3-deleveraging.js";
import { ruleN4 } from "../scoring/findings/rules/n4-coverage-strengthening.js";
import { ruleN5 } from "../scoring/findings/rules/n5-dual-institutional-build.js";
import { ruleN6 } from "../scoring/findings/rules/n6-promoter-accumulation.js";
import { ruleN7 } from "../scoring/findings/rules/n7-pledge-release.js";
import type { FiredFinding } from "../scoring/findings/types.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ SUPERSEDED BY CONSTRUCTION (filing-pass step 2), AND KEPT AS THE PROOF OF THAT.
//
// This script's original claim was "adding Family N moves nothing", proved by an in-process A/B over
// computePgScores with and without the N rules. As of step 2 Family N does not run in computePgScores
// at all — it moved to the stock-keyed FILING pass with the other 20 filed-data rules — so the A/B
// below now compares a pass against itself and would report a vacuous ✅.
//
// Rather than delete it or let it lie, the assertion is inverted into the fact that now matters:
// Family N is ABSENT from SCORING_RULES and PRESENT in FILING_RULES. If someone re-registers an N
// rule in the scoring pass, this fails. The A/B still runs underneath and must still show zero
// movement — which it now does trivially, and the summary says so rather than claiming a proof it is
// no longer making.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const N_RULES = [ruleN1, ruleN2, ruleN3, ruleN4, ruleN5, ruleN6, ruleN7];
const NON_N_RULES = SCORING_RULES.filter((r) => !N_RULES.includes(r as never));
const isN = (f: FiredFinding) => /_N[1-7]_/.test(f.key);

const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));

// A deterministic fingerprint for a finding (order-independent within a member).
const fp = (f: FiredFinding) =>
  `${f.kind}|${f.key}|${f.direction ?? null}|${f.severity ?? null}|${f.displayState ?? "active"}|${f.magnitude === null || f.magnitude === undefined ? "null" : f.magnitude}`;
const scoreFp = (m: { composite: { composite: number | null; labelBand: unknown; pillars: { pillar: string; subtotal: number | null }[] } }) => {
  const sub = (p: string) => m.composite.pillars.find((x) => x.pillar === p)?.subtotal ?? null;
  return JSON.stringify({ c: m.composite.composite, b: m.composite.labelBand, f: sub("foundation"), mo: sub("momentum"), mk: sub("market"), o: sub("ownership") });
};

async function main() {
  console.log("════ FAMILY-N NO-SCORE-MOVED (read-only, in-process A/B on identical live data) ════\n");

  // ★ THE ASSERTION THAT NOW CARRIES THE WEIGHT — see the note above NON_N_RULES.
  console.log("── 0 · REGISTRY ──");
  const inScoring = N_RULES.filter((r) => SCORING_RULES.includes(r as never)).length;
  const inFiling = N_RULES.filter((r) => FILING_RULES.includes(r)).length;
  console.log(`  ${inScoring === 0 ? "✅" : "❌"} Family N absent from SCORING_RULES (${inScoring}/7 present)`);
  console.log(`  ${inFiling === 7 ? "✅" : "❌"} Family N present in FILING_RULES (${inFiling}/7)`);
  if (inScoring !== 0 || inFiling !== 7) { await prisma.$disconnect(); process.exit(1); }
  console.log("  ↳ the A/B below is therefore TRIVIALLY identical — N no longer runs in this pass.\n");
  let members = 0, scoreIdentical = 0, scoreMoved = 0, existingIdentical = 0, existingMoved = 0, nAdded = 0;
  const movedSamples: string[] = [];
  const nByKey = new Map<string, number>();

  for (const ref of PGS) {
    let withN, withoutN;
    try {
      withN = await computePgScores(ref, { withFindings: true });                          // ALL_RULES (incl N)
      withoutN = await computePgScores(ref, { withFindings: true, findingsRules: NON_N_RULES }); // N removed
    } catch (e) { console.log(`  ${ref.pgId} ERROR: ${(e as Error).message.slice(0, 70)}`); continue; }

    const bySymWithout = new Map(withoutN.members.map((m) => [m.symbol, m]));
    for (const a of withN.members) {
      if (a.composite.state !== "scored" || a.composite.composite === null) continue;
      const b = bySymWithout.get(a.symbol);
      if (!b) continue;
      members++;

      // 1 · composite + pillars identical (findings can't reach the scoring path)
      if (scoreFp(a) === scoreFp(b)) scoreIdentical++;
      else { scoreMoved++; if (movedSamples.length < 10) movedSamples.push(`SCORE ${a.symbol}: withN ${scoreFp(a)} vs withoutN ${scoreFp(b)}`); }

      // 2 · existing (non-N) findings byte-identical between the two runs
      const aNonN = (a.findings ?? []).filter((f) => !isN(f)).map(fp).sort();
      const bAll = (b.findings ?? []).map(fp).sort(); // withoutN has no N findings by construction
      if (JSON.stringify(aNonN) === JSON.stringify(bAll)) existingIdentical++;
      else {
        existingMoved++;
        if (movedSamples.length < 10) {
          const extra = aNonN.filter((x) => !bAll.includes(x));
          const missing = bAll.filter((x) => !aNonN.includes(x));
          movedSamples.push(`FINDINGS ${a.symbol}: +[${extra.join(", ")}] −[${missing.join(", ")}]`);
        }
      }

      // 3 · the additive N delta
      for (const f of (a.findings ?? []).filter(isN)) { nAdded++; nByKey.set(f.key, (nByKey.get(f.key) ?? 0) + 1); }
    }
  }

  console.log(`Members scored & compared (both runs): ${members}\n`);
  console.log(`── COMPOSITE + PILLARS (upstream of findings) ──`);
  console.log(`  identical with/without Family N: ${scoreIdentical}/${members}   moved: ${scoreMoved}`);
  console.log(`\n── EXISTING (non-N) FINDINGS (dampen + lens included) ──`);
  console.log(`  byte-identical with/without Family N: ${existingIdentical}/${members}   moved: ${existingMoved}`);
  movedSamples.forEach((s) => console.log(`     • ${s}`));
  console.log(`\n── FAMILY-N (the additive delta) ──`);
  console.log(`  new N pattern rows: ${nAdded}`);
  [...nByKey.entries()].sort().forEach(([k, c]) => console.log(`     ${k}  ×${c}`));

  const clean = scoreMoved === 0 && existingMoved === 0 && nAdded === 0;
  if (nAdded > 0) console.log(`   ↳ ${nAdded} Family-N finding(s) fired INSIDE computePgScores — N must no longer run there at all.`);
  console.log(`\n════ VERDICT: ${clean ? "✅ Family N is OUT of the scoring pass — it fires nothing here, and nothing else moved" : "❌ SOMETHING MOVED — see samples above"} ════`);
  await prisma.$disconnect();
  process.exit(clean ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
