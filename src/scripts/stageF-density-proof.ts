// STAGE-F STEP 2 — full-catalog correctness vs File 1 + loud/quiet/empty density spot-check.
// Prints the COMPLETE fired finding set (sorted by §5 family order) for chosen stocks:
//   - File 1 worked examples (ITC→P11, DIXON→R6, a recovering name→P12/D, …)
//   - known-distressed (LOUD: several findings) vs known-healthy (QUIET/EMPTY: few/none)
// Confirms severity/magnitude/displayState/direction + verbatim copy.
//   npx tsx src/scripts/stageF-density-proof.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));

// §5 family display order (File 1): A red flags → B → C(wide) → D → C(notable) → E → F → G → H → I
const FAMILY_ORDER = (k: string): number => {
  if (k.includes("_R")) return 0; // red flags
  if (k.includes("_B_deterioration")) return 1;
  if (k.startsWith("divergence_C")) return 2;
  if (k.includes("_D_recovery")) return 3;
  if (/_P\d/.test(k)) return 4; // patterns
  if (k.includes("F1") || k.includes("F2")) return 5;
  if (k.includes("_G_")) return 6;
  if (k.includes("_H_")) return 7;
  if (k.includes("_I_")) return 8;
  return 9;
};

const WATCH = ["GLENMARK", "BHEL", "VEDL", "ITC", "DIXON", "WIPRO", "TCS", "ABB", "NESTLEIND", "ASHOKLEY", "POWERINDIA", "HCLTECH"];

async function main() {
  console.log("════ STAGE-F STEP 2 — catalog correctness + density (loud/quiet/empty) ════\n");
  const found = new Map<string, { composite: number; band: string; findings: FiredFinding[] }>();
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    for (const m of c.members) {
      if (WATCH.includes(m.symbol) && m.composite.state === "scored") {
        found.set(m.symbol, { composite: m.composite.composite!, band: m.composite.labelBand!, findings: m.findings ?? [] });
      }
    }
  }
  for (const sym of WATCH) {
    const f = found.get(sym);
    if (!f) { console.log(`── ${sym}: (not in a scored roster)\n`); continue; }
    const sorted = [...f.findings].sort((a, b) => FAMILY_ORDER(a.key) - FAMILY_ORDER(b.key));
    const density = sorted.some((x) => FAMILY_ORDER(x.key) <= 4) ? "LOUD" : sorted.length ? "quiet (context only)" : "EMPTY (nothing notable)";
    console.log(`── ${sym}  composite ${f.composite.toFixed(1)}/${f.band}  — ${sorted.length} findings — ${density} ──`);
    for (const x of sorted) {
      const mag = x.magnitude != null ? ` mag=${x.magnitude}` : "";
      const st = x.displayState && x.displayState !== "active" ? ` [${x.displayState}]` : "";
      const v = (x.evidence as any).verbatim ?? (x.evidence as any).verdict ?? "";
      console.log(`   [${x.kind === "red_flag" ? "RED" : "pat"}] ${x.key.padEnd(42)} sev=${(x.severity ?? "").padEnd(8)}${mag}${x.direction ? ` dir=${x.direction}` : ""}${st}`);
      console.log(`        ${v}`);
    }
    console.log();
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
