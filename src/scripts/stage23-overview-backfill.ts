// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 23 — A COMPANY PROFILE FOR EVERY STOCK, HONEST ABOUT WHAT IT CANNOT KNOW.  ⚠ WRITES.
//
//   npx tsx src/scripts/stage23-overview-backfill.ts            # dry
//   npx tsx src/scripts/stage23-overview-backfill.ts --commit
//
// MEASURED: `stock_overviews` holds 224 hand-authored rows against 2,290 active stocks, so 2,066 —
// 90% — render "Company profile not yet available" on the stock page's Overview tab.
//
// ── THREE OF THE FIVE FIELDS ARE DERIVABLE. TWO ARE NOT, AND ARE LEFT BLANK. ─────────────────────
//   listedSince   ← NSE's own EQUITY_L.csv (DATE OF LISTING), authoritative for all 2,291
//   industry      ← Yahoo's `industry`, captured per symbol during stage 21
//   coreBusiness  ← the Yahoo business summary already written to stocks.description in stage 21
//   revenueModel  ← "" — NOT derivable. "Earns from selling industrial explosives to mining
//                    customers, plus a rapidly growing, higher-margin defence order book" is
//                    ANALYSIS. No feed produces it, and a sector-shaped paraphrase of it would be
//                    invention wearing the same typeface as the 224 real ones.
//   businessTags  ← [] — NOT derivable either. The authored tags are curated segments
//                    ("Oil-to-Chemicals", "Jio (Telecom)", "Reliance Retail"); Yahoo's single
//                    industry label cannot be split into them.
//
// ⚠ BLANK IS A SUPPORTED STATE, NOT A WORKAROUND. overview-view.service.ts already treats a
//   blank/whitespace column as absent "so the UI honest-empties that field rather than rendering an
//   empty box", and section-identity.tsx renders each half only `&&` its field is truthy. So a row
//   with coreBusiness and no revenueModel shows "What it does" alone — which is exactly what we
//   know, presented as all we know.
//
// ⚠ THE 224 AUTHORED ROWS ARE NEVER TOUCHED. This INSERTS where no row exists. A hand-written
//   profile outranks a third-party summary on every field, and there is no version of this script
//   that should be able to overwrite one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** DD-MON-YYYY → year. NSE's own format; anything else yields null rather than a guess. */
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function listedYear(s: string): number | null {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s.trim().toUpperCase());
  if (!m || !MON.includes(m[2])) return null;
  const y = Number(m[3]);
  return y >= 1850 && y <= new Date().getUTCFullYear() ? y : null;
}

function readListingYears(path: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!fs.existsSync(path)) return out;
  let text = fs.readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const iS = head.indexOf("SYMBOL"), iD = head.indexOf("DATE OF LISTING");
  if (iS < 0 || iD < 0) return out;
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const y = listedYear(c[iD] ?? "");
    if (c[iS] && y) out.set(c[iS].trim().toUpperCase(), y);
  }
  return out;
}

function readYahooIndustry(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(".").filter((x) => /^_s21-ledger.*\.json$/.test(x))) {
    const led = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, { industry?: string }>;
    for (const [sym, e] of Object.entries(led)) if (e.industry?.trim()) out.set(sym, e.industry.trim());
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 23 — company profiles for the rest of the universe  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const years = readListingYears("_EQUITY_L.csv");
  const inds = readYahooIndustry();
  console.log(`\n  sources: listing years ${years.size} · yahoo industries ${inds.size}`);

  const need = await raw<{ id: string; symbol: string; description: string | null }>(
    `SELECT s.id, s.symbol, s.description FROM stocks s
      WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM stock_overviews o WHERE o.stock_id = s.id)
      ORDER BY s.symbol`);
  console.log(`  stocks with no profile row: ${need.length}`);

  const rows = need.map((s) => ({
    stockId: s.id,
    symbol: s.symbol,
    industry: inds.get(s.symbol) ?? "",
    listedSince: years.get(s.symbol) ?? null,
    coreBusiness: (s.description ?? "").trim(),
    revenueModel: "",
    businessTags: [] as string[],
  }));

  const withCore = rows.filter((r) => r.coreBusiness.length > 0).length;
  const withInd = rows.filter((r) => r.industry.length > 0).length;
  const withYear = rows.filter((r) => r.listedSince !== null).length;
  // A row carrying none of the three would render a profile panel with nothing in it — worse than
  // the honest empty it replaces. Those are skipped, not inserted.
  const usable = rows.filter((r) => r.coreBusiness || r.industry || r.listedSince !== null);

  console.log(`\n  of those, we can supply:`);
  console.log(`     coreBusiness (what it does)  ${withCore}`);
  console.log(`     industry                     ${withInd}`);
  console.log(`     listedSince                  ${withYear}`);
  console.log(`     revenueModel / businessTags  0   — not derivable, left blank on purpose`);
  console.log(`\n  rows to insert: ${usable.length}   (skipping ${rows.length - usable.length} with nothing to say)`);

  if (!COMMIT) {
    console.log(`\n  sample:`);
    for (const r of usable.slice(0, 3))
      console.log(`     ${r.symbol.padEnd(12)} ${String(r.listedSince ?? "—").padEnd(6)} ${r.industry.padEnd(34)} ${r.coreBusiness.slice(0, 60)}…`);
    console.log(`\n  dry — re-run with --commit.\n`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (let i = 0; i < usable.length; i += 200) {
    const chunk = usable.slice(i, i + 200);
    const vals = chunk.map((_, k) => `($${k * 7 + 1},$${k * 7 + 2},$${k * 7 + 3},$${k * 7 + 4},$${k * 7 + 5},$${k * 7 + 6},$${k * 7 + 7}::text[])`).join(",");
    const args = chunk.flatMap((r) => [crypto.randomUUID(), r.stockId, r.industry, r.listedSince, r.coreBusiness, r.revenueModel, r.businessTags]);
    // ON CONFLICT DO NOTHING on the unique stock_id — the authored 224 cannot be touched even if
    // the target set were computed wrongly. Belt and braces, deliberately.
    n += await prisma.$executeRawUnsafe(
      `INSERT INTO stock_overviews (id, stock_id, industry, listed_since, core_business, revenue_model, business_tags, updated_at)
       VALUES ${vals.replace(/\)(,|$)/g, ", now())$1")}
       ON CONFLICT (stock_id) DO NOTHING`, ...args);
    process.stdout.write(`\r  inserting… ${n}/${usable.length}`);
  }

  const after = await raw<{ tot: number; act: number }>(
    `SELECT (SELECT count(*)::int FROM stock_overviews) tot,
            (SELECT count(*)::int FROM stocks s WHERE s.is_active AND EXISTS(SELECT 1 FROM stock_overviews o WHERE o.stock_id=s.id)) act`);
  console.log(`\n\n  inserted ${n} · stock_overviews now ${after[0].tot} · active stocks with a profile ${after[0].act} / 2290\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
