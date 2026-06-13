import { prisma } from "../db/prisma.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

// ─── sample selection ────────────────────────────────────────────────────────

async function pickSample() {
  // Rank stocks by number of shareholding rows (most history first)
  const ranked = await prisma.$queryRaw<
    { symbol: string; industryType: string; cnt: bigint }[]
  >`
    SELECT sp.symbol, s."industryType", COUNT(*) AS cnt
    FROM shareholding_patterns sp
    JOIN stocks s ON s.id = sp."stock_id"
    GROUP BY sp.symbol, s."industryType"
    ORDER BY cnt DESC
  `;

  if (ranked.length === 0) {
    console.log("\nVERDICT: FAIL-NULL — shareholding_patterns table is empty.");
    console.log("No rows exist yet; the parser has not ingested any shareholding data.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Try to bucket: high-promoter (>50%), low/zero-promoter (<10%), banking, non-financial
  // We'll do a quick promoter-pct sample per symbol to classify
  const symbolSet = ranked.map((r) => r.symbol);

  const promoterAvgs = await prisma.$queryRaw<
    { symbol: string; avgPromoter: number }[]
  >`
    SELECT symbol, AVG(CAST(promoter_pct AS FLOAT)) AS "avgPromoter"
    FROM shareholding_patterns
    WHERE symbol = ANY(${symbolSet}::text[])
    GROUP BY symbol
  `;

  const promoterMap = new Map(promoterAvgs.map((r) => [r.symbol, r.avgPromoter]));

  const banking = ranked.filter((r) => r.industryType === "banking");
  const nonFin = ranked.filter((r) => r.industryType === "non_financial");

  const highPromoter = ranked.filter(
    (r) => (promoterMap.get(r.symbol) ?? 0) >= 50
  );
  const lowPromoter = ranked.filter(
    (r) => (promoterMap.get(r.symbol) ?? 100) < 10
  );

  const chosen = new Map<string, { row: (typeof ranked)[0]; reason: string }>();

  const add = (
    row: (typeof ranked)[0] | undefined,
    reason: string
  ) => {
    if (row && !chosen.has(row.symbol)) chosen.set(row.symbol, { row, reason });
  };

  // Top 5 by history count (any type)
  ranked.slice(0, 5).forEach((r) => add(r, `top-${Number(r.cnt)}-rows`));

  // At least 2 banking
  banking.slice(0, 3).forEach((r) => add(r, "banking-sector"));

  // At least 3 high-promoter
  highPromoter.slice(0, 3).forEach((r) =>
    add(r, `high-promoter(${(promoterMap.get(r.symbol) ?? 0).toFixed(0)}%)`)
  );

  // At least 2 low/zero-promoter
  lowPromoter.slice(0, 2).forEach((r) =>
    add(r, `low-promoter(${(promoterMap.get(r.symbol) ?? 0).toFixed(0)}%)`)
  );

  // Fill up to 15 from the ranked list
  for (const r of ranked) {
    if (chosen.size >= 15) break;
    add(r, `filler-rank`);
  }

  return [...chosen.values()];
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(72));
  console.log("SHAREHOLDING PATTERN — promoterShares / totalShares DIAGNOSTIC");
  console.log("=".repeat(72));

  const sample = await pickSample();

  console.log(`\nSAMPLE (${sample.length} stocks):`);
  for (const { row, reason } of sample) {
    console.log(
      `  ${row.symbol.padEnd(14)} industryType=${row.industryType.padEnd(14)} historyRows=${Number(row.cnt)}  reason=${reason}`
    );
  }

  // ── per-stock data ───────────────────────────────────────────────────────

  type RowResult = {
    symbol: string;
    asOnDate: Date;
    promoterShares: bigint | null;
    totalShares: bigint | null;
    promoterPct: number | null;
    impliedPct: number | null;
    delta: number | null;
    promoterNonNull: boolean;
    totalNonNull: boolean;
    consistent: boolean | null; // null when can't compute
  };

  const allRows: RowResult[] = [];

  type StockSummary = {
    symbol: string;
    industryType: string;
    quartersChecked: number;
    promoterNonNull: number;
    totalNonNull: number;
    consistent: number;
    worstDelta: number;
  };

  const summaries: StockSummary[] = [];

  console.log("\n" + "─".repeat(72));
  console.log("PER-STOCK DETAIL");
  console.log("─".repeat(72));

  for (const { row } of sample) {
    const rows = await prisma.shareholdingPattern.findMany({
      where: { symbol: row.symbol },
      orderBy: { asOnDate: "desc" },
      take: 8,
      select: {
        asOnDate: true,
        promoterShares: true,
        totalShares: true,
        promoterPct: true,
      },
    });

    let promoterNonNull = 0;
    let totalNonNull = 0;
    let consistentCount = 0;
    let worstDelta = 0;

    const results: RowResult[] = rows.map((r) => {
      const pNonNull = r.promoterShares !== null;
      const tNonNull = r.totalShares !== null;
      if (pNonNull) promoterNonNull++;
      if (tNonNull) totalNonNull++;

      let impliedPct: number | null = null;
      let delta: number | null = null;
      let consistent: boolean | null = null;

      if (
        pNonNull &&
        tNonNull &&
        Number(r.totalShares) > 0 &&
        r.promoterPct !== null
      ) {
        impliedPct =
          (Number(r.promoterShares) / Number(r.totalShares)) * 100;
        const actual = Number(r.promoterPct);
        delta = impliedPct - actual;
        consistent = Math.abs(delta) <= 0.5;
        if (consistent) consistentCount++;
        if (Math.abs(delta) > worstDelta) worstDelta = Math.abs(delta);
      } else if (pNonNull && tNonNull && r.promoterPct !== null) {
        // totalShares is 0 — cannot compute
        consistent = null;
      }

      return {
        symbol: row.symbol,
        asOnDate: r.asOnDate,
        promoterShares: r.promoterShares,
        totalShares: r.totalShares,
        promoterPct: r.promoterPct !== null ? Number(r.promoterPct) : null,
        impliedPct,
        delta,
        promoterNonNull: pNonNull,
        totalNonNull: tNonNull,
        consistent,
      };
    });

    allRows.push(...results);

    summaries.push({
      symbol: row.symbol,
      industryType: row.industryType,
      quartersChecked: rows.length,
      promoterNonNull,
      totalNonNull,
      consistent: consistentCount,
      worstDelta,
    });
  }

  // ── per-stock table ──────────────────────────────────────────────────────

  const hdr = [
    "symbol".padEnd(14),
    "industryType".padEnd(14),
    "qtrs".padStart(4),
    "prom≠null".padStart(9),
    "tot≠null".padStart(8),
    "consistent".padStart(10),
    "worst|Δ|".padStart(8),
  ].join("  ");
  console.log("\n" + hdr);
  console.log("─".repeat(hdr.length));

  for (const s of summaries) {
    const q = s.quartersChecked;
    console.log(
      [
        s.symbol.padEnd(14),
        s.industryType.padEnd(14),
        String(q).padStart(4),
        pct(s.promoterNonNull, q).padStart(9),
        pct(s.totalNonNull, q).padStart(8),
        pct(s.consistent, q).padStart(10),
        s.worstDelta.toFixed(2).padStart(8),
      ].join("  ")
    );
  }

  // ── aggregate ────────────────────────────────────────────────────────────

  const total = allRows.length;
  const totalPromNonNull = allRows.filter((r) => r.promoterNonNull).length;
  const totalTotNonNull = allRows.filter((r) => r.totalNonNull).length;
  const checkable = allRows.filter((r) => r.consistent !== null && r.delta !== null);
  const totalConsistent = checkable.filter((r) => r.consistent === true).length;

  const deltas = checkable
    .map((r) => r.delta as number)
    .sort((a, b) => a - b);

  console.log("\n" + "─".repeat(72));
  console.log("AGGREGATE");
  console.log("─".repeat(72));
  console.log(
    `  Total rows sampled  : ${total}`
  );
  console.log(
    `  promoterShares ≠ null: ${pct(totalPromNonNull, total)}  (${totalPromNonNull}/${total})`
  );
  console.log(
    `  totalShares ≠ null   : ${pct(totalTotNonNull, total)}  (${totalTotNonNull}/${total})`
  );
  console.log(
    `  Rows checkable       : ${checkable.length}  (both counts present & totalShares > 0 & promoterPct present)`
  );
  if (checkable.length > 0) {
    console.log(
      `  Consistent (|Δ|≤0.5) : ${pct(totalConsistent, checkable.length)}  (${totalConsistent}/${checkable.length})`
    );
    console.log(
      `  Signed delta min/med/max: ${deltas[0].toFixed(3)} / ${median(deltas).toFixed(3)} / ${deltas[deltas.length - 1].toFixed(3)}`
    );
  }

  // ── verdict ──────────────────────────────────────────────────────────────

  const promNullPct = totalPromNonNull / total;
  const totNullPct = totalTotNonNull / total;
  const consistencyPct =
    checkable.length > 0 ? totalConsistent / checkable.length : 0;

  const materialNull = promNullPct < 0.95 || totNullPct < 0.95;
  const inconsistent =
    checkable.length > 0 && consistencyPct < 0.95;

  console.log("\n" + "=".repeat(72));
  if (!materialNull && !inconsistent) {
    console.log(
      "VERDICT: PASS — ≥95% of rows have both share counts non-null and are internally consistent."
    );
  } else if (materialNull) {
    console.log(
      "VERDICT: FAIL-NULL — A material share of promoterShares or totalShares values are null. " +
        "The parser is likely not extracting these fields for a significant portion of filings."
    );
  } else {
    console.log(
      "VERDICT: FAIL-INCONSISTENT — Share counts are present but do not align with promoterPct. " +
        "Possible cause: promoterPct and share counts are sourced from different table sections."
    );
  }
  console.log("=".repeat(72));

  // ── offending examples ───────────────────────────────────────────────────

  if (materialNull || inconsistent) {
    console.log("\nOFFENDING EXAMPLES (up to 5):");

    const offenders = allRows
      .filter((r) => {
        if (materialNull && (!r.promoterNonNull || !r.totalNonNull)) return true;
        if (inconsistent && r.consistent === false) return true;
        return false;
      })
      .slice(0, 5);

    const ofHdr = [
      "symbol".padEnd(12),
      "asOnDate".padEnd(12),
      "promoterShares".padStart(16),
      "totalShares".padStart(13),
      "promoterPct".padStart(11),
      "impliedPct".padStart(10),
      "delta".padStart(7),
    ].join("  ");
    console.log("\n" + ofHdr);
    console.log("─".repeat(ofHdr.length));

    for (const r of offenders) {
      console.log(
        [
          r.symbol.padEnd(12),
          r.asOnDate.toISOString().slice(0, 10).padEnd(12),
          (r.promoterShares !== null ? String(r.promoterShares) : "NULL").padStart(16),
          (r.totalShares !== null ? String(r.totalShares) : "NULL").padStart(13),
          (r.promoterPct !== null ? r.promoterPct.toFixed(4) : "NULL").padStart(11),
          (r.impliedPct !== null ? r.impliedPct.toFixed(4) : "NULL").padStart(10),
          (r.delta !== null ? r.delta.toFixed(4) : "NULL").padStart(7),
        ].join("  ")
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
