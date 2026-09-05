// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BLOCK BUILDERS — resolver in, `Section | null` out. One function per stage-7 block.
//
// ── ★ WHY EACH RETURNS `null` RATHER THAN AN EMPTY SECTION ────────────────────────────────────────
// `null` here means WE CANNOT SPEAK TO THIS AT ALL — the resolver's `ok: false` arm — and the
// executor drops the block AND its lead sentence, so no orphan line introduces a card that is not
// there (§4.5). It does NOT mean "nothing was found": a stock with no block deals resolves `ok: true`
// with an empty list and renders a rail that says so, because §4.2's whole subject is that "we looked
// and found nothing" is a finding.
//
// The distinction is carried by the resolvers (blocks-stock.ts) and is only honoured here. A builder
// that collapsed both to `null` would silently turn every honest empty state into a missing card.
//
// ── ★ EVERY READER-FACING SENTENCE COMES FROM `BLOCK_COPY` (§7.2) ─────────────────────────────────
// Not one absent phrase is a literal in this file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  resolvePrice, resolveQuarterSeries, resolveCorporateEvents, resolveOwnershipEvents,
  resolveOwnershipSeries, resolvePeers, resolveNews,
} from "../resolve/blocks-stock.js";
import { blockCopy } from "../catalogue/block-copy.js";
import { spineSection, steppedFilingSection, type FilingRow } from "../section/kinds/series.js";
import { railSection, type RailItem } from "../section/kinds/rail.js";
import { relativeSection, type RelativeMark } from "../section/kinds/relative.js";
import type { AnySection } from "../composition/contract.js";

