// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE BRIEF — one projected slice → the text the model actually reads.
//
// A SEPARATE SEAM FROM THE PROJECTION, on purpose. `universe-projection.service.ts` decides WHAT is
// true and bounded; this file decides how that arrives in a small model's context. The two change for
// different reasons: a data question moves the service, a measured behaviour moves this file. (Same
// split as grounding.ts ↔ the fact block, and for the same reason.)
//
// ── ★ THE PERIOD LINE IS THE POINT OF THIS FILE ────────────────────────────────────────────────────
// The projection removed the SHAPE that lets a false period claim through — there is no `periodKey`
// field to pass along. This file closes the other half: it puts the true framing, the spread that
// proves a single quarter would be false, and the forbidden sentence-form side by side, at the TOP of
// every slice. A model that writes "as of FY27Q1, 21 companies are Pristine" has to do it with
// "64 at FY27Q1, 30 at FY26Q4" three words above.
//
// §THE PAGES raised this risk rather than lowering it: it taught the model to speak about Vytal with
// confidence, and a confident false scope claim is worse than a hedged one.
//
// ── CLOSED-WORLD DISCIPLINE, INHERITED ─────────────────────────────────────────────────────────────
// Numbers go through grounding's own `scoreStr` (re-exported by tools/shared.ts) so a universe median
// and a stock page can never state one number two ways. Every list states its cap ("showing 12 of 22")
// from the STRUCTURE — never left to the model to notice. No CLOSED_WORLD_HEADER: it already leads
// message[0] and governs everything downstream (compose.ts).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { scoreStr, NA } from "./tools/shared.js";
import type {
  BandSlice,
  Capped,
  CensusSlice,
  DivergenceSlice,
  EmptySlice,
  FindingDetail,
  FindingSlice,
  MoversSlice,
  OverviewSlice,
  PeriodContract,
  UniverseProjection,
  WeekSlice,
} from "../scoring/read/universe-projection.types.js";

const SCOPE_TITLE: Record<string, string> = {
  universe: "THE SCORED UNIVERSE",
  portfolio: "THE READER'S OWN HOLDINGS (the scored ones)",
  watchlist: "THE READER'S OWN WATCHLIST (the scored ones)",
};

/** The scope's own sentence, so a scoped answer can never be relayed as a market-wide one. */
const SCOPE_NOTE: Record<string, string> = {
  universe: "Scope: every company Vytal scores. Vytal tracks more Indian stocks than it scores; this is the scored set.",
  portfolio: "Scope: ONLY the companies the reader holds that Vytal scores. Every count below is about THEIR book, not the market — never relay these as market-wide numbers.",
  watchlist: "Scope: ONLY the companies on the reader's watchlist that Vytal scores. Every count below is about THEIR list, not the market — never relay these as market-wide numbers.",
};

const sc = (x: number): string => scoreStr(x);
const delta = (x: number): string => `${x >= 0 ? "+" : ""}${scoreStr(x)}`;

/**
 * The bounded statement for a list. ★ IT LEADS THE LIST; IT DOES NOT FOLLOW IT.
 *
 * ⚠ MEASURED LIVE. The first cut put this after the rows, as a parenthetical footnote —
 * "(showing 12 of 22 findings…)". The model read the twelve rows, wrote its answer, and never
 * relayed the bound: the reader was handed twelve findings with nothing saying there were
 * twenty-two. A trailing parenthetical is the easiest thing in a tool result for a small model to
 * skip. So the count now comes FIRST, as a sentence about the whole set, with the list presented
 * as a subset of it — and it says what to say rather than merely stating a fact.
 */
function capLead<T>(c: Capped<T>, unit: string, criterion: string): string {
  return c.total > c.shown.length
    ? `${c.total} ${unit} in total. The ${c.shown.length} ${criterion} are listed below — SAY "${c.shown.length} of ${c.total}"; do not imply this is all of them.`
    : `${c.total} ${unit} in total, all listed below.`;
}

/** The same fact after a short list that was NOT cut — no instruction needed when nothing is hidden. */
function capNote<T>(c: Capped<T>, unit: string, criterion: string): string {
  return c.total > c.shown.length
    ? `(showing ${c.shown.length} of ${c.total} ${unit} — ${criterion}. SAY the total; the rest are real and not listed.)`
    : `(all ${c.total} ${unit} listed)`;
}

/**
 * ★ THE PERIOD BLOCK. Emitted at the top of EVERY slice.
 *
 * It states the only legal framing, then hands over the spread as the evidence. Where the spread has
 * one entry the claim would be safe — but the phrasing rule stays anyway, because a universe that
 * happens to be aligned this week will not be next quarter, and a rule the model learns only
 * sometimes is a rule it does not have.
 */
