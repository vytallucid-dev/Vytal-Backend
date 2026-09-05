// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SEVEN STOCK BLOCKS' RESOLVERS — price · quarter series · events · ownership events ·
// ownership series · peers · news. Stage 7.
//
// ── ★ EVERY ONE IS A WRAPPER, NOT A REWRITE ───────────────────────────────────────────────────────
// The reads all live in `src/scoring/read/` and survive the stage-8 deletion untouched. What was
// missing was the `Resolved<T>` envelope: an honest coverage half, an absent arm that is a value
// rather than a null, and provenance. That is the whole of the class-B gap the stage-5a audit found,
// and it is why these are one file — they share a subject kind, a coverage shape and a resolver
// pattern, and splitting them into seven near-identical files would hide that.
//
// ── ★ THE ONE DISCIPLINE THAT MATTERS AT SEVEN AT ONCE ────────────────────────────────────────────
// `ok: false` means WE CANNOT SPEAK TO THIS. It does NOT mean the answer is empty. A stock with no
// block deals resolves `ok: true` with an empty list, because "no deals were done" is a fact about
// the market; a stock we hold no ownership filings for resolves `ok: false`, because that is a fact
// about us. Collapsing the two would render the same card for both, and §3.1's whole subject is that
// they are different answers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { pairDeals } from "./deal-pairs.js";
import { buildPriceView } from "../scoring/read/price-view.service.js";
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import { buildCorporateEventsView } from "../scoring/read/corporate-events.service.js";
import { parseEventDescription, renderComponents, SUPPRESSED_TAIL_NOTE } from "../catalogue/event-description.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { buildPeerComparisonView } from "../scoring/read/peer-comparison.service.js";
import { getPeerGroupForStock, getPeerGroupMembers } from "../scoring/read/peer-group-lookup.js";
import { prisma } from "../db/prisma.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, resolved, stockCoverage, type Coverage, type Resolved, type Source } from "./contract.js";
import type { BlockCopyKey } from "../catalogue/block-copy.js";

/**
 * The coverage envelope every block below shares: this stock's, and no query.
 *
 * ⚠ `null` MEANS THE COVERAGE READ ITSELF FAILED, and every caller must return `read_failed` rather
 *   than carry on with an empty envelope. `resolveStockCoverage` now answers `read_failed` instead of
 *   throwing, and taking `.coverage` off that absence would hand back `{ subject: null, query: null }`
 *   — a perfectly well-formed envelope asserting we hold nothing on a stock we may hold plenty on.
 *   That is the swallow one level up from the one this file was fixed for at C-1.
 */
async function envelopeFor(symbol: string): Promise<Coverage | null> {
  const cov = await resolveStockCoverage(symbol);
  if (!cov.ok && cov.absent.reason === "read_failed") return null;
  return cov.coverage;
}
const PROV_PRICE: Source[] = ["stocks"];
const PROV_Q: Source[] = ["stocks", "quarterly_results"];

// ═══ 1 · PRICE ═════════════════════════════════════════════════════════════════════════════════════
export interface PriceRead {
  readonly symbol: string;
  readonly current: number | null;
  readonly dayChangePct: number | null;
  readonly week52High: number | null;
  readonly week52Low: number | null;
  readonly pctFrom52WHigh: number | null;
  readonly pctFrom52WLow: number | null;
  readonly returns: { readonly r1m: number | null; readonly r3m: number | null; readonly r6m: number | null; readonly r1y: number | null; readonly r3y: number | null };
  readonly series: readonly { readonly at: string; readonly value: number }[];
  readonly benchmark: { readonly label: string; readonly points: readonly { at: string; value: number }[]; readonly r1y: number | null } | null;
  readonly sectorLabel: string | null;
  readonly coverageDays: number;
}

