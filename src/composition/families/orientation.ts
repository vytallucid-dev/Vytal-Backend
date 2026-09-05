// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: ORIENTATION — "how is X doing". The whole company, not one facet of it.
//
// ── ★ WHAT THIS FAMILY GOT WRONG FIRST TIME ───────────────────────────────────────────────────────
// It was scoped `lens: ["health"]` and the router put `lens: "health"` on every question containing
// "how is" — so a reader asking about a whole company received three health-score sections and
// nothing else. That looked like "we have only built one component". It was not: it was a routing
// conflation (the lens pattern owned an OPERATION phrase) plus a composition scoped to the narrowest
// possible reading of the broadest possible question.
//
// A general question now takes `lens: null` and gets the ORDER a person would answer in:
//
//   what the company is and what its quarter said   → ANCHOR
//   how the market has treated it                   → inside the anchor stats
//   how our score reads it, if we score it          → DECOMPOSITION
//   what code flagged                               → CALLOUT
//   where to go next                                → NEXT
//
// The health breakdown is one section among five. A reader who asks specifically about the score
// gets `lens: "health"` and the narrow composition below it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveCompanySnapshot } from "../../resolve/company-snapshot.js";
import { resolvePillarDecomposition } from "../../resolve/pillar-decomposition.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { anchorSection } from "../../section/kinds/anchor.js";
import { metricTableSection, ownershipSection } from "../../section/kinds/table.js";
import { readPledgeFromDerived } from "../../resolve/pledge.js";
import { waterfallSection } from "../../section/kinds/decomposition.js";
import { calloutSection } from "../../section/kinds/callout.js";
import type { AnySection, ComposedAnswer, Composition } from "../contract.js";
import { buildAnswer, type Block } from "../answer.js";
import { readFindingsForSymbols } from "../../scoring/read/symbol-findings.service.js";
import { STOCK_FINDINGS } from "../../catalogue/stock-findings.js";

/** Family C is the divergence family — 11 catalogue entries measuring one company against the group
 *  it is judged with. Built from the catalogue so the set cannot drift from the rules that fire. */
const DIVERGENCE_NAMES: ReadonlySet<string> = new Set(
  (Object.values(STOCK_FINDINGS) as { family?: string; name?: string; key?: string }[])
    .filter((f) => f.family === "C" && !String(f.key ?? "").includes("S1_aligned"))
    .map((f) => String(f.name ?? ""))
    .filter(Boolean),
);
import { stockCoverage } from "../../resolve/contract.js";