function periodBlock(p: PeriodContract): string {
  const L: string[] = [];
  // ⚠ THE FORBIDDEN EXAMPLE IS DELIBERATELY QUARTER-FREE. Writing a real quarter label into the
  //   instruction ("as of FY27Q1, …") would hand the model the exact false sentence to copy, and would
  //   go stale the moment the plurality period rolls. The placeholder teaches the SHAPE, not a token.
  L.push(
    "★ HOW TO SAY THE DATE. Each company below is read at ITS OWN most recent reported quarter — the quarters DIFFER across companies. " +
      'Say "each at its most recent reported quarter". NEVER name one quarter as though it covered them all ("as of <a quarter>, N companies are …") — that sentence would be false for the rest.',
  );
  if (p.spread.length) {
    const parts = p.spread.map((s) => `${s.count} at ${s.period}`).join(", ");
    L.push(`  Quarters actually represented: ${parts}${p.mixed ? " — more than one, which is why no single label fits." : "."}`);
  }
  // ⚠ MEASURED LIVE, TWICE, AND THE SECOND TIME IS WHY IT LIVES HERE. Asked how many stocks Vytal
  //   scores, the model answered "roughly 90" — a count it had been given exactly, rounded away. An
  //   instruction on the OVERVIEW slice fixed that question and nothing else: the very next run rounded
  //   the same number inside the BAND slice ("out of about 90 total scored stocks"). The count appears
  //   in every slice, so its instruction belongs in the one block every slice carries — here — not
  //   repeated per renderer, where the next slice added would silently miss it.
  L.push(
    `  Most recent rescore across this read: ${p.asOfDate ?? NA}. Companies in this read: ${p.companiesRead} — ★ STATE THIS NUMBER EXACTLY. "${p.companiesRead}", never "about ${Math.round(p.companiesRead / 10) * 10}" or "nearly ${Math.ceil(p.companiesRead / 50) * 50}". It is a count, not an estimate.`,
  );
  if (p.notRescored.total > 0) {
    const names = p.notRescored.shown.map((n) => `${n.symbol} (last ${n.lastQuarter})`).join(", ");
    L.push(
      `  Held OUT of this read — no longer being rescored: ${p.notRescored.total} (${names}). They are not counted in any number below.`,
    );
  }
  return L.join("\n");
}

function head(title: string, scope: string): string[] {
  return [`=== VYTAL — ${SCOPE_TITLE[scope] ?? SCOPE_TITLE.universe}: ${title} ===`, SCOPE_NOTE[scope] ?? SCOPE_NOTE.universe];
}

// ── the seven renderers ────────────────────────────────────────────────────────────────────────────

function renderOverview(s: OverviewSlice): string {
  const L = head("overview", s.scope);
  L.push(periodBlock(s.period));
  // The exact-count instruction is NOT repeated here — the period block above carries it for every
  //   slice. Two copies in one result is the double-header bug at a smaller scale.
  L.push(`Companies carrying a Vytal health score: ${s.companiesScored}.`);
  L.push(
    `Median health ${sc(s.medianScore)} · mean ${sc(s.meanScore)} · median move versus each company's own previous quarter ${
      s.medianQuarterMove == null ? NA : delta(s.medianQuarterMove)
    } points.`,
  );
  L.push(`Spread: the middle half sits between ${sc(s.p25)} and ${sc(s.p75)} (standard deviation ${s.stdDev}).`);
  L.push(
    `Weakest: ${s.lowest ? `${s.lowest.symbol} (${s.lowest.name}) ${sc(s.lowest.score)}, ${s.lowest.band}` : NA}. ` +
      `Strongest: ${s.highest ? `${s.highest.symbol} (${s.highest.name}) ${sc(s.highest.score)}, ${s.highest.band}` : NA}.`,
  );
  L.push(`Bands, strongest first: ${s.bands.map((b) => `${b.band} ${b.count}`).join(" · ")}.`);
  L.push(`Pillar medians: ${s.pillarMedians.map((p) => `${p.pillar} ${p.median}`).join(" · ")}.`);
  L.push(`Companies firing at least one red flag: ${s.redFlagCompanies} of ${s.companiesScored}.`);
  L.push("(Overview only. For the companies in one band call slice=band; for what is firing call slice=census.)");
  return L.join("\n");
}

