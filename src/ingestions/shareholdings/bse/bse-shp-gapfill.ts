// ─────────────────────────────────────────────────────────────────────────────
// BSE GAP-FILL — the NSE fallback for ONGOING shareholding ingestion.
//
// The forward pipeline (quarterly-shareholding + daily-shareholding-refresh) is
// NSE-only. When NSE drops a quarter for a stock, nothing notices and the hole
// stays: ABB's 2026-06-30 filing was missing 55 days past the SEBI deadline while
// BSE held it complete (promoter 75 / public 25 / fii 7.67 / dii 9.9).
//
// This closes that class of hole. It is a RECONCILIATION sweep, deliberately not
// threaded into the NSE ingest path:
//   · it runs AFTER the NSE pass, so NSE stays the primary and BSE the fallback;
//   · it only considers quarters whose SEBI filing deadline has passed, so a
//     not-yet-filed quarter is never mistaken for a gap;
//   · it only considers quarters AFTER a stock's first known row, so pre-listing
//     quarters are never chased;
//   · it INSERTS ONLY (skipDuplicates) — an NSE row is never overwritten.
//
// Every guard from the Stage 2 backfill applies: vintage detection from payload
// content, the fully-paid share counts, the FVCI classification, the closure test
// for omitted subtotals, largest-row selection for multi-class scrips, and the
// cross-endpoint public-total check. See bse-shp-extract.ts for why each exists.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { BsePacer } from "../../quaterly-results/bse/bse-http.js";
import { dateToQuarterFY } from "../shareholding-dates.js";
import {
  checkPartitionBroken, checkPctRange, checkShareInvariants,
} from "../shareholding-guards.js";
import { parseBseShareholding, dateToQid, type BseParsedShareholding } from "./bse-shp-extract.js";
import { fetchSecurity, fetchPublic, securityUrl } from "./bse-shp-fetch.js";
import { fetchScripMaster, resolveAgainstMaster } from "../../quaterly-results/bse/bse-resolver.js";

/** SEBI Reg-31 allows 21 days after quarter end. Only look past that. */
export const FILING_WINDOW_DAYS = 21;
const TOL_PP = 0.05;
/** Where the symbol -> BSE scrip code map lives (resolved by ISIN). */
const SCRIP_MAP_FILE = "_s10-bse-resolved.json";

export interface GapFillResult {
  scanned: number;
  gaps: number;
  filled: number;
  unavailable: number;
  guardFailed: number;
  noScripCode: number;
  details: { symbol: string; quarter: string; outcome: string }[];
}

export interface GapFillOptions {
  /** Newest N quarters to reconcile. Default 8. */
  lookbackQuarters?: number;
  /** Preview only — resolve and report, write nothing. */
  dryRun?: boolean;
  /** Restrict to these symbols (diagnostics). */
  symbols?: string[];
  onProgress?: (done: number, total: number, label: string) => Promise<boolean> | boolean;
  signal?: AbortSignal;
}

const qEnd = (y: number, q: number): string => `${y}-${["03-31", "06-30", "09-30", "12-31"][q]}`;

/** Quarter-end dates whose filing deadline has PASSED, newest first. */
export function reconcilableQuarters(n: number, today = new Date()): string[] {
  const out: string[] = [];
  let y = today.getUTCFullYear();
  let q = Math.floor(today.getUTCMonth() / 3);
  while (out.length < n) {
    q -= 1;
    if (q < 0) { q = 3; y -= 1; }
    const d = qEnd(y, q);
    const age = Math.floor((today.getTime() - new Date(`${d}T00:00:00Z`).getTime()) / 86400000);
    if (age > FILING_WINDOW_DAYS) out.push(d);
  }
  return out;
}

