// ─────────────────────────────────────────────────────────────────────────────
// ITEM 2.2 — THE FENCE TEST. Route B: real flip, REAL exported selectors, revert.
//
// RULES ENFORCED IN CODE:
//   · SELECTORS ONLY — no job, no fetch, no external call. Every probe below is a
//     pure read. `runDaily*` / `scanUniverse` / `runPriceBackfill` are NEVER called.
//   · Refuses to start inside 17:45–22:00 UTC (the cron window).
//   · Refuses to start if any background_job is running/pending.
//   · finally-revert: an exception cannot leave the row flipped.
//   · Final gate: census must read 504 true / 0 false, else exit 1.
//
//   npx tsx tmp-22-fence-test.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./src/db/prisma.js";
import { filingUniverse } from "./src/filing/pass.js";
import { loadStockUniverse } from "./src/ingestions/insider-trades/pit-ingester.js";
import { getUniverseRows, _clearUniverseRowsCacheForVerification } from "./src/scoring/read/universe-rows.cache.js";
import { getResultsFeedRows, _clearResultsFeedCacheForVerification } from "./src/scoring/read/results-feed.cache.js";
import { resolveResultsSeasonBanner } from "./src/results-season/service.js";
import { getAllCalendarEvents, getCalendarBounds } from "./src/controllers/ingestion/events-controllers.js";
import { getTodayNewsFeed } from "./src/controllers/ingestion/news-controllers.js";
// ── The four worklist selectors made testable by item 2.4 (export-only). ──
// Aliased: three of them share the name `loadUniverse`. NONE of these fetch —
// each is a single prisma.stock.findMany and nothing else.
import { loadUniverse as pricesUniverse } from "./src/ingestions/prices/ingest-prices.js";
import { loadUniverse as dealsUniverse } from "./src/ingestions/block-deals/ingest-deals.js";
import { loadUniverse as eventsUniverse } from "./src/ingestions/corporate-events/ingest-events.js";
import { loadUniverse as newsUniverse } from "./src/ingestions/news_and_announcements/ingest-news.js";

const SYM = "NSLNISP";
let STOCK_ID = "";

// ── deep membership search: does this payload NAME the symbol anywhere? ──
function mentions(v: unknown, needle: string): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v === needle;
  if (typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => mentions(x, needle));
  return Object.values(v as Record<string, unknown>).some((x) => mentions(x, needle));
}

