// ═══════════════════════════════════════════════════════════════
// R5-A detail — EVERY LOST FILING: symbol, period, basis, which field overflowed,
// and whether it falls INSIDE the Jan-2022 window. READ-ONLY.
//   npx tsx src/scripts/_r5a-lost.ts [--fetch]
//
// Without --fetch: identity + window classification, from the ledger and the DB
//   alone (no NSE). Safe to run while the backfill is crawling.
// With --fetch: additionally opens each lost document, parses it with the SAME
//   legacy parser the run used, recomputes all six Decimal(8,4) derived ratios,
//   and names the one(s) that exceed the column ceiling. Run this AFTER the
//   backfill so the two do not compete for NSE.
//
// ⚠ THE WINDOW IS THE POINT. The Jan-2022 target loads quarters counting back
//   from 2022-01-31. A lost filing with period-end <= that date is INSIDE the
//   window and its absence changes what the scorer can see at the target date.
//   One with a later period-end is outside it and the loss is routine.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const LEDGER = `${DIR}/_r2-ledger.json`;
const WINDOW_END = "2022-01-31";
const CEIL = 10000; // Decimal(8,4) → |v| must be < 10000
const DO_FETCH = process.argv.includes("--fetch");
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Quarterly:01-Apr-2023..30-Jun-2023 [standalone]" → parts */
function parseFiling(s: string) {
  const m = /^(\w+):(\d{2})-(\w{3})-(\d{4})\.\.(\d{2})-(\w{3})-(\d{4})\s*\[(\w+)\]$/.exec(s);
  if (!m) return null;
  const iso = (d: string, mo: string, y: string) => `${y}-${String(MON.indexOf(mo) + 1).padStart(2, "0")}-${d}`;
  return { leg: m[1], from: iso(m[2], m[3], m[4]), to: iso(m[5], m[6], m[7]), basis: m[8] };
}

