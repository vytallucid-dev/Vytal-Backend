// Read-only diagnostic: verify unit convention of pledge fields across SEBI XBRL vintages.
// NO WRITES. Run: npx tsx src/scripts/diagnose-pledge-units.ts

import { prisma } from "../db/prisma.js";

const TOLERANCE_PP = 1.0; // within 1 percentage-point → same value

type UnitVerdict = "percent" | "fraction" | "mismatch" | "zero_computed";

function classifyUnit(stored: number, computed: number): UnitVerdict {
  if (computed === 0) return "zero_computed";
  const ratio = stored / computed;
  if (Math.abs(stored - computed) <= TOLERANCE_PP) return "percent";
  if (Math.abs(stored - computed / 100) <= TOLERANCE_PP / 100) return "fraction";
  return "mismatch";
}

function inferVintage(xbrlUrl: string | null, sourceDate: Date | null): string {
  // SEBI taxonomy vintages: 2022-09-30, 2025-05-31, 2025-10-31
  if (xbrlUrl) {
    if (xbrlUrl.includes("2025-10-31") || xbrlUrl.includes("20251031")) return "2025-10-31";
    if (xbrlUrl.includes("2025-05-31") || xbrlUrl.includes("20250531")) return "2025-05-31";
    if (xbrlUrl.includes("2022-09-30") || xbrlUrl.includes("20220930")) return "2022-09-30";
  }
  // Fall back to sourceDate range heuristic
  if (sourceDate) {
    const d = sourceDate;
    if (d >= new Date("2025-10-31")) return "2025-10-31";
    if (d >= new Date("2025-05-31")) return "2025-05-31";
    return "2022-09-30";
  }
  return "unknown";
}