function renderBand(s: BandSlice): string {
  const L = head("bands", s.scope);
  L.push(periodBlock(s.period));
  L.push(`Bands, strongest first, out of ${s.companiesScored} scored companies:`);
  for (const b of s.bands) L.push(`  · ${b.band}: ${b.count}`);
  if (s.unrecognisedBand) {
    L.push(
      `⚠ "${s.unrecognisedBand}" is not one of Vytal's five bands. The five are Pristine, Healthy, Steady, Below Par, Fragile. ` +
        "Say that plainly — do not map it onto whichever band seems closest.",
    );
  }
  if (s.focus) {
    L.push(
      `${s.focus.band}: ${s.focus.count} of ${s.companiesScored} companies. ${capLead(s.focus.members, "companies are in this band", "highest-scoring")} Highest score first:`,
    );
    for (const m of s.focus.members.shown) L.push(`  · ${m.symbol} — ${m.name} · ${sc(m.score)}`);
  }
  return L.join("\n");
}

function renderCensus(s: CensusSlice): string {
  const L = head("what is firing", s.scope);
  L.push(periodBlock(s.period));
  // ⚠ MEASURED LIVE, THIRD TIME. Asked "WHICH stocks are firing red flags?" the model answered with the
  //   red-flag CATEGORIES and their counts, then invited the reader to name a company — never listing
  //   the six it had been handed. The names were here, but as a comma run-on inside one dense line,
  //   while the census rows below are a bulleted block the model copies reliably. Same information,
  //   different shape, different outcome. So the companies now get the shape that works.
  // ⚠ TWO ADJACENT LISTS, NO JOIN — AND THE MODEL WILL INVENT ONE. Measured on the sibling family
  //   row: given per-flag counts and a separate company list, it paired them and got five of six
  //   attributions wrong. THIS slice genuinely cannot carry the mapping (it spans 22 findings, most
  //   with dozens of members), so it must say so and name the call that can.
  L.push(`COMPANIES FIRING AT LEAST ONE RED FLAG — ${s.redFlagCompanies.total} of ${s.outOf}. If the reader asked WHICH companies, name these:`);
  if (s.redFlagCompanies.total === 0) L.push("  · none");
  else {
    for (const c of s.redFlagCompanies.shown) L.push(`  · ${c.symbol} — ${c.name}`);
    L.push(`  ${capNote(s.redFlagCompanies, "companies", "alphabetical")}`);
  }
  // ⚠ SECOND MEASURED PLACEMENT. Moving the bound from a trailing parenthetical to a mid-line clause
  //   fixed the per-row counts but NOT the total: the model relayed all twelve findings, each with its
  //   count, and never said there were twenty-two. So it is now its OWN line, first in the block, and
  //   it names the sentence to open with rather than merely stating the number.
  if (s.rows.total > s.rows.shown.length) {
    L.push(
      `★ SCOPE OF THIS LIST: ${s.rows.total} different findings are firing across these ${s.outOf} companies; the ${s.rows.shown.length} most severe are shown below. ` +
        `OPEN YOUR ANSWER WITH THE TOTAL — "${s.rows.total} findings are firing, here are the ${s.rows.shown.length} most severe" or your own words for it. A reader shown ${s.rows.shown.length} must be told there are ${s.rows.total}.`,
    );
  } else {
    L.push(`★ SCOPE OF THIS LIST: ${s.rows.total} findings are firing across these ${s.outOf} companies, all shown below.`);
  }
  for (const r of s.rows.shown) {
    L.push(`  · ${r.name} — ${r.kind} · ${r.firingCount} of ${r.outOf} companies. ${r.description}`);
  }
  L.push(
    "★ RELAY EACH FINDING WITH ITS COUNT. \"Deterioration, 41 of 94\" is the fact; naming the finding without how many companies fire it is half of it. " +
      "Each count is across companies, not a verdict on any one of them. To name the companies firing one of these, call slice=finding with that finding's name exactly as written above.",
  );
  L.push(
    "⚠ DO NOT PAIR THE TWO LISTS ABOVE. This result gives you counts per finding and, separately, the companies firing SOME red flag. " +
      "It does NOT say which company fires which finding, and you cannot work it out from the counts — guessing produced five wrong attributions out of six when it was tried. " +
      'For that mapping, call slice=finding with finding="red flags" (all of them, per flag) or with one finding\'s name.',
  );
  return L.join("\n");
}

