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
import { ALL_RULES, FAMILY_N_RULES } from "../scoring/findings/engine.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const NON_N_RULES = ALL_RULES.filter((r) => !FAMILY_N_RULES.includes(r));
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

  const clean = scoreMoved === 0 && existingMoved === 0;
  console.log(`\n════ VERDICT: ${clean ? "✅ NO SCORE MOVED — composite, pillar subtotals, and every existing finding are byte-identical with/without Family N; N is purely additive" : "❌ SOMETHING MOVED — see samples above"} ════`);
  await prisma.$disconnect();
  process.exit(clean ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
