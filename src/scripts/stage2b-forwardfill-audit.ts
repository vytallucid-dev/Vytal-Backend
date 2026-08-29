// ═══════════════════════════════════════════════════════════════
// FORWARD-FILL AUDIT — is the ONGOING shareholding ingestion keeping up, or is
// it leaving holes at the recent end?
//
//   npx tsx src/scripts/stage2b-forwardfill-audit.ts
//
// Read-only. The backfill proved the HISTORY is complete; this asks the opposite
// question — for each of the last N quarters, how many stocks are missing it, and
// is the miss a genuine "not filed yet" or a pipeline failure?
//
// A stock legitimately lacks the newest quarter for a while: SEBI allows 21 days
// after quarter end to file. So a miss is only interesting once that window has
// closed, and this separates the two.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const OUT = "_s2b-forwardfill.json";
/** SEBI Reg-31 filing deadline after quarter end. */
const FILING_WINDOW_DAYS = 21;
const LOOKBACK_QUARTERS = 10;

const qEnd = (y: number, q: number): string => `${y}-${["03-31", "06-30", "09-30", "12-31"][q]}`;

function recentQuarterEnds(n: number, today: Date): string[] {
  const out: string[] = [];
  let y = today.getUTCFullYear();
  let q = Math.floor(today.getUTCMonth() / 3); // 0..3, the quarter we are IN
  for (let i = 0; i < n; i++) {
    q -= 1;
    if (q < 0) { q = 3; y -= 1; }
    out.push(qEnd(y, q));
  }
  return out;
}

const daysSince = (iso: string, today: Date): number =>
  Math.floor((today.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);

async function main(): Promise<void> {
  const today = new Date();
  const quarters = recentQuarterEnds(LOOKBACK_QUARTERS, today);

  const active = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, symbol FROM stocks WHERE is_active = true ORDER BY symbol`,
  );
  const held = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q, (p.xbrl_url LIKE '%bseindia%') bse
     FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
     WHERE p.as_on_date >= $1::date`,
    quarters[quarters.length - 1],
  );
  const have = new Map<string, Set<string>>();
  const src = new Map<string, string>();
  for (const r of held) {
    const s = String(r.symbol);
    if (!have.has(s)) have.set(s, new Set());
    have.get(s)!.add(String(r.q));
    src.set(`${s}|${r.q}`, r.bse ? "BSE" : "NSE");
  }

  // A stock cannot be missing a quarter that predates its listing. Use its very
  // FIRST shareholding row (across all history, not just the lookback) as the
  // listing proxy: a hole BEFORE that is pre-listing and uninteresting; a hole
  // AFTER it is a genuine forward-fill failure, which is what we are hunting.
  const firstRow = new Map<string, string>();
  for (const r of await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, min(p.as_on_date)::text mn
     FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id GROUP BY s.symbol`,
  )) firstRow.set(String(r.symbol), String(r.mn));

  console.log(`\n=== FORWARD-FILL AUDIT — ${active.length} active stocks, last ${LOOKBACK_QUARTERS} quarters ===`);
  console.log(`  today ${today.toISOString().slice(0, 10)}   filing window ${FILING_WINDOW_DAYS}d after quarter end\n`);
  console.log(`  ${"quarter".padEnd(12)} ${"age".padStart(5)} ${"present".padStart(8)} ${"missing".padStart(8)} ${"NSE".padStart(6)} ${"BSE".padStart(6)}  status`);

  const missingBy: Record<string, string[]> = {};
  for (const q of quarters) {
    const age = daysSince(q, today);
    const present = active.filter((s) => have.get(String(s.symbol))?.has(q));
    const missingAll = active.filter((s) => !have.get(String(s.symbol))?.has(q)).map((s) => String(s.symbol));
    // Only count a miss if the stock already had a row BEFORE this quarter.
    const missing = missingAll.filter((s) => {
      const f = firstRow.get(s);
      return f !== undefined && f < q;
    });
    const preListing = missingAll.length - missing.length;
    const fromNse = present.filter((s) => src.get(`${s.symbol}|${q}`) === "NSE").length;
    const fromBse = present.length - fromNse;
    const due = age > FILING_WINDOW_DAYS;
    const status = !due
      ? `filing window still open (${FILING_WINDOW_DAYS - age}d left)`
      : missing.length === 0
        ? "COMPLETE"
        : `${missing.length} GENUINE hole(s) past the deadline`;
    console.log(
      `  ${q.padEnd(12)} ${String(age).padStart(4)}d ${String(present.length).padStart(8)} ${String(missing.length).padStart(8)} ` +
      `${String(fromNse).padStart(6)} ${String(fromBse).padStart(6)}  ${status}` +
      (preListing ? `  (+${preListing} pre-listing, ignored)` : ""),
    );
    if (due && missing.length) missingBy[q] = missing;
  }

  // ── the interesting part: stocks missing a quarter whose deadline has passed ──
  const offenders = new Map<string, string[]>();
  for (const [q, syms] of Object.entries(missingBy))
    for (const s of syms) (offenders.get(s) ?? offenders.set(s, []).get(s)!).push(q);

  console.log(`\n  -- STOCKS MISSING A PAST-DEADLINE QUARTER (${offenders.size}) --`);
  if (offenders.size === 0) console.log("     none — forward fill is keeping up");
  for (const [sym, qs] of [...offenders].sort((a, b) => b[1].length - a[1].length).slice(0, 40))
    console.log(`     ${sym.padEnd(13)} ${qs.length} missing: ${qs.join(" ")}`);
  if (offenders.size > 40) console.log(`     ... and ${offenders.size - 40} more (see ${OUT})`);

  // Is the newest quarter's shortfall shrinking over time (healthy) or stuck?
  console.log(`\n  -- INTERPRETATION --`);
  const due = quarters.filter((q) => daysSince(q, today) > FILING_WINDOW_DAYS);
  const worst = due.map((q) => ({ q, n: (missingBy[q] ?? []).length })).sort((a, b) => b.n - a.n);
  console.log(`     past-deadline quarters audited: ${due.length}`);
  console.log(`     worst quarters: ${worst.slice(0, 5).map((w) => `${w.q}:${w.n}`).join("  ")}`);
  const totalMisses = Object.values(missingBy).reduce((s, v) => s + v.length, 0);
  console.log(`     total (stock, quarter) misses past deadline: ${totalMisses}`);

  writeFileSync(OUT, JSON.stringify({
    generatedAt: today.toISOString(), quarters, missingBy,
    offenders: Object.fromEntries(offenders),
  }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
