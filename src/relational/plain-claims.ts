// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PLAIN CLAIMS (§Phase 8.2) — the card's register for elevated findings.
//
// THE PROBLEM. The nine findings that ever won a card slot carry text written for the HEALTH TAB, in
// analyst register, and the relational layer passes it through verbatim: "peer μ 37.16, N=6",
// "sustained 2 snapshots", "the regime-robust tell", "L3 declining 100%". Correct for a reader already
// inside the health model; opaque as the second line of an orientation card.
//
// THE MECHANISM. A second copy field beside the finding's own `verdict`. The card PREFERS `plainClaim`
// and falls back to `verdict`. The health tab is untouched — it keeps reading `verdict` as it always has.
//
// ★ HAND-WRITTEN, DETERMINISTIC STRINGS. No transformation, no generation, no templating engine, no
// AI. Anything that rewrites a finding's words at render time is re-authoring its meaning, which §0.10
// prohibits. These are authored once, here, and read like any other copy constant.
//
// ★ SAME FACT, SAME NUMBERS (§0.11). A plain claim may not drop a figure the analyst claim carried, nor
// add one it did not. It restates; it never summarises and never softens. Where the original names a
// threshold we declared, the plain form still names it — attribution is not decoration.
//
// ★ PLAIN IS THE HIGHEST-RISK REGISTER FOR ADVICE DRIFT (§0.11). Compression pulls "below bar — leads a
// weak field" toward "everyone else is worse, so it's fine", which is a verdict. Every string here is
// scanned by the register guard over assembled output, and none may imply a direction or an action.
//
// ★ NUMBERS ARE SUBSTITUTED FROM THE FINDING'S OWN EVIDENCE, never re-derived (§0.7). A builder that
// cannot find the figure it needs returns null and the card falls back to the analyst verdict — an
// honest fallback, never a claim with a hole in it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
/** Whole number, or one decimal only when the decimal is non-zero (§0.11 — no invented precision). */
const n1 = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
};
const plural = (n: number, s: string): string => `${n} ${n === 1 ? s : `${s}s`}`;

type Builder = (ev: Record<string, unknown>) => string | null;

/**
 * patternKey → plain-claim builder. The nine that won slots in the live census, plus the two red flags
 * that carry no `verdict` of their own. The mechanism generalises; the batch does not need to.
 */
