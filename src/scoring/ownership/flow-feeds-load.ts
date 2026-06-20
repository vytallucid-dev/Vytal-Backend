// File: src/scoring/ownership/flow-feeds-load.ts
//
// FLOW FEEDS LOADER — assembles the Category C (insider) + D (block) FlowFeeds for
// ONE stock from the raw InsiderTrade / BlockDeal tables. This is the wiring that
// REPLACES the NO_FEEDS stub (score-pass.ts): the C/D scoring logic in flow.ts is
// already complete and only dormant for lack of a feed; this loader supplies it.
//
// ── CUTOFF-CORRECT (the #1 risk) ──────────────────────────────────────────────
// When a point-in-time cutoff is given (a backfill quarter-end), insider trades are
// restricted to tradeDate ≤ cutoff and block deals to dealDate ≤ cutoff — the SAME
// cutoff every other raw read in computePgScores honours. A post-period transaction
// can therefore never leak backward into a historical period's score. (The C/D
// window logic in flow.ts then further anchors to the shareholding as-of date, so
// activity past the scored quarter never enters that quarter's flow read either.)
//
// ── RATIFIED personCategory → role MAPPING (LOCKED, identical every PG) ────────
//   promoter / promoter_group      → "promoter"
//   director / kmp                 → "director"
//   designated_employee            → EXCLUDED  (known eligible-insider boundary; NOT flagged)
//   immediate_relative / other / any unrecognised SEBI string
//                                  → EXCLUDED **and FLAGGED** (surfaced for review —
//                                    never silently shrink C coverage)
// A deterministic taxonomy→bucket transform — no data-dependent branching.
//
// ── null vs [] (the dormancy decision) ────────────────────────────────────────
// insiderTxns / blockTxns are ALWAYS arrays once this loader runs (never null). A
// stock with no activity gets EMPTY ARRAYS, so C/D evaluate to their SCORED-neutral
// state — `dormant_no_feed` now means only "this loader was not used". marketCapInrCr
// is null solely when price or share count is unavailable → D degrades to
// `dormant_no_data` (graceful), never a garbage score.

import { prisma } from "../../db/prisma.js";
import type { DailyClose } from "../price/range.js";
import type { BlockTxn, FlowFeeds, InsiderTxn } from "./flow.js";

const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

// ── personCategory → InsiderTxn.role (ratified) ───────────────────────────────
export function mapPersonCategoryToRole(raw: string | null): { role: "promoter" | "director" | null; flagged: boolean } {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "promoter":
    case "promoter_group":
      return { role: "promoter", flagged: false };
    case "director":
    case "kmp":
      return { role: "director", flagged: false };
    case "designated_employee":
      return { role: null, flagged: false }; // ratified exclusion — known, not flagged
    default:
      return { role: null, flagged: true }; // immediate_relative / other / unknown → exclude + FLAG
  }
}

// ── insider transactionType → directional side ────────────────────────────────
// Only open-market buy/sell are directional FLOW. pledge / revoke_pledge /
// inter_se_transfer / esos / other are NOT accumulation/distribution signals
// (pledge is owned by Primary; ESOS/inter-se are not conviction trades) → dropped.
function mapInsiderSide(t: string | null): "buy" | "sell" | null {
  const s = (t ?? "").trim().toLowerCase();
  if (s === "buy") return "buy";
  if (s === "sell") return "sell";
  return null;
}

/** End-of-window market cap (₹cr) = last close on/before `asOf` × totalShares ÷ 1e7.
 *  `daily` is ascending and already ≤ cutoff. null when price or share count missing
 *  → Category D lands dormant_no_data (graceful). */
export function marketCapInrCrAsOf(
  daily: DailyClose[],
  asOf: Date,
  totalShares: bigint | null,
): { value: number | null; source: string } {
  if (totalShares === null || totalShares <= 0n) return { value: null, source: "no_total_shares" };
  let close: number | null = null;
  let closeDate: Date | null = null;
  for (const d of daily) {
    if (d.date.getTime() <= asOf.getTime()) {
      close = d.close;
      closeDate = d.date;
    } else break;
  }
  if (close === null || close <= 0) return { value: null, source: "no_price_asof" };
  const value = (close * Number(totalShares)) / 1e7; // ₹ → ₹cr
  return { value, source: `close ₹${close} @ ${closeDate!.toISOString().slice(0, 10)} × ${totalShares.toString()} sh` };
}