/** Reasons this row must not be written. Empty ⇒ acceptable. */
function guardRow(p: BseParsedShareholding, publicTotalFromPub: number | null): string[] {
  const out: string[] = [];
  if (checkPartitionBroken(p.promoterPct, p.publicPct, p.employeeTrustPct))
    out.push(`partition ${p.promoterPct}+${p.publicPct}+${p.employeeTrustPct}`);
  // checkPctRange is a VIOLATION predicate — true means OUTSIDE [0,100].
  for (const [k, v] of [["fii", p.fiiPct], ["dii", p.diiPct], ["retail", p.retailPct]] as const)
    if (checkPctRange(v)) out.push(`${k}=${v} out of range`);
  if (p.fiiPct !== null && p.diiPct !== null && p.fiiPct + p.diiPct > p.publicPct + TOL_PP)
    out.push(`fii+dii ${p.fiiPct + p.diiPct} > public ${p.publicPct}`);
  if (publicTotalFromPub !== null && Math.abs(publicTotalFromPub - p.publicPct) > TOL_PP)
    out.push(`endpoints disagree on public: ${p.publicPct} vs ${publicTotalFromPub}`);
  out.push(...checkShareInvariants({
    totalShares: p.totalShares, promoterShares: p.promoterShares, pledgedShares: p.pledgedShares,
  }));
  return out;
}


/** BSE master, fetched at most once per run and only if the cache misses. */
let liveMaster: Awaited<ReturnType<typeof fetchScripMaster>> | null = null;
const liveResolveFailed = new Set<string>();

async function resolveScripLive(symbol: string): Promise<string | undefined> {
  try {
    const isin = (await prisma.stock.findUnique({ where: { symbol }, select: { isin: true } }))?.isin ?? "";
    if (!liveMaster) liveMaster = await fetchScripMaster(new BsePacer());
    const r = resolveAgainstMaster([{ symbol, isin }], liveMaster);
    return r.resolved[0]?.scripCode;
  } catch {
    return undefined;   // a resolver failure is "unavailable", never a thrown job
  }
}