export async function resolvePrice(symbol: string): Promise<Resolved<PriceRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<PriceRead>("read_failed", { subject: null, query: null });
  // ⚠ C-1. A view that could not be BUILT is our failure; a view that built and holds nothing is
  //   the record's silence. Only the second may be reported as a fact about the company.
  let read = true;
  const v = await buildPriceView(symbol).catch(() => { read = false; return null; });
  if (!read) return absent<PriceRead>("read_failed", coverage);
  // ⚠ `hasPrice: false` IS OUR ABSENCE, NOT THE MARKET'S — the stock trades, we simply hold no series.
  if (!v || !v.hasPrice) return absent<PriceRead>("not_ingested", coverage);

  const pts = v.stock.series.map((p) => ({ at: String((p as { date?: string; at?: string }).date ?? (p as { at?: string }).at ?? ""), value: Number((p as { close?: number; value?: number }).close ?? (p as { value?: number }).value ?? 0) }))
    .filter((p) => p.at && Number.isFinite(p.value));
  const bench = v.benchmark
    ? {
        label: String((v.benchmark as { name?: string; label?: string }).name ?? (v.benchmark as { label?: string }).label ?? "Nifty 50"),
        points: ((v.benchmark as { series?: unknown[] }).series ?? []).map((p) => ({
          at: String((p as { date?: string }).date ?? ""), value: Number((p as { close?: number }).close ?? 0),
        })).filter((p) => p.at && Number.isFinite(p.value)),
        r1y: ((v.benchmark as { returns?: { r1y?: number | null } }).returns?.r1y) ?? null,
      }
    : null;

  return resolved<PriceRead>({
    symbol: v.symbol,
    current: v.current.price,
    dayChangePct: v.current.dayChangePct,
    week52High: v.current.week52High,
    week52Low: v.current.week52Low,
    pctFrom52WHigh: v.current.pctFrom52WHigh,
    pctFrom52WLow: v.current.pctFrom52WLow,
    returns: v.stock.returns,
    series: pts,
    benchmark: bench,
    sectorLabel: v.sector ? String((v.sector as { name?: string }).name ?? "sector index") : null,
    coverageDays: v.stock.coverageDays,
  }, coverage, PROV_PRICE);
}

// ═══ 2 · QUARTERLY SERIES ══════════════════════════════════════════════════════════════════════════
export interface QuarterCell { readonly label: string; readonly value: number | null; readonly unit: "cr" | "pct" }
export interface QuarterPeriod { readonly period: string; readonly cells: readonly QuarterCell[] }
export interface QuarterSeriesRead {
  readonly symbol: string;
  readonly periods: readonly QuarterPeriod[];
  /** RESOLVED, never as-requested (§3.3) — a caller who asked 12 and got 8 must be able to see 8. */
  readonly asked: number;
  readonly held: number;
}

