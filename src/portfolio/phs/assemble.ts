// ─────────────────────────────────────────────────────────────────────────────
// PHS ASSEMBLE — resolve a user's book into the engine's input (A.3 Stage 0).
// Per holding, attach: market_value (qty × current price), mcap tier (frozen
// snapshot), sector, health (latest ScoreSnapshot.composite IF scored), and the
// fired findings Signals consumes. PHS READS these — it never recomputes a score
// or re-fires a finding.
//
// NON-SCOPE BOUNDARY (1.1 Change 4): this is the ONLY seam feeding the PHS engine. It
// attaches position + health facts and NOTHING ELSE. Growth / behaviour / returns history
// (a holding's XIRR, TWR, P&L, holding period, buy-sell cadence) lives on the Performance
// surface and MUST NEVER be assembled onto a PhsHolding — PHS is a HEALTH read, never a
// performance read (legal boundary, §A.1/B.0). If a future task needs behaviour context,
// it belongs on a Performance/behaviour snapshot, not here and not in the score.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import type { PhsHolding, McapTier, FindingKind, PillarSubtotals } from "./engine.js";
import type { AssetClass } from "./entity.js";
import { LENS_NATURE, type LensNature, CONSTRUCTION_PROVISIONAL_ABOVE, MATCHER_VERSION_NONE } from "./constants.js";
import type { PhsProvenance } from "./persist.js";
import { listUnifiedPositions, type UnifiedPosition } from "../../brokers/union.js";
import {
  resolvePrice,
  type InstrumentPriceInput,
  type InstrumentPrevInput, type UnpricedReason } from "../price-resolver.js";

/** RedFlag.severity (free text) → the Signals headline class it maps to. */
function severityToFinding(sev: string | null): FindingKind | null {
  switch ((sev ?? "").toLowerCase()) {
    case "critical": return "critical";
    case "high": return "high";
    case "medium": return "medium";
    default: return null; // low / null → not a Signals deduction
  }
}

/** A position we hold but CANNOT score or value with our own prices: a broker symbol outside
 *  our universe, or a future non-equity instrument. It is excluded from PHS weights (we will
 *  not invent a market value), but it is NOT swept under the rug — it is returned so the
 *  display surface can show it, loudly, with whatever the broker said it was worth. */
export interface HeldNotValued {
  symbol: string;
  accountId: string;
  accountName: string;
  source: "manual" | "broker";
  quantity: string;
  /** The BROKER's ₹ figure, when it gave one. This is the ONLY value we have for it — and it
   *  is display-only, precisely because it never enters the score. null = we truly don't know. */
  brokerCurrentValue: string | null;
  /** (Step 4) the position's account is severed => this quantity is last-known, not current. */
  stale: boolean;
  lastSyncedAt: string | null;
  /** (Stage 9) WHICH KIND OF "no" this is — the resolver already decided it (price-resolver.ts);
   *  HeldNotValued simply dropped it on the floor. PE6 binds it, because "we cannot value this and we
   *  do not expect to" (not_exchange_traded) and "no price has landed yet" are DIFFERENT SENTENCES, and
   *  only one of them contains a promise. null on the defensive path only. */
  unpricedReason: UnpricedReason | null;
}

/** (Step 4) A SEVERED account: bound to a broker, no longer receiving data. Its holdings are a
 *  frozen last-known-good snapshot — they STILL score (the user still owns the shares), so the
 *  one thing we owe them is to say so, loudly, every time we show a number built on it. */
export interface StaleAccount {
  accountId: string;
  accountName: string;
  /** null ⇔ the connection itself is gone (clear-data) — the account is stale AND empty. */
  broker: string | null;
  /** null ⇒ never synced (severed before its first successful sync). */
  lastSyncedAt: string | null;
  /** DERIVED AT READ, NEVER STORED — it grows every day the account stays severed, so a frozen
   *  copy would begin lying the moment it was written. null ⇔ never synced. */
  ageDays: number | null;
  /** how many frozen positions this account is still contributing to the score. */
  positions: number;
}