export async function fillShareholdingGapsFromBse(opts: GapFillOptions = {}): Promise<GapFillResult> {
  const { lookbackQuarters = 8, dryRun = false, symbols, onProgress, signal } = opts;
  const res: GapFillResult = {
    scanned: 0, gaps: 0, filled: 0, unavailable: 0, guardFailed: 0, noScripCode: 0, details: [],
  };

  // ⚠ THE SIDE-FILE IS A CACHE, NOT THE SOURCE OF TRUTH.
  //   MEASURED 2026-08-26: `_s10-bse-resolved.json` held 499 entries for a 504-stock universe, and
  //   every symbol added since it was generated silently reported "no BSE scrip code" — an honest
  //   -looking outcome for a stock BSE lists perfectly well. ABBOTINDIA, BAYERCROP and MCX (scrips
  //   500488 / 506285 / 534091) were all in that hole. A static map that goes stale whenever the
  //   universe changes is a silent-failure generator, so anything absent from it is now resolved
  //   against the LIVE BSE master before being called unavailable.
  let scrip: Map<string, string>;
  try {
    const resolved = JSON.parse(readFileSync(SCRIP_MAP_FILE, "utf8")) as
      { symbol: string; scripCode: string }[];
    scrip = new Map(resolved.map((r) => [r.symbol, r.scripCode]));
  } catch {
    // A missing cache is not fatal — everything simply resolves live below.
    res.details.push({ symbol: "-", quarter: "-", outcome: `scrip map ${SCRIP_MAP_FILE} unreadable — resolving live instead` });
    scrip = new Map();
  }

  const quarters = reconcilableQuarters(lookbackQuarters);
  const oldest = quarters[quarters.length - 1];

  const stocks = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.id, s.symbol FROM stocks s WHERE s.is_active = true ORDER BY s.symbol`,
  );
  const held = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q FROM shareholding_patterns p
     JOIN stocks s ON s.id = p.stock_id WHERE p.as_on_date >= $1::date`,
    oldest,
  );
  const have = new Map<string, Set<string>>();
  for (const r of held) {
    const s = String(r.symbol);
    if (!have.has(s)) have.set(s, new Set());
    have.get(s)!.add(String(r.q));
  }
  // First-ever row per stock: a quarter BEFORE it is pre-listing, not a gap.
  const firstRow = new Map<string, string>();
  for (const r of await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, min(p.as_on_date)::text mn FROM shareholding_patterns p
     JOIN stocks s ON s.id = p.stock_id GROUP BY s.symbol`,
  )) firstRow.set(String(r.symbol), String(r.mn));

  // ── enumerate the real gaps ──
  const work: { id: string; symbol: string; quarter: string }[] = [];
  for (const s of stocks) {
    const sym = String(s.symbol);
    if (symbols && !symbols.includes(sym)) continue;
    res.scanned++;
    const first = firstRow.get(sym);
    for (const q of quarters) {
      if (have.get(sym)?.has(q)) continue;
      if (first === undefined || first >= q) continue; // pre-listing
      work.push({ id: String(s.id), symbol: sym, quarter: q });
    }
  }
  res.gaps = work.length;
  if (!work.length) return res;

  const pacer = new BsePacer({ minSpacingMs: 900, throttleStopMs: 120000, slowMs: 15000, maxSpacingMs: 60000 });

  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) break;
    const w = work[i];
    let code = scrip.get(w.symbol);
    if (!code && !liveResolveFailed.has(w.symbol)) {
      // absent from the cache — ask BSE itself before declaring it unavailable
      code = await resolveScripLive(w.symbol);
      if (code) scrip.set(w.symbol, code);
      else liveResolveFailed.add(w.symbol);
    }
    if (!code) {
      res.noScripCode++;
      res.details.push({
        symbol: w.symbol, quarter: w.quarter,
        outcome: "no BSE scrip code (absent from the cache AND from the live BSE master — NSE-only listing)",
      });
      continue;
    }
    const qid = dateToQid(w.quarter);
    try {
      const secRows = await fetchSecurity(pacer, code, qid);
      // Cheap absence test before paying for the second request.
      const probe = parseBseShareholding(secRows, []);
      if (!probe.ok && probe.reason !== "unknown_public_form") {
        res.unavailable++;
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `BSE lacks it (${probe.reason})` });
        continue;
      }
      const pubRows = await fetchPublic(pacer, code, qid);
      const parsed = parseBseShareholding(secRows, pubRows);
      if (!parsed.ok) {
        res.unavailable++;
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `BSE lacks it (${parsed.reason})` });
        continue;
      }
      const pubTotal = pubRows.find((r) => !r.holder && r.code === "STB1B2B3")?.pct ?? null;
      const bad = guardRow(parsed.value, pubTotal);
      if (bad.length) {
        res.guardFailed++;
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `guard: ${bad.join("; ")}` });
        continue;
      }
      if (dryRun) {
        res.filled++;
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `WOULD FILL (promoter ${parsed.value.promoterPct}, fii ${parsed.value.fiiPct}, dii ${parsed.value.diiPct})` });
        continue;
      }
      const d = parsed.value;
      const asOn = new Date(`${w.quarter}T00:00:00.000Z`);
      const { quarter, fiscalYear } = dateToQuarterFY(asOn);
      const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
      const big = (v: number | null) => (v === null ? BigInt(0) : BigInt(Math.round(v)));
      const created = await prisma.shareholdingPattern.createMany({
        // skipDuplicates: if the NSE pass landed this quarter in the meantime,
        // its row wins and this is a no-op.
        skipDuplicates: true,
        data: [{
          stockId: w.id, symbol: w.symbol, asOnDate: asOn, quarter, fiscalYear,
          promoterPct: new Prisma.Decimal(d.promoterPct),
          publicPct: new Prisma.Decimal(d.publicPct),
          employeeTrustPct: new Prisma.Decimal(d.employeeTrustPct),
          fiiPct: dec(d.fiiPct), diiPct: dec(d.diiPct),
          retailPct: dec(d.retailPct), othersPct: dec(d.othersPct),
          mutualFundPct: dec(d.mutualFundPct), insurancePct: dec(d.insurancePct),
          banksFisPct: dec(d.banksFisPct),
          promoterPledgedPct: dec(d.promoterPledgedPct),
          promoterPledgedSharesPct: dec(d.promoterPledgedSharesPct),
          totalShares: big(d.totalShares), promoterShares: big(d.promoterShares),
          pledgedShares: big(d.pledgedShares),
          xbrlUrl: securityUrl(code, qid), // provenance: greppable as the BSE lane
          sourceDate: asOn,
        }],
      });
      if (created.count === 1) {
        res.filled++;
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `filled from BSE (promoter ${d.promoterPct}, fii ${d.fiiPct}, dii ${d.diiPct})` });
      } else {
        res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: "already present (NSE won the race)" });
      }
    } catch (e) {
      res.unavailable++;
      res.details.push({ symbol: w.symbol, quarter: w.quarter, outcome: `fetch failed: ${(e as Error).message}` });
    }
    if (onProgress) {
      const cont = await onProgress(i + 1, work.length, `${w.symbol} ${w.quarter}`);
      if (cont === false) break;
    }
  }
  return res;
}