async function main() {
  if (!existsSync(LEDGER)) { console.error(`FATAL: ledger missing ${LEDGER}`); process.exit(1); }
  const l = JSON.parse(readFileSync(LEDGER, "utf8"));
  const lost = (l.errors ?? []).filter((e: any) => /numeric field overflow|out of range for the type/i.test(String(e.error)));

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5-A — EVERY FILING LOST TO A DERIVED-RATIO OVERFLOW                       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ledger: ${l.done.length}/442 symbols · ${l.filings} filings · ${l.failed} failed`);
  console.log(`  of those, lost to numeric overflow: ${lost.length}\n`);
  if (!lost.length) { console.log(`  ✓ none\n`); await prisma.$disconnect(); return; }

  const recs: any[] = [];
  for (const e of lost) {
    const p = parseFiling(String(e.filing));
    const inWindow = p ? p.to <= WINDOW_END : null;
    recs.push({ symbol: e.symbol, filing: e.filing, leg: p?.leg, periodEnd: p?.to, basis: p?.basis, inWindow });
  }
  recs.sort((a, b) => a.symbol.localeCompare(b.symbol) || String(a.periodEnd).localeCompare(String(b.periodEnd)));

  console.log(`  ${pad("symbol", 14)}${pad("leg", 11)}${pad("period end", 13)}${pad("basis", 14)}window`);
  for (const r of recs) {
    console.log(`  ${pad(r.symbol, 14)}${pad(r.leg ?? "?", 11)}${pad(r.periodEnd ?? "?", 13)}${pad(r.basis ?? "?", 14)}${r.inWindow === null ? "?" : r.inWindow ? "⚠ INSIDE Jan-2022" : "outside"}`);
  }

  const inside = recs.filter((r) => r.inWindow);
  const outside = recs.filter((r) => r.inWindow === false);
  console.log(`\n  ── WINDOW SPLIT (the thing that decides urgency) ──`);
  console.log(`  INSIDE  the Jan-2022 window (period-end <= ${WINDOW_END}) : ${inside.length}  ${inside.length ? "⚠ these change what the scorer sees at the target date" : ""}`);
  console.log(`  OUTSIDE the window                                       : ${outside.length}  (routine — after the target date)`);
  const bySymIn = new Map<string, number>();
  for (const r of inside) bySymIn.set(r.symbol, (bySymIn.get(r.symbol) ?? 0) + 1);
  if (bySymIn.size) {
    console.log(`\n  stocks with IN-WINDOW losses:`);
    for (const [s, n] of [...bySymIn.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ⚠ ${pad(s, 14)}${n} quarter(s)`);
  }

  // ⚠ A FAILED UPSERT HAS TWO VERY DIFFERENT OUTCOMES, and conflating them
  //   overstates the damage:
  //     ABSENT — no row for that (stock, period, basis) at all. Net data loss;
  //              the period is a hole the scorer will see.
  //     STALE  — a row already existed from an earlier pass. The upsert failed,
  //              so the row was not REFRESHED, but it survives with its prior
  //              content. No hole is created; the row is simply not updated.
  console.log(`\n  ── OUTCOME OF EACH FAILED UPSERT: net loss, or a refresh that did not take? ──`);
  const absent: any[] = [], stale: any[] = [];
  for (const r of recs) {
    if (!r.periodEnd) continue;
    const [x] = await raw<any>(
      `SELECT count(*)::int n, max(q."source") src, max(q."updated_at")::text ua
         FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
        WHERE st."symbol"=$1 AND q."report_date"=DATE '${r.periodEnd}' AND q."result_type"=$2`, r.symbol, r.basis);
    if (x.n === 0) { r.outcome = "ABSENT"; absent.push(r); }
    else { r.outcome = "STALE"; r.existingSource = x.src; r.existingUpdatedAt = x.ua; stale.push(r); }
  }
  console.log(`  ⚠ ABSENT (net data loss)                 : ${absent.length}`);
  for (const r of absent) console.log(`      ⚠ ${pad(r.symbol, 14)}${pad(r.periodEnd, 13)}${pad(r.basis, 14)}${r.inWindow ? "⚠ INSIDE Jan-2022 window" : "outside window"}`);
  console.log(`  STALE (row survived, refresh did not take): ${stale.length}`);
  for (const r of stale) console.log(`      · ${pad(r.symbol, 14)}${pad(r.periodEnd, 13)}${pad(r.basis, 14)}kept ${pad(r.existingSource, 26)} @ ${String(r.existingUpdatedAt).slice(0, 19)}`);
  const absentIn = absent.filter((r) => r.inWindow);
  console.log(`\n  ⇒ THE REAL LOSS is ${absent.length} filing(s), of which ${absentIn.length} sit INSIDE the Jan-2022 window:`);
  for (const r of absentIn) console.log(`      ⚠ ${r.symbol} ${r.periodEnd} ${r.basis}`);
  console.log(`  ⇒ the other ${stale.length} are rows that already existed and simply were not refreshed —`);
  console.log(`    no hole is created, and their prior content is intact.`);

  // ── optional: name the overflowing field from the document ──
  if (DO_FETCH) {
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ WHICH DERIVED FIELD OVERFLOWED — recomputed from the source document       ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
    const { fetchFilingsList, fetchXbrlFile } = await import("../ingestions/quaterly-results/legacy/discovery-legacy.js");
    const { parseQuarterlyResultXbrl } = await import("../ingestions/quaterly-results/legacy/parser-legacy-common.js");
    const listCache = new Map<string, any[]>();
    for (const r of recs) {
      if (r.leg !== "Quarterly" || !r.periodEnd) continue;
      try {
        if (!listCache.has(r.symbol)) { listCache.set(r.symbol, await fetchFilingsList(r.symbol, "Quarterly")); await sleep(400); }
        const want = listCache.get(r.symbol)!.filter((f: any) => {
          const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(f.toDate); if (!m) return false;
          const iso = `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
          const basis = f.consolidated === "Consolidated" ? "consolidated" : "standalone";
          return iso === r.periodEnd && basis === r.basis;
        });
        if (!want.length) { console.log(`  ${pad(r.symbol + " " + r.periodEnd, 28)} listing entry not found`); continue; }
        const xml = await fetchXbrlFile(want[0].xbrl);
        const v2: any = parseQuarterlyResultXbrl(xml, { symbol: r.symbol, xbrl: want[0].xbrl, consolidated: want[0].consolidated });
        const rev = v2.revenue, op = v2.operatingProfit, np = v2.netProfit;
        const om = op !== null && rev !== null && rev !== 0 ? (op / rev) * 100 : null;
        const nm = np !== null && rev !== null && rev !== 0 ? (np / rev) * 100 : null;
        const over: string[] = [];
        if (om !== null && Math.abs(om) >= CEIL) over.push(`operatingMargin=${om.toFixed(2)}`);
        if (nm !== null && Math.abs(nm) >= CEIL) over.push(`netMargin=${nm.toFixed(2)}`);
        console.log(`  ${pad(r.symbol + " " + r.periodEnd + " " + r.basis, 40)} rev=${lp(rev ?? "null", 10)} opProfit=${lp(op ?? "null", 10)} netProfit=${lp(np ?? "null", 10)}`);
        console.log(`      operatingMargin=${om === null ? "null" : om.toFixed(2)}  netMargin=${nm === null ? "null" : nm.toFixed(2)}  ceiling ±${CEIL}`);
        console.log(`      ⇒ ${over.length ? "⚠ OVERFLOWS: " + over.join(", ") : "neither margin overflows — the culprit is a QoQ/YoY ratio (needs the prior row)"}`);
        r.overflowFields = over;
        r.revenue = rev; r.operatingProfit = op; r.netProfit = np;
        await sleep(400);
      } catch (err) { console.log(`  ${pad(r.symbol + " " + r.periodEnd, 28)} ${(err as Error).message.slice(0, 60)}`); }
    }
  } else {
    console.log(`\n  (run with --fetch AFTER the backfill to name the overflowing field per filing)`);
  }

  writeFileSync(`${DIR}/_r5a-lost.json`, JSON.stringify({ windowEnd: WINDOW_END, total: recs.length, inside: inside.length, outside: outside.length, recs }, null, 1));
  console.log(`\n  → ${DIR}/_r5a-lost.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
