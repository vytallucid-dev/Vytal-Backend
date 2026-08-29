// ═══════════════════════════════════════════════════════════════
// STAGE 2 BACKFILL — BSE shareholding to Mar-2019.
//
// NSE's shareholding API floors at ~2021-Sep for 346 of 504 stocks and only 5
// reach FY2019, so BSE is the ONLY route to the plan's target. This script fills
// the quarters NSE does not have; it NEVER touches a quarter NSE already holds.
//
//   PASS 1 (default)  fetch + parse + guard, append a JSONL ledger. NO DB writes.
//                       npx tsx src/scripts/stage2-bse-shp-backfill.ts
//   PASS 2 (--apply)  insert the accepted rows from the ledger, then verify.
//                       npx tsx src/scripts/stage2-bse-shp-backfill.ts --apply
//
//   --symbols A,B,C   restrict to named stocks (for a pilot)
//   --limit N         stop after N stocks
//
// Pass 1 is resumable: every (symbol, qid) already in the ledger is skipped, so a
// killed run continues where it stopped. A lockfile prevents two passes from
// interleaving into the same ledger.
//
// ── THE PER-STOCK OVERLAP GATE (the safeguard beyond the plan) ───────────────
// Before ANY of a stock's BSE-only quarters are trusted, one quarter that BOTH
// sources hold is fetched and required to match NSE exactly. A stock that fails
// is skipped ENTIRELY — none of its earlier quarters are proposed.
//
// This exists because scrip-code mis-resolution is the one failure mode that
// silently writes ANOTHER COMPANY'S shareholding into a stock's history, and
// nothing downstream would catch it: the numbers are perfectly well-formed. The
// plan validated three stocks by hand; this validates all 504 for ~2 extra
// requests each, which is under 8% of the run.
//
// ⚠️ Rows are INSERTED with skipDuplicates — an existing NSE row is never
//    overwritten, even if the ledger somehow proposes that quarter.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import {
  parseBseShareholding, qidToDate, dateToQid,
  type BseParsedShareholding,
} from "../ingestions/shareholdings/bse/bse-shp-extract.js";
import { fetchSecurity, fetchPublic, securityUrl } from "../ingestions/shareholdings/bse/bse-shp-fetch.js";
import { dateToQuarterFY } from "../ingestions/shareholdings/shareholding-dates.js";
import {
  checkPartitionBroken, checkPctRange, checkShareInvariants,
} from "../ingestions/shareholdings/shareholding-guards.js";

const APPLY = process.argv.includes("--apply");
const LEDGER = "_s2-bse-ledger.jsonl";
const PROGRESS = "_s2-bse-progress.log";
const LOCK = "_s2-bse.lock";
const TARGET_QID = 101; // Mar-2019 — the plan's target
const TOL_PP = 0.05;
const TOL_FIIDII_PP = 0.15; // the plan's own overlap tolerance
/** How many shared quarters the overlap gate may try before giving up on a stock. */
const OVERLAP_TRIES = 3;
const REPORT_EVERY_MS = 5 * 60 * 1000;

const argVal = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const ONLY = argVal("--symbols")?.split(",").map((s) => s.trim().toUpperCase()) ?? null;
const LIMIT = Number(argVal("--limit") ?? 0);

// 900ms. Measured BSE latency on this lane is a steady ~700ms with no transport
// faults, so the floor — not the server — is the limiter. The
// adaptive widening remains the real protection: a latency climb widens spacing
// automatically toward maxSpacingMs, and a genuine fault streak stops the run.
const pacer = new BsePacer({ minSpacingMs: 900, throttleStopMs: 120000, slowMs: 15000, maxSpacingMs: 60000 });
/** Consecutive absent quarters, walking DOWN from NSE floor, before giving up. */
const ABSENT_STREAK_STOP = 3;

// ── LEDGER ───────────────────────────────────────────────────────────────────

type Verdict =
  | "accept" | "absent" | "guard_failed" | "fetch_failed" | "stock_rejected"
  /** Not probed: the descending walk already hit this stock's BSE coverage floor.
   *  Recorded rather than omitted so the ledger stays complete and a resumed run
   *  does not re-walk ground already known to be empty. */
  | "below_coverage";
