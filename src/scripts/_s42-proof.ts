// ═══════════════════════════════════════════════════════════════
// S4.2e PROOF — construct the case that overflows TODAY, and show that with the
// bound the value becomes NULL and the row's score-relevant columns survive.
// READ-ONLY, in memory. Parses the REAL document that caused the loss.
//   npx tsx src/scripts/_s42-proof.ts
//
// The subject is ADANIENSOL 2019-06-30 standalone — one of the 4 in-window
// filings Stage 3b lost. Its row is ABSENT from the DB today; this reads the
// filing, runs the SHIPPED parser and the SHIPPED derive, and shows the outcome.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchFilingsList, fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { parseQuarterlyResultXbrl } from "../ingestions/quaterly-results/legacy/parser-legacy-common.js";
import { deriveIndAsQuarterly } from "../ingestions/quaterly-results/derive/derive-indas-quarterly.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const CEIL = 10000; // Decimal(8,4)
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const TARGETS = [
  { sym: "ADANIENSOL", periodEnd: "2019-06-30", basis: "standalone" },
  { sym: "ADANIENSOL", periodEnd: "2020-06-30", basis: "standalone" },
];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4.2e PROOF — the overflow case, against the real document                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  for (const t of TARGETS) {
    console.log(`\n  ══ ${t.sym} ${t.periodEnd} ${t.basis} ══`);
    // is the row absent today? (it was lost in Stage 3b)
    const [db] = await raw<any>(
      `SELECT count(*)::int n FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
        WHERE st."symbol"=$1 AND q."report_date"=DATE '${t.periodEnd}' AND q."result_type"=$2`, t.sym, t.basis);
    console.log(`     row in DB today: ${db.n === 0 ? "✗ ABSENT (this is the loss)" : `${db.n} present`}`);

    let list: any[];
    try { list = await fetchFilingsList(t.sym, "Quarterly"); }
    catch (e) { console.log(`     listing failed: ${(e as Error).message.slice(0, 60)}`); continue; }
    const hit = list.find((f: any) => {
      const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(f.toDate); if (!m) return false;
      const iso = `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      const basis = f.consolidated === "Consolidated" ? "consolidated" : "standalone";
      return iso === t.periodEnd && basis === t.basis;
    });
    if (!hit) { console.log(`     listing entry not found`); continue; }

    const xml = await fetchXbrlFile(hit.xbrl);
    const v2: any = parseQuarterlyResultXbrl(xml, { symbol: t.sym, xbrl: hit.xbrl, consolidated: hit.consolidated });
    console.log(`     parsed: period ${v2.fiscalYear}${v2.quarter} · revenue=${v2.revenue} · operatingProfit=${v2.operatingProfit} · netProfit=${v2.netProfit}`);
    console.log(`             profitBeforeTax=${v2.profitBeforeTax} · depreciation=${v2.depreciation} · interest=${v2.interest}`);

    // the RAW ratio, exactly as the derive computes it before bounding
    const rawOm = v2.operatingProfit !== null && v2.revenue !== null && v2.revenue !== 0
      ? (v2.operatingProfit / v2.revenue) * 100 : null;
    const rawNm = v2.netProfit !== null && v2.revenue !== null && v2.revenue !== 0
      ? (v2.netProfit / v2.revenue) * 100 : null;
    console.log(`\n     RAW operatingMargin = ${rawOm === null ? "null" : rawOm.toFixed(2)}   column ceiling ±${CEIL}`);
    console.log(`     RAW netMargin       = ${rawNm === null ? "null" : rawNm.toFixed(2)}`);
    const wouldFail = (rawOm !== null && Math.abs(rawOm) >= CEIL) || (rawNm !== null && Math.abs(rawNm) >= CEIL);
    console.log(`     ⇒ BEFORE the fix: ${wouldFail ? "⚠ Decimal(8,4) OVERFLOW → the ENTIRE upsert fails → row lost" : "would have fit"}`);

    // run the SHIPPED derive (now bounded)
    const d = deriveIndAsQuarterly(
      { revenue: v2.revenue, netProfit: v2.netProfit, operatingProfit: v2.operatingProfit }, null, null);
    const show = (k: string, v: any) => `${k}=${v === null ? "null" : v.toString()}`;
    console.log(`     AFTER the fix, the six derived columns:`);
    console.log(`        ${show("operatingMargin", d.columns.operatingMargin)}  ${show("netMargin", d.columns.netMargin)}`);
    console.log(`        ${show("revenueQoq", d.columns.revenueQoq)}  ${show("revenueYoy", d.columns.revenueYoy)}  ${show("profitQoq", d.columns.profitQoq)}  ${show("profitYoy", d.columns.profitYoy)}`);
    const allFit = Object.values(d.columns).every((v: any) => v === null || Math.abs(Number(v.toString())) < CEIL);
    console.log(`     ⇒ every derived column now fits the column: ${allFit ? "✓ YES" : "⚠ NO"}`);

    // and the score-relevant columns are untouched
    const scoreRelevant = { revenue: v2.revenue, otherIncome: v2.otherIncome, interest: v2.interest,
      depreciation: v2.depreciation, profitBeforeTax: v2.profitBeforeTax, netProfit: v2.netProfit,
      operatingProfit: v2.operatingProfit };
    const present = Object.entries(scoreRelevant).filter(([, v]) => v !== null).length;
    console.log(`     ⇒ score-relevant columns intact: ${present}/7 populated — ${present > 0 ? "✓ the row SURVIVES with its scoreable content" : "⚠ empty"}`);
    console.log(`        ${Object.entries(scoreRelevant).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
    await new Promise((z) => setTimeout(z, 400));
  }

  // ── the bound must NOT touch a normal row (regression direction) ──
  console.log(`\n  ══ REGRESSION: a NORMAL quarter must be completely unaffected ══`);
  const normals: Array<[string, number, number, number]> = [
    ["typical profitable", 1000, 250, 180],
    ["thin but sane margin", 5000, 60, 30],
    ["loss-making", 800, -120, -150],
    ["exactly at the ceiling-1", 100, 9999, 9999],
  ];
  for (const [label, revenue, operatingProfit, netProfit] of normals) {
    const d = deriveIndAsQuarterly({ revenue, netProfit, operatingProfit }, null, null);
    const om = d.columns.operatingMargin, nm = d.columns.netMargin;
    const expectedOm = (operatingProfit / revenue) * 100, expectedNm = (netProfit / revenue) * 100;
    const okOm = Math.abs(expectedOm) >= CEIL ? om === null : om !== null && Math.abs(Number(om.toString()) - expectedOm) < 0.001;
    const okNm = Math.abs(expectedNm) >= CEIL ? nm === null : nm !== null && Math.abs(Number(nm.toString()) - expectedNm) < 0.001;
    console.log(`     ${pad(label, 26)} rev=${pad(revenue, 6)} opm expect ${pad(expectedOm.toFixed(2), 10)} got ${pad(om === null ? "null" : om.toString(), 10)} ${okOm && okNm ? "✓" : "⚠ CHANGED"}`);
  }
  console.log(`\n  ⇒ the bound fires ONLY outside the column's range; in-range values pass through unchanged.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