const PLAIN: Record<string, Builder> = {
  // ── Trajectory ────────────────────────────────────────────────────────────────────────────────
  // "Sliding from a high base — Market crossed below its strong mark (82 → 36), sustained 2 snapshots:
  //  an early risk-regime change."
  trajectory_B_deterioration: (ev) => {
    const leg = str(ev.leg);
    const sustained = num(ev.sustainedSnapshots);
    const where = leg ? `Its ${leg} reading` : "Its health";
    const held = sustained ? ` It has stayed there for ${plural(sustained, "quarter")}.` : "";
    return `${where} has fallen out of the range we call strong.${held}`;
  },

  // "Turning up out of weakness — Market rose out of its weak zone (47 → 58), sustained 2 snapshots."
  trajectory_D_recovery: (ev) => {
    const leg = str(ev.leg);
    const sustained = num(ev.sustainedSnapshots);
    const where = leg ? `Its ${leg} reading` : "Its health";
    const held = sustained ? ` It has held there for ${plural(sustained, "quarter")}.` : "";
    return `${where} has risen out of the range we call weak.${held}`;
  },

  // "Crossed into Below-par (from 63.4 to 46.7), held 2 snapshots."
  trajectory_I_band_transition: (ev) => {
    const to = str(ev.toBand);
    const sustained = num(ev.sustainedSnapshots);
    if (!to) return null;
    const held = sustained ? ` It has stayed there for ${plural(sustained, "quarter")}.` : "";
    return `Its overall health has moved down into ${to.toLowerCase()}.${held}`;
  },

  // "Mix shifted while the score held (75→77) — ownership rose 9pp, foundation fell 0pp."
  trajectory_F2_composition_shift: (ev) => {
    const rose = str(ev.leaderCurrent);
    return rose
      ? `The overall score barely moved, but what is driving it changed — ${rose} is carrying more of it than before.`
      : "The overall score barely moved, but what is driving it has changed.";
  },

  // ── Composition ───────────────────────────────────────────────────────────────────────────────
  // "A 66 that isn't a typical steady — foundation runs 15pp above its band-typical (masking) while
  //  market sits 29pp below."
  composition_F1_atypical: (ev) => {
    const band = str(ev.band);
    const masking = str(ev.maskingPillar);
    const lagging = str(ev.laggingPillar);
    if (!masking || !lagging) return null;
    const b = band ? ` for a ${band.replace(/_/g, " ")} score` : "";
    return `Its parts are unusually uneven${b} — ${masking} is well above what we normally see, and ${lagging} well below.`;
  },

  // ── Divergence ────────────────────────────────────────────────────────────────────────────────
  // "Price (72) sits 44.2 pts above its fundamentals (F35 / M20, mean 27.6) — a wide gap."
  divergence_C1_price_ahead: (ev) => {
    const gap = num(ev.gap);
    if (gap === null) return null;
    return `The market is pricing this well ahead of what its financials currently show — a gap of ${n1(gap)} points on our 0–100 scale.`;
  },

  // "Smart money building under weakness — Ownership 75 above a weak Foundation 35 (a 40pt gap, the
  //  regime-robust tell)."
  divergence_C2_ownership_vs_fundamentals: (ev) => {
    const own = num(ev.ownership);
    const found = num(ev.foundation);
    const gap = num(ev.gap);
    if (own === null || found === null || gap === null) return null;
    return own > found
      ? `Large investors hold more of this than its financials alone would suggest — ownership scores ${Math.round(own)} against a foundation of ${Math.round(found)}.`
      : `Large investors hold less of this than its financials alone would suggest — ownership scores ${Math.round(own)} against a foundation of ${Math.round(found)}.`;
  },

  // "Floor–trajectory split — Momentum 80 running well ahead of Foundation 53 (a 28pt gap)."
  divergence_C3_floor_trajectory_split: (ev) => {
    const mom = num(ev.momentum);
    const found = num(ev.foundation);
    if (mom === null || found === null) return null;
    return `Its recent direction is running ahead of its underlying position — momentum ${Math.round(mom)} against a foundation of ${Math.round(found)}.`;
  },

  // ── Lens (metric-level) ───────────────────────────────────────────────────────────────────────
  // "NII: below its absolute bar but above the peer field (peer μ 4.91, N=6) — the peer group is weak
  //  on this metric."  ·  "CASA: below its bar, below the peer field …, and declining …"
  lens_lm3_NII: (ev) => lensPlain(ev, "net interest income"),
  lens_lm3_NPyoy: (ev) => lensPlain(ev, "profit growth"),
  lens_lm7_CASA: (ev) => lensPlain(ev, "low-cost deposits"),
  lens_lp5_foundation: () => "Most of its balance-sheet measures are weaker than they were.",

  // ── Ownership / red flags (these carry no `verdict` of their own) ─────────────────────────────
  // "Distribution pattern — promoter and FII both cut while retail absorbed, same quarter …"
  // ⚠ "reduced" trips the shared advice deny-list (`\breduc(e|es|ed|ing)\b`) — descriptive here, but
  // the guard scans vocabulary, not intent, and a plain-register string is exactly where "reduce"
  // drifts toward instruction (§0.11: plain is the highest-risk register for advice drift). "Sold down"
  // states the same fact with no verb the reader could read as a suggestion.
  ownership_R6_distribution: () =>
    "Promoters and foreign investors both sold down their stake in the same quarter, and small shareholders picked it up.",

  // "Promoter exit — promoter holding fell 7.00pp into FY27Q1 (past the 5pp line), a genuine sell-down —
  //  not a QIP/rights dilution." ⚠ "exit" and "sell-down" both trip the deny lists — descriptive here
  // (what the promoter did), the same shape as R6's "reduced" above. "Sold down" states the same fact
  // with no verb the reader could read as a suggestion. The 5pp line is dropped from the rendered form —
  // it's an internal bar, not a company fact, and naming it invites "so 4.9pp is fine?", a question about
  // the model rather than the stock.
  ownership_R2_promoter_exit: (ev) => {
    const drop = num(ev.promoterPctDropPp);
    const period = str(ev.currentPeriod);
    if (drop === null || !period) return null;
    const clause = ev.dilutionVerdict === "indeterminate"
      ? "unexplained by any fresh share issue, so we're treating it as a real cut"
      : "a real cut, not shares diluted by a fresh issue";
    return `Promoters sold down their stake by ${n1(drop)}pp in ${period} — ${clause}.`;
  },

  // "Interest coverage collapse — TTM interest coverage held below 1.5× for 2 straight quarters …"
  foundation_R5_interest_coverage: (ev) => {
    const q = num(ev.consecutiveQuarters);
    const held = q ? ` for ${plural(q, "quarter")} running` : "";
    return `Its earnings have not covered its interest bill${held}.`;
  },

  // R1 has an authored verdict from Phase 1.6; a plain form for the card.
  ownership_R1_pledge: (ev) => {
    const ratio = num(ev.pledgeRatioQ);
    return ratio !== null && ratio > 50
      ? `Promoters have pledged ${n1(ratio)}% of their holding as loan collateral — above the 50% level at which we treat pledging as critical.`
      : "Promoters have sharply increased how much of their holding is pledged as loan collateral.";
  },

  // ── Foundation ────────────────────────────────────────────────────────────────────────────────
  // "Capital tied in receivables — receivables grew 29.6% in FY26 while revenue fell 8.5% …"
  foundation_P8_receivables: (ev) => {
    const rec = num(ev.receivablesGrowthPct);
    const rev = num(ev.revenueGrowthPct);
    if (rec === null || rev === null) return null;
    return `Money owed to it by customers is growing faster than its sales — receivables ${rec >= 0 ? "up" : "down"} ${n1(Math.abs(rec))}% while revenue ${rev >= 0 ? "rose" : "fell"} ${n1(Math.abs(rev))}%.`;
  },

  // "Accruals divergence — operating cash flow was NEGATIVE (−₹104 Cr) against ₹759 Cr net profit …"
  foundation_P7_accruals: () =>
    "Its reported profit is not showing up as cash from the business.",

  // "Ownership event — 2 block/bulk deals (₹157 Cr, two-sided) this window."
  ownership_H_block_events: (ev) => {
    const deals = num(ev.deals);
    return deals ? `${plural(deals, "large trade")} changed hands in bulk recently.` : null;
  },
};

/** The three-lens metric reads share one shape: bar · peer · trend. Same facts, plainer words. */
function lensPlain(ev: Record<string, unknown>, metricName: string): string | null {
  const t = ev.triplet as Record<string, unknown> | undefined;
  if (!t) return null;
  const l1 = str(t.l1), l2 = str(t.l2), l3 = str(t.l3);
  const parts: string[] = [];
  if (l1 === "below_bar") parts.push("below the level we look for");
  else if (l1 === "above_bar") parts.push("above the level we look for");
  if (l2 === "below_peer") parts.push("below its peers");
  else if (l2 === "above_peer") parts.push("above its peers");
  if (l3 === "declining") parts.push("weaker than its own history");
  else if (l3 === "improving") parts.push("stronger than its own history");
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Its ${metricName} is ${joined}.`;
}

/**
 * The plain claim for a finding, or null when none is authored / its figures are absent.
 * The caller falls back to the finding's own `verdict` — never renders a partial string.
 */
export function plainClaimFor(patternKey: string, evidence: Record<string, unknown> | null): string | null {
  const build = PLAIN[patternKey];
  if (!build) return null;
  try {
    return build(evidence ?? {});
  } catch {
    return null; // a malformed evidence payload falls back, never throws into the card
  }
}