async function buildCompany(symbol: string): Promise<ComposedAnswer> {
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE DIVERGENCE READ — and the slot it fills was a FALSE ALL-CLEAR.
  //
  // ⚠ THIS ANSWER'S CALLOUT PASSED A LITERAL `[]`, so it always rendered `nothing-found`, whose
  //   digest reads "Nothing notable found · Checked and clear" — under a lead promising "everything
  //   code checks on this company, whether or not it found anything". Measured: TECHM has an ACTIVE
  //   `divergence_S2_sticky_divergence` and four live patterns, and the most-asked answer in the
  //   product told the reader it was clear. A check we did not run must never render as a check that
  //   came back clean (§3.1).
  //
  // ★ DIVERGENCE ONLY, AND THAT IS N-3 RATHER THAN TIMIDITY. PT · Patterns owns the FULL list and
  //   renders it; orientation showing every finding would be a second home for the same concept. What
  //   an overview uniquely cannot otherwise say is the RELATIVE statement — this company is moving
  //   differently from the group it is judged against — which is what family C measures and what
  //   §4.1 says a CALLOUT is for. The NEXT chips already carry the reader to the full list.
  //
  // ★ AND IT CONSUMES `readFindingsForSymbols`, IT DOES NOT REBUILD IT. That service already folds
  //   the §5C divergence consolidation and orders worst-first; a second derivation here would be the
  //   one that is wrong, which is stage 9's lesson exactly.
  const [cov, snap, dec, finds] = await Promise.all([
    resolveStockCoverage(symbol),
    resolveCompanySnapshot(symbol),
    resolvePillarDecomposition(symbol),
    readFindingsForSymbols([symbol]).catch(() => null),
  ]);
  // ⚠ THE READ AND THE FAILURE ARE KEPT APART (F-3). A findings read that threw is not a company with
  //   no divergences, and only one of those two may render as "checked and clear".
  const findingsRead = finds !== null;
  // ★ MATCHED AGAINST THE CATALOGUE, NOT AGAINST A KEY PREFIX. `SymbolFindingRow` carries a NAME and
  //   no rule key by design — the service renders catalogue copy, never engine tokens (N-1) — so the
  //   family-C membership test belongs where family C is defined. `DIVERGENCE_NAMES` is derived from
  //   `STOCK_FINDINGS` at module load, so a new family-C entry is picked up with no edit here.
  //
  // ⚠ `S1_aligned` IS EXCLUDED AND IT IS THE WHOLE POINT OF THE FILTER. "Aligned — No Tension" is a
  //   family-C entry that fires when there is NO divergence; rendering it under a lead that says the
  //   company is moving differently from its group would state the opposite of what it measured.
  const divergences = (finds?.rows?.[0]?.findings?.shown ?? [])
    .filter((f) => DIVERGENCE_NAMES.has(f.name));
  const scored = (stockCoverage(cov.coverage)?.tier ?? 0) === 2;
  const d = snap.ok ? snap.data : null;
  const q = d?.latest;
  const sh = d?.shareholding;
  const margin = d?.metrics.find((m) => m.label === "Operating margin");

  const opening: string[] = [];
  if (d) {
    // ⚠ THE ARTICLE IS ABOUT THE SOUND, NOT THE LETTER, AND 143 COMPANIES READ "a NBFC". An
    //   initialism whose first letter is said with a leading vowel — N, F, M, L, S, X, H, R —
    //   takes "an". This is the whole of the exception: an ALL-CAPS run at the start of the word.
    const VOWEL_SOUND_INITIALS = "AEFHILMNORSX";
    const firstWord = (d.industry ?? "").split(/[^A-Za-z]/)[0] ?? "";
    const isInitialism = firstWord.length >= 2 && firstWord === firstWord.toUpperCase();
    const art = !d.industry
      ? "a"
      : isInitialism
        ? (VOWEL_SOUND_INITIALS.includes(firstWord[0]!) ? "an" : "a")
        : (/^[AEIOU]/i.test(d.industry) ? "an" : "a");
    opening.push(`${d.name} is ${d.industry ? `${art} ${d.industry} business` : "a listed business"}${d.listedSince ? `, listed since ${d.listedSince}` : ""}.`);
    if (q?.revenue != null) {
      opening.push(
        // ⚠ THE FAMILY'S OWN WORD, NOT "revenue". An insurer files net premium income and a bank
        //   files interest earned; naming either "revenue" is a false statement about an account the
        //   reader very likely knows better than we do. `topLabel` is resolved per family.
        `In ${q.periodKey} it reported ${q.topLabel.toLowerCase()} of ${(q.revenue / 100000 >= 1 ? "₹" + (q.revenue / 100000).toFixed(2) + " lakh Cr" : "₹" + Math.round(q.revenue).toLocaleString("en-IN") + " Cr")}` +
        `${q.revenueYoyPct != null ? `, ${q.revenueYoyPct > 0 ? "+" : ""}${q.revenueYoyPct.toFixed(1)}% against the same quarter last year` : ""}.`,
      );
    }
    if (d.annual?.roe != null) {
      opening.push(`Across the full year it returns ${d.annual.roe.toFixed(1)}% on equity${d.annual.debtToEquity === 0 ? " and carries no debt" : ""}.`);
    }
  }

  const blocks: Block[] = [
    { lead: "What the business is, and the headline figures from the quarter it just reported.",
      section: d ? (anchorSection(snap) as AnySection) : null },
    { lead: `The figures behind that, quarter against quarter and year against year${margin?.qoqPct != null && margin.qoqPct < 0 ? " — margins narrowed this quarter, which the table separates from the revenue line" : ""}.`,
      section: d && (d.metrics.length || d.annualRows.length) ? (metricTableSection(d, cov.coverage) as AnySection) : null },
    { lead: `Who actually holds it${sh?.parts.find((p) => p.key === "promoter") ? `, with the promoter at ${sh.parts.find((p) => p.key === "promoter")!.pct.toFixed(1)}%` : ""}.`,
      // ★ THROUGH THE PLEDGE RULING (resolve/pledge.ts). This composition holds only the DERIVED
      //   pledge value, which cannot support the positive state on its own, so it gets the
      //   conservative reading — the direction that withholds a claim rather than making one.
      section: sh ? (ownershipSection({
        periodKey: sh.periodKey, parts: sh.parts, promoterPct: sh.promoterPct,
        promoterDeltaPp: sh.promoterDeltaPp, instDeltaPp: sh.instDeltaPp, undisclosed: sh.undisclosed,
        pledge: readPledgeFromDerived(sh.pledgedPctOfPromoter, sh.promoterPct),
      }, cov.coverage) as AnySection) : null },
    { lead: "Our own reading of all that is a single score, and it is worth seeing which part of the business carries it.",
      section: scored ? (waterfallSection(dec) as AnySection) : null },
    // ★ THE DIVERGENCE CALLOUT — the one renderer in the CALLOUT set that had no caller of its own.
    //   `divergence` was this function's DEFAULT until Phase 1 · Batch 2 gave every OTHER case a
    //   specific id; it kept the default and never got a home, so the id looked dead while the data
    //   behind it kept firing. It is wired here rather than into PG because PG's callout slot already
    //   holds `largest-movers` — the group's own moves — and two callouts in one answer is a list,
    //   not a highlight.
    { lead: divergences.length > 0
        ? "One thing code found that the figures above do not show: this company is moving differently from the group it is judged against."
        : findingsRead
          ? "Separately, everything code checks on this company against its peer group — whether or not it found anything."
          : "We could not complete the pattern check on this company, so nothing below should be read as an all-clear.",
      section: calloutSection(
        `${symbol} against the group it is judged with`,
        divergences.map((f: { name?: string; verdict?: string; severity?: string }) => ({
          label: String(f.name ?? "Divergence"),
          detail: String(f.verdict ?? ""),
          severity: (f.severity ?? "low") as "low" | "medium" | "high",
        })),
        cov.coverage,
        "divergence",
      ) as AnySection },
  ];

  const bits: string[] = [];
  if (q?.revenueYoyPct != null) bits.push(`revenue is ${q.revenueYoyPct > 0 ? "growing" : "shrinking"} year on year`);
  if (margin?.qoqPct != null) bits.push(`margins ${margin.qoqPct < 0 ? "gave a little back" : "held or improved"} this quarter`);
  const pr = sh?.parts.find((p) => p.key === "promoter");
  if (pr) bits.push(`the promoter holding is steady at ${pr.pct.toFixed(1)}%`);
  const conclusion = bits.length
    ? `Taken together: ${bits.join(", ")}. Nothing in what we hold was flagged for attention — which is a statement about our checks, not a forecast.`
    : `That is everything we hold on ${symbol} today.`;

  return buildAnswer({
    coverage: cov.coverage, opening, blocks, conclusion, symbol,
    signals: {
      scored, findings: [],
      // ⚠ ALWAYS FALSE, AND THAT IS THE PLEDGE RULING REACHING THE CHIPS. This read
      //   `(sh?.pledgedPctOfPromoter ?? 0) > 0` — the field measured to be unreliable in both
      //   directions — and the chip it produced offers a figure we decline to state. Only
      //   `families/ownership.ts`, which reads both raw columns, can raise this signal honestly.
      pledged: false,
      instSold: (sh?.instDeltaPp ?? 0) < -0.25,
      thin: (stockCoverage(cov.coverage)?.depth.quarters ?? 0) < 8,
      marginFell: (margin?.qoqPct ?? 0) < -2,
    },
  });
}