interface Entry {
  key: string; // symbol:qid
  symbol: string; stockId: string; scripCode: string; qid: number; date: string;
  verdict: Verdict;
  reason?: string;
  vintage?: string;
  data?: BseParsedShareholding;
}

function readLedger(): Entry[] {
  if (!existsSync(LEDGER)) return [];
  const out: Entry[] = [];
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Entry); } catch { /* torn final line */ }
  }
  return out;
}
const write = (e: Entry): void => { appendFileSync(LEDGER, `${JSON.stringify(e)}\n`); };
const log = (s: string): void => { console.log(s); appendFileSync(PROGRESS, `${s}\n`); };

function acquireLock(phase: string): void {
  if (existsSync(LOCK)) {
    console.error(`\nREFUSING TO START — ${LOCK} exists (${readFileSync(LOCK, "utf8").trim()}).\n` +
      `Confirm no node process is still running this script, then delete ${LOCK}.\n`);
    process.exit(1);
  }
  writeFileSync(LOCK, `pid=${process.pid} phase=${phase} started=${new Date().toISOString()}\n`);
  const rel = (): void => { try { if (existsSync(LOCK)) unlinkSync(LOCK); } catch { /* best effort */ } };
  process.on("exit", rel);
  process.on("SIGINT", () => { rel(); process.exit(130); });
  process.on("SIGTERM", () => { rel(); process.exit(143); });
}

// ── GUARDS ───────────────────────────────────────────────────────────────────

/** Every reason this row must not be written. Empty ⇒ acceptable. */
function guardRow(p: BseParsedShareholding, publicTotalFromPub: number | null): string[] {
  const out: string[] = [];
  if (checkPartitionBroken(p.promoterPct, p.publicPct, p.employeeTrustPct))
    out.push(`partition broken ${p.promoterPct}+${p.publicPct}+${p.employeeTrustPct}`);
  // checkPctRange is a VIOLATION predicate: true means OUT of [0,100].
  for (const [k, v] of [["fii", p.fiiPct], ["dii", p.diiPct], ["retail", p.retailPct],
    ["mutualFund", p.mutualFundPct], ["insurance", p.insurancePct], ["banksFis", p.banksFisPct]] as const)
    if (checkPctRange(v)) out.push(`${k}=${v} out of 0-100`);
  if (p.fiiPct !== null && p.diiPct !== null && p.fiiPct + p.diiPct > p.publicPct + TOL_PP)
    out.push(`fii+dii ${p.fiiPct + p.diiPct} exceeds public ${p.publicPct}`);
  // CROSS-ENDPOINT CHECK — the two endpoints report the public total
  // independently. Disagreement means they are describing different quarters.
  if (publicTotalFromPub !== null && Math.abs(publicTotalFromPub - p.publicPct) > TOL_PP)
    out.push(`public disagrees across endpoints: security=${p.publicPct} public=${publicTotalFromPub}`);
  out.push(...checkShareInvariants({
    totalShares: p.totalShares, promoterShares: p.promoterShares, pledgedShares: p.pledgedShares,
  }));
  return out;
}

// ── PASS 1 ───────────────────────────────────────────────────────────────────

interface Target {
  symbol: string; stockId: string; scripCode: string;
  /** Quarters BELOW NSE's earliest — probed NEWEST-FIRST so the walk can stop at
   *  the stock's coverage floor instead of grinding through impossible years. */
  belowFloor: number[];
  /** Holes INSIDE NSE's span. Always probed: they are bounded by covered quarters,
   *  so the descending-walk early stop does not apply to them. */
  internalGaps: number[];
  /** CANDIDATE quarters for the overlap gate, oldest first. More than one,
   *  because a single bad NSE row must not discard a whole stock — see the gate. */
  overlapQids: number[];
}

