// File: src/scoring/composite/pg-registry.ts
//
// CANONICAL REGISTRY of the SCORED peer groups + the stock→PG fan-out lookup the
// event-driven scoring-trigger layer uses to decide which PGs to rescore.
//
// Single source of truth for "which PGs get a Health Score": the 11 non-financial
// (PG1–PG4, PG8–PG14) + the 2 banking (PG5 private, PG6 PSU) = 13. PG7 (NBFC) is GATED
// (separate bank-data workstream) and is DELIBERATELY ABSENT here, so the fan-out can
// never target it and the price path's "rescore all" means all 13, not PG7.
//
// pgId / seedKey / pgName mirror the committed-score scripts (stage4-commit-scores.ts,
// bank-stage4-commit.ts) EXACTLY. computePgScores resolves the DB peer group by
// `pgName` (prisma.peerGroup.findFirst({ where: { name } })), so these names MUST match
// the seed `name` field (peer-groups.seed.ts) verbatim.

import { prisma } from "../../db/prisma.js";
import type { PgRef } from "./score-pass.js";

/** The 13 scored peer groups. PG7 NBFC intentionally excluded (gated — no rescore). */
export const SCORED_PGS: readonly PgRef[] = [
  { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
  { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" },
  { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" },
  { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
  { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
  { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
];

const BY_NAME = new Map<string, PgRef>(SCORED_PGS.map((p) => [p.pgName, p]));
const BY_PGID = new Map<string, PgRef>(SCORED_PGS.map((p) => [p.pgId, p]));

/** Resolve a scored PG by its DB peer-group name (the StockPeerGroup → PeerGroup.name
 *  join key). Returns undefined for an unscored group (PG7 / alternate groups). */
export function scoredPgByName(name: string): PgRef | undefined {
  return BY_NAME.get(name);
}

/** Resolve a scored PG by its logical pgId ("PG5"). undefined if not a scored PG. */
export function scoredPgById(pgId: string): PgRef | undefined {
  return BY_PGID.get(pgId);
}

/**
 * Fan out a set of stockIds → the DISTINCT scored PGs they belong to.
 *
 * MULTI-PG SAFE: a stock can be in more than one peer group (StockPeerGroup has only
 * @@unique([stockId, peerGroupId]), not unique on stockId). This returns ALL of a
 * stock's memberships, not findFirst — so an ingestion for a multi-PG stock triggers a
 * rescore of every PG it sits in. Deduped by pgId across the input set. Any membership
 * that is NOT a scored PG (PG7 NBFC, alternate groups) is silently dropped — those PGs
 * have no committed scores to recompute.
 *
 * One indexed query (StockPeerGroup @@index([stockId])).
 */
export async function pgRefsForStockIds(stockIds: string[]): Promise<PgRef[]> {
  if (!stockIds.length) return [];
  const memberships = await prisma.stockPeerGroup.findMany({
    where: { stockId: { in: stockIds } },
    select: { peerGroup: { select: { name: true } } },
  });
  const out = new Map<string, PgRef>();
  for (const m of memberships) {
    const ref = BY_NAME.get(m.peerGroup.name);
    if (ref) out.set(ref.pgId, ref);
  }
  return [...out.values()];
}

/** Fan out a set of stock SYMBOLS → the DISTINCT scored PGs they belong to. Resolves
 *  symbols → stockIds first, then delegates to pgRefsForStockIds. Unknown symbols are
 *  silently dropped (a symbol not in the Stock table has no memberships). */
export async function pgRefsForSymbols(symbols: string[]): Promise<PgRef[]> {
  if (!symbols.length) return [];
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true },
  });
  return pgRefsForStockIds(stocks.map((s) => s.id));
}
