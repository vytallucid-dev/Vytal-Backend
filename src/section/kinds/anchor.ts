// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · hero-fundamental — what the company is and what its last quarter said.
//
// ★ THE PART A COMPETITOR ANSWER OPENS WITH, AND THE PART OURS WAS MISSING ENTIRELY. A whole-company
// question wants the business named, the latest quarter headline figures, and the returns profile
// before any score is mentioned. The health score is ONE section of that answer, not the answer.
//
// ⚠ EVERY FIGURE IS A QUERY RESULT FORMATTED ONCE (N-1). The digest carries the same figures as
// display strings, so the model writes connective prose over them and cannot re-derive or re-round.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { CompanySnapshot } from "../../resolve/company-snapshot.js";
import type { Resolved } from "../../resolve/contract.js";
import { reasonPhrase } from "../../relational/coverage.js";
import { digest, line, unchanged, withheld, type DigestGroup, type Section } from "../contract.js";

export interface AnchorStat {
  readonly label: string;
  readonly value: string | null;
  readonly sub: string | null;
  readonly tone: "up" | "down" | "flat" | "none";
}
export interface AnchorPayload {
  readonly symbol: string; readonly name: string;
  readonly industry: string | null; readonly listedSince: string | null;
  readonly coreBusiness: string | null; readonly businessTags: readonly string[];
  readonly periodKey: string | null;
  readonly stats: readonly AnchorStat[];
}

const cr = (v: number | null): string | null =>
  v === null ? null : v >= 100000 ? "₹" + (v / 100000).toFixed(2) + " lakh Cr" : "₹" + Math.round(v).toLocaleString("en-IN") + " Cr";
const pctStr = (v: number | null): string | null =>
  v === null ? null : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
const tone = (v: number | null): AnchorStat["tone"] =>
  v === null ? "none" : v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";

export function anchorSection(r: Resolved<CompanySnapshot>): Section<"ANCHOR", AnchorPayload | null> {
  if (!r.ok) {
    const phrase = reasonPhrase(r.absent.reason);
    return {
      kind: "ANCHOR", renderer: "hero-fundamental", payload: null,
      digest: digest("The company", [{ label: "Overview", lines: [withheld("Latest results", phrase)] }]),
      coverage: r.coverage, interactions: [],
    };
  }
  const d = r.data;
  const q = d.latest;
  const a = d.annual;

  const stats: AnchorStat[] = [
    { label: "Revenue", value: cr(q?.revenue ?? null), sub: q?.revenueYoyPct != null ? pctStr(q.revenueYoyPct) + " YoY" : null, tone: tone(q?.revenueYoyPct ?? null) },
    { label: "Net profit", value: cr(q?.netProfit ?? null), sub: q?.profitYoyPct != null ? pctStr(q.profitYoyPct) + " YoY" : null, tone: tone(q?.profitYoyPct ?? null) },
    { label: "Operating margin", value: q?.operatingMargin != null ? q.operatingMargin.toFixed(1) + "%" : null, sub: q ? "in " + q.periodKey : null, tone: "none" },
    { label: "Return on equity", value: a?.roe != null ? a.roe.toFixed(1) + "%" : null, sub: a ? a.fiscalYear + " full year" : null, tone: "none" },
    { label: "Market value", value: cr(d.marketCapCr), sub: d.dividendYield != null ? d.dividendYield.toFixed(2) + "% dividend yield" : null, tone: "none" },
    { label: "Debt to equity", value: a?.debtToEquity != null ? a.debtToEquity.toFixed(2) + "×" : null, sub: a?.debtToEquity === 0 ? "carries no debt" : null, tone: "none" },
  ];

  const groups: DigestGroup[] = [
    { label: "What the company is", lines: [
      line("Name", d.name + " (" + d.symbol + ")"),
      d.industry ? line("Industry", d.industry) : withheld("Industry", "no industry classification held"),
      d.coreBusiness ? line("Business", d.coreBusiness) : withheld("Business", "no business description held"),
    ]},
    { label: "The quarter it just reported", lines: q
      ? [
          line("Period", q.periodKey),
          q.revenue != null ? line("Revenue", cr(q.revenue) + (q.revenueYoyPct != null ? ", " + pctStr(q.revenueYoyPct) + " against the same quarter last year" : "")) : withheld("Revenue", "not reported for this period"),
          q.netProfit != null ? line("Net profit", cr(q.netProfit) + (q.profitYoyPct != null ? ", " + pctStr(q.profitYoyPct) + " year on year" : "")) : withheld("Net profit", "not reported for this period"),
          q.operatingMargin != null ? line("Operating margin", q.operatingMargin.toFixed(1) + "%") : withheld("Operating margin", "not reported for this period"),
        ]
      : [withheld("Latest quarter", "no quarterly results held")] },
    { label: "What it earns on what it uses", lines: a
      ? [
          a.roe != null ? line("Return on equity", a.roe.toFixed(1) + "% in " + a.fiscalYear) : withheld("Return on equity", "not computed for this year"),
          a.roce != null ? line("Return on capital", a.roce.toFixed(1) + "%") : withheld("Return on capital", "not computed for this year"),
          a.debtToEquity === 0 ? unchanged("Debt", "carries no debt against equity") : a.debtToEquity != null ? line("Debt to equity", a.debtToEquity.toFixed(2) + "×") : withheld("Debt to equity", "not computed"),
          d.marketCapCr != null ? line("Market value", cr(d.marketCapCr)!) : withheld("Market value", "no live market capitalisation"),
        ]
      : [withheld("Annual returns", "no annual accounts held")] },
  ];

  return {
    kind: "ANCHOR", renderer: "hero-fundamental",
    payload: {
      symbol: d.symbol, name: d.name, industry: d.industry, listedSince: d.listedSince,
      coreBusiness: d.coreBusiness, businessTags: d.businessTags,
      periodKey: q?.periodKey ?? null, stats,
    },
    digest: digest("The company and its latest quarter", groups),
    coverage: r.coverage,
    interactions: [],
  };
}

