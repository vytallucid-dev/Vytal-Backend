// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — READER CONTEXT RESOLVER (§1.2).
//
// One reader's relationship to their whole book + watchlist + attention, resolved once per request. It
// EXTENDS the joins the chat composer already uses — it does NOT write a parallel set:
//   · `probeStockRelationship` (src/ai/insight/relationship.ts) is reused VERBATIM for the (held,
//     watchlist-row) probe — union-aware, the same one the discuss composer routes on.
//   · `buildPortfolioHealthView` supplies the entity-aggregated book (weights, values, sector, PHS) — the
//     SAME read the portfolio page renders, so weights are never re-derived here.
//   · `listUnifiedPositions` supplies per-account labels + route + the fund-holding fact.
//   · `resolveToneForUser` supplies aiLevel (fail-soft to balanced).
// relationship.ts is UNCHANGED, so the chat composer's behaviour is untouched (it still calls
// probeStockRelationship / groundStockRelationship exactly as before). This resolver sits alongside it.
//
// ANONYMOUS ⇒ a VALID context (userId null, no reader-side facts) that resolves to M9 — not an error path.
// ATTENTION IS A ROUTER (§0.6): the fields below select the mode and eligibility; they are never rendered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { probeStockRelationship } from "../ai/insight/relationship.js";
import { buildPortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { resolveToneForUser } from "../ai/tone.js";
import type { ReaderContext, ReaderBook, ReaderHolding, ReaderWatchlist, ReaderAttention } from "./types.js";

const TRAILING_30D_MS = 30 * 24 * 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** The anonymous / stranger context — a valid ReaderContext with no reader-side facts (→ M9). */
export function anonymousContext(): ReaderContext {
  return {
    identity: { userId: null, isAuthenticated: false, aiLevel: "balanced" },
    heldThisObject: false,
    book: null,
    watchlist: null,
    attention: null,
  };
}

/**
 * Resolve the ReaderContext for an authenticated user reading `stockId`. `stockId` is needed only to
 * resolve the per-object facts (the watchlist row + the attention rollup for THIS object); the book and
 * tone are object-independent. Never throws — every sub-read degrades to an honest-empty rather than
 * failing the guaranteed-resolve card.
 */
export async function resolveReaderContext(userId: string, stockId: string): Promise<ReaderContext> {
  const [tone, probe, rollup, trailing30d, watchlistCount] = await Promise.all([
    resolveToneForUser(userId), // fail-soft to balanced internally
    probeStockRelationship(userId, stockId).catch(() => ({ held: false, watchlist: null })),
    prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId, stockId } } }).catch(() => null),
    prisma.attentionEvent
      .count({ where: { userId, stockId, eventType: "view", createdAt: { gt: new Date(Date.now() - TRAILING_30D_MS) } } })
      .catch(() => 0),
    prisma.watchlist.count({ where: { userId } }).catch(() => 0),
  ]);

  const book = await resolveBook(userId);

  const watchlist: ReaderWatchlist = {
    exists: watchlistCount > 0,
    count: watchlistCount,
    thisAddedAt: probe.watchlist?.addedAt ?? null,
  };

  // FIRST when there is genuinely no view history for this object; hasHistory guards against a rollup
  // created by a relationship event (no view) reading as RETURNING (§2.1 / UG6 territory).
  const viewCount = rollup?.viewCount ?? 0;
  const attention: ReaderAttention = {
    hasHistory: viewCount > 0,
    firstViewedAt: rollup?.firstViewedAt ?? null,
    lastViewedAt: rollup?.lastViewedAt ?? null,
    viewCount,
    viewCountTrailing30d: trailing30d,
    lastViewedSnapshotGeneration: rollup?.lastViewedSnapshotGeneration ?? null,
  };

  return {
    identity: { userId, isAuthenticated: true, aiLevel: tone.level },
    heldThisObject: probe.held, // union-aware; authoritative even before a PHS snapshot lands
    book,
    watchlist,
    attention,
  };
}