async function buildTargets(): Promise<Target[]> {
  const resolved = JSON.parse(readFileSync("_s10-bse-resolved.json", "utf8")) as
    { symbol: string; scripCode: string; ambiguous?: boolean }[];
  // AMBIGUOUS codes are NOT excluded. The `ambiguous` flag is a heuristic from an
  // earlier symbol-resolution pass; the overlap gate below is an empirical test of
  // the very thing the flag guesses at — a wrong scrip code means a different
  // company, whose share counts differ by orders of magnitude and cannot survive
  // the gate. Excluding them blind would drop 7 stocks including RELIANCE, whose
  // code (500325) is demonstrably correct. Flagged codes are logged, then judged.
  const scrip = new Map(resolved.map((r) => [r.symbol, r.scripCode]));
  const ambiguous = new Set(resolved.filter((r) => r.ambiguous).map((r) => r.symbol));

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.id, s.symbol, p.as_on_date::text q
     FROM stocks s LEFT JOIN shareholding_patterns p ON p.stock_id = s.id
       AND (extract(month from p.as_on_date), extract(day from p.as_on_date)) IN ((3,31),(6,30),(9,30),(12,31))
     WHERE s.is_active = true`,
  );
  const bySym = new Map<string, { id: string; have: Set<string> }>();
  for (const r of rows) {
    const s = String(r.symbol);
    if (!bySym.has(s)) bySym.set(s, { id: String(r.id), have: new Set() });
    if (r.q) bySym.get(s)!.have.add(String(r.q));
  }

  const targets: Target[] = [];
  for (const [symbol, { id, have }] of bySym) {
    const code = scrip.get(symbol);
    if (!code) continue;
    if (ONLY && !ONLY.includes(symbol)) continue;
    const haveQids = [...have].map(dateToQid).sort((a, b) => a - b);
    const floor = haveQids.length ? haveQids[0] : dateToQid("2026-06-30") + 1;
    // Everything from the target up to NSE's floor, plus any hole inside NSE's span.
    const wanted: number[] = [];
    for (let q = TARGET_QID; q < floor; q++) wanted.push(q);
    if (haveQids.length)
      for (let q = haveQids[0]; q <= haveQids[haveQids.length - 1]; q++)
        if (!haveQids.includes(q)) wanted.push(q);
    if (!wanted.length) continue;
    const below = wanted.filter((q) => q < floor).sort((a, b) => b - a); // DESCENDING
    const gaps = wanted.filter((q) => q >= floor).sort((a, b) => a - b);
    // The overlap gate needs a quarter BOTH sources hold — prefer NSE's earliest,
    // which is adjacent to the BSE-only range and so validates the boundary.
    targets.push({
      symbol, stockId: id, scripCode: code, belowFloor: below, internalGaps: gaps,
      // Oldest first: the earliest shared quarters sit next to the BSE-only range,
      // so they validate the boundary that actually matters.
      overlapQids: haveQids.slice(0, OVERLAP_TRIES),
    });
  }
  const noCode = [...bySym.keys()].filter((s2) => !scrip.has(s2));
  if (noCode.length) console.log(`  NOTE ${noCode.length} active stocks have no BSE scrip code: ${noCode.join(", ")}`);
  const amb = targets.filter((t) => ambiguous.has(t.symbol)).map((t) => t.symbol);
  if (amb.length) console.log(`  NOTE ${amb.length} targets carry an ambiguous scrip code (the overlap gate decides): ${amb.join(", ")}`);
  targets.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
}

/** Fetch one quarter and parse it. Returns null when BSE does not hold it. */
async function fetchQuarter(code: string, qid: number): Promise<
  { ok: true; data: BseParsedShareholding; publicTotal: number | null } | { ok: false; reason: string }
> {
  const secRows = await fetchSecurity(pacer, code, qid);
  // Cheap absence test BEFORE paying for the second request.
  const probe = parseBseShareholding(secRows, []);
  if (!probe.ok && (probe.reason === "empty" || probe.reason === "zeroed" || probe.reason === "partition_missing"))
    return { ok: false, reason: probe.reason };
  const pubRows = await fetchPublic(pacer, code, qid);
  const parsed = parseBseShareholding(secRows, pubRows);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const pubTotal = pubRows.find((r) => !r.holder && r.code === "STB1B2B3")?.pct ?? null;
  return { ok: true, data: parsed.value, publicTotal: pubTotal };
}

/**
 * The per-stock overlap gate. Returns null on pass, or the reason it failed.
 *
 * ⚠️ TRIES SEVERAL SHARED QUARTERS, NOT ONE. A single quarter is not a safe
 * oracle: NSE's own stored row can be the wrong one. SBIN 2021-09-30 stores
 * 8,924,611,534 shares against BSE's 8,816,166,654 — but BSE's series runs
 * monotonically (8,816m -> 8,818m -> 8,821m) while NSE's value for that quarter
 * is HIGHER than the quarter after it, so NSE is the outlier. Every other field
 * (promoter shares, promoter %, fii, dii) matched exactly, and the four
 * surrounding quarters matched to the share. Gating on that one row alone
 * discarded a decade of correct history for one of the largest stocks in the
 * universe.
 *
 * So: a stock PASSES if ANY candidate quarter validates cleanly, and is rejected
 * only when all of them fail. That keeps the guarantee that matters — a wrong
 * scrip code cannot match ANY quarter's share counts — while tolerating a single
 * bad row on either side.
 */
async function overlapGate(t: Target): Promise<string | null> {
  if (!t.overlapQids.length) return "no NSE quarter to validate against";
  const failures: string[] = [];

  for (const qid of t.overlapQids) {
    const date = qidToDate(qid);
    const nse = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT promoter_pct, public_pct, fii_pct, dii_pct, total_shares, promoter_shares
       FROM shareholding_patterns WHERE stock_id = $1 AND as_on_date = $2::date`,
      t.stockId, date,
    );
    if (!nse.length) { failures.push(`${date}: NSE row vanished`); continue; }
    const r = nse[0];
    let got: Awaited<ReturnType<typeof fetchQuarter>>;
    try {
      got = await fetchQuarter(t.scripCode, qid);
    } catch (e) {
      failures.push(`${date}: fetch failed (${(e as Error).message})`);
      continue;
    }
    if (!got.ok) { failures.push(`${date}: BSE lacks it (${got.reason})`); continue; }
    const b = got.data;

    const bad: string[] = [];
    const note: string[] = [];

    // ── promoter% / public% are INFORMATIONAL, never disqualifying ──
    // They come from DIFFERENT SOURCES with different denominators. NSE's stored
    // promoter_pct is taken from the NSE master API (ingest-shareholding.ts:257),
    // which for a company holding C1 depository-receipt shares reports on a
    // different base than BSE's Fld_TotalPercentageOf_A_B_C2. BBTC 2020-09-30:
    // NSE 74.05/25.95 vs BSE 65.93/34.07 — and BSE agrees exactly with the NSE
    // XBRL and with the share ratio (46,002,345 / 69,771,900 = 65.93%). Neither
    // is wrong; they are different denominators.
    //
    // fii/dii are NOT in this category: both sources derive them on the same base,
    // which is why they match exactly even on BBTC. They stay hard checks.
    if (Math.abs(Number(r.promoter_pct) - b.promoterPct) > TOL_PP ||
        Math.abs(Number(r.public_pct) - b.publicPct) > TOL_PP)
      note.push(`promoter/public differ by basis: NSE ${r.promoter_pct}/${r.public_pct} vs BSE ${b.promoterPct}/${b.publicPct}`);

    // Share counts are what actually catch a WRONG SCRIP CODE: a different company
    // differs by orders of magnitude, not by a rounding.
    const rel = (a: number, c: number): number => (c === 0 ? (a === 0 ? 0 : 1) : Math.abs(a - c) / c);
    if (r.total_shares !== null && b.totalShares !== null && rel(Number(r.total_shares), b.totalShares) > 0.001)
      bad.push(`totalShares ${r.total_shares} vs ${b.totalShares}`);
    if (r.promoter_shares !== null && b.promoterShares !== null && Number(r.promoter_shares) > 0 &&
        rel(Number(r.promoter_shares), b.promoterShares) > 0.001)
      bad.push(`promoterShares ${r.promoter_shares} vs ${b.promoterShares}`);
    if (r.fii_pct !== null && b.fiiPct !== null && Math.abs(Number(r.fii_pct) - b.fiiPct) > TOL_FIIDII_PP)
      bad.push(`fii ${r.fii_pct} vs ${b.fiiPct}`);
    if (r.dii_pct !== null && b.diiPct !== null && Math.abs(Number(r.dii_pct) - b.diiPct) > TOL_FIIDII_PP)
      bad.push(`dii ${r.dii_pct} vs ${b.diiPct}`);

    if (!bad.length) {
      if (note.length) log(`  NOTE ${t.symbol}: ${note.join("; ")} (share counts + fii/dii verified at ${date})`);
      if (failures.length) log(`  NOTE ${t.symbol}: validated at ${date} after ${failures.length} earlier candidate(s) disagreed: ${failures.join(" | ")}`);
      return null;
    }
    failures.push(`${date}: ${bad.join("; ")}`);
  }
  return `no candidate quarter validated — ${failures.join(" | ")}`;
}