/** Everything the portfolio read must DISCLOSE about numbers it is showing: what we hold but
 *  could not value, and what we valued off frozen data. Both are live facts (mapping can
 *  change; staleness ages daily), so both are computed at READ time and neither is persisted
 *  into the PHS snapshot. */
/** (Step 14.5) A position we CAN value but will never SCORE — an ETF, a REIT, an InvIT, a fund.
 *
 *  Until 14.5 these were lumped into `heldNotValued`, because "not an equity" and "cannot be
 *  priced" happened to be the same set. They are not the same THING, and the moment ETFs/REITs got
 *  prices the conflation became a lie: /me/holdings would show a REIT worth ₹5,432 while this
 *  channel was still calling it a position we "could not price".
 *
 *  The distinction is permanent, not transitional:
 *    · held-not-VALUED — we do not know what it is worth. A gap. Might be closed one day.
 *    · held-not-SCORED — we know exactly what it is worth, and we will never judge it. The Health
 *      Score is an EQUITY judgement built on fundamentals (margins, ROCE, leverage, promoter
 *      pledge) that a trust does not have and a fund does not report. Scoring one would not be a
 *      stretch; it would be a category error.
 *
 *  Both carry ZERO score weight — that is unchanged, and is why splitting them cannot move a
 *  number. What changes is only what we TELL the user about the capital sitting outside the score. */
export interface HeldNotScored {
  symbol: string;
  accountId: string;
  accountName: string;
  source: "manual" | "broker";
  quantity: string;
  /** OUR value: resolved price × quantity. The whole point — this capital is real and we know it. */
  marketValue: string;
  /** stock_price | exchange_close | amfi_nav — where the price came from. */
  priceSource: string;
  /** The day the price belongs to. Never render one without the other. */
  priceAsOf: string | null;
  assetClass: string;
  /** (Construction v2 Stage 1) the instrument's ISIN + AMFI category — the position facts the entity
   *  model reads (nature + entity key). isin drives entity aggregation; category splits commodity
   *  ETFs from baskets. Carried onto the weight-vector holding in assemblePortfolio. */
  isin: string;
  category: string | null;
  stale: boolean;
  lastSyncedAt: string | null;
}

/** (Construction v2 Stage 0 — Ruling 2) VALUATION-COMPLETENESS flags for the Construction read.
 *  Computed READ-TIME from heldNotValued (a live fact — never frozen into the snapshot) against the
 *  corrected valued book. NOT persisted, NOT in the fingerprint. Band/display is Stage 6. */
export interface ConstructionValuation {
  /** Σ of the BROKER's ₹ figure over positions we could not price (display-only figures — the only
   *  value we have for them). Positions with no broker value contribute nothing: we truly don't know. */
  unvaluedValue: string;
  /** unvaluedValue ÷ (valuedBook + unvaluedValue) — the share of the WHOLE book we could not value. */
  unvaluedShare: number;
  /** (Ruling 2) unvaluedShare past CONSTRUCTION_PROVISIONAL_ABOVE → the Construction read is
   *  provisional: too much of the book is unvalued for its shape to be trusted. Flag only. */
  constructionProvisional: boolean;
}

export interface PortfolioDisclosure {
  /** Positions we could NOT price. A gap we admit to. */
  heldNotValued: HeldNotValued[];
  /** (Step 14.5) Positions we CAN price but never score. Valued capital, deliberately unjudged. */
  heldNotScored: HeldNotScored[];
  /** (Construction v2 Stage 9) Raw UNION positions — "does this user hold anything at all?".
   *
   *  NOT the coverage counts: those must be over the AGGREGATED book (`holdings`), which is what
   *  `totalValue` sums, and they live on the snapshot (`constructionData.holdingCount`/`scoredCount`).
   *  This is deliberately the RAW position count — one row per (account × instrument), before assemble
   *  collapses the same instrument across accounts into one exposure. It answers a different question,
   *  and it answers it over the union rather than the manual table alone (the controller's
   *  `hasHoldings` used `prisma.holding.count`, so a broker-only book read as "no holdings"). */
  positionCount: number;
  /** (Step 14.5) The ₹ we hold, know the value of, and do not score. The honest headline for
   *  "how much of my book is outside the Health Score, and what is it worth". */
  heldNotScoredValue: string;
  staleAccounts: StaleAccount[];
  staleAccountCount: number;
  /** the age of the OLDEST frozen account's data — the honest headline for "how stale is this". */
  oldestSyncAgeDays: number | null;
}