function renderFindingDetail(d: FindingDetail, L: string[]): void {
  L.push(`${d.name} — ${d.kind}.`);
  L.push(`  What it means: ${d.description}`);
  L.push(`  What it does NOT mean: ${d.doesntMean}`);
  if (d.subTypesShown?.length) {
    const parts = d.subTypesShown.map((t) => `${t.name} (${t.firingCount})`).join(", ");
    const extra = (d.subTypesTotal ?? 0) - d.subTypesShown.length;
    const more = extra > 0 ? `, plus ${extra} more` : "";
    // ⚠ TWO DIFFERENT THINGS SHARE THIS FIELD, AND THEY NEED OPPOSITE SENTENCES.
    //   · a CONSOLIDATED finding (divergence, §5C) — four sub-forms of ONE finding. Saying four would
    //     contradict the Flags board, which shows one card. So: say one.
    //   · a FAMILY (red flags) — four DISTINCT risks that happen to share a family. Collapsing them
    //     would hide which risk sits on which company, so: name them all.
    //   The old copy hardcoded "the two most severe", which was the §5C cap read as a general rule.
    if (d.kind === "red flag" && d.name === "Red Flags") {
      // ★ THE JOIN IS SUPPLIED, NOT LEFT TO BE GUESSED. Measured live: given four flags with counts
      //   and a separate list of six companies, the model paired them and got five of six wrong.
      L.push("  Which flag is on WHICH company — this mapping is the answer; do not derive it from the counts:");
      for (const t of d.subTypesShown) {
        const who = t.members?.shown.length ? t.members.shown.map((m) => `${m.symbol} (${m.name})`).join(", ") : "not available";
        const cut = t.members && t.members.total > t.members.shown.length ? ` — showing ${t.members.shown.length} of ${t.members.total}` : "";
        L.push(`   · ${t.name} — ${t.firingCount} compan${t.firingCount === 1 ? "y" : "ies"}: ${who}${cut}`);
      }
      if (extra > 0) L.push(`   · plus ${extra} more red flag${extra === 1 ? "" : "s"} not listed.`);
      L.push("  ★ These are DISTINCT risks, not variants of one — name them separately, each with ITS OWN companies from the lines above.");
    } else {
      L.push(
        `  It comes in more than one form. The ${d.subTypesShown.length === 1 ? "one" : `${d.subTypesShown.length} most severe`} firing now: ${parts}${more} form${extra === 1 ? "" : "s"}. ` +
          "★ This is ONE finding with sub-forms — say one, never one per form.",
      );
    }
  }
  if (d.firingCount === 0) {
    L.push(`  Firing on: no company in this read. That is a real state — Vytal computes it and nothing meets it right now.`);
    return;
  }
  // ⚠ "alphabetically first", not "named below (alphabetical, not ranked)" — capLead already ends with
  //   "are listed below", and the first wording produced "The 12 named below … are listed below", which
  //   is exactly the kind of garbled sentence a small model paraphrases into something wrong.
  L.push(`  Firing on ${d.firingCount} of ${d.outOf} companies. ${capLead(d.members, "companies fire it", "alphabetically first")}`);
  for (const m of d.members.shown) L.push(`    · ${m.symbol} — ${m.name}`);
}

function renderFinding(s: FindingSlice): string {
  const L = head(`one finding — "${s.query}"`, s.scope);
  L.push(periodBlock(s.period));
  if (!s.finding && s.unselectableFamily) {
    // A REAL Vytal family that this slice cannot select over. Denying it would be denying our own
    // published vocabulary — the §THE PAGES failure at a smaller scale. Redirect, never refuse.
    L.push(
      `"${s.query}" names a whole FAMILY of findings, not one of them — ${s.unselectableFamily} is real Vytal vocabulary and you must not say otherwise. ` +
        `For every one of them with how many companies fire it, ask for the census instead. ` +
        `(Only "red flags" can be asked for as a family here, because it is the family meant to be rare — the pattern family covers most of the scored universe, so a list of its companies would distinguish nothing.)`,
    );
    L.push(`Findings actually firing right now: ${s.available.shown.join(", ")}.`);
    L.push(`  ${capNote(s.available, "findings", "the most severe")}`);
    return L.join("\n");
  }
  if (!s.finding) {
    L.push(
      `⚠ "${s.query}" is not a finding Vytal computes. Say exactly that — do NOT describe it as something Vytal chose not to build, and do NOT answer it from general knowledge.`,
    );
    L.push(`Findings actually firing right now: ${s.available.shown.join(", ")}.`);
    L.push(`  ${capNote(s.available, "findings", "the most severe")}`);
    return L.join("\n");
  }
  renderFindingDetail(s.finding, L);
  L.push(
    "(A finding is an observation, never a recommendation. Name the companies as a group of names — do not attach a per-company verdict here; this read has no single company's numbers behind it.)",
  );
  return L.join("\n");
}