export async function resolveQuarterSeries(symbol: string, asked = 8): Promise<Resolved<QuarterSeriesRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<QuarterSeriesRead>("read_failed", { subject: null, query: null });
  // ⚠ A VIEW WE COULD NOT BUILD IS OUR FAILURE, NOT A SHORT RECORD — F-3. This became
  //   `insufficient_quarters` below, whose reader phrase is "more quarters of results than we hold
  //   yet": a NUMERIC claim about the filings, produced by a catch. `statements.ts` already draws this
  //   distinction in words; this file did not draw it at all.
  let viewRead = true;
  const v = await buildFundamentalsView(symbol).catch(() => { viewRead = false; return null; });
  if (!viewRead) return absent<QuarterSeriesRead>("read_failed", coverage);
  // ★ ALL FIVE INDUSTRY FAMILIES, NOT JUST `nonFinancial`. `FundamentalsView` populates exactly one
  //   of five payloads and nulls the rest; a block reading only the first would render nothing for
  //   every bank, NBFC and insurer in the universe and look like a data gap rather than a code one.
  //   `company-snapshot.ts` reads `nonFinancial` alone — a pre-existing narrowing, reported at 5b as
  //   the tier-measurement lesson, and not repeated here.
  const fam = (v as Record<string, unknown> | null);
  const payload = (fam?.nonFinancial ?? fam?.banking ?? fam?.nbfc ?? fam?.lifeInsurance ?? fam?.generalInsurance) as
    Record<string, unknown> | null | undefined;
  const rows = ((payload?.quarters as Record<string, unknown>[] | undefined) ?? []);
  if (rows.length === 0) return absent<QuarterSeriesRead>("insufficient_quarters", coverage);

  const tail = rows.slice(Math.max(0, rows.length - asked));
  const num = (r: Record<string, unknown>, ...keys: string[]): number | null => {
    for (const k of keys) { const x = r[k]; if (typeof x === "number" && Number.isFinite(x)) return x; }
    return null;
  };
  const periods: QuarterPeriod[] = tail.map((r) => ({
    period: String(r.periodKey ?? `${r.fiscalYear ?? ""}${r.quarter ?? ""}`),
    // ⚠ THE KEY LISTS ARE PER-FAMILY ALIASES, NOT GUESSES. A bank files net interest income where a
    //   manufacturer files revenue; the reader's question ("show me the last eight quarters") is the
    //   same and the line that answers it is not. A missing key stays `null` and renders as withheld.
    cells: [
      { label: "Revenue", value: num(r, "revenue", "totalIncome", "netInterestIncome", "grossPremium", "grossWrittenPremium"), unit: "cr" as const },
      { label: "Operating profit", value: num(r, "operatingProfit", "ebitda", "preProvisionOperatingProfit", "operatingSurplus"), unit: "cr" as const },
      { label: "Net profit", value: num(r, "netProfit", "profitAfterTax"), unit: "cr" as const },
      { label: "Operating margin", value: num(r, "operatingMargin", "netInterestMargin", "combinedRatio"), unit: "pct" as const },
    ],
  }));
  return resolved<QuarterSeriesRead>(
    { symbol, periods, asked, held: rows.length }, coverage, PROV_Q,
  );
}

// ═══ 3 · CORPORATE EVENTS ══════════════════════════════════════════════════════════════════════════
export interface EventRead {
  readonly at: string; readonly kind: string; readonly title: string; readonly detail: string;
  readonly future: boolean; readonly confirmed: boolean;
}
export interface EventsRead { readonly symbol: string; readonly items: readonly EventRead[]; readonly windowDays: number }