/** Whole-days between a last-sync stamp and now. Read-time only (see StaleAccount.ageDays). */
function ageDaysOf(lastSyncedAt: string | null, now: Date): number | null {
  if (!lastSyncedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(lastSyncedAt).getTime()) / 86_400_000));
}

/** Split the union into what PHS can score (aggregated by stock) and what it cannot (returned
 *  for loud display). Shared by the SCORE path (assemblePortfolio) and the READ path
 *  (listPortfolioDisclosure) so the two can never disagree about which positions are which. */
/** Which of these stocks do we actually have a PRICE for? One query, not N.
 *
 *  (Step 7) This became load-bearing the moment add-to-universe shipped. Before it, "we cannot
 *  value this" and "this has no stock_id" were the SAME condition, so partition() could key on
 *  the stock_id alone. Now a freshly-admitted broker symbol HAS a stock_id and has no price yet —
 *  so keying on stock_id would quietly value the user's real shares at ₹0 and disclose nothing.
 *  The honest key is, and always was, CAN WE VALUE IT. */
/** (Construction v2 Stage 0 — Ruling 4) Keys on a USABLE PRICE VALUE, not mere row existence.
 *  A stock whose price row is missing OR null therefore falls through to the heldNotValued branch
 *  below (per-position, with full account attribution) instead of reaching assemblePortfolio and
 *  being valued at ₹0 INSIDE the denominator — the latent `: 0` defect. stock_prices.price is
 *  NOT NULL today, so this is byte-identical on the live book (existence ⟺ has-value); it removes a
 *  latent ₹0-weight hole, it does not move a number. Returns a Set so callers keep `.has(stockId)`. */
async function pricedStockIds(stockIds: string[]): Promise<Set<string>> {
  if (stockIds.length === 0) return new Set();
  const rows = await prisma.stockPrice.findMany({ where: { stockId: { in: stockIds } }, select: { stockId: true, price: true } });
  return new Set(rows.filter((r) => r.price != null).map((r) => r.stockId));
}