async function main() {
  console.log("=".repeat(100));
  console.log("PLEDGE UNIT DIAGNOSTIC — read-only, no writes");
  console.log("=".repeat(100));

  // ── 1. Null/zero rates for the three pledge fields ──────────────────────────
  const totalRows = await prisma.shareholdingPattern.count();

  const nullPledgedPct = await prisma.shareholdingPattern.count({
    where: { promoterPledgedPct: null },
  });
  const zeroPledgedPct = await prisma.shareholdingPattern.count({
    where: { promoterPledgedPct: 0 },
  });
  const nullPledgedSharesPct = await prisma.shareholdingPattern.count({
    where: { promoterPledgedSharesPct: null },
  });
  const zeroPledgedSharesPct = await prisma.shareholdingPattern.count({
    where: { promoterPledgedSharesPct: 0 },
  });
  const nullPledgedShares = await prisma.shareholdingPattern.count({
    where: { pledgedShares: null },
  });
  const zeroPledgedShares = await prisma.shareholdingPattern.count({
    where: { pledgedShares: { equals: BigInt(0) } },
  });

  console.log(`\nTOTAL ShareholdingPattern rows: ${totalRows}`);
  console.log("\nNULL / ZERO RATES:");
  const pct = (n: number) => `${n} (${((n / totalRows) * 100).toFixed(1)}%)`;
  console.log(`  promoterPledgedPct:       null=${pct(nullPledgedPct)}  zero=${pct(zeroPledgedPct)}`);
  console.log(`  promoterPledgedSharesPct: null=${pct(nullPledgedSharesPct)}  zero=${pct(zeroPledgedSharesPct)}`);
  console.log(`  pledgedShares:            null=${pct(nullPledgedShares)}  zero=${pct(zeroPledgedShares)}`);

  // ── 2. Rows with LIVE pledging ───────────────────────────────────────────────
  // Fetch all rows where pledgedShares > 0 AND promoterShares > 0 AND promoterPledgedPct present
  const pledgeRows = await prisma.shareholdingPattern.findMany({
    where: {
      pledgedShares: { gt: BigInt(0) },
      promoterShares: { gt: BigInt(0) },
      promoterPledgedPct: { not: null },
    },
    select: {
      id: true,
      symbol: true,
      fiscalYear: true,
      quarter: true,
      asOnDate: true,
      promoterShares: true,
      totalShares: true,
      pledgedShares: true,
      promoterPledgedPct: true,
      promoterPledgedSharesPct: true,
      xbrlUrl: true,
      sourceDate: true,
    },
    orderBy: [{ symbol: "asc" }, { asOnDate: "asc" }],
  });

  console.log(`\nRows with pledgedShares > 0 AND promoterShares > 0 AND promoterPledgedPct non-null: ${pledgeRows.length}`);

  if (pledgeRows.length === 0) {
    console.log("  No pledging rows found — cannot determine unit convention from live data.");
    await prisma.$disconnect();
    return;
  }

  // ── 3. Per-row unit verdict ─────────────────────────────────────────────────
  interface RowVerdict {
    symbol: string;
    fiscalYear: string;
    quarter: string | null;
    vintage: string;
    storedPledgedPct: number;
    computedPledgedPct: number; // pledgedShares / promoterShares * 100
    ratio: number;
    verdict: UnitVerdict;
    storedSharesPct: number | null;
    computedSharesPct: number | null; // pledgedShares / totalShares * 100
    sharesVerdict: UnitVerdict | "no_data";
  }

  const verdicts: RowVerdict[] = [];

  for (const r of pledgeRows) {
    const storedPledgedPct = Number(r.promoterPledgedPct!);
    const computedPledgedPct =
      (Number(r.pledgedShares!) / Number(r.promoterShares!)) * 100;
    const ratio = computedPledgedPct === 0 ? NaN : storedPledgedPct / computedPledgedPct;
    const verdict = classifyUnit(storedPledgedPct, computedPledgedPct);

    let computedSharesPct: number | null = null;
    let sharesVerdict: UnitVerdict | "no_data" = "no_data";
    if (r.totalShares && r.totalShares > 0n) {
      computedSharesPct = (Number(r.pledgedShares!) / Number(r.totalShares)) * 100;
    }
    if (r.promoterPledgedSharesPct !== null && computedSharesPct !== null) {
      sharesVerdict = classifyUnit(Number(r.promoterPledgedSharesPct), computedSharesPct);
    }

    verdicts.push({
      symbol: r.symbol,
      fiscalYear: r.fiscalYear ?? "?",
      quarter: r.quarter,
      vintage: inferVintage(r.xbrlUrl, r.sourceDate),
      storedPledgedPct,
      computedPledgedPct,
      ratio,
      verdict,
      storedSharesPct: r.promoterPledgedSharesPct !== null ? Number(r.promoterPledgedSharesPct) : null,
      computedSharesPct,
      sharesVerdict,
    });
  }

  // ── 4. Full table ──────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(120));
  console.log("PER-ROW VERDICT: promoterPledgedPct vs pledgedShares/promoterShares*100");
  console.log("─".repeat(120));
  const h = [
    "symbol".padEnd(14),
    "FY".padEnd(6),
    "Q".padEnd(3),
    "vintage".padEnd(12),
    "stored%".padStart(9),
    "computed%".padStart(10),
    "ratio".padStart(7),
    "verdict".padEnd(14),
    "st.shares%".padStart(11),
    "cmp.sh%".padStart(9),
    "shVerdict".padEnd(12),
  ].join(" ");
  console.log(h);
  console.log("─".repeat(h.length));

  for (const v of verdicts) {
    console.log(
      [
        v.symbol.padEnd(14),
        v.fiscalYear.padEnd(6),
        (v.quarter ?? "ANN").padEnd(3),
        v.vintage.padEnd(12),
        v.storedPledgedPct.toFixed(4).padStart(9),
        v.computedPledgedPct.toFixed(4).padStart(10),
        (isNaN(v.ratio) ? "N/A" : v.ratio.toFixed(3)).padStart(7),
        v.verdict.padEnd(14),
        (v.storedSharesPct === null ? "—" : v.storedSharesPct.toFixed(4)).padStart(11),
        (v.computedSharesPct === null ? "—" : v.computedSharesPct.toFixed(4)).padStart(9),
        (v.sharesVerdict === "no_data" ? "—" : v.sharesVerdict).padEnd(12),
      ].join(" "),
    );
  }

  // ── 5. Cross-tab: verdict × vintage ────────────────────────────────────────
  const vintages = [...new Set(verdicts.map((v) => v.vintage))].sort();
  const vrdKeys: UnitVerdict[] = ["percent", "fraction", "mismatch", "zero_computed"];

  console.log("\n" + "─".repeat(80));
  console.log("CROSS-TAB: verdict × vintage (promoterPledgedPct)");
  console.log("─".repeat(80));
  console.log(
    "vintage".padEnd(14) +
      vrdKeys.map((k) => k.padStart(14)).join("") +
      "  TOTAL".padStart(8),
  );
  for (const vintage of vintages) {
    const rows = verdicts.filter((v) => v.vintage === vintage);
    const counts = vrdKeys.map((k) => rows.filter((v) => v.verdict === k).length);
    console.log(
      vintage.padEnd(14) +
        counts.map((c) => String(c).padStart(14)).join("") +
        String(rows.length).padStart(8),
    );
  }
  // Total row
  const totals = vrdKeys.map((k) => verdicts.filter((v) => v.verdict === k).length);
  console.log(
    "TOTAL".padEnd(14) +
      totals.map((c) => String(c).padStart(14)).join("") +
      String(verdicts.length).padStart(8),
  );

  // Same for promoterPledgedSharesPct
  const spVerdicts = verdicts.filter((v) => v.sharesVerdict !== "no_data");
  if (spVerdicts.length > 0) {
    console.log("\n" + "─".repeat(80));
    console.log("CROSS-TAB: verdict × vintage (promoterPledgedSharesPct vs pledgedShares/totalShares)");
    console.log("─".repeat(80));
    const spVrdKeys: (UnitVerdict | "no_data")[] = ["percent", "fraction", "mismatch", "zero_computed"];
    console.log(
      "vintage".padEnd(14) +
        spVrdKeys.map((k) => k.padStart(14)).join("") +
        "  TOTAL".padStart(8),
    );
    for (const vintage of vintages) {
      const rows = spVerdicts.filter((v) => v.vintage === vintage);
      if (rows.length === 0) continue;
      const counts = spVrdKeys.map((k) => rows.filter((v) => v.sharesVerdict === k).length);
      console.log(
        vintage.padEnd(14) +
          counts.map((c) => String(c).padStart(14)).join("") +
          String(rows.length).padStart(8),
      );
    }
    const spTotals = spVrdKeys.map((k) => spVerdicts.filter((v) => v.sharesVerdict === k).length);
    console.log(
      "TOTAL".padEnd(14) +
        spTotals.map((c) => String(c).padStart(14)).join("") +
        String(spVerdicts.length).padStart(8),
    );
  }

  // ── 6. Stocks with live pledging ────────────────────────────────────────────
  const pledgingSymbols = [...new Set(verdicts.map((v) => v.symbol))].sort();
  console.log("\n" + "─".repeat(80));
  console.log(`STOCKS WITH LIVE PLEDGING DATA: ${pledgingSymbols.length} stock(s)`);
  console.log("─".repeat(80));
  for (const sym of pledgingSymbols) {
    const rows = verdicts.filter((v) => v.symbol === sym);
    const vs = [...new Set(rows.map((r) => r.verdict))].join(", ");
    console.log(`  ${sym.padEnd(16)} ${rows.length} row(s), verdicts: ${vs}`);
  }

  // ── 7. Example rows for any fraction/mismatch ───────────────────────────────
  const badRows = verdicts.filter((v) => v.verdict === "fraction" || v.verdict === "mismatch");
  if (badRows.length > 0) {
    console.log("\n" + "═".repeat(80));
    console.log(`FRACTION/MISMATCH EXAMPLES (up to 5 of ${badRows.length}):`);
    console.log("═".repeat(80));
    for (const r of badRows.slice(0, 5)) {
      console.log(
        `  ${r.symbol} ${r.fiscalYear} ${r.quarter ?? "ANN"} [${r.vintage}]:\n` +
          `    stored promoterPledgedPct = ${r.storedPledgedPct}\n` +
          `    computed (pledged/promoter*100) = ${r.computedPledgedPct.toFixed(4)}\n` +
          `    ratio (stored/computed) = ${r.ratio.toFixed(4)} → ${r.verdict}`,
      );
    }
  }

  // ── 8. Decisive summary lines ────────────────────────────────────────────────
  const pctCount = totals[0];
  const fracCount = totals[1];
  const misCount = totals[2];
  let pledgedPctUnit: string;
  if (fracCount === 0 && misCount === 0) pledgedPctUnit = "PERCENT";
  else if (pctCount === 0 && misCount === 0) pledgedPctUnit = "FRACTION";
  else if (fracCount > 0 && pctCount > 0) pledgedPctUnit = "MIXED-by-vintage";
  else pledgedPctUnit = "SEMANTIC-MISMATCH";

  const spPctOk = spVerdicts.filter((v) => v.sharesVerdict === "percent").length;
  const spFracBad = spVerdicts.filter((v) => v.sharesVerdict !== "percent" && v.sharesVerdict !== "zero_computed").length;
  const promoterSharesPctMatch = spVerdicts.length === 0 ? "NO DATA" : spFracBad === 0 ? "YES" : "NO";

  console.log("\n" + "═".repeat(100));
  console.log("DECISIVE SUMMARY");
  console.log("═".repeat(100));
  console.log(`  promoterPledgedPct unit: ${pledgedPctUnit}.`);
  console.log(
    `  promoterPledgedSharesPct matches its claimed definition (% of total): ${promoterSharesPctMatch}` +
      (spVerdicts.length > 0 ? ` (${spPctOk}/${spVerdicts.length} rows pass)` : "") +
      ".",
  );
  console.log(
    `  Stocks with live pledging data: [${pledgingSymbols.join(", ")}] (${pledgingSymbols.length} stock${pledgingSymbols.length === 1 ? "" : "s"}).`,
  );
  if (pledgedPctUnit !== "PERCENT") {
    console.log(`\n  ⚠️  ACTION NEEDED: promoterPledgedPct is NOT stored as percent — rescaling required before use.`);
  }
  console.log("═".repeat(100));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