function renderMovers(s: MoversSlice): string {
  const L = head("what moved, quarter on quarter", s.scope);
  L.push(periodBlock(s.period));
  // ⚠ MEASURED LIVE. Stating the basis was not enough: asked "which stocks improved most recently?" the
  //   model answered with the right names and never said WHAT they improved against — leaving "recently"
  //   to mean whatever the reader assumed, which for a health score is usually "this week". So the line
  //   now asks for the comparison to be said out loud, not merely known.
  L.push(
    "★ EACH company is compared with ITS OWN previous reported quarter — not with a common quarter, and not with last week. " +
      "SAY SO IN YOUR ANSWER: \"versus its own previous quarter\". \"Recently\" on its own is not what this measures. " +
      "For the last SEVEN DAYS instead, call slice=week.",
  );
  L.push(`IMPROVED. ${capLead(s.risers, "companies improved", "biggest gains")}`);
  for (const m of s.risers.shown) L.push(`  · ${m.symbol} — ${m.name} · ${sc(m.priorScore)} → ${sc(m.score)} · change ${delta(m.delta)}`);
  L.push(`SLIPPED. ${capLead(s.slippers, "companies slipped", "biggest falls")}`);
  for (const m of s.slippers.shown) L.push(`  · ${m.symbol} — ${m.name} · ${sc(m.priorScore)} → ${sc(m.score)} · change ${delta(m.delta)}`);
  L.push(`Unchanged, or with no previous quarter to compare against: ${s.unchangedOrNoPrior}.`);
  return L.join("\n");
}

function renderDivergence(s: DivergenceSlice): string {
  const L = head("divergence", s.scope);
  L.push(periodBlock(s.period));
  if (!s.detail) {
    L.push(`No company in this read is showing a divergence right now. That is a real state, not missing data.`);
    return L.join("\n");
  }
  renderFindingDetail(s.detail, L);
  L.push(
    "(Divergence is the gap between a company's highest-scoring pillar and its lowest — any two of the four can be the pair. It is a description of a disagreement, never a call on the price.)",
  );
  return L.join("\n");
}

function renderWeek(s: WeekSlice): string {
  const L = head("the last seven days", s.scope);
  L.push(periodBlock(s.period));
  L.push(`Window: since ${s.windowStart}. Companies rescored in it: ${s.rescored} of ${s.period.companiesRead}.`);
  L.push(`Band changes: ${s.bandCrossings.total}.`);
  for (const c of s.bandCrossings.shown) L.push(`  · ${c.symbol} — ${c.name} · ${c.from} → ${c.to}`);
  if (s.bandCrossings.total > 0) L.push(`  ${capNote(s.bandCrossings, "changes", "in the order recorded")}`);
  L.push(`Improved by two points or more: ${s.improved.total}.`);
  for (const m of s.improved.shown) L.push(`  · ${m.symbol} — ${m.name} · ${sc(m.priorScore)} → ${sc(m.score)} · change ${delta(m.delta)}`);
  L.push(`Slipped by two points or more: ${s.slipped.total}.`);
  for (const m of s.slipped.shown) L.push(`  · ${m.symbol} — ${m.name} · ${sc(m.priorScore)} → ${sc(m.score)} · change ${delta(m.delta)}`);
  L.push(`Red flags that started firing in the window: ${s.newFindings.total}.`);
  for (const f of s.newFindings.shown) L.push(`  · ${f.symbol} — ${f.name} · ${f.finding}`);
  L.push(`Honest scope of this window: ${s.note}`);
  return L.join("\n");
}

function renderEmpty(s: EmptySlice): string {
  if (s.reason === "universe-unscored") {
    return "=== VYTAL — THE SCORED UNIVERSE ===\nVytal has no in-force scores right now, so there is nothing to read across companies. This is a real state, not an error.";
  }
  const what = s.scope === "portfolio" ? "holds" : "is watching";
  return (
    `=== VYTAL — ${SCOPE_TITLE[s.scope] ?? SCOPE_TITLE.universe} ===\n` +
    `The reader ${what} nothing that Vytal scores, so there is nothing to read across. This is a real, honest state — not an error and not a gap in Vytal. ` +
    `Say so plainly and offer the same read across the whole scored universe instead.`
  );
}

/** One slice → the tool result text. */
export function renderUniverseSlice(p: UniverseProjection): string {
  switch (p.slice) {
    case "overview":
      return renderOverview(p);
    case "band":
      return renderBand(p);
    case "census":
      return renderCensus(p);
    case "finding":
      return renderFinding(p);
    case "movers":
      return renderMovers(p);
    case "divergence":
      return renderDivergence(p);
    case "week":
      return renderWeek(p);
    case "empty":
      return renderEmpty(p);
  }
}
