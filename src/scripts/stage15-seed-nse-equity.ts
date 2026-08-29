// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 15 — SEED THE NSE EQUITY SEGMENT (EQ series) AS DISPLAY-ONLY STOCKS.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage15-seed-nse-equity.ts                     # dry-run
//   npx tsx src/scripts/stage15-seed-nse-equity.ts --commit
//   npx tsx src/scripts/stage15-seed-nse-equity.ts --csv _EQUITY_L.csv --commit
//
// Source of truth: NSE's own https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
//
// ── THE FIREWALL, INHERITED FROM seed-nifty500-pass1.ts AND NOT NEGOTIABLE ────────────────────────
// This script NEVER writes stock_peer_groups. A stock with no stock_peer_groups row is structurally
// never a scoring candidate — the scoring roster is built from peerGroup.stocks, so membership is
// the only door in. MEASURED precedent: 356 of the current 504 already have no peer group and hold
// zero snapshots. These 1,788 join them. They are screener-visible, not scored.
//
// ── WHY EQ ONLY ──────────────────────────────────────────────────────────────────────────────────
// The file carries EQ 2,291 · BE 240 · BZ 28. BE and BZ are the surveillance / trade-to-trade
// series — exactly the names we do not want to present as trackable holdings. They fall to the
// broker-sync banner instead. (SME is a different NSE file entirely, so it is excluded by source.)
//
// ── industryType IS LEFT AT ITS DEFAULT ON PURPOSE ───────────────────────────────────────────────
// It drives which XBRL taxonomy parses a filing, and guessing it from a company name would be a
// coin-flip that silently routes a bank's results into the Ind-AS tables. It does not need guessing:
// scan.ts detects the taxonomy FROM THE FILING, refuses to ingest on a mismatch, and logs the right
// answer to result_fetch_logs.error as "Industry mismatch (basis): stock=X, xbrl=Y". So the sequence
// is seed → scan → harvest the mismatch log → correct → re-scan. MEASURED: 107 such rows already
// exist, and this exact remediation was run once before (ingest-industry-mismatch-13.ts).
// A wrong industryType therefore costs a skipped filing, never a wrong number.
//
// ── FACE VALUE IS FILLED FOR EVERYONE, INCLUDING THE EXISTING 504 ────────────────────────────────
// MEASURED: face_value is NULL on all 504 stocks today. The CSV carries it for all 2,291 EQ rows
// from NSE itself. Filling it is free and sourced. NULL-ONLY — an existing non-null value is never
// touched, the same rule the ingestion fence enforces.
//
// ── NO instruments ROW IS CREATED ────────────────────────────────────────────────────────────────
// Broker resolution reads `stocks` directly by symbol and then by ISIN (universe-admit.ts:176,190);
// the instruments lookup above it is filtered to `stockId: null`, i.e. NON-equities only. So an
// equity resolves without a catalogue row, and adding 1,788 of them would grow a 26 MB table for
// nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const CSV = argv.includes("--csv") ? argv[argv.indexOf("--csv") + 1] : "_EQUITY_L.csv";

/**
 * Symbols NSE lists as EQ that we deliberately do NOT carry, keyed on ISIN because that is the
 * identity that survives a rename. Without this the seeder is self-undoing: a symbol removed by hand
 * is simply recreated by the next run, since the target predicate is "in the CSV, not in the DB".
 */
const EXCLUDE_ISIN: Record<string, string> = {
  INE18UN01038: "GAJA (Gaja Alternative Asset Management) — Yahoo serves no price history for it, so " +
    "it can never get a price series. Removed 2026-08-27 after the backfill proved it unservable.",
};

interface Row { sym: string; name: string; series: string; listed: string; isin: string; faceValue: number | null }

/** NSE's header has leading spaces (" SERIES", " ISIN NUMBER"), so every name is trimmed. */
function readCsv(path: string): Row[] {
  let text = fs.readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const at = (n: string): number => head.indexOf(n);
  const iS = at("SYMBOL"), iN = at("NAME OF COMPANY"), iSer = at("SERIES"), iD = at("DATE OF LISTING"), iI = at("ISIN NUMBER"), iF = at("FACE VALUE");
  if ([iS, iN, iSer, iI].some((i) => i < 0)) throw new Error(`${path}: unexpected header — ${head.join("|")}`);
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const fv = Number((c[iF] ?? "").trim());
    return {
      sym: (c[iS] ?? "").trim(),
      name: (c[iN] ?? "").trim(),
      series: (c[iSer] ?? "").trim().toUpperCase(),
      listed: (c[iD] ?? "").trim(),
      isin: (c[iI] ?? "").trim().toUpperCase(),
      faceValue: Number.isFinite(fv) && fv > 0 ? fv : null,
    };
  }).filter((r) => r.sym);
}