async function pass1(): Promise<void> {
  const targets = await buildTargets();
  const done = new Set(readLedger().map((e) => e.key));
  const rejected = new Set(readLedger().filter((e) => e.verdict === "stock_rejected").map((e) => e.symbol));
  const allQ = (t: Target): number[] => [...t.belowFloor, ...t.internalGaps];
  const totalQ = targets.reduce((s2, t) => s2 + allQ(t).length, 0);
  const todoQ = targets.reduce((s2, t) => s2 + allQ(t).filter((q) => !done.has(`${t.symbol}:${q}`)).length, 0);

  log(`\n=== STAGE 2 BSE BACKFILL · PASS 1 (READ-ONLY) ===`);
  log(`  target: quarters ${TARGET_QID} (${qidToDate(TARGET_QID)}) upward, per stock, that NSE lacks`);
  log(`  stocks=${targets.length}  stock-quarters=${totalQ}  already in ledger=${totalQ - todoQ}  to fetch=${todoQ}`);
  log(`  ~${todoQ * 2 + targets.length * 2} requests at 2.5s pacing -> est ${((todoQ * 2 + targets.length * 2) * 2.5 / 3600).toFixed(1)} h\n`);

  /** Latency percentile over everything this run has fetched so far. */
  const pct = (q: number): number => {
    const a = [...pacer.latencies].sort((x, y) => x - y);
    return a.length ? Math.round(a[Math.min(a.length - 1, Math.floor((a.length * q) / 100))]) : 0;
  };
  const tally: Record<Verdict, number> = {
    accept: 0, absent: 0, guard_failed: 0, fetch_failed: 0, stock_rejected: 0, below_coverage: 0,
  };
  const started = Date.now();
  let lastReport = Date.now();
  let qDone = 0;

  for (const t of targets) {
    const pendingBelow = t.belowFloor.filter((q) => !done.has(`${t.symbol}:${q}`)); // already newest-first
    const pendingGaps = t.internalGaps.filter((q) => !done.has(`${t.symbol}:${q}`));
    if (!pendingBelow.length && !pendingGaps.length) continue;
    if (rejected.has(t.symbol)) continue;

    // ── the gate: one quarter both sources hold, or the stock is skipped whole ──
    let gateFail: string | null;
    try {
      gateFail = await overlapGate(t);
    } catch (e) {
      gateFail = `overlap fetch failed: ${(e as Error).message}`;
    }
    if (gateFail) {
      tally.stock_rejected++;
      write({ key: `${t.symbol}:GATE`, symbol: t.symbol, stockId: t.stockId, scripCode: t.scripCode,
        qid: -1, date: "-", verdict: "stock_rejected", reason: gateFail });
      log(`  REJECTED ${t.symbol}: ${gateFail}`);
      continue;
    }

    const probe = async (qid: number): Promise<Verdict> => {
      const key = `${t.symbol}:${qid}`;
      const date = qidToDate(qid);
      const base = { key, symbol: t.symbol, stockId: t.stockId, scripCode: t.scripCode, qid, date };
      let entry: Entry;
      try {
        const got = await fetchQuarter(t.scripCode, qid);
        if (!got.ok) {
          entry = { ...base, verdict: "absent", reason: got.reason };
        } else {
          const reasons = guardRow(got.data, got.publicTotal);
          entry = reasons.length
            ? { ...base, verdict: "guard_failed", reason: reasons.join("; "), vintage: got.data.vintage }
            : { ...base, verdict: "accept", vintage: got.data.vintage, data: got.data };
        }
      } catch (e) {
        entry = { ...base, verdict: "fetch_failed", reason: (e as Error).message };
      }
      tally[entry.verdict]++;
      write(entry);
      qDone++;
      if (Date.now() - lastReport >= REPORT_EVERY_MS) {
        lastReport = Date.now();
        const rate = qDone / ((Date.now() - started) / 1000);
        const eta = rate > 0 ? Math.ceil((todoQ - qDone) / rate / 60) : -1;
        log(`${new Date().toISOString()} PASS1 ${qDone}/${todoQ} (${((qDone / todoQ) * 100).toFixed(1)}%) ` +
          `accept=${tally.accept} absent=${tally.absent} belowCoverage=${tally.below_coverage} ` +
          `guard=${tally.guard_failed} fetchfail=${tally.fetch_failed} ` +
          `stocksRejected=${tally.stock_rejected} eta=${eta}min ` +
          `| spacing=${Math.round(pacer.spacingMs)}ms retries=${pacer.retries} ` +
          `lat_p50=${pct(50)}ms lat_p90=${pct(90)}ms n=${pacer.latencies.length}`);
      }
      return entry.verdict;
    };

    // ── BELOW NSE'S FLOOR: walk NEWEST-FIRST and stop at the coverage floor ──
    // Measured across every stock inspected, a stock's absent quarters form a
    // clean FLOOR — there were ZERO absences interleaved between accepted ones.
    // So once ABSENT_STREAK_STOP consecutive quarters come back empty, the
    // remaining (older) ones cannot exist either. Probing them anyway is what
    // made a 2024 IPO cost 21 requests to learn it listed in 2024. The streak is
    // 3 rather than 1 so a single odd missing filing cannot truncate a real history.
    let streak = 0;
    let i = 0;
    for (; i < pendingBelow.length; i++) {
      const v = await probe(pendingBelow[i]);
      streak = v === "absent" ? streak + 1 : 0;
      if (streak >= ABSENT_STREAK_STOP) { i++; break; }
    }
    // Everything from where the walk stopped is OLDER still: recorded, not fetched.
    // slice(i) is exactly the un-probed tail, so nothing is double-written.
    for (const qid of pendingBelow.slice(i)) {
      tally.below_coverage++;
      qDone++;
      write({ key: `${t.symbol}:${qid}`, symbol: t.symbol, stockId: t.stockId, scripCode: t.scripCode,
        qid, date: qidToDate(qid), verdict: "below_coverage",
        reason: `walk stopped after ${ABSENT_STREAK_STOP} consecutive absent quarters` });
    }

    // ── INTERNAL GAPS: always probed. They sit BETWEEN covered quarters, so the
    //    coverage-floor argument does not apply to them. ──
    for (const qid of pendingGaps) await probe(qid);
  }
  summarise();
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────

function summarise(): Entry[] {
  const all = readLedger();
  const acc = all.filter((e) => e.verdict === "accept");
  const by = (v: Verdict) => all.filter((e) => e.verdict === v);
  console.log(`\n-- LEDGER SUMMARY (${LEDGER}) --`);
  console.log(`  entries            ${all.length}`);
  console.log(`  accept             ${acc.length}   (${new Set(acc.map((e) => e.symbol)).size} stocks)`);
  console.log(`  absent at BSE      ${by("absent").length}`);
  console.log(`  below coverage     ${by("below_coverage").length}   (older than the stock's BSE floor; not fetched)`);
  console.log(`  guard_failed       ${by("guard_failed").length}`);
  console.log(`  fetch_failed       ${by("fetch_failed").length}`);
  console.log(`  stocks REJECTED    ${by("stock_rejected").length}`);
  const vint = new Map<string, number>();
  for (const e of acc) vint.set(e.vintage ?? "?", (vint.get(e.vintage ?? "?") ?? 0) + 1);
  console.log(`  vintages           ${[...vint].map(([k, v]) => `${k}:${v}`).join("  ")}`);
  const dates = acc.map((e) => e.date).sort();
  if (dates.length) console.log(`  span               ${dates[0]} .. ${dates[dates.length - 1]}`);
  for (const v of ["stock_rejected", "guard_failed", "fetch_failed"] as const) {
    const rows = by(v);
    if (!rows.length) continue;
    console.log(`\n  -- ${v} (${rows.length}) --`);
    for (const e of rows.slice(0, 20)) console.log(`     ${e.symbol.padEnd(12)} ${e.date}  ${e.reason ?? ""}`);
    if (rows.length > 20) console.log(`     ... and ${rows.length - 20} more (see ${LEDGER})`);
  }
  return acc;
}

// ── PASS 2 ───────────────────────────────────────────────────────────────────

async function pass2(): Promise<void> {
  console.log(`\n=== STAGE 2 BSE BACKFILL · PASS 2 (--apply · LIVE WRITE) ===`);
  const acc = summarise();
  if (!acc.length) { console.log("\nNothing accepted — run pass 1 first.\n"); return; }

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  const big = (v: number | null) => (v === null ? null : BigInt(Math.round(v)));

  let written = 0, skipped = 0, failed = 0;
  const CHUNK = 200;
  for (let i = 0; i < acc.length; i += CHUNK) {
    const batch = acc.slice(i, i + CHUNK);
    const data = batch.map((e) => {
      const d = e.data!;
      const asOn = new Date(`${e.date}T00:00:00.000Z`);
      const { quarter, fiscalYear } = dateToQuarterFY(asOn);
      return {
        stockId: e.stockId, symbol: e.symbol, asOnDate: asOn, quarter, fiscalYear,
        promoterPct: new Prisma.Decimal(d.promoterPct),
        publicPct: new Prisma.Decimal(d.publicPct),
        employeeTrustPct: new Prisma.Decimal(d.employeeTrustPct),
        fiiPct: dec(d.fiiPct), diiPct: dec(d.diiPct),
        retailPct: dec(d.retailPct), othersPct: dec(d.othersPct),
        mutualFundPct: dec(d.mutualFundPct), insurancePct: dec(d.insurancePct),
        banksFisPct: dec(d.banksFisPct),
        promoterPledgedPct: dec(d.promoterPledgedPct),
        promoterPledgedSharesPct: dec(d.promoterPledgedSharesPct),
        totalShares: big(d.totalShares) ?? BigInt(0),
        promoterShares: big(d.promoterShares) ?? BigInt(0),
        pledgedShares: big(d.pledgedShares) ?? BigInt(0),
        // PROVENANCE: the exact BSE endpoint this row came from. There is no
        // source column on the table, and a mixed-source table needs origin to be
        // greppable — `xbrl_url LIKE '%bseindia%'` selects the BSE lane, and the
        // URL itself re-fetches the very payload that produced the row.
        xbrlUrl: securityUrl(e.scripCode, e.qid),
        // BSE exposes no filing date here; the NSE lane already falls back to the
        // quarter-end date when submissionDate is unparseable, so this matches.
        sourceDate: asOn,
      };
    });
    try {
      // skipDuplicates: an existing (stockId, asOnDate) row — always NSE-sourced —
      // is left completely untouched. This lane only ever ADDS quarters.
      const r = await prisma.shareholdingPattern.createMany({ data, skipDuplicates: true });
      written += r.count;
      skipped += batch.length - r.count;
    } catch (e) {
      failed += batch.length;
      console.log(`  BATCH FAILED at ${i}: ${(e as Error).message}`);
    }
    log(`${new Date().toISOString()} PASS2 ${Math.min(i + CHUNK, acc.length)}/${acc.length} written=${written} skipped=${skipped} failed=${failed}`);
  }

  const [after] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) rows_total,
            count(*) FILTER (WHERE xbrl_url LIKE '%bseindia%') bse_rows,
            min(as_on_date)::text mn, max(as_on_date)::text mx,
            count(*) FILTER (WHERE fii_pct IS NULL) fii_null
     FROM shareholding_patterns`);
  console.log(`\n-- POST-WRITE --\n  ${JSON.stringify(after, (_, v) => (typeof v === "bigint" ? Number(v) : v))}`);
  const [bad] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) n FROM shareholding_patterns
     WHERE fii_pct IS NOT NULL AND dii_pct IS NOT NULL AND (fii_pct + dii_pct) > public_pct + ${TOL_PP}`);
  console.log(`  rows violating fii+dii <= public : ${Number(bad.n)} (must be 0)`);
  console.log(`\n=== PASS 2 DONE — written=${written} skipped=${skipped} failed=${failed} ===\n`);
}

async function main(): Promise<void> {
  acquireLock(APPLY ? "pass2-apply" : "pass1-readonly");
  if (APPLY) await pass2();
  else await pass1();
  const lat = [...pacer.latencies].sort((a, b) => a - b);
  if (lat.length)
    console.log(`  BSE latency: n=${lat.length} p50=${lat[Math.floor(lat.length / 2)]}ms p90=${lat[Math.floor(lat.length * 0.9)]}ms max=${lat[lat.length - 1]}ms`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