async function partition(positions: UnifiedPosition[]) {
  // ── AGGREGATE BY STOCK (exposure), not per-account line ──
  // PHS's S1 concentration rule is per-holding and additive, and the fingerprint keys on symbol.
  // Feeding it the same stock twice (once per account) would charge TWO half-sized positions
  // instead of ONE combined one — understating concentration. Exposure is what health reads.
  // (The display surface keeps the per-account lines; that is a different, deliberate shape.)
  //
  // A STALE position aggregates in exactly like a live one (Step 4). Its quantity is the last
  // known one, and last-known is a far better estimate of what the user holds than zero — which
  // is what dropping it would assert. Staleness caveats the QUANTITY; it never removes the
  // position, and it never touches the price (that is ours and live — §2.4 / Ruling 1).
  const byStock = new Map<string, { stockId: string; quantity: number }>();
  const heldNotValued: HeldNotValued[] = [];
  const heldNotScored: HeldNotScored[] = [];

  const priced = await pricedStockIds([...new Set(positions.map((p) => p.stockId).filter((id): id is string => !!id))]);

  // (Step 14.5) The catalogue rows for every NON-STOCK position, so a priced-but-unscorable
  // instrument can be reported as what it IS (held-not-scored, worth ₹X) instead of being filed
  // under "we could not price it". Uses the SAME resolver as holdings-controller, so the display
  // read and this disclosure can never disagree about whether a position is priceable.
  //
  // NOTHING BELOW TOUCHES `byStock`. The score's input set is exactly what it was.
  const nonStockIds = [...new Set(positions.filter((p) => !p.stockId && p.instrumentId).map((p) => p.instrumentId!))];
  // (Construction v2 Stage 1) the map carries isin + category too — the position facts the entity
  // model reads. Same one query; two extra columns.
  const instrBy = new Map<string, InstrumentPriceInput & { isin: string; category: string | null }>();
  const instrPrevBy = new Map<string, InstrumentPrevInput>();
  if (nonStockIds.length > 0) {
    const [rows, prevRows] = await Promise.all([
      prisma.instrument.findMany({
        where: { id: { in: nonStockIds } },
        select: { id: true, assetClass: true, lastPrice: true, lastPriceDate: true, currentNav: true, navDate: true, isActive: true, isin: true, category: true },
      }),
      prisma.$queryRawUnsafe<{ instrument_id: string; close: unknown; prev_close: unknown; date: Date }[]>(
        `SELECT DISTINCT ON (instrument_id) instrument_id, close, prev_close, date
           FROM instrument_prices WHERE instrument_id = ANY($1::text[])
          ORDER BY instrument_id, date DESC`,
        nonStockIds,
      ),
    ]);
    for (const r of rows) instrBy.set(r.id, r);
    for (const r of prevRows) instrPrevBy.set(r.instrument_id, { close: r.close, prevClose: r.prev_close, date: r.date });
  }

  for (const p of positions) {
    // HONEST-EMPTY: no price of ours ⇒ no market value we can honestly compute. Excluded from the
    // score's weights rather than valued with the broker's number (which would let SOURCE move the
    // score) — and SURFACED here rather than silently dropped.
    //
    // TWO ways to be unvaluable, and Step 7 introduced the second:
    //   • no stockId          — a broker symbol we could not identify (no ISIN). The original case.
    //   • stockId, NO PRICE   — a stock we just ADMITTED from a broker feed. It has an identity but
    //     no price row yet, and it will keep none until it appears in a bhavcopy. Valuing it at ₹0
    //     (which is what falling through to the scoring path does) would be a silent lie about
    //     real shares the user owns. It is not scored either way — the weight is 0 in both — so
    //     routing it here changes NO score. It changes only whether we ADMIT to not knowing.
    if (!p.stockId || !priced.has(p.stockId)) {
      // (Step 14.5) THE SPLIT. The CONDITION above is untouched — the score's input set is exactly
      // what it was, so no number can move. All that happens here is that we now say WHICH kind of
      // outside-the-score this position is, instead of calling every one of them unpriceable.
      const resolved = resolvePrice({
        stockId: p.stockId,
        instrumentId: p.instrumentId,
        stockPrice: undefined, // by construction: a stock reaching here has NO stock_prices row
        instrument: p.instrumentId ? instrBy.get(p.instrumentId) : undefined,
        instrumentPrev: p.instrumentId ? instrPrevBy.get(p.instrumentId) : undefined,
      });

      if (resolved.price != null) {
        // We KNOW what it is worth. It is not a gap — it is capital we deliberately do not judge.
        const instr = instrBy.get(p.instrumentId!);
        heldNotScored.push({
          symbol: p.symbol,
          accountId: p.accountId,
          accountName: p.accountName,
          source: p.source,
          quantity: p.quantity,
          marketValue: (Number(p.quantity) * resolved.price).toFixed(2),
          priceSource: resolved.source!,
          priceAsOf: resolved.asOf,
          assetClass: instr?.assetClass ?? "unknown",
          // (Stage 1) isin is the instrument's own (fund/ETF/REIT ISIN); a priced heldNotScored row
          // ALWAYS resolved through an instrument, so `instr` is present here — the ?? are defensive.
          isin: instr?.isin ?? p.symbol,
          category: instr?.category ?? null,
          stale: p.stale ?? false,
          lastSyncedAt: p.lastSyncedAt ?? null,
        });
        continue;
      }

      // We genuinely do not know what it is worth. Admit it — never imply ₹0.
      heldNotValued.push({
        symbol: p.symbol,
        accountId: p.accountId,
        accountName: p.accountName,
        source: p.source,
        quantity: p.quantity,
        brokerCurrentValue: p.brokerCurrentValue ?? null,
        stale: p.stale ?? false,
        lastSyncedAt: p.lastSyncedAt ?? null,
        unpricedReason: resolved.unpricedReason, // the resolver already knows; stop discarding it
      });
      continue;
    }
    const agg = byStock.get(p.stockId);
    if (agg) agg.quantity += Number(p.quantity);
    else byStock.set(p.stockId, { stockId: p.stockId, quantity: Number(p.quantity) });
  }
  return { byStock, heldNotValued, heldNotScored };
}

