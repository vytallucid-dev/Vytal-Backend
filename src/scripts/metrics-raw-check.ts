// Verification harness for the METRIC RAW-VALUE layer (Foundation F1–F10 +
// Momentum M1–M5), STANDALONE only. Reads the DB, computes every raw value, and
// PRINTS the value + formula + inputs + flags per stock, then runs by-hand
// sanity checks and surfaces FLAGS. Computes nothing that scores.
//
//   npx tsx src/scripts/metrics-raw-check.ts
//
// Sample spans sectors: RELIANCE (energy/petchem, fully dual-basis re-scanned),
// TCS (IT services), HINDUNILVR (FMCG), INFY (IT services).

import {
  resolveStockId, loadFoundationStandalone, loadMomentumStandalone, basisCounts,
} from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum, consecutiveTail } from "../scoring/metrics/momentum.js";
import type { MetricValue } from "../scoring/metrics/types.js";

const SAMPLE = ["RELIANCE", "TCS", "HINDUNILVR", "INFY"];

const f = (v: number | null, u: string) => (v === null ? "—" : `${v.toFixed(u === "%" ? 2 : 4)}${u === "%" ? "%" : u === "ratio" ? "" : u === "n/a" ? "" : u}`);

function printMetric(m: MetricValue): void {
  if (m.available) {
    console.log(`  ${m.key.padEnd(3)} ${m.label.padEnd(24)} = ${f(m.value, m.unit).padStart(12)}   ${m.source}`);
    console.log(`        formula: ${m.formula}`);
  } else {
    console.log(`  ${m.key.padEnd(3)} ${m.label.padEnd(24)} = ${"UNAVAILABLE".padStart(12)}   reason=${m.reason}`);
    console.log(`        ${m.formula}`);
  }
  for (const fl of m.flags) console.log(`        ⚑ ${fl}`);
}

