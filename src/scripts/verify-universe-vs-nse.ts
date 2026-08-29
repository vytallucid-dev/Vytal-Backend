// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ RECONCILE THE UNIVERSE AGAINST NSE'S OWN LIST — delistings, mergers, renames, series demotions.
//
//   npx tsx src/scripts/verify-universe-vs-nse.ts                 # report only
//   npx tsx src/scripts/verify-universe-vs-nse.ts --deactivate    # ⚠ flips is_active on the absent
//
// ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
// MEASURED: the universe has NO delisting or merger status check of any kind, and price recency
// cannot substitute for one. JBCHEPHARM was dissolved into Torrent Pharma effective 2026-07-08 and
// is still is_active=true — with price bars still arriving, so a "stale price" heuristic would never
// have flagged it. Its true tell is that NSE stopped listing it. That is what this reads.
//
// ── COMPARED AGAINST EVERY SERIES, NOT JUST EQ ───────────────────────────────────────────────────
// A stock demoted EQ → BE (surveillance) or BZ (trade-to-trade) is STILL LISTED. Only absence from
// the whole file means the security is gone. Comparing against EQ alone would deactivate 240+ live
// companies for the crime of being under surveillance.
//
// ── THE SPINE IS ISIN ────────────────────────────────────────────────────────────────────────────
// Symbols drift and ISINs do not. A symbol we no longer recognise whose ISIN is still listed is a
// RENAME, and reporting it as a delisting would be exactly backwards.
//
// ⚠ THE BULK GUARD IS THE POINT OF THIS SCRIPT, NOT A NICETY. A truncated or rate-limited CSV
//   download is indistinguishable from "NSE delisted everything". Without a ceiling, one bad fetch
//   deactivates the universe and every pipeline goes quiet at once. So --deactivate refuses to act
//   on more than MAX_DEACTIVATE at a time, and refuses outright if the file looks too small to be
//   the real list.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const DEACTIVATE = argv.includes("--deactivate");
const FORCE = argv.includes("--force");
const CSV = argv.includes("--csv") ? argv[argv.indexOf("--csv") + 1] : "_EQUITY_L.csv";

/** A real EQUITY_L has ~2,500 rows. Anything far below it is a broken download, not a mass delisting. */
const MIN_PLAUSIBLE_ROWS = 1500;
/** More than this in one run is a data problem until proven otherwise. */
const MAX_DEACTIVATE = 25;

interface Row { sym: string; isin: string; series: string; name: string }

function readCsv(path: string): Row[] {
  let text = fs.readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const at = (n: string): number => head.indexOf(n);
  const iS = at("SYMBOL"), iI = at("ISIN NUMBER"), iSer = at("SERIES"), iN = at("NAME OF COMPANY");
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    return { sym: (c[iS] ?? "").trim(), isin: (c[iI] ?? "").trim().toUpperCase(), series: (c[iSer] ?? "").trim().toUpperCase(), name: (c[iN] ?? "").trim() };
  }).filter((r) => r.sym && r.isin);
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`UNIVERSE vs NSE  ${DEACTIVATE ? "*** --deactivate ***" : "(report only)"}`);
  console.log("=".repeat(100));

  if (!fs.existsSync(CSV)) { console.log(`\n  no CSV at ${CSV}\n`); process.exit(1); }
  const rows = readCsv(CSV);
  console.log(`\n  ${CSV}: ${rows.length} listed securities (all series)`);
  if (rows.length < MIN_PLAUSIBLE_ROWS) {
    console.log(`\n  ⚠ REFUSING — ${rows.length} rows is below the ${MIN_PLAUSIBLE_ROWS} plausibility floor.`);
    console.log(`    That reads as a truncated download, not as NSE delisting the market. Re-fetch first.\n`);
    process.exit(1);
  }
  const nseByIsin = new Map(rows.map((r) => [r.isin, r]));
  const nseBySym = new Map(rows.map((r) => [r.sym, r]));

  const ours = await prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true, isin: true, name: true },
    orderBy: { symbol: "asc" },
  });

  const gone: typeof ours = [];
  const renamed: Array<{ ours: (typeof ours)[number]; nse: Row }> = [];
  const demoted: Array<{ ours: (typeof ours)[number]; nse: Row }> = [];

  for (const s of ours) {
    const byIsin = nseByIsin.get(s.isin);
    if (!byIsin) { gone.push(s); continue; }
    if (byIsin.sym !== s.symbol) renamed.push({ ours: s, nse: byIsin });
    if (byIsin.series !== "EQ") demoted.push({ ours: s, nse: byIsin });
  }
  // A symbol of ours that NSE gives to a DIFFERENT ISIN — the ticker was reassigned.
  const reassigned = ours.filter((s) => {
    const h = nseBySym.get(s.symbol);
    return h && h.isin !== s.isin;
  });

  console.log(`  our active stocks: ${ours.length}\n`);

  console.log(`  ── NOT LISTED ON NSE AT ALL (delisted / merged / dissolved) — ${gone.length} ──`);
  for (const s of gone) console.log(`     ${s.symbol.padEnd(14)} ${s.isin}  ${s.name.slice(0, 50)}`);
  if (!gone.length) console.log(`     none`);

  console.log(`\n  ── SYMBOL RENAMED (ISIN still listed) — ${renamed.length} ──`);
  for (const x of renamed.slice(0, 20)) console.log(`     we call it ${x.ours.symbol.padEnd(14)} NSE calls it ${x.nse.sym.padEnd(14)} ${x.ours.isin}`);
  if (!renamed.length) console.log(`     none`);
  if (renamed.length) console.log(`     ⚠ these are RENAMES, not delistings — the ISIN is the identity. Rename, never deactivate.`);

  console.log(`\n  ── DEMOTED OUT OF EQ (still listed, under surveillance) — ${demoted.length} ──`);
  for (const x of demoted.slice(0, 20)) console.log(`     ${x.ours.symbol.padEnd(14)} now series ${x.nse.series}`);
  if (!demoted.length) console.log(`     none`);

  if (reassigned.length) {
    console.log(`\n  ── ⚠ TICKER REASSIGNED TO A DIFFERENT SECURITY — ${reassigned.length} ──`);
    for (const s of reassigned.slice(0, 10)) console.log(`     ${s.symbol.padEnd(14)} ours ${s.isin} · NSE ${nseBySym.get(s.symbol)!.isin}`);
  }

  if (!DEACTIVATE) {
    console.log(`\n  report only — re-run with --deactivate to flip is_active on the ${gone.length} not-listed stock(s).\n`);
    await prisma.$disconnect();
    return;
  }

  if (!gone.length) { console.log(`\n  nothing to deactivate.\n`); await prisma.$disconnect(); return; }
  if (gone.length > MAX_DEACTIVATE && !FORCE) {
    console.log(`\n  ⚠ REFUSING — ${gone.length} stocks would be deactivated, over the ceiling of ${MAX_DEACTIVATE}.`);
    console.log(`    A number this large is far more likely to be a bad file than a real event. Check the`);
    console.log(`    list above; pass --force only once you believe every one of them.\n`);
    process.exit(1);
  }

  // Deactivation is the universe-wide off switch: every pipeline honours is_active, so this stops
  // prices, results, shareholding and news for these names. It is reversible by design — nothing is
  // deleted, and the held rows stay readable.
  const n = await prisma.stock.updateMany({ where: { id: { in: gone.map((s) => s.id) } }, data: { isActive: false } });
  console.log(`\n  deactivated ${n.count} stock(s): ${gone.map((s) => s.symbol).join(", ")}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