/** THE DISCLOSURE READ (Step 4). Read-only, IDOR-scoped by `userId` (the caller takes it from
 *  the auth token). Never persisted: every field here is a LIVE fact. */
export async function listPortfolioDisclosure(userId: string, now: Date = new Date()): Promise<PortfolioDisclosure> {
  const positions = await listUnifiedPositions(userId);
  const { heldNotValued, heldNotScored } = await partition(positions);

  // One entry per SEVERED account (not per position) — the account is the unit the user severed.
  const byAccount = new Map<string, StaleAccount>();
  for (const p of positions) {
    if (!p.stale) continue;
    const existing = byAccount.get(p.accountId);
    if (existing) {
      existing.positions++;
      continue;
    }
    byAccount.set(p.accountId, {
      accountId: p.accountId,
      accountName: p.accountName,
      broker: p.broker ?? null,
      lastSyncedAt: p.lastSyncedAt ?? null,
      ageDays: ageDaysOf(p.lastSyncedAt ?? null, now),
      positions: 1,
    });
  }
  const staleAccounts = [...byAccount.values()];
  const ages = staleAccounts.map((a) => a.ageDays).filter((d): d is number => d != null);

  return {
    heldNotValued,
    heldNotScored,
    positionCount: positions.length,
    // The ₹ the user holds, that we KNOW the value of, and that the Health Score deliberately does
    // not judge. Summed here rather than left for a caller to add up, because a caller that forgets
    // is a caller that quietly under-reports the book.
    heldNotScoredValue: heldNotScored.reduce((s, h) => s + Number(h.marketValue), 0).toFixed(2),
    staleAccounts,
    staleAccountCount: staleAccounts.length,
    oldestSyncAgeDays: ages.length ? Math.max(...ages) : null,
  };
}

/** (Construction v2 Stage 0 — Ruling 2) The valuation-completeness flags for the Construction read,
 *  computed READ-TIME (heldNotValued is a live fact — never frozen). `valuedBook` is the corrected
 *  denominator: Σ marketValue over (byStock ∪ heldNotScored) — i.e. the persisted snapshot's
 *  totalValue AFTER Stage 0's population fix. Pure; the caller (the read controller) is the only
 *  place both the valued book and the disclosure meet, so the share is stitched there, not stored. */
export function constructionValuation(valuedBook: number, heldNotValued: HeldNotValued[]): ConstructionValuation {
  const unvaluedValue = heldNotValued.reduce((s, h) => s + (h.brokerCurrentValue ? Number(h.brokerCurrentValue) : 0), 0);
  const denom = valuedBook + unvaluedValue;
  const unvaluedShare = denom > 0 ? unvaluedValue / denom : 0;
  return {
    unvaluedValue: unvaluedValue.toFixed(2),
    unvaluedShare,
    constructionProvisional: unvaluedShare > CONSTRUCTION_PROVISIONAL_ABOVE,
  };
}