/**
 * Build the entity-aggregated book from the PHS view + unified positions. Fail-soft: any throw degrades to
 * a minimal book (existence from the raw positions, weights null) rather than losing the whole card. Held
 * facts (weights, values, sector) come from the SAME entity ledger the portfolio page reads (§0.7).
 */
async function resolveBook(userId: string): Promise<ReaderBook | null> {
  let positions: Awaited<ReturnType<typeof listUnifiedPositions>> = [];
  try {
    positions = await listUnifiedPositions(userId);
  } catch {
    positions = [];
  }

  // Account labels per constituent symbol + the whole-book account count + the fund-holding fact.
  const labelsBySymbol = new Map<string, Set<string>>();
  const accountNames = new Set<string>();
  let hasFundHoldings = false;
  for (const p of positions) {
    accountNames.add(p.accountName);
    if (p.symbol) {
      const set = labelsBySymbol.get(p.symbol) ?? new Set<string>();
      set.add(p.accountName);
      labelsBySymbol.set(p.symbol, set);
    }
    // A recognised non-equity instrument (stockId null, instrumentId present) is a fund/basket/bond the
    // reader holds and we cannot see through — the honest trigger for `lookthrough_unavailable` / UG5.
    if (p.stockId === null && p.instrumentId !== null) hasFundHoldings = true;
  }

  let pv: Awaited<ReturnType<typeof buildPortfolioHealthView>> | null = null;
  try {
    pv = await buildPortfolioHealthView(userId);
  } catch {
    pv = null;
  }

  const exists = pv?.hasHoldings ?? positions.length > 0;
  if (!exists) {
    // Authenticated, no portfolio connected → book exists:false (UG7 states the limit once).
    return {
      exists: false,
      accountCount: 0,
      scoredHoldingsCount: 0,
      totalHoldingsCount: 0,
      unscoredHoldingsCount: 0,
      totalValue: 0,
      typicalPositionValue: null,
      holdings: [],
      hasFundHoldings: false,
      lookThroughAvailable: false,
      phsComposite: null,
      phsBand: null,
    };
  }

  const entities = pv?.snapshot?.constructionRead.entities ?? [];
  const cov = pv?.snapshot?.coverageState ?? null;
  const totalValue = cov?.totalValue ?? positions.reduce((s, p) => s + Number(p.investedValue ?? 0), 0);

  const holdings: ReaderHolding[] = entities.map((e) => {
    const symbols = e.constituentInstruments.map((c) => c.symbol);
    const labels = new Set<string>();
    for (const sym of symbols) for (const l of labelsBySymbol.get(sym) ?? []) labels.add(l);
    return {
      entityKey: e.entityKey,
      displayLabel: e.displayName,
      value: e.constituentInstruments.reduce((s, c) => s + c.marketValue, 0),
      weightPct: e.weight * 100,
      accountLabels: [...labels],
      // Per-entity scored resolution is deferred — the slice's decisions use aggregate counts
      // (scoredHoldingsCount) and per-object scored (ObjectState.isScored), never this flag.
      isScored: true,
      sector: e.sector,
      route: "direct", // look-through is unavailable, so every name-risk entity is direct-only (§1.2)
      symbols,
    };
  });

  const scoredHoldingsCount = cov?.scoredCount ?? holdings.length;
  const totalHoldingsCount = cov?.totalCount ?? holdings.length;

  return {
    exists: true,
    accountCount: accountNames.size,
    scoredHoldingsCount,
    totalHoldingsCount,
    unscoredHoldingsCount: Math.max(0, totalHoldingsCount - scoredHoldingsCount),
    totalValue,
    typicalPositionValue: median(holdings.map((h) => h.value)),
    holdings,
    hasFundHoldings,
    lookThroughAvailable: false, // permanently false today (§1.2) — UH5 can never fire; UG5 is the handler
    phsComposite: pv?.snapshot?.healthRead?.value ?? null,
    phsBand: pv?.snapshot?.healthRead?.band ?? null,
  };
}