export interface FlowFeedsDiag {
  insiderRaw: number;
  insiderKept: number;
  insiderDroppedRole: number; // designated_employee + flagged categories
  insiderDroppedSide: number; // pledge / esos / inter-se / other transactionType
  insiderDroppedValue: number; // null / ≤0 tradeValueCr (unscoreable)
  blockRaw: number;
  blockKept: number;
  blockDroppedValue: number;
  marketCapInrCr: number | null;
  marketCapSource: string;
  /** distinct unmapped personCategory strings (exclude+FLAG) → occurrence count. */
  flaggedCategories: Record<string, number>;
}

export interface FlowFeedsLoaded {
  feeds: FlowFeeds;
  diag: FlowFeedsDiag;
}

/**
 * Load the C/D FlowFeeds for one stock. Reads the InsiderTrade + BlockDeal tables
 * (the only NEW queries); the market cap is derived from the already-loaded daily
 * closes + the current shareholding totalShares (no re-query).
 */
export async function loadFlowFeeds(args: {
  stockId: string;
  /** Current shareholding as-on date — the C/D window anchor + market-cap as-of. */
  asOf: Date;
  /** Point-in-time cutoff (pit.quarterEnd). Restricts tradeDate/dealDate ≤ cutoff. */
  cutoff?: Date;
  /** Already-loaded daily closes (≤ cutoff), ascending — reused for the market cap. */
  daily: DailyClose[];
  /** Current shareholding totalShares — for the Category-D %-of-mcap banding. */
  totalShares: bigint | null;
}): Promise<FlowFeedsLoaded> {
  const { stockId, asOf, cutoff, daily, totalShares } = args;

  // ── Category C — insider trades (cutoff-correct) ──
  const insiderRows = await prisma.insiderTrade.findMany({
    where: { stockId, ...(cutoff ? { tradeDate: { lte: cutoff } } : {}) },
    select: { tradeDate: true, intimationDate: true, personName: true, personCategory: true, transactionType: true, tradeValueCr: true },
  });
  const insiderTxns: InsiderTxn[] = [];
  const flaggedCategories: Record<string, number> = {};
  let dRole = 0, dSide = 0, dValue = 0;
  for (const r of insiderRows) {
    const { role, flagged } = mapPersonCategoryToRole(r.personCategory);
    if (flagged) {
      const key = (r.personCategory ?? "∅").trim() || "∅";
      flaggedCategories[key] = (flaggedCategories[key] ?? 0) + 1;
    }
    if (role === null) { dRole++; continue; } // designated_employee or flagged → excluded
    const side = mapInsiderSide(r.transactionType);
    if (side === null) { dSide++; continue; } // non-directional txn type
    const valueInrCr = num(r.tradeValueCr);
    if (valueInrCr === null || valueInrCr <= 0) { dValue++; continue; } // unscoreable value
    const date = r.tradeDate ?? r.intimationDate; // intimationDate is NOT NULL → always a date
    insiderTxns.push({ date, insiderId: (r.personName ?? "").trim().toLowerCase() || "unknown", side, valueInrCr, role });
  }

  // ── Category D — block + bulk deals (cutoff-correct) ──
  const blockRows = await prisma.blockDeal.findMany({
    where: { stockId, ...(cutoff ? { dealDate: { lte: cutoff } } : {}) },
    select: { dealDate: true, transactionType: true, valueCr: true },
  });
  const blockTxns: BlockTxn[] = [];
  let bValue = 0;
  for (const r of blockRows) {
    const valueInrCr = num(r.valueCr);
    if (valueInrCr === null || valueInrCr <= 0) { bValue++; continue; }
    const side: "buy" | "sell" = r.transactionType === "sell" ? "sell" : "buy";
    blockTxns.push({ date: r.dealDate, side, valueInrCr });
  }

  const mc = marketCapInrCrAsOf(daily, asOf, totalShares);

  return {
    feeds: { insiderTxns, blockTxns, marketCapInrCr: mc.value },
    diag: {
      insiderRaw: insiderRows.length,
      insiderKept: insiderTxns.length,
      insiderDroppedRole: dRole,
      insiderDroppedSide: dSide,
      insiderDroppedValue: dValue,
      blockRaw: blockRows.length,
      blockKept: blockTxns.length,
      blockDroppedValue: bValue,
      marketCapInrCr: mc.value,
      marketCapSource: mc.source,
      flaggedCategories,
    },
  };
}