export async function assemblePortfolio(userId: string): Promise<{
  holdings: PhsHolding[];
  prov: PhsProvenance;
  fieldWeakSymbols: Set<string>;
  heldNotValued: HeldNotValued[];
}> {
  // THE UNION (Step 3): manual (FIFO) ⊎ broker (snapshot), across EVERY account the user owns.
  // Source is a display label and plays NO part below — every share weighs the same (§2.4).
  // Includes FROZEN positions from severed accounts (Step 4) — see partition().
  const positions = await listUnifiedPositions(userId);
  const { byStock, heldNotValued, heldNotScored } = await partition(positions);

  const holdings: PhsHolding[] = [];
  const healthSnapshotIds: string[] = [];
  const findingIds: string[] = [];
  const fieldWeakSymbols = new Set<string>(); // LM3/LP2 — for PX5 ONLY, NEVER a deduction
  let tierAsOfDate = "none";

  for (const agg of byStock.values()) {
    const stock = await prisma.stock.findUnique({
      where: { id: agg.stockId },
      select: { id: true, symbol: true, isin: true, sector: { select: { name: true } } },
    });
    if (!stock) continue; // catalog says there is a stock, but it's gone — skip, never fabricate
    const stockId = stock.id;
    const [price, tierRow, score] = await Promise.all([
      prisma.stockPrice.findUnique({ where: { stockId }, select: { price: true } }),
      prisma.marketCapTierSnapshot.findFirst({ where: { stockId }, orderBy: { asOfDate: "desc" }, select: { tier: true, asOfDate: true } }),
      prisma.scoreSnapshot.findFirst({
        where: { stockId },
        orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
        // (1.2 Change 4) the four pillar subtotals ride the same read — they are frozen on
        // the ScoreSnapshot, so pillarProfile needs no extra join.
        select: { id: true, composite: true, labelBand: true, foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true },
      }),
    ]);

    // RULING 1 — every share is valued with OUR price × the COMBINED qty across sources and
    // accounts. The broker's own `currentValue` is deliberately NOT used here: if broker rows
    // were valued by the broker and manual rows by us, the SAME stock would score differently
    // depending on who reported it — and source must never move the score (§2.4).
    //
    // This is also what makes scoring a FROZEN position honest (Step 4): the price is TODAY's,
    // so a stale holding is marked to the current market. Only the quantity is last-known — so
    // a severed account's value ages the way the market moves, not the way a stale ₹ figure rots.
    // (Construction v2 Stage 0 — Ruling 4) partition routes ONLY usably-priced stocks into byStock,
    // so `price` is present here. A null is a delete-race between partition and this read — skip the
    // holding entirely rather than let it become a ₹0-weighted position inside the denominator (the
    // old `price ? … : 0` did exactly that: a real stock diluting every weight and under-reporting
    // totalValue). Skipping keeps the weight vector honest; the disclosure read owns surfacing it.
    if (!price) continue;
    const marketValue = agg.quantity * Number(price.price);
    const tier: McapTier = (tierRow?.tier as McapTier | undefined) ?? "unknown";
    if (tierRow) {
      const d = tierRow.asOfDate.toISOString().slice(0, 10);
      if (d > tierAsOfDate) tierAsOfDate = d;
    }

    // Scored ⇔ a health snapshot exists. health = composite.
    const health = score ? Number(score.composite) : null;
    // (1.2 Change 4) pillar subtotals for a scored holding (else null).
    const pillars: PillarSubtotals | null = score
      ? { foundation: Number(score.foundationSubtotal), momentum: Number(score.momentumSubtotal), market: Number(score.marketSubtotal), ownership: Number(score.ownershipSubtotal) }
      : null;
    const lensNatures: LensNature[] = []; // (1.2 Change 5) natures of this holding's fired lens patterns
    const findings: FindingKind[] = [];
    if (score) {
      healthSnapshotIds.push(score.id);
      const flags = await prisma.redFlag.findMany({ where: { snapshotId: score.id }, select: { id: true, severity: true } });
      for (const f of flags) {
        findingIds.push(f.id);
        const k = severityToFinding(f.severity);
        if (k) findings.push(k);
      }
      // Distress band → distress headline. The stock engine's lowest band ("fragile")
      // is the distress-equivalent. Headline-wins in the engine dedupes it against any
      // Critical flag on the same name (single-largest), so no double-count.
      if (score.labelBand === "fragile") findings.push("distress");
      // LP5/LP6 (breadth patterns) + LM3/LP2 (field-weak verdicts) from the LIVE
      // lens-pattern store (score_patterns.pattern_key). Only genuinely-fired patterns
      // (not pending_data_integration). LP5/LP6 → Signals deductions; LM3/LP2 → PX5
      // context ONLY (field-verdict lock: they NEVER deduct, never a negative finding).
      const patterns = await prisma.scorePattern.findMany({
        where: { snapshotId: score.id, displayState: { not: "pending_data_integration" } },
        select: { id: true, patternKey: true },
      });
      for (const p of patterns) {
        if (p.patternKey === "LP5") { findings.push("lp5"); findingIds.push(p.id); }
        else if (p.patternKey === "LP6") { findings.push("lp6"); findingIds.push(p.id); }
        else if (p.patternKey === "LM3" || p.patternKey === "LP2") { fieldWeakSymbols.add(stock.symbol); findingIds.push(p.id); }
        // (1.2 Change 5) EVERY fired three-lens pattern (LM1–8 / LP1–6) contributes its
        // primary nature to lensProfile — a findings-character read, orthogonal to whether
        // it also feeds Signals (LP5/LP6) or the field-weak context (LM3/LP2). Not added to
        // the fingerprint: patterns are regenerated WITH the score snapshot (already tracked).
        const nat = LENS_NATURE[p.patternKey];
        if (nat) lensNatures.push(nat);
      }
    }

    // (Stage 1) a stock is name-risk; its entity key is stocks.isin.slice(0,7), computed at read.
    holdings.push({ symbol: stock.symbol, marketValue, tier, sector: stock.sector?.name ?? null, health, findings, pillars, lensNatures, isin: stock.isin, assetClass: "stock", category: null });
  }

  // (Construction v2 Stage 0 — Ruling 1) heldNotScored ENTERS the weight vector + Construction.
  // A priced fund / ETF / REIT / InvIT / gilt is REAL CAPITAL: it has a market value we resolved,
  // so it has weight and it is part of the book the coverage line describes. It contributes NOTHING
  // to Health — `health: null` keeps it out of Quality (renormalized over scored) AND out of the
  // Signals sum (also renormalized over scored, Ruling i) — so no Health value can move. What it
  // now enters is totalValue, the weight vector, and Construction, which is exactly right: the book
  // is bigger than the equities we score, and pretending otherwise is the coverage-line lie this
  // stage exists to end. Aggregated by symbol like byStock (a fund's symbol is its ISIN — unique),
  // so the same fund across two accounts is ONE combined exposure, never two half-sized ones.
  // tier "unknown" (a fund has no mcap tier) → bucket small_unscored; sector null (Stage 4 resolves
  // sectors). Deliberately unscored capital, now honestly weighted. §13 frozen: nothing here scores.
  // (Construction v2 Stage 4 — §7) Resolve each BOND's sector by INHERITING its issuer's. The bond's
  // 7-char stem matches a CATALOGUED stock (ruled catalogued, not scored — a sector is a company fact,
  // ODL cv2-s4-bond-sector-catalogued); all 504 catalogued stocks carry a sector. A bond whose issuer
  // is not in our universe (165 live) stays sector-null → not_applicable downstream. Non-bond
  // non-stocks (funds/ETFs/sovereign/trusts) carry no resolved sector this stage. One query, only when
  // a bond is actually held — the live cohort has none, so this never runs for them.
  const bondStems = new Set(heldNotScored.filter((h) => h.assetClass === "bond").map((h) => h.isin.slice(0, 7)));
  const stemSector = new Map<string, string | null>();
  if (bondStems.size > 0) {
    const stks = await prisma.stock.findMany({ select: { isin: true, sector: { select: { name: true } } } });
    for (const s of stks) { const stem = s.isin?.slice(0, 7); if (stem && bondStems.has(stem)) stemSector.set(stem, s.sector?.name ?? null); }
  }

  // (Construction v2 Stage 5 — §6 C5) Resolve each FUND PRODUCT's fund house. A basket or commodity ETF
  // (asset_class etf | mutual_fund) is an AMC product — C5 prices single-house concentration. Resolution:
  // instrument.amfiSchemeCode → mf_family_members.scheme_code → mf_families.fund_house (100% live
  // coverage), with instrument.fund_house as a fallback. Name-risk / sovereign carry no house. One pair
  // of queries, only when a fund product is actually held — the live cohort holds two, most books none.
  const fundIsins = [...new Set(heldNotScored.filter((h) => h.assetClass === "etf" || h.assetClass === "mutual_fund").map((h) => h.isin))];
  const houseByIsin = new Map<string, string | null>();
  const nameByIsin = new Map<string, string>();
  if (fundIsins.length > 0) {
    const instrs = await prisma.instrument.findMany({ where: { isin: { in: fundIsins } }, select: { isin: true, amfiSchemeCode: true, fundHouse: true, name: true } });
    const codes = [...new Set(instrs.map((i) => i.amfiSchemeCode).filter((c): c is string => !!c))];
    const famHouseByCode = new Map<string, string>();
    if (codes.length > 0) {
      const mems = await prisma.$queryRawUnsafe<{ scheme_code: string; fund_house: string }[]>(
        `SELECT m.scheme_code, f.fund_house FROM mf_family_members m JOIN mf_families f ON f.id = m.family_id WHERE m.scheme_code = ANY($1::text[])`,
        codes,
      );
      for (const m of mems) famHouseByCode.set(m.scheme_code, m.fund_house);
    }
    for (const i of instrs) {
      const viaFamily = i.amfiSchemeCode ? famHouseByCode.get(i.amfiSchemeCode) : undefined;
      houseByIsin.set(i.isin, viaFamily ?? i.fundHouse ?? null);
      // (Stage 9) the fund's catalog name — DISPLAY ONLY. A fund's `symbol` is its ISIN (below), so
      // without this PB6's bind would read "INF204K01234 is a Large Cap Fund". Same query, one column.
      nameByIsin.set(i.isin, i.name);
    }
  }

  const byNonStock = new Map<string, { marketValue: number; isin: string; assetClass: AssetClass; category: string | null }>();
  for (const h of heldNotScored) {
    const e = byNonStock.get(h.symbol);
    if (e) e.marketValue += Number(h.marketValue);
    else byNonStock.set(h.symbol, { marketValue: Number(h.marketValue), isin: h.isin, assetClass: h.assetClass as AssetClass, category: h.category });
  }
  for (const [symbol, e] of byNonStock) {
    const sector = e.assetClass === "bond" ? (stemSector.get(e.isin.slice(0, 7)) ?? null) : null;
    // (Stage 5) fund house for a fund product; null for name-risk / sovereign (never a C5 subject).
    const fundHouse = e.assetClass === "etf" || e.assetClass === "mutual_fund" ? (houseByIsin.get(e.isin) ?? null) : null;
    holdings.push({ symbol, marketValue: e.marketValue, tier: "unknown", sector, health: null, findings: [], pillars: null, lensNatures: [], isin: e.isin, assetClass: e.assetClass, category: e.category, fundHouse, name: nameByIsin.get(e.isin) ?? null });
  }

  return {
    holdings,
    // (Stage 7 §12) `sectorVersion: "nse-sector-v1"` is GONE — it was a hardcoded constant, so it could
    // never fire; the fingerprint now hashes the sector-resolution OUTPUTS themselves (the actual fact
    // C3/C4 read), which is strictly better: per-book, and true rather than merely asserted.
    // `matcherVersion` is the §14 matcher's version — the sentinel until Stage 8 builds it and bumps it,
    // at which point every affected snapshot invalidates instead of silently re-rating.
    prov: { healthSnapshotIds, findingIds, tierAsOfDate, matcherVersion: MATCHER_VERSION_NONE },
    fieldWeakSymbols,
    heldNotValued,
  };
}