/** "06-OCT-2008" → Date. NSE's own format; anything else is refused rather than coerced. */
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function parseListed(s: string): Date | null {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s.toUpperCase());
  if (!m || !(m[2] in MON)) return null;
  return new Date(Date.UTC(Number(m[3]), MON[m[2]], Number(m[1])));
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 15 — seed NSE equity segment  ${COMMIT ? "*** COMMIT ***" : "(dry-run — writes nothing)"}`);
  console.log("=".repeat(104));

  if (!fs.existsSync(CSV)) { console.log(`\n  no CSV at ${CSV}\n`); await prisma.$disconnect(); return; }
  const all = readCsv(CSV);
  const bySeries: Record<string, number> = {};
  for (const r of all) bySeries[r.series] = (bySeries[r.series] ?? 0) + 1;
  console.log(`\n  ${CSV}: ${all.length} row(s) — ${Object.entries(bySeries).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

  const eq = all.filter((r) => r.series === "EQ");
  const badIsin = eq.filter((r) => !/^IN[EF9][A-Z0-9]{9}$/.test(r.isin));
  if (badIsin.length) console.log(`  ⚠ ${badIsin.length} EQ row(s) with a malformed ISIN — refused: ${badIsin.slice(0, 5).map((r) => `${r.sym}(${r.isin})`).join(", ")}`);
  const clean = eq.filter((r) => !badIsin.includes(r));

  const existing = await prisma.stock.findMany({ select: { id: true, symbol: true, isin: true, faceValue: true } });
  const byIsin = new Map(existing.map((s) => [s.isin, s]));
  const bySym = new Map(existing.map((s) => [s.symbol, s]));

  const toCreate: Row[] = [];
  const conflicts: string[] = [];
  const excluded: string[] = [];
  for (const r of clean) {
    if (EXCLUDE_ISIN[r.isin]) { excluded.push(`${r.sym} — ${EXCLUDE_ISIN[r.isin]}`); continue; }
    const hitIsin = byIsin.get(r.isin), hitSym = bySym.get(r.sym);
    if (hitIsin || hitSym) {
      // ⚠ Same symbol, different ISIN is NOT a duplicate — it is two different securities claiming
      //   one ticker, and creating the second would either violate UNIQUE(symbol) or fork a company.
      //   Report it; never resolve it here.
      if (hitSym && !hitIsin) conflicts.push(`${r.sym}: NSE says ISIN ${r.isin}, we hold ${hitSym.isin}`);
      continue;
    }
    toCreate.push(r);
  }

  // ── face value, null-only, for everyone already present ──────────────────────────────────────
  const fvFill = clean
    .map((r) => ({ r, hit: byIsin.get(r.isin) }))
    .filter((x): x is { r: Row; hit: NonNullable<ReturnType<typeof byIsin.get>> } =>
      !!x.hit && x.hit.faceValue === null && x.r.faceValue !== null);

  console.log(`\n  ── PLAN ──`);
  console.log(`  EQ rows                      ${String(clean.length).padStart(5)}`);
  console.log(`  already held (skip)          ${String(clean.length - toCreate.length - excluded.length).padStart(5)}`);
  console.log(`  TO CREATE                    ${String(toCreate.length).padStart(5)}`);
  console.log(`  face_value to fill on held   ${String(fvFill.length).padStart(5)}   (null-only)`);
  if (excluded.length) {
    console.log(`\n  deliberately excluded (${excluded.length}):`);
    for (const e of excluded) console.log(`     ${e}`);
  }
  if (conflicts.length) {
    console.log(`\n  ⚠ ${conflicts.length} symbol/ISIN conflict(s) — skipped, not resolved:`);
    for (const c of conflicts.slice(0, 10)) console.log(`     ${c}`);
  }
  const noDate = toCreate.filter((r) => !parseListed(r.listed)).length;
  if (noDate) console.log(`  (${noDate} new row(s) have an unparseable listing date — created without it)`);

  if (!COMMIT) {
    console.log(`\n  sample of what would be created:`);
    for (const r of toCreate.slice(0, 5)) console.log(`     ${r.sym.padEnd(14)} ${r.isin}  fv ${String(r.faceValue).padStart(5)}  listed ${r.listed}  ${r.name.slice(0, 44)}`);
    console.log(`\n  dry-run — re-run with --commit.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── create ───────────────────────────────────────────────────────────────────────────────────
  // sectorId is left NULL: the NSE file carries no industry label, and inventing one would be worse
  // than an honest gap. It is nullable, and the nifty500 pass set the precedent of gating it.
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 250) {
    const chunk = toCreate.slice(i, i + 250);
    const res = await prisma.stock.createMany({
      data: chunk.map((r) => ({
        symbol: r.sym,
        name: r.name,
        isin: r.isin,
        exchange: "NSE",
        isActive: true,
        faceValue: r.faceValue,
        // industryType / fiscalYearEnd: schema defaults, derived later from filings (see header).
      })),
      skipDuplicates: true,
    });
    created += res.count;
    process.stdout.write(`\r  creating… ${created}/${toCreate.length}`);
  }
  console.log(`\n  created ${created} stock(s)`);

  let filled = 0;
  for (const { r, hit } of fvFill) {
    // Guarded by `faceValue: null` in the WHERE, so a value that appeared between the read and the
    // write is left alone — the same structural null-only rule the ingestion writer uses.
    const n = await prisma.stock.updateMany({ where: { id: hit.id, faceValue: null }, data: { faceValue: r.faceValue } });
    filled += n.count;
  }
  console.log(`  filled face_value on ${filled} existing stock(s)`);

  const after = await prisma.stock.count();
  console.log(`\n  universe: ${existing.length} -> ${after}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