// ── NEXT · chips ──────────────────────────────────────────────────────────────────────────────────
// ★ AN ANSWER THAT ENDS IS AN ANSWER THAT ENDS THE SESSION. Chips name real Vytal surfaces, so a
//   reader leaves the answer INTO the product rather than back to a blank box. Each carries the
//   question a reader would actually type, not a feature name — a chip reading "Ownership tool" asks
//   the reader to translate; one reading "Who owns this, and has that changed?" does not.
export interface Chip { readonly label: string; readonly question: string; readonly surface: string }
export interface NextPayload { readonly chips: readonly Chip[] }

export interface NextSignals {
  readonly scored: boolean;
  readonly findings: readonly string[];
  readonly pledged: boolean;
  readonly instSold: boolean;
  readonly thin: boolean;
  readonly marginFell: boolean;
}

/**
 * ★ THE CHIPS ARE CHOSEN BY THE DATA, NOT BY A FIXED LIST. A generic four-chip strip is furniture; a
 * chip that names what we actually found is the next question the reader already has. So a flagged
 * finding produces a chip about THAT finding, a pledge produces a pledge question, institutions
 * selling produces an ownership question — and the generic ones fill in behind them.
 *
 * Ordered by how specific each is: what we found first, the standing surfaces last.
 */
export function nextSection(symbol: string, sig: NextSignals): Section<"NEXT", NextPayload> {
  const chips: Chip[] = [];

  // 1 · WHAT WE ACTUALLY FOUND. Named, so the reader can pull the thread rather than guess it exists.
  for (const f of sig.findings.slice(0, 2)) {
    chips.push({ label: "Flagged", question: "Why was " + f + " flagged on " + symbol + "?", surface: "Findings" });
  }
  if (sig.pledged) chips.push({ label: "Pledging", question: "How much of " + symbol + " promoter holding is pledged, and since when?", surface: "Ownership tool" });
  if (sig.instSold) chips.push({ label: "Institutions", question: "Which institutions moved out of " + symbol + " last quarter?", surface: "Ownership tool" });
  if (sig.marginFell) chips.push({ label: "Margins", question: "Why did " + symbol + " operating margin fall this quarter?", surface: "Fundamentals" });
  if (sig.thin) chips.push({ label: "Coverage", question: "What do you actually hold on " + symbol + "?", surface: "Coverage" });

  // 2 · THE STANDING SURFACES, behind whatever was specific.
  const generic: Chip[] = [
    { label: "Results", question: "Show " + symbol + " across its last eight quarters", surface: "Quarterly results" },
    { label: "Peers", question: "How does " + symbol + " compare with its peer group?", surface: "Comparison" },
    { label: "Ownership", question: "Who owns " + symbol + ", and has that changed?", surface: "Ownership tool" },
  ];
  if (sig.scored) generic.push({ label: "Health", question: "Why is " + symbol + " scored the way it is?", surface: "Health score" });
  for (const g of generic) {
    if (chips.length >= 5) break;
    if (!chips.some((c) => c.surface === g.surface)) chips.push(g);
  }

  return {
    kind: "NEXT", renderer: "chips", payload: { chips },
    digest: digest("Where this can go next", [
      { label: "Follow-ups offered", lines: chips.map((c) => line(c.label, c.question)) },
    ]),
    coverage: { subject: null, query: null },
    interactions: chips.map((c) => ({ id: c.label, kind: "drill" as const, label: c.label })),
  };
}

/**
 * ★ A CHIP SET WITH NO SUBJECT AND NO SIGNALS — stage 9.
 *
 * `nextSection` above is signal-driven and stock-shaped: it needs a symbol and a set of findings to
 * decide what to offer. The three branches that ask the reader a question back — an ambiguous
 * company, an unreadable operation, a bare ticker — have neither, and until now they carried their
 * chips in a plain string array that **the chat controller dropped on the floor**. Every one of them
 * rendered as one line of grey text with nothing to press.
 *
 * ⚠ THE CHIP CARRIES A QUESTION THE READER CAN SEND, NEVER A LABEL. That is what makes it an
 *   affordance rather than a caption — "How is HDFCBANK doing?" is a message; "HDFC Bank" is a hint
 *   that the reader still has to retype.
 */
export function chipSection(chips: readonly Chip[]): Section<"NEXT", NextPayload> {
  return {
    kind: "NEXT", renderer: "chips", payload: { chips: [...chips] },
    digest: digest("What I can answer instead", [
      { label: "Offered", lines: chips.map((c) => line(c.label, c.question)) },
    ]),
    coverage: { subject: null, query: null },
    interactions: chips.map((c) => ({ id: c.label, kind: "drill" as const, label: c.label })),
  };
}