export const orientationCompany: Composition = {
  id: "orientation.company",
  family: "orientation",
  // ★ `lens: [null]` — THE UN-NARROWED QUESTION ONLY, and this is what makes the family safe to
  //   register (stage 5b). The header above says a general question takes `lens: null` and gets the
  //   whole company; that was true of the BUILDER and had never been true of the PREDICATE, which
  //   claimed every `orient` turn. Registered as it stood, it would have answered "what is TCS
  //   trading at" (orient + price) with a whole-company overview — the same conflation, arriving
  //   from the other side.
  when: { operation: ["orient"], lens: [null], subject: "required", minTier: 1 },
  examples: [
    "how is TCS doing",
    "how is RELIANCE doing",
    "tell me about HDFCBANK",
    "what is going on with INFY",
  ],
  build: async (ctx) => buildCompany(ctx.symbol!),
  assertions: [
    { name: "coverage is stated first (N-6)",
      check: (s) => (s[0]?.kind === "COVERAGE" ? null : "first section is " + s[0]?.kind) },
    { name: "the company is anchored before any score",
      check: (s) => {
        const a = s.findIndex((x) => x.kind === "ANCHOR");
        const d = s.findIndex((x) => x.kind === "DECOMPOSITION");
        return a >= 0 && (d < 0 || a < d) ? null : "ANCHOR missing or after DECOMPOSITION";
      } },
    { name: "the answer offers somewhere to go next",
      check: (s) => (s.some((x) => x.kind === "NEXT") ? null : "no NEXT section — the answer dead-ends") },
    { name: "no digest leaf is a raw number (N-1)",
      check: (s) => {
        for (const sec of s) for (const g of sec.digest.groups) for (const l of g.lines)
          if (typeof (l as { value: unknown }).value !== "string") return sec.kind + ": non-string digest value";
        return null;
      } },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ `orientationScored` WAS HERE AND IS GONE — REPLACED, NOT DELETED, AT PHASE 2 · BATCH 1.
//
// It claimed `{operation: [orient, decompose], lens: [health]}` and its first example was the literal
// string "why is TCS scored the way it is". That is A · ATTRIBUTION's question, and it is now answered
// by `families/attribution.ts` — a field-level walk from a perfect 100 down to the score, rather than
// four pillar bars and two sentences.
//
// ★ IT HAD TO GO RATHER THAN SIT BESIDE THE NEW FAMILY. Two compositions behind one predicate makes
//   the answer depend on the position of an entry in `COMPOSITIONS`, with nothing in either file
//   saying so — the same silent-ordering hazard `Predicate.subject` was added to remove in batch 1.
//
// ★ `orientationCompany` ABOVE IS UNTOUCHED and still renders the four-pillar waterfall as one section
//   among five. That is not a duplicate of the walk: it is the pillar ANATOMY inside a whole-company
//   answer, at a different grain, for a question that did not narrow to health.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