// ── formatters. One home, so a figure cannot be spoken two ways across seven blocks (N-5). ────────
const inr = (v: number | null): string | null => (v === null ? null : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const cr = (v: number | null): string | null =>
  v === null ? null : v >= 100000 ? `₹${(v / 100000).toFixed(2)} lakh Cr` : `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
/**
 * ★ SCALE-AWARE MONEY, IN CRORE IN AND WHATEVER UNIT THE FIGURE ACTUALLY IS OUT.
 *
 * ⚠ THIS EXISTS BECAUSE `cr` ABOVE PRINTED "₹0 Cr" FOR EVERY POSITION IN A REAL READER'S BOOK.
 *   `cr` is a CORPORATE formatter — it rounds to whole crore, which is right for revenue of ₹72,275 Cr
 *   and catastrophic for a holding of ₹3,99,110 (0.0399 Cr → "₹0 Cr"). Every row of a 21-position
 *   book rendered as zero, and the book total with it. §3.1: a zero where the value is known and
 *   small is a FALSE STATEMENT, not a rounding choice — the reader is being told they hold nothing.
 *
 *   The bug is not the rounding. It is that one formatter was asked to span nine orders of magnitude,
 *   from a retail position to a market capitalisation. So the unit follows the number:
 *
 *     ≥ 1 lakh Cr    ₹1.42 lakh Cr     ← the largest listed companies
 *     ≥ 100 Cr       ₹72,275 Cr        ← corporate scale, whole crore (identical to `cr`)
 *     ≥ 1 Cr         ₹3.62 Cr          ← decimals kept: 3.62 Cr and 4 Cr are different books
 *     ≥ 0.01 Cr      ₹3.99 lakh        ← the retail band, where every real holding lives
 *     > 0            ₹12,500           ← rupees, in full
 *     = 0            ₹0                 ← a TRUE zero, and the only one this ever prints
 */
const money = (valueCr: number | null): string | null => {
  if (valueCr === null) return null;
  const v = Math.abs(valueCr);
  const sign = valueCr < 0 ? "-" : "";
  const n = (x: number, dp: number) => x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (v === 0) return "₹0";
  if (v >= 100000) return `${sign}₹${n(v / 100000, 2)} lakh Cr`;
  if (v >= 100) return `${sign}₹${Math.round(v).toLocaleString("en-IN")} Cr`;
  if (v >= 1) return `${sign}₹${n(v, 2)} Cr`;
  if (v >= 0.01) return `${sign}₹${n(v * 100, 2)} lakh`;
  return `${sign}₹${Math.round(v * 1e7).toLocaleString("en-IN")}`;
};
const pct = (v: number | null, dp = 1): string | null => (v === null ? null : `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`);
const plain = (v: number | null, dp = 2): string | null => (v === null ? null : v.toFixed(dp));

// ═══ price ═════════════════════════════════════════════════════════════════════════════════════════
export async function priceBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolvePrice(symbol);
  if (!r.ok) return null;
  const d = r.data;
  return spineSection({
    heading: "How the market has priced it",
    label: `${symbol} share price`,
    unit: "inr",
    points: d.series,
    overlay: d.benchmark && d.benchmark.points.length ? { label: d.benchmark.label, points: d.benchmark.points } : null,
    windowLabel: d.coverageDays ? `${d.coverageDays} trading days held` : null,
    facts: [
      { label: "Last price", value: inr(d.current), absentPhrase: blockCopy("price_none") },
      { label: "Day change", value: pct(d.dayChangePct), absentPhrase: blockCopy("price_none") },
      { label: "52-week range", value: d.week52Low !== null && d.week52High !== null ? `${inr(d.week52Low)} – ${inr(d.week52High)}` : null, absentPhrase: blockCopy("price_no_52w") },
      { label: "From the 52-week high", value: pct(d.pctFrom52WHigh), absentPhrase: blockCopy("price_no_52w") },
      { label: "1-year return", value: pct(d.returns.r1y), absentPhrase: blockCopy("price_no_return") },
      { label: "3-year return", value: pct(d.returns.r3y), absentPhrase: blockCopy("price_no_return") },
      { label: "Benchmark 1-year", value: pct(d.benchmark?.r1y ?? null), absentPhrase: blockCopy("price_no_benchmark") },
    ],
  }, r.coverage) as AnySection;
}

// ═══ quarter series ════════════════════════════════════════════════════════════════════════════════
export async function quarterSeriesBlock(symbol: string, asked = 8): Promise<AnySection | null> {
  const r = await resolveQuarterSeries(symbol, asked);
  if (!r.ok) return null;
  const d = r.data;
  const rows: FilingRow[] = d.periods.map((p) => ({
    period: p.period,
    cells: p.cells.map((c) => ({
      label: c.label,
      value: c.unit === "cr" ? cr(c.value) : c.value === null ? null : `${c.value.toFixed(2)}%`,
      absentPhrase: blockCopy("quarters_not_reported"),
    })),
  }));
  // ★ THE PLOT CARRIES RAW NUMBERS FOR THE BROWSER; THE ROWS CARRY STRINGS FOR THE MODEL. Same
  //   resolve, two objects, and they never cross (N-2).
  const plots = ["Revenue", "Net profit"].map((label) => ({
    label,
    points: d.periods
      .map((p) => ({ at: p.period, value: p.cells.find((c) => c.label === label)?.value ?? null }))
      .filter((x): x is { at: string; value: number } => x.value !== null),
  })).filter((pl) => pl.points.length > 1);

  return steppedFilingSection({
    heading: `The last ${d.periods.length} quarters as filed`,
    columns: ["Revenue", "Operating profit", "Net profit", "Operating margin"],
    rows, plots,
  }, r.coverage) as AnySection;
}

// ═══ corporate events ══════════════════════════════════════════════════════════════════════════════
export async function eventsBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolveCorporateEvents(symbol);
  if (!r.ok) return null;
  const items: RailItem[] = r.data.items.slice(0, 12).map((e) => ({
    at: e.at,
    title: e.title,
    detail: e.detail,
    tag: e.kind.replace(/_/g, " "),
    // ⚠ A SCHEDULED EVENT IS MARKED SCHEDULED. A reader must never read a diary entry as a filed fact.
    when: e.future ? "future" : "past",
    source: null,
    url: null,
  }));
  return railSection({
    renderer: "event-rail",
    heading: "What is on the calendar",
    lookedFor: "scheduled and past corporate events",
    items,
    emptyPhrase: blockCopy("events_none"),
  }, r.coverage) as AnySection;
}

// ═══ ownership events ══════════════════════════════════════════════════════════════════════════════
export async function ownershipEventsBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolveOwnershipEvents(symbol);
  if (!r.ok) return null;
  const d = r.data;
  // ★ ONE RAIL, BOTH CHANNELS, EACH TAGGED. They answer one reader question — "who has been buying
  //   or selling?" — and splitting them into two cards makes the reader do the merge.
  const items: RailItem[] = [
    ...d.insider.map((e) => ({ at: e.at, title: e.who, detail: e.detail, tag: `insider ${e.what}`, when: "past" as const, source: "SEBI disclosure", url: null })),
    ...d.deals.map((e) => ({ at: e.at, title: e.who, detail: e.detail, tag: e.what, when: "past" as const, source: "exchange", url: null })),
  ].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));

  return railSection({
    renderer: "filing-rail",
    heading: "Who has been buying and selling",
    lookedFor: "insider disclosures and block or bulk deals",
    items,
    totalAvailable: d.insiderTotal + d.dealsTotal,
    // Both absences are the WORLD's, not ours, and the sentence says so — see block-copy.ts.
    emptyPhrase: `${blockCopy("insider_none")}. ${blockCopy("deals_none")}.`,
  }, r.coverage) as AnySection;
}

// ═══ ownership series ══════════════════════════════════════════════════════════════════════════════
export async function ownershipSeriesBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolveOwnershipSeries(symbol);
  if (!r.ok) return null;
  const d = r.data;
  const marks: RelativeMark[] = d.lines.map((l) => {
    const first = l.points[0];
    const last = l.points[l.points.length - 1];
    const move = first && last ? Math.round((last.value - first.value) * 100) / 100 : null;
    return {
      label: l.label,
      value: move,
      // ⚠ POINTS, NOT PERCENT. A holding class moving from 71.8% to 70.1% moved 1.7 POINTS, and
      //   calling that −2.4% states a relative change nobody filed (the `changeUnit` rule, again).
      display: move === null ? "" : `${last!.value.toFixed(2)}% now, ${move > 0 ? "+" : ""}${move.toFixed(2)}pp across the window`,
      role: "member" as const,
    };
  });
  return relativeSection({
    renderer: "own-history-band",
    heading: "How the register has moved",
    unit: "pp",
    marks,
    referenceLabel: "its own filings",
    referenceCount: d.filings,
    windowLabel: d.periods.length ? `${d.periods[0]} to ${d.periods[d.periods.length - 1]}` : null,
    unavailablePhrase: d.filings < 2 ? blockCopy("ownership_series_thin") : blockCopy("ownership_series_none"),
  }, r.coverage) as AnySection;
}

// ═══ peers ═════════════════════════════════════════════════════════════════════════════════════════
export async function peersBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolvePeers(symbol);
  if (!r.ok) return null;
  const d = r.data;
  const marks: RelativeMark[] = [
    { label: symbol, value: d.stockReturnPct, display: pct(d.stockReturnPct) ?? "", role: "subject" },
    { label: d.groupName ? `${d.groupName} average` : "peer average", value: d.peerAveragePct, display: pct(d.peerAveragePct) ?? "", role: "reference" },
    { label: d.indexLabel ?? "sector index", value: d.indexReturnPct, display: pct(d.indexReturnPct) ?? "", role: "reference" },
  ];
  // ★ THE MEMBERS RIDE AS MARKS WITH NO VALUE. They are the SET, not measurements — a reader
  //   checking "judged against whom?" needs the names, and giving them fake bars would imply we hold
  //   a return for each. `value: null` renders each as a named absence, which is what they are here.
  for (const m of d.members.slice(0, 12)) {
    marks.push({ label: m.name || m.symbol, value: null, display: "", role: "member" });
  }
  return relativeSection({
    renderer: "peer-marker",
    heading: "Who it is judged against",
    unit: "pct",
    marks,
    referenceLabel: d.groupName ?? "no peer group",
    referenceCount: d.unavailable === "peers_none" ? null : d.peerCount,
    windowLabel: `${d.windowDays} days`,
    unavailablePhrase: d.unavailable ? blockCopy(d.unavailable) : null,
  }, r.coverage) as AnySection;
}

// ═══ news ══════════════════════════════════════════════════════════════════════════════════════════
export async function newsBlock(symbol: string): Promise<AnySection | null> {
  const r = await resolveNews(symbol);
  if (!r.ok) return null;
  const items: RailItem[] = r.data.items.map((n) => ({
    at: n.at, title: n.title, detail: n.source, tag: n.kind.replace(/_/g, " "),
    when: "past" as const, source: n.source, url: n.url,
  }));
  return railSection({
    renderer: "news-list",
    heading: "What has been written about it",
    lookedFor: `headlines in the last ${r.data.windowDays} days`,
    items,
    emptyPhrase: blockCopy("news_none"),
  }, r.coverage) as AnySection;
}

export const FORMATTERS = { inr, cr, money, pct, plain };