export async function resolveCorporateEvents(symbol: string, days = 365): Promise<Resolved<EventsRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<EventsRead>("read_failed", { subject: null, query: null });
  // ⚠ C-1. A view that could not be BUILT is our failure; a view that built and holds nothing is
  //   the record's silence. Only the second may be reported as a fact about the company.
  let read = true;
  const [up, past] = await Promise.all([
    buildCorporateEventsView(symbol, { upcoming: true, days }).catch(() => { read = false; return null; }),
    buildCorporateEventsView(symbol, { upcoming: false, days }).catch(() => { read = false; return null; }),
  ]);
  if (!read) return absent<EventsRead>("read_failed", coverage);
  // ⚠ BOTH NULL MEANS THE STOCK IS NOT IN OUR UNIVERSE — that is our absence. An empty LIST from a
  //   real view is the world's: nothing was scheduled, which is an answer.
  if (!up && !past) return absent<EventsRead>("not_in_universe", coverage);

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const items: EventRead[] = [];
  for (const v of [up, past]) {
    for (const e of v?.events ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      // ★ THE DESCRIPTION GOES THROUGH THE CLASSIFIER, NEVER STRAIGHT TO THE READER. A raw tail like
      //   "Interim Dividend Rs 11 Per Share/ Special Dividend Rs 46 Per Share" states one amount and
      //   buries the other, leaving the reader to compute ₹57 — the regression `verify-number-grounding`
      //   §2 pins, and one this block reproduced until the gate caught it.
      const verdict = parseEventDescription(e.description, e.dividendAmount);
      const components = renderComponents(verdict, e.dividendAmount);
      const money = e.dividendAmount != null ? `₹${e.dividendAmount.toFixed(2)} per share` : null;
      const ratio = e.bonusRatio ?? e.splitRatio ?? null;
      // `clean` ⇒ the prose carries no unattributed money and is safe verbatim. `structured` ⇒ the
      // components replace it. Anything else is SUPPRESSED with a note saying why (N-4, not silence).
      const prose =
        verdict.kind === "clean" ? verdict.text
        : verdict.kind === "structured" ? components
        : SUPPRESSED_TAIL_NOTE[verdict.reason];
      items.push({
        at: e.eventDate,
        kind: e.eventType,
        title: e.eventType.replace(/_/g, " "),
        detail: [money, ratio, e.exDate ? `ex-date ${e.exDate}` : null, prose]
          .filter(Boolean).join(" · ") || "no further detail disclosed",
        future: e.eventDate > today,
        confirmed: e.isConfirmed,
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return resolved<EventsRead>({ symbol, items, windowDays: days }, coverage, PROV_PRICE);
}

// ═══ 4 · OWNERSHIP EVENTS (insider · block/bulk) ════════════════════════════════════════════════════
export interface OwnershipEventRead {
  readonly at: string | null; readonly who: string; readonly what: string; readonly detail: string;
  readonly channel: "insider" | "deal";
}
export interface OwnershipEventsRead {
  readonly symbol: string;
  readonly insider: readonly OwnershipEventRead[];
  readonly deals: readonly OwnershipEventRead[];
  readonly insiderTotal: number;
  readonly dealsTotal: number;
}

const SHOW = 10;

export async function resolveOwnershipEvents(symbol: string): Promise<Resolved<OwnershipEventsRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<OwnershipEventsRead>("read_failed", { subject: null, query: null });
  // ⚠ C-1. A view that could not be BUILT is our failure; a view that built and holds nothing is
  //   the record's silence. Only the second may be reported as a fact about the company.
  let read = true;
  const v = await buildOwnershipView(symbol, 8).catch(() => { read = false; return null; });
  if (!read) return absent<OwnershipEventsRead>("read_failed", coverage);
  if (!v) return absent<OwnershipEventsRead>("feed_not_wired", coverage);

  const cr = (x: number | null) => (x == null ? null : `₹${x.toFixed(2)} Cr`);
  const insider: OwnershipEventRead[] = v.events.insider.slice(0, SHOW).map((e) => ({
    at: e.tradeDate,
    who: `${e.personName} (${e.personCategory.replace(/_/g, " ")})`,
    what: e.transactionType.replace(/_/g, " "),
    detail: [
      e.securitiesTraded ? `${Number(e.securitiesTraded).toLocaleString("en-IN")} shares` : null,
      cr(e.tradeValueCr),
      e.holdingPctDelta != null ? `${e.holdingPctDelta > 0 ? "+" : ""}${e.holdingPctDelta.toFixed(2)}pp of holding` : null,
      `reg ${e.regulation}`,
    ].filter(Boolean).join(" · "),
    channel: "insider" as const,
  }));
  // ★ PAIRED BEFORE IT IS CAPPED, AND BY THE SHARED HOME — see `resolve/deal-pairs.ts`. Capping
  //   first would slice one leg of a pair off the bottom of the list and leave the other stranded,
  //   which is how a "block buy" appears with no counterparty and reads as one-way activity.
  const deals: OwnershipEventRead[] = pairDeals(v.events.block).slice(0, SHOW).map((e) => ({
    at: e.at, who: e.who, what: e.what, detail: e.detail, channel: "deal" as const,
  }));

  return resolved<OwnershipEventsRead>({
    symbol, insider, deals,
    insiderTotal: v.events.insider.length,
    // ⚠ DEALS, NOT LEGS — the count is what the rail's "n of m" is built from. `v.events.block.length`
    //   counts DISCLOSURE ROWS, and after pairing a two-legged deal is one row: TCS would have read
    //   "1 of 2", which says we truncated the list when we merged it.
    dealsTotal: pairDeals(v.events.block).length,
  }, coverage, PROV_PRICE);
}

// ═══ 5 · OWNERSHIP SERIES ══════════════════════════════════════════════════════════════════════════
export interface OwnershipSeriesRead {
  readonly symbol: string;
  readonly periods: readonly string[];
  readonly lines: readonly { readonly key: string; readonly label: string; readonly points: readonly { at: string; value: number }[] }[];
  readonly filings: number;
  readonly tell: string | null;
}

const CLASS_LABEL: Record<string, string> = {
  promoter: "Promoter", fii: "Foreign institutions", dii: "Domestic institutions",
  public: "Retail and public", government: "Government", others: "Others",
};

export async function resolveOwnershipSeries(symbol: string, quarters = 8): Promise<Resolved<OwnershipSeriesRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<OwnershipSeriesRead>("read_failed", { subject: null, query: null });
  // ⚠ C-1. A view that could not be BUILT is our failure; a view that built and holds nothing is
  //   the record's silence. Only the second may be reported as a fact about the company.
  let read = true;
  const v = await buildOwnershipView(symbol, quarters).catch(() => { read = false; return null; });
  if (!read) return absent<OwnershipSeriesRead>("read_failed", coverage);
  if (!v || v.series.length === 0) return absent<OwnershipSeriesRead>("insufficient_shareholding_history", coverage);

  const periods = v.series.map((p) => String((p as { periodKey?: string; asOnDate?: string }).periodKey ?? (p as { asOnDate?: string }).asOnDate ?? ""));
  const keys = Object.keys(CLASS_LABEL);
  const lines = keys.map((k) => ({
    key: k,
    label: CLASS_LABEL[k]!,
    points: v.series.map((p, i) => {
      const raw = (p as unknown as Record<string, unknown>)[k];
      const holdings = (p as unknown as { holdings?: Record<string, unknown> }).holdings;
      const val = typeof raw === "number" ? raw : typeof holdings?.[k] === "number" ? (holdings[k] as number) : null;
      return val === null ? null : { at: periods[i]!, value: val };
    }).filter((x): x is { at: string; value: number } => x !== null),
  })).filter((l) => l.points.length > 0);

  return resolved<OwnershipSeriesRead>(
    { symbol, periods, lines, filings: v.series.length, tell: v.tell ? String(v.tell) : null },
    coverage, PROV_PRICE,
  );
}

// ═══ 6 · PEERS ═════════════════════════════════════════════════════════════════════════════════════
export interface PeersRead {
  readonly symbol: string;
  readonly groupName: string | null;
  readonly memberCount: number;
  readonly stockReturnPct: number | null;
  readonly peerAveragePct: number | null;
  readonly peerCount: number;
  readonly indexLabel: string | null;
  readonly indexReturnPct: number | null;
  readonly windowDays: number;
  /** ★ THE ACTUAL COMPARISON SET, NOT JUST ITS SIZE. "Judged against 14 peers" answers half the
   *  question; `getPeerGroupMembers` existed because the other half — WHICH fourteen — is the half a
   *  reader checks the verdict against. */
  readonly members: readonly { readonly symbol: string; readonly name: string }[];
  readonly unavailable: BlockCopyKey | null;
}

export async function resolvePeers(symbol: string): Promise<Resolved<PeersRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<PeersRead>("read_failed", { subject: null, query: null });
  // ⚠ C-1. A view that could not be BUILT is our failure; a view that built and holds nothing is
  //   the record's silence. Only the second may be reported as a fact about the company.
  let read = true;
  const v = await buildPeerComparisonView(symbol).catch(() => { read = false; return null; });
  if (!read) return absent<PeersRead>("read_failed", coverage);
  if (!v) return absent<PeersRead>("not_in_universe", coverage);

  const stock = await prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() }, select: { id: true } });
  const pg = stock ? await getPeerGroupForStock(stock.id).catch(() => null) : null;
  const members = pg
    ? (await getPeerGroupMembers((pg as { id: string }).id).catch(() => []))
        .map((m) => ({ symbol: String((m as { symbol?: string }).symbol ?? ""), name: String((m as { name?: string }).name ?? "") }))
        .filter((m) => m.symbol && m.symbol.toUpperCase() !== symbol.toUpperCase())
    : [];

  // ⚠ `hasPeerGroup: false` IS `ok: true` WITH A NAMED REASON, NOT `ok: false`. "This stock is not in
  //   a peer group" is an answer to "who are its peers"; refusing the resolve would render nothing.
  const unavailable: BlockCopyKey | null =
    !v.hasPeerGroup ? "peers_none"
    : (v.peers?.peerCount ?? 0) < 2 ? "peers_too_few"
    : null;

  return resolved<PeersRead>({
    symbol,
    groupName: v.peerGroup?.displayName ?? null,
    memberCount: v.peerGroup?.memberCount ?? 0,
    stockReturnPct: v.stockReturn1mPct,
    peerAveragePct: v.peers?.averageReturn1mPct ?? null,
    peerCount: v.peers?.peerCount ?? 0,
    indexLabel: v.index ? String((v.index as { displayName?: string; name?: string }).displayName ?? (v.index as { name?: string }).name ?? "sector index") : null,
    indexReturnPct: v.index ? ((v.index as { return1mPct?: number | null }).return1mPct ?? null) : null,
    windowDays: v.windowDays,
    members,
    unavailable,
  }, coverage, PROV_PRICE);
}

