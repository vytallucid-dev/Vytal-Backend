import { prisma } from "../db/prisma.js";

function pct(n: number, d: number, decimals = 1): string {
  if (d === 0) return "n/a";
  return ((n / d) * 100).toFixed(decimals) + "%";
}

function bar(nullCount: number, total: number, width = 20): string {
  if (total === 0) return " ".repeat(width);
  const filled = Math.round((nullCount / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function main() {
  console.log("=".repeat(72));
  console.log("SHAREHOLDING PATTERN — PERCENTAGE NULL DIAGNOSTIC");
  console.log("=".repeat(72));

  // ── 1. Overall null rates ──────────────────────────────────────────────

  const total = await prisma.shareholdingPattern.count();
  console.log(`\nTotal ShareholdingPattern rows: ${total}\n`);

  const fields = [
    { label: "promoterPct",    col: "promoter_pct"    },
    { label: "publicPct",      col: "public_pct"      },
    { label: "fiiPct",         col: "fii_pct"         },
    { label: "diiPct",         col: "dii_pct"         },
    { label: "retailPct",      col: "retail_pct"      },
    { label: "promoterShares", col: "promoter_shares" },
    { label: "totalShares",    col: "total_shares"    },
  ];

  console.log("NULL RATES (all rows)");
  console.log("─".repeat(60));
  console.log(
    "field".padEnd(20) +
    "nullCount".padStart(10) +
    "  %null".padStart(8) +
    "  " + "visual (20 chars = 100%)".padEnd(22)
  );
  console.log("─".repeat(60));

  const nullCounts: Record<string, number> = {};

  for (const f of fields) {
    const rows = await prisma.$queryRawUnsafe<[{ n: bigint }]>(
      `SELECT COUNT(*) AS n FROM shareholding_patterns WHERE "${f.col}" IS NULL`
    );
    const n = Number(rows[0].n);
    nullCounts[f.label] = n;
    console.log(
      f.label.padEnd(20) +
      String(n).padStart(10) +
      pct(n, total).padStart(8) +
      "  " + bar(n, total)
    );
  }

  // ── 2. promoterPct null concentration ────────────────────────────────

  const promNullCount = nullCounts["promoterPct"];
  console.log(`\n${"─".repeat(72)}`);
  console.log(`promoterPct NULL CONCENTRATION  (${promNullCount} null rows)`);
  console.log("─".repeat(72));

  // — by fiscalYear —
  const byYear = await prisma.$queryRawUnsafe<
    { fiscal_year: string; total: bigint; null_pct: bigint }[]
  >(`
    SELECT fiscal_year,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE promoter_pct IS NULL) AS null_pct
    FROM shareholding_patterns
    GROUP BY fiscal_year
    ORDER BY fiscal_year DESC
  `);

  console.log("\n  By fiscalYear:");
  console.log(
    "  " + "year".padEnd(8) + "total".padStart(8) + "  nullPct".padStart(10) + "  %null"
  );
  for (const r of byYear) {
    const t = Number(r.total);
    const n = Number(r.null_pct);
    console.log(
      "  " + (r.fiscal_year ?? "NULL").padEnd(8) +
      String(t).padStart(8) +
      String(n).padStart(10) +
      pct(n, t).padStart(8)
    );
  }

  // — by industryType —
  const byIndustry = await prisma.$queryRawUnsafe<
    { "industryType": string; total: bigint; null_pct: bigint }[]
  >(`
    SELECT s."industryType",
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE sp.promoter_pct IS NULL) AS null_pct
    FROM shareholding_patterns sp
    JOIN stocks s ON s.id = sp.stock_id
    GROUP BY s."industryType"
    ORDER BY s."industryType"
  `);

  console.log("\n  By industryType:");
  console.log(
    "  " + "type".padEnd(16) + "total".padStart(8) + "  nullPct".padStart(10) + "  %null"
  );
  for (const r of byIndustry) {
    const t = Number(r.total);
    const n = Number(r.null_pct);
    console.log(
      "  " + (r.industryType ?? "NULL").padEnd(16) +
      String(t).padStart(8) +
      String(n).padStart(10) +
      pct(n, t).padStart(8)
    );
  }

  // — by xbrlUrl host (or "no xbrlUrl") —
  const byHost = await prisma.$queryRawUnsafe<
    { host: string; total: bigint; null_pct: bigint }[]
  >(`
    SELECT
      COALESCE(
        REGEXP_REPLACE(xbrl_url, '^https?://([^/]+)/.*$', '\\1'),
        'NO_XBRL_URL'
      ) AS host,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE promoter_pct IS NULL) AS null_pct
    FROM shareholding_patterns
    GROUP BY host
    ORDER BY null_pct DESC
  `);

  console.log("\n  By xbrlUrl host:");
  console.log(
    "  " + "host".padEnd(40) + "total".padStart(8) + "  nullPct".padStart(10) + "  %null"
  );
  for (const r of byHost) {
    const t = Number(r.total);
    const n = Number(r.null_pct);
    console.log(
      "  " + (r.host ?? "NULL").padEnd(40) +
      String(t).padStart(8) +
      String(n).padStart(10) +
      pct(n, t).padStart(8)
    );
  }

  // — by sourceDate year —
  const bySourceYear = await prisma.$queryRawUnsafe<
    { src_year: number; total: bigint; null_pct: bigint }[]
  >(`
    SELECT
      EXTRACT(YEAR FROM source_date)::int AS src_year,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE promoter_pct IS NULL) AS null_pct
    FROM shareholding_patterns
    GROUP BY src_year
    ORDER BY src_year DESC
  `);

  console.log("\n  By sourceDate year:");
  console.log(
    "  " + "year".padEnd(8) + "total".padStart(8) + "  nullPct".padStart(10) + "  %null"
  );
  for (const r of bySourceYear) {
    const t = Number(r.total);
    const n = Number(r.null_pct);
    console.log(
      "  " + String(r.src_year ?? "NULL").padEnd(8) +
      String(t).padStart(8) +
      String(n).padStart(10) +
      pct(n, t).padStart(8)
    );
  }

  // ── 3. Reconstructability ─────────────────────────────────────────────

  console.log(`\n${"─".repeat(72)}`);
  console.log("RECONSTRUCTABILITY");
  console.log("─".repeat(72));

  // promoterPct: reconstructable when promoterShares AND totalShares both non-null
  const [promRecon] = await prisma.$queryRawUnsafe<[{ n: bigint }]>(`
    SELECT COUNT(*) AS n
    FROM shareholding_patterns
    WHERE promoter_pct IS NULL
      AND promoter_shares IS NOT NULL
      AND total_shares IS NOT NULL
      AND total_shares > 0
  `);
  const promReconCount = Number(promRecon.n);
  console.log(
    `\n  promoterPct null rows  : ${promNullCount}`
  );
  console.log(
    `  reconstructable (both counts non-null & totalShares>0): ${promReconCount}`
  );
  console.log(
    `  → promoterPct reconstructable from counts on ${pct(promReconCount, promNullCount)} of null rows.`
  );

  // FII: no absolute count column in schema — only fiiPct
  const fiiNullCount = nullCounts["fiiPct"];
  console.log(`\n  fiiPct null rows       : ${fiiNullCount}`);
  console.log(
    "  → No absolute FII share count column exists in the schema " +
    "(schema has fiiPct only; no fii_shares / fii_count field)."
  );
  console.log(
    "  → fiiPct nulls are NOT reconstructable from counts. This is a HARD GAP."
  );

  // DII: same situation
  const diiNullCount = nullCounts["diiPct"];
  console.log(`\n  diiPct null rows       : ${diiNullCount}`);
  console.log(
    "  → No absolute DII share count column exists in the schema " +
    "(schema has diiPct only; no dii_shares / dii_count field)."
  );
  console.log(
    "  → diiPct nulls are NOT reconstructable from counts. This is a HARD GAP."
  );

  // ── Summary ───────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(72)}`);
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(
    `  promoterPct null rate : ${pct(promNullCount, total)}  → reconstructable on ${pct(promReconCount, promNullCount)} of null rows (derive from counts)`
  );
  console.log(
    `  fiiPct null rate      : ${pct(fiiNullCount, total)}  → NOT reconstructable (no absolute count stored)`
  );
  console.log(
    `  diiPct null rate      : ${pct(nullCounts["diiPct"], total)}  → NOT reconstructable (no absolute count stored)`
  );
  console.log(
    `  promoterShares null   : ${pct(nullCounts["promoterShares"], total)}`
  );
  console.log(
    `  totalShares null      : ${pct(nullCounts["totalShares"], total)}`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