async function main() {
  const allFlags: string[] = [];

  for (const symbol of SAMPLE) {
    const stockId = await resolveStockId(symbol);
    console.log(`\n${"═".repeat(96)}\n${symbol}`);
    if (!stockId) { console.log("  (no stock row)"); continue; }

    const counts = await basisCounts(stockId);
    console.log(
      `  basis rows → fundamentals: ${JSON.stringify(counts.fundamentals)}  quarterly: ${JSON.stringify(counts.quarterly)}`,
    );

    // ── FOUNDATION ──
    const fRows = await loadFoundationStandalone(stockId);
    console.log(`\n  ── FOUNDATION (standalone annual; ${fRows.length} rows: ${fRows.map((r) => r.fiscalYear).join(",")}) ──`);
    const fres = computeFoundation(fRows, /* periodAvgPrice */ null);
    if (!fres) console.log("  no standalone annual rows → all Foundation UNAVAILABLE");
    else {
      console.log(`  snapshot FY = ${fres.snapshotFy}`);
      for (const m of fres.metrics) {
        printMetric(m);
        for (const fl of m.flags) if (fl.startsWith("⚠")) allFlags.push(`${symbol} ${m.key}: ${fl}`);
      }
    }

    // ── MOMENTUM ──
    const qRows = await loadMomentumStandalone(stockId);
    const run = consecutiveTail(qRows);
    console.log(
      `\n  ── MOMENTUM (standalone quarterly; ${qRows.length} rows: ${qRows.map((r) => r.fiscalYear + r.quarter).join(",")}) ──`,
    );
    console.log(`  max consecutive run ending at snapshot = ${run.length} (${run.map((r) => r.fiscalYear + r.quarter).join(",")})`);
    const mres = computeMomentum(qRows);
    if (!mres) console.log("  no standalone quarterly rows → all Momentum UNAVAILABLE");
    else {
      console.log(`  snapshot quarter = ${mres.snapshotQuarter}`);
      for (const m of mres.metrics) printMetric(m);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BY-HAND SANITY CHECKS (RELIANCE standalone — the fully re-scanned stock)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(96)}\nBY-HAND SANITY CHECKS — RELIANCE standalone FY26\n`);
  const relId = await resolveStockId("RELIANCE");
  if (relId) {
    const fr = await loadFoundationStandalone(relId);
    const qr = await loadMomentumStandalone(relId);
    const f26 = fr.find((r) => r.fiscalYear === "FY26")!;
    const fres = computeFoundation(fr)!;
    const mres = computeMomentum(qr)!;
    const get = (arr: MetricValue[], k: string) => arr.find((m) => m.key === k)!;

    const sc: { check: string; expect: string; got: string; ok: boolean }[] = [];
    const approx = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

    // 1. ROCE plausibility + matches stored standalone column (7.6453).
    const roce = get(fres.metrics, "F1");
    sc.push({ check: "F1 ROCE reproduces stored standalone roce 7.6453", expect: "7.6453", got: roce.value!.toFixed(4), ok: approx(roce.value!, 7.6453) });
    sc.push({ check: "F1 ROCE plausible for capital-heavy petchem (3–25%)", expect: "3–25%", got: roce.value!.toFixed(2) + "%", ok: roce.value! > 3 && roce.value! < 25 });

    // 2. TTM revenue of FY26 four quarters == FY26 annual revenue (524105) — the
    //    strongest cross-check (TTM of a full FY = that FY annual).
    const ttmRev = Number(get(mres.metrics, "M1").inputs.ttmRevenue);
    sc.push({ check: "M1 TTM revenue (FY26 Q1–Q4) == FY26 annual revenue 524105", expect: "524105", got: String(ttmRev), ok: approx(ttmRev, f26.revenue!, 0.001) });

    // 3. M5 TTM interest coverage == annual F5 (both = FY26 full year, 8.83).
    const f5 = get(fres.metrics, "F5").value!;
    const m5 = get(mres.metrics, "M5").value!;
    sc.push({ check: "M5 TTM IC == annual F5 IC (FY26 full year)", expect: f5.toFixed(2), got: m5.toFixed(2), ok: approx(m5, f5) });

    // 4. M1 OPM is now EBITDA-based (model-wide OPM fix) and RECONCILES to the annual
    //    EBITDA OPM: TTM(FY26 Q1–Q4) == FY26 full year, SAME EBITDA definition
    //    (PBT+interest+depreciation, OI left in). RELIANCE FY26: 14.8987% == 14.8987%.
    const m1 = get(mres.metrics, "M1").value!;
    const annualOpmStored = f26.stored.operatingMargin!; // 14.8987 (EBITDA-based, incl OI)
    sc.push({ check: "M1 OPM (EBITDA) reconciles to annual EBITDA OPM (same definition, post-fix)", expect: `≈${annualOpmStored.toFixed(2)}%`, got: m1.toFixed(2) + "%", ok: approx(m1, annualOpmStored, 0.01) });

    // 5. NPM in a sane 0–40% band (units sanity — a 200% NPM = units bug).
    const m2 = get(mres.metrics, "M2").value!;
    sc.push({ check: "M2 TTM NPM in plausible 0–40% band (units sanity)", expect: "0–40%", got: m2.toFixed(2) + "%", ok: m2 > 0 && m2 < 40 });

    // 6. F4 D/E reproduces stored standalone debtToEquity/100 (0.4086).
    const de = get(fres.metrics, "F4").value!;
    sc.push({ check: "F4 D/E reproduces stored debtToEquity%/100 (0.4086)", expect: "0.4086", got: de.toFixed(4), ok: approx(de, 0.4086) });

    let allok = true;
    for (const s of sc) {
      console.log(`  ${s.ok ? "✓ PASS" : "✗ FAIL"}  ${s.check}\n           expect ${s.expect}  got ${s.got}`);
      if (!s.ok) allok = false;
    }
    console.log(`\n  ${allok ? "✓ ALL SANITY CHECKS PASS" : "✗ A SANITY CHECK FAILED — investigate (likely units or basis)"}`);
  }

  // ── FLAGS roll-up ──
  console.log(`\n${"═".repeat(96)}\nFLAGS (interpretations, ambiguities, stored-column disagreements)\n`);
  const STATIC_FLAGS = [
    "OPM is EBITDA-based MODEL-WIDE: M1 TTM OPM = Σ4Q(PBT+interest+depreciation)/Σrev×100 (PRE-depreciation, other income left in) — the SHARED definition for all 11 non-financial PGs, mirroring the annual EBITDA operating margin (F1_OPM). PG8's M1_OPM_TTM emit-renames the same fn. (Pre-fix M1 used the EBIT operating-profit column = PBT+interest−otherIncome — a model-wide definitional mismatch vs the EBITDA-derived bars; CORRECTED.)",
    "DELIBERATE asymmetry preserved: OPM is PRE-depreciation (EBITDA, M1); ROCE (F1) and interest coverage (F5, M5) are POST-depreciation (EBIT = PBT+interest, includes other income). M1 TTM OPM now RECONCILES to annual EBITDA OPM (verified RELIANCE FY26: 14.8987% == 14.8987%).",
    "F2 ROE uses YEAR-END net worth per spec; the stored `roe` column uses 2-YEAR AVERAGE equity. They differ legitimately — we report the spec value and do not cross-check against stored.",
    "F3 buyback path (i) financing-line is structurally UNAVAILABLE (schema's cashFromFinancing has no separable buyback line). Path (ii) ΔESC detects the SIGNAL but the ₹ amount needs a buyback-period weighted-avg price feed we don't have — detected buybacks are left UNQUANTIFIED (amount null, flagged), value computed with buyback=0. Most sample stocks show ESC stable → confirmed_zero.",
    "Net worth derivation uses totalEquity (else ESC+otherEquity); we deliberately skip equityAttributableToOwners (a consolidated concept; equals totalEquity on standalone rows — verified).",
    "Capital Employed = net worth + total debt (repo convention; reproduces stored standalone roce exactly). The alternative 'total assets − current liabilities' is NOT used (would differ).",
    "F9 OCF Consistency window = 5 fiscal years (chosen, stated); denominator = PRESENT standalone years (absent years are 'unknown', excluded — NOT counted as negative).",
    "STANDALONE GAPS ARE REAL even for re-scanned RELIANCE (FY23/FY24 annual absent; only FY22+FY25+FY26). Non-RELIANCE stocks have only 2 annual + ~5 quarterly standalone rows (dual-basis re-scan pending universe-wide) → F8/F10 and M3/M4 frequently UNAVAILABLE. This is correct standalone-only behaviour, NOT a failure.",
  ];
  for (const fl of STATIC_FLAGS) console.log("  • " + fl + "\n");
  if (allFlags.length) {
    console.log("  STORED-COLUMN DISAGREEMENTS / DETECTED-BUYBACK flags raised this run:");
    for (const fl of allFlags) console.log("    ⚠ " + fl);
  } else {
    console.log("  No stored-column basis disagreements detected on the sample (derived == stored standalone where both present).");
  }

  const { prisma } = await import("../db/prisma.js");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