function mockReqRes(query: Record<string, unknown> = {}) {
  const out: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const res: any = {
    status(c: number) { out.statusCode = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    send(b: unknown) { out.body = b; return res; },
  };
  return { req: { query, params: {}, body: {} } as any, res, out };
}

// ── THE PROBES — each returns true if NSLNISP is present in that site's output ──
interface Probe { n: string; site: string; cls: string; run: () => Promise<boolean> }

const PROBES: Probe[] = [
  { n: "4", site: "filing/pass.ts:338 filingUniverse()", cls: "SQL · ingestion worklist",
    run: async () => (await filingUniverse()).some((s) => s.symbol === SYM) },

  { n: "8", site: "pit-ingester.ts:117 loadStockUniverse()", cls: "SQL · ingestion worklist",
    run: async () => { const m = await loadStockUniverse();
      return m.has(SYM) || [...m.values()].includes(SYM); } },

  // ── ITEM 2.4: the four heavy nightly worklists, testable for the first time ──
  { n: "11", site: "ingest-prices.ts:62 loadUniverse()", cls: "SQL · ingestion worklist",
    run: async () => (await pricesUniverse()).has(SYM) },

  { n: "6", site: "ingest-deals.ts:26 loadUniverse()", cls: "SQL · ingestion worklist",
    run: async () => (await dealsUniverse()).has(SYM) },

  { n: "7", site: "ingest-events.ts:204 loadUniverse()", cls: "SQL · ingestion worklist",
    run: async () => (await eventsUniverse()).has(SYM) },

  { n: "9", site: "ingest-news.ts:72 loadUniverse()", cls: "SQL · ingestion worklist",
    run: async () => (await newsUniverse()).some((s) => s.symbol === SYM) },

  { n: "21", site: "results-feed.cache.ts:106-325 getResultsFeedRows()", cls: "SQL · UI/read (6 clauses)",
    run: async () => { _clearResultsFeedCacheForVerification();
      return mentions(await getResultsFeedRows(), SYM); } },

  // ⚠ PROBE CORRECTED after run #1. `!= null` was WRONG: loadStockFacts returns null for an
  // inactive stock (:142), but resolveResultsSeasonBanner turns that into silence("unknown_stock")
  // (:180) — a non-null resolution object. The membership question is whether the banner still
  // SPEAKS about the stock, so the assertion is "not silenced as unknown_stock".
  { n: "19", site: "results-season/service.ts:142 resolveResultsSeasonBanner()", cls: "post-fetch guard · UI/read",
    run: async () => {
      const r = await resolveResultsSeasonBanner(null, STOCK_ID) as unknown as Record<string, unknown>;
      const reason = (r?.reason ?? r?.silenceReason ?? null) as string | null;
      return reason !== "unknown_stock";
    } },

  { n: "1", site: "events-controllers.ts:103 getAllCalendarEvents()", cls: "SQL · UI/read",
    run: async () => { const { req, res, out } = mockReqRes({ days: "365" });
      await getAllCalendarEvents(req, res); return mentions(out.body, SYM); } },

  { n: "2", site: "events-controllers.ts:235 getCalendarBounds()", cls: "SQL · UI/read",
    run: async () => { const { req, res, out } = mockReqRes();
      await getCalendarBounds(req, res); return mentions(out.body, SYM); } },

  { n: "3", site: "news-controllers.ts:213 getTodayNewsFeed()", cls: "SQL · UI/read",
    run: async () => { const { req, res, out } = mockReqRes();
      await getTodayNewsFeed(req, res); return mentions(out.body, SYM); } },

  // ── THE FENCELESS CONTROL. Expected to STILL INCLUDE it — that is the point. ──
  { n: "F1", site: "universe-rows.cache.ts:102 getUniverseRows()  [NO where clause]", cls: "FENCELESS · control",
    run: async () => { _clearUniverseRowsCacheForVerification();
      return (await getUniverseRows()).stocks.some((s) => s.symbol === SYM) } },
];

async function census() {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT is_active, count(*)::int AS n FROM stocks GROUP BY 1`)) as { is_active: boolean; n: number }[];
  return { active: rows.find((r) => r.is_active)?.n ?? 0, inactive: rows.find((r) => !r.is_active)?.n ?? 0 };
}

async function runAll(phase: string): Promise<Map<string, boolean | "ERR">> {
  const out = new Map<string, boolean | "ERR">();
  for (const p of PROBES) {
    try { out.set(p.n, await p.run()); }
    catch (e) { out.set(p.n, "ERR"); console.error(`  [${phase}] probe ${p.n} threw:`, (e as Error).message); }
  }
  return out;
}

async function main() {
  // ── PRECONDITION 1: the cron window ──
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  console.log(`UTC start: ${now.toISOString()}`);
  if (mins >= 17 * 60 + 45 && mins < 22 * 60) {
    throw new Error(`REFUSING: ${now.toISOString().slice(11, 16)} UTC is inside the forbidden 17:45–22:00 cron window`);
  }
  console.log("  ✅ outside the 17:45–22:00 UTC cron window");

  // ── PRECONDITION 2: no jobs in flight ──
  const jobs = (await prisma.$queryRawUnsafe(
    `SELECT status, count(*)::int AS n FROM background_jobs WHERE status IN ('running','pending') GROUP BY 1`)) as any[];
  if (jobs.length) throw new Error(`REFUSING: background_jobs in flight → ${JSON.stringify(jobs)}`);
  console.log("  ✅ zero background_jobs running/pending");

  // ── PRECONDITION 3: clean census + the subject exists and is unreferenced ──
  const c0 = await census();
  if (c0.active !== 504 || c0.inactive !== 0) throw new Error(`REFUSING: census ${c0.active}/${c0.inactive}, expected 504/0`);
  console.log(`  ✅ census ${c0.active} true / ${c0.inactive} false`);

  const subj = await prisma.stock.findUnique({ where: { symbol: SYM }, select: { id: true, isActive: true } });
  if (!subj) throw new Error(`REFUSING: ${SYM} not found`);
  if (!subj.isActive) throw new Error(`REFUSING: ${SYM} is already inactive — resolve before running`);
  STOCK_ID = subj.id;

  const refs = (await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*)::int FROM stock_peer_groups WHERE stock_id=$1) AS pg,
           (SELECT count(*)::int FROM holdings         WHERE stock_id=$1) AS holdings,
           (SELECT count(*)::int FROM watchlist        WHERE stock_id=$1) AS watchlist,
           (SELECT count(*)::int FROM alerts           WHERE stock_id=$1) AS alerts,
           (SELECT count(*)::int FROM transactions     WHERE stock_id=$1) AS txns`, STOCK_ID)) as any[];
  const r = refs[0];
  if (r.pg || r.holdings || r.watchlist || r.alerts || r.txns)
    throw new Error(`REFUSING: ${SYM} is referenced → ${JSON.stringify(r)}`);
  console.log(`  ✅ ${SYM} unreferenced: ${JSON.stringify(r)}\n`);

  let flipped = false;
  let before: Map<string, boolean | "ERR">, during: Map<string, boolean | "ERR">, after: Map<string, boolean | "ERR">;

  try {
    console.log("── PHASE 1: BASELINE (active) ──");
    before = await runAll("before");

    console.log("\n── FORWARD FLIP ──");
    const n = await prisma.$executeRawUnsafe(
      `UPDATE stocks SET is_active = false WHERE symbol = $1 AND is_active = true`, SYM);
    flipped = true;
    const cf = await census();
    console.log(`  UPDATE affected ${n} row(s); census now ${cf.active} true / ${cf.inactive} false`);

    console.log("\n── PHASE 2: DURING (inactive) ──");
    during = await runAll("during");
  } finally {
    if (flipped) {
      const n = await prisma.$executeRawUnsafe(
        `UPDATE stocks SET is_active = true WHERE symbol = $1 AND is_active = false`, SYM);
      console.log(`\n── REVERT ── restored ${n} row(s)`);
    }
  }

  console.log("\n── PHASE 3: AFTER (active again) ──");
  after = await runAll("after");

  // ── THE TABLE ──
  console.log("\n" + "═".repeat(104));
  console.log("PER-SITE RESULT — membership of NSLNISP (not counts)");
  console.log("═".repeat(104));
  console.log("#".padEnd(4) + "before".padEnd(8) + "during".padEnd(8) + "after".padEnd(7) + "VERDICT".padEnd(26) + "site");
  const b = (v: boolean | "ERR" | undefined) => v === "ERR" ? "ERR" : v ? "yes" : "no";
  let notExcluding: string[] = [];
  for (const p of PROBES) {
    const B = before!.get(p.n), D = during!.get(p.n), A = after!.get(p.n);
    let verdict: string;
    if (B === "ERR" || D === "ERR") verdict = "PROBE ERROR";
    else if (B === false) verdict = "INCONCLUSIVE (absent at baseline)";
    else if (D === false && A === true) verdict = "EXCLUDES ✅";
    else if (D === true) { verdict = "DOES NOT EXCLUDE ⚠"; notExcluding.push(`${p.n} ${p.site}`); }
    else verdict = `ANOMALY (before=${b(B)} during=${b(D)} after=${b(A)})`;
    console.log(p.n.padEnd(4) + b(B).padEnd(8) + b(D).padEnd(8) + b(A).padEnd(7) + verdict.padEnd(26) + p.site);
  }

  console.log("\n── SITES THAT DID NOT EXCLUDE ──");
  console.log(notExcluding.length ? notExcluding.map((s) => "  ⚠ " + s).join("\n") : "  (none besides the fenceless control)");

  // ── FINAL GATE ──
  const c1 = await census();
  const ok = c1.active === 504 && c1.inactive === 0;
  console.log(`\nFINAL CENSUS: ${c1.active} true / ${c1.inactive} false — ${ok ? "GATE PASS" : "GATE FAIL"}`);
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (e) => {
  console.error("\nHARNESS FAILED:", e);
  console.error("⚠ RUN `npx tsx tmp-22-revert.ts` NOW to re-assert the census.");
  await prisma.$disconnect();
  process.exit(1);
});
