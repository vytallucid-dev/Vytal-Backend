// ─────────────────────────────────────────────────────────────────────────────────────────────
// BACKFILL — `fundamentals.total_liabilities`, for the rows whose absence made a false fault.
//
// The column is new (20260829120000). Going forward the annual ingester reads the filing's own
// `Liabilities` subtotal and stores it; every row ingested BEFORE that has NULL, and for those the
// balance-sheet guard falls back to reconstructing the total as current + non-current — which is
// short by every bucket that is neither, and is what produced all 48 open faults.
//
// A full backfill would mean re-fetching 11,114 filings for a number that changes nothing on the
// rows where the reconstruction already agreed. So this fetches ONLY the rows the guard currently
// flags: the ones where the missing bucket is the entire difference between a balanced sheet and
// a fault. Everything else keeps its NULL honestly and its behaviour unchanged.
//
// It WRITES ONLY WHAT THE DOCUMENT SAYS. `Liabilities` is read from the filing; a document that
// does not tag one is left alone and its fault stays open for a human, which is the correct
// outcome — there is no number to store and no identity to check.
//
//   npx tsx src/scripts/backfill-fundamental-total-liabilities.ts [--apply]
// ─────────────────────────────────────────────────────────────────────────────────────────────
import https from "node:https";
import { prisma } from "../db/prisma.js";
import { extractNumber } from "../ingestions/quaterly-results/xbrl/extract.js";
import { BALANCE_SHEET_CONTEXT } from "../ingestions/quaterly-results/xbrl/contexts.js";
import { checkBsImbalance, BS_IMBALANCE_MAX } from "../ingestions/quaterly-results/fundamentals-guards.js";

const APPLY = process.argv.includes("--apply");

const fetchXml = (url: string) =>
  new Promise<string>((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if ((res.statusCode ?? 0) >= 400) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });

type Row = {
  id: string; symbol: string; fy: string; rt: string; url: string | null;
  assets: number | null; equity: number | null; cl: number | null; ncl: number | null;
};

// Every row where the CURRENT (reconstructed) identity fails and no total is stored yet.
const candidates = await prisma.$queryRaw<Row[]>`
  SELECT f.id, s.symbol, f.fiscal_year AS fy, f.result_type AS rt, f.xbrl_url AS url,
         f.total_assets::float8 AS assets, f.total_equity::float8 AS equity,
         f.current_liabilities::float8 AS cl, f.noncurrent_liabilities::float8 AS ncl
  FROM fundamentals f JOIN stocks s ON s.id = f.stock_id
  WHERE f.total_liabilities IS NULL
    AND f.total_assets IS NOT NULL AND f.total_equity IS NOT NULL
    AND f.current_liabilities IS NOT NULL AND f.noncurrent_liabilities IS NOT NULL
    AND f.total_assets > 0
    AND abs(f.total_assets - (f.total_equity + f.current_liabilities + f.noncurrent_liabilities))
        / f.total_assets > ${BS_IMBALANCE_MAX}
  ORDER BY s.symbol, f.fiscal_year`;

console.log(`rows the reconstructed identity currently flags: ${candidates.length}\n`);

let stored = 0, closed = 0, stillOff = 0, noTag = 0, failed = 0;
for (const r of candidates) {
  if (!r.url) { noTag++; continue; }
  let liabilities: number | null;
  try {
    const xml = await fetchXml(r.url);
    const prefix = xml.includes("<in-capmkt:") ? "in-capmkt" : "in-bse-fin";
    liabilities = extractNumber(xml, "Liabilities", BALANCE_SHEET_CONTEXT, prefix);
  } catch (e) {
    console.log(`  ! ${r.symbol} ${r.fy} ${r.rt} — re-fetch failed (${(e as Error).message})`);
    failed++;
    continue;
  }
  if (liabilities == null) {
    console.log(`  · ${r.symbol} ${r.fy} ${r.rt} — the filing tags NO Liabilities total; left alone, fault stands`);
    noTag++;
    continue;
  }
  const after = checkBsImbalance({
    totalAssets: r.assets, totalEquity: r.equity,
    currentLiabilities: r.cl, noncurrentLiabilities: r.ncl,
    totalLiabilities: liabilities,
  });
  after === null ? closed++ : stillOff++;
  console.log(
    `  ${after === null ? "✓" : "✗"} ${r.symbol} ${r.fy} ${r.rt}  Liabilities=${liabilities}` +
      `  (reconstructed ${((r.cl ?? 0) + (r.ncl ?? 0)).toFixed(2)})` +
      (after === null ? "  → balances" : `  → STILL ${(after * 100).toFixed(1)}% off`),
  );
  if (APPLY) {
    await prisma.fundamental.update({ where: { id: r.id }, data: { totalLiabilities: liabilities } });
    stored++;
  }
}

console.log(`\nbalances once the filing's own total is used : ${closed}`);
console.log(`still out of balance (a REAL fault)          : ${stillOff}`);
console.log(`filing tags no Liabilities total             : ${noTag}`);
console.log(`re-fetch failed                              : ${failed}`);
console.log(APPLY ? `\n✅ stored total_liabilities on ${stored} row(s).` : `\n(dry run — pass --apply to write)`);
await prisma.$disconnect();