// ═══ 7 · NEWS ══════════════════════════════════════════════════════════════════════════════════════
export interface NewsItemRead {
  readonly at: string | null; readonly title: string; readonly source: string;
  readonly url: string | null; readonly kind: string;
}
export interface NewsRead { readonly symbol: string; readonly items: readonly NewsItemRead[]; readonly windowDays: number }

/**
 * ★ THE STORED NEWS CHANNEL, NOT THE LIVE WEB ONE. `chat/web/serper.ts` fetched headlines as of the
 * instant of asking and dies with its tree; this reads `stock_news`, which the ingest pipeline fills
 * and which survives the deletion. The capability is narrower and the difference is stated to the
 * reader by the renderer, not hidden: these are headlines we already hold, not a live search.
 */
export async function resolveNews(symbol: string, days = 30): Promise<Resolved<NewsRead>> {
  const coverage = await envelopeFor(symbol);
  // A failed coverage read is ours, and it is not a fact about this stock — see envelopeFor.
  if (!coverage) return absent<NewsRead>("read_failed", { subject: null, query: null });
  const stock = await prisma.stock.findUnique({ where: { symbol: symbol.toUpperCase() }, select: { id: true } });
  if (!stock) return absent<NewsRead>("not_in_universe", coverage);

  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.stockNews.findMany({
    where: { stockId: stock.id, publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    take: 12,
    select: { title: true, publishedAt: true, sourceName: true, sourceType: true, url: true },
  }).catch(() => [] as Array<Record<string, unknown>>);

  const items: NewsItemRead[] = (rows as Array<Record<string, unknown>>).map((r) => ({
    at: r.publishedAt ? new Date(r.publishedAt as Date).toISOString().slice(0, 10) : null,
    title: String(r.title ?? ""),
    source: String(r.sourceName ?? r.sourceType ?? "unknown"),
    url: (r.url as string | null) ?? null,
    kind: String(r.sourceType ?? "news"),
  })).filter((i) => i.title);

  return resolved<NewsRead>({ symbol, items, windowDays: days }, coverage, PROV_PRICE);
}

/** Shared by the executor: the tier this stock actually has, or 0 for a non-stock (§3.7). */
export const tierOf = (c: Coverage): number => stockCoverage(c)?.tier ?? 0;
