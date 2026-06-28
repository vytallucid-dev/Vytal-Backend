// ─────────────────────────────────────────────────────────────
// GATE — Stage 1h (ShareholdingPattern residual othersPct/retailPct). READ-ONLY.
// The ONLY shareholding column derived from other STORED columns is the
// residual others/retail % = max(0, public − fii − dii). Everything else is
// disclosed-from-XBRL (fill-as-is). Verify the residual reproduces stored
// othersPct/retailPct (within the rounding floor) for rows where fii/dii present.
// Run:  npx tsx src/scripts/verify-derive-shareholding.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { deriveOthersPct } from "../ingestions/shareholdings/shareholding-derive.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

function unit() {
  console.log("\n[A] Synthetic unit-checks");
  check("deriveOthersPct(100,20,30) = 50", deriveOthersPct(100, 20, 30) === 50);
  check("deriveOthersPct(50,10,45) = 0 (clamped at 0)", deriveOthersPct(50, 10, 45) === 0);
  check("deriveOthersPct(100,null,30) = null (fii absent → not re-derivable)", deriveOthersPct(100, null, 30) === null);
  check("deriveOthersPct(100,20,null) = null", deriveOthersPct(100, 20, null) === null);
  check("rounding: deriveOthersPct(85.5, 12.34, 8.16) = 65", deriveOthersPct(85.5, 12.34, 8.16) === 65);
}

async function main() {
  unit();
  const rows = await prisma.shareholdingPattern.findMany({
    select: { id: true, symbol: true, asOnDate: true, publicPct: true, fiiPct: true, diiPct: true, othersPct: true, retailPct: true },
  });
  let exact = 0, withinTol = 0, breach = 0, skipNoFiiDii = 0, retailMismatch = 0;
  let maxAbs = new Prisma.Decimal(0);
  for (const r of rows) {
    const fii = num(r.fiiPct), dii = num(r.diiPct), pub = num(r.publicPct);
    if (fii == null || dii == null || pub == null) { skipNoFiiDii++; continue; }
    const derived = deriveOthersPct(pub, fii, dii);
    if (derived == null) { skipNoFiiDii++; continue; }
    const dd = new Prisma.Decimal(derived);
    // retailPct must equal othersPct (same value by construction)
    if (r.othersPct != null && r.retailPct != null && !r.othersPct.equals(r.retailPct)) retailMismatch++;
    const stored = r.othersPct;
    if (stored == null) { breach++; console.log(`     [breach] ${r.symbol}@${r.asOnDate.toISOString().slice(0,10)} stored othersPct=null derived=${derived}`); continue; }
    const abs = stored.minus(dd).abs();
    if (stored.equals(dd)) { exact++; continue; }
    if (abs.lessThanOrEqualTo(0.01)) { withinTol++; if (abs.greaterThan(maxAbs)) maxAbs = abs; continue; }
    breach++; console.log(`     [breach] ${r.symbol}@${r.asOnDate.toISOString().slice(0,10)} public=${pub} fii=${fii} dii=${dii} stored=${stored} derived=${derived} |Δ|=${abs}`);
  }
  console.log(`\n[B] rows=${rows.length} | exact=${exact} withinTol=${withinTol} breach=${breach} skip(no fii/dii)=${skipNoFiiDii} | maxAbsΔ=${maxAbs}`);
  check("residual othersPct: 0 breaches (gate)", breach === 0, breach);
  check("retailPct == othersPct for all rows", retailMismatch === 0, retailMismatch);
  console.log(`\n=== unit+gate ${pass}/${pass + fail} | breaches ${breach} ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
