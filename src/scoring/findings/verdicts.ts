// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERDICT RENDERERS — File 1 §5's prescribed sentence for every fired finding, bound to the real
// breaching stat in that finding's own evidence JSON.
//
// ── ★ WHY THIS IS HERE AND NOT IN THE CATALOGUE ───────────────────────────────────────────────────
// A verdict is an (evidence) => string FUNCTION. It cannot be JSON, so it cannot be served from the
// catalogue endpoint — it has to be RENDERED, on the response that already carries the evidence it
// reads. That makes its home the read layer, beside the rules whose evidence it consumes, not beside
// the static copy. The two layers are:
//
//   description  static, rule-level.  "What this pattern means."          → catalogue, any surface.
//   VERDICT      dynamic, per-stock.  "What happened at THIS company."    → HERE, evidence surfaces.
//
// They compose. A verdict never substitutes for a description and vice versa.
//
// ── ★ THIS IS A MOVE FROM Vytal-Frontend/lib/findings/verdicts.ts, CHARACTER FOR CHARACTER ────────
// scripts/verify-verdicts.ts renders every key against fixture evidence through BOTH implementations
// and asserts the output strings are identical. A single changed character fails it.
//
// ── ⚠ THERE WERE TWO VERDICT AUTHORITIES, AND THAT IS THE DEFECT THIS CLOSES ──────────────────────
// Each rule already writes its own assembled sentence into `evidence.verdict` (or `evidence.verbatim`).
// The frontend's renderers then OVERRODE it on the stock page. So the same fired finding said one
// thing on the stock page and a different thing everywhere the backend spoke — the chat, the
// relational card, the grounding block. For some keys the two texts happen to agree verbatim (C2, C3);
// for others they do not (C1 carries an extra "mean 27.6"; R6 orders its three deltas differently;
// N1 says "earnings converting reliably to cash", which the amendment's own §4.2 register list would
// not permit in the authored copy). Agreement on some keys and not others is the worst shape of drift:
// it reads as consistent right up until it isn't.
//
// PRECEDENCE IS PRESERVED EXACTLY as the frontend's `renderVerdict` had it:
//     1. the File-1 authored renderer for the key      (this catalog)
//     2. the engine's own assembled evidence.verbatim / evidence.verdict
//     3. a generic last resort
// Moving it backend-side does not change which wins — it changes WHO CAN SEE the winner.
//
// RETIRED / UNBUILT: P2 (→ R6), P3 (→ R1) are consolidated and NOT registered by the engine; P9
// (capex) is unbuilt. They have NO display slot here — deliberately no entries.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { N_FAMILY_COPY, familyOf, findingDescription, findingName } from "../../catalogue/index.js";
import { REGIME_EVIDENCE_KEY } from "../regime/regime.js";

type Ev = Record<string, unknown>;

/** Pillar display names. The frontend keeps its own copy in lib/findings/classify.ts (which is
 *  ordering/accent logic and is NOT part of this migration); this is the renderers' local copy and
 *  is asserted identical in verify-verdicts.ts. */
export const PILLAR_LABEL: Record<string, string> = {
  foundation: "Foundation",
  momentum: "Momentum",
  market: "Market",
  ownership: "Ownership",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const f = (v: unknown, d = 1): string => {
  const n = num(v);
  return n === null ? "—" : n.toFixed(d);
};
const signed = (v: unknown, d = 2): string => {
  const n = num(v);
  if (n === null) return "—";
  return n >= 0 ? `+${n.toFixed(d)}` : n.toFixed(d);
};
const abs1 = (v: unknown, d = 1): string => {
  const n = num(v);
  return n === null ? "—" : Math.abs(n).toFixed(d);
};
const pl = (k: unknown): string => PILLAR_LABEL[str(k)] ?? str(k);
/** "30.8 → 29.1 → 28.0" from an evidence opmSeries (P11/P12 locked copy). */
const opmArrow = (v: unknown): string =>
  Array.isArray(v) ? (v as { opm?: unknown }[]).map((p) => f(p.opm, 1)).join(" → ") : "";

// ── Family N (Notable) — instance verdicts, DERIVED from the spec copy templates
// (catalogue/n-family-copy.ts), never re-authored here. Each is guarded: the verdict interpolates a
// run length / delta from the fired instance, so if a required evidence key is missing at runtime we
// render the STATIC DESCRIPTION instead of a broken "undefined" sentence (amendment §8.3). The
// required keys per rule are exactly the §3 evidence keys the engine build writes. ──────────────────
const N_REQUIRED_KEYS: Record<string, string[]> = {
  foundation_N1_cash_backed_earnings: ["years"],
  foundation_N2_working_capital: ["years"],
  foundation_N3_deleveraging: ["years", "deFrom", "deTo"],
  foundation_N4_coverage_strengthening: ["quarters", "troughCoverage"],
  ownership_N5_dual_institutional_build: ["fiiDeltaPp", "diiDeltaPp"],
  ownership_N6_promoter_accumulation: ["quarters", "cumulativePp"],
  ownership_N7_pledge_release: ["pledgeFromPct", "pledgeToPct"],
};

const N_VERDICTS: Record<string, (ev: Ev) => string> = Object.fromEntries(
  Object.entries(N_FAMILY_COPY).map(([key, copy]) => [
    key,
    (ev: Ev): string => {
      const required = N_REQUIRED_KEYS[key] ?? [];
      // Guard: never interpolate a missing/undefined/null evidence value into user-facing text.
      const haveAll = required.every((k) => ev[k] != null);
      return haveAll ? copy.verdict(ev) : (findingDescription(key) ?? "");
    },
  ]),
);

// ── the catalog (one File-1 sentence per fired key, bound to evidence) ─────────
export const VERDICTS: Record<string, (ev: Ev) => string> = {
  // Family N (Notable) — guarded instance verdicts (fall back to the static description if the
  // engine's evidence key is absent). Spread first; keys are disjoint from the A–I set below.
  ...N_VERDICTS,

  // ── A · Critical red flags (§5A — names the flag + the single breaching stat) ──
  ownership_R1_pledge: (ev) => {
    const pct = num(ev.pledgeRatioQ);
    const rise = num(ev.qoqRisePp);
    const pctTxt = pct !== null ? `${pct.toFixed(1)}%` : "above the 50% line";
    if (rise !== null && rise > 10) {
      return `Pledged holding rose ${rise.toFixed(1)}pp this quarter to ${pctTxt} of promoter stake — a financing-stress signal that overrides the composite.`;
    }
    return `Promoter pledged holding is at ${pctTxt} of promoter stake — a financing-stress signal that overrides the composite.`;
  },
  ownership_R2_promoter_exit: (ev) =>
    `Promoter exit — promoter holding fell ${f(ev.promoterPctDropPp, 2)}pp into ${str(ev.currentPeriod)} (past the ${f(ev.thresholdPp, 0)}pp line), a genuine sell-down — not a QIP/rights dilution.`,
  foundation_R3_earnings_quality: (ev) => {
    const yrs = num(ev.consecutiveYears);
    const series = Array.isArray(ev.series) ? (ev.series as { fy?: unknown }[]) : [];
    const span = series.length ? `${str(series[0].fy)}–${str(series[series.length - 1].fy)}` : str(ev.latestPeriod);
    return `Earnings quality breakdown — net profit has exceeded operating cash flow for ${yrs ?? "≥4"} straight years (${span}).`;
  },
  foundation_R4_debt_explosion: (ev) =>
    `Debt explosion — debt-to-equity reached ${f(ev.deRatioLatest, 2)}× in ${str(ev.latestPeriod)}, crossing ${f(ev.threshold, 0)}× for the first time in 5 years.`,
  foundation_R5_interest_coverage: (ev) =>
    `Interest coverage collapse — TTM interest coverage held below ${f(ev.threshold, 1)}× for ${num(ev.consecutiveQuarters) ?? "≥2"} straight quarters (latest ${f(ev.latestTtmIC, 2)}×).`,
  ownership_R6_distribution: (ev) =>
    `Distribution pattern — promoter ${signed(ev.promoterDeltaPp)}pp and FII ${signed(ev.fiiDeltaPp)}pp both cut while retail absorbed ${signed(ev.retailDeltaPp)}pp, same quarter (${str(ev.currentPeriod)}).`,

  // ── E · Patterns (§5E — locked copy for P11/P12/P13; field-bound for the rest) ──
  ownership_P1_clean_rotation: (ev) =>
    `Clean institutional rotation — DII added (${signed(ev.diiDeltaPp)}pp) as FII trimmed (${f(ev.fiiDeltaPp, 2)}pp) with the promoter steady, into ${str(ev.period)}.`,
  ownership_P4_dual_exit: (ev) =>
    `Dual institutional exit — FII (${f(ev.fiiDeltaPp, 2)}pp) and DII (${f(ev.diiDeltaPp, 2)}pp) both cut in the same quarter (${str(ev.period)}).`,
  ownership_P5_insider_distress: (ev) => {
    const n = num(ev.distinctSellers) ?? 1;
    return `Insider-confirmed distress — ${n} insider${n > 1 ? "s" : ""} sold a net ₹${f(ev.netSellCr, 0)} Cr on an already-weak name (composite ${f(ev.composite, 0)}).`;
  },
  ownership_P6_insider_conviction: (ev) =>
    `Insider conviction — ${num(ev.distinctBuyers) ?? 1} directors/KMP bought a net ₹${f(ev.netBuyCr, 0)} Cr over the last quarter.`,
  foundation_P7_accruals: (ev) => {
    const ocf = num(ev.ocf);
    const period = str(ev.latestPeriod);
    if (ocf !== null && ocf < 0) {
      return `Accruals divergence — operating cash flow was negative (−₹${f(-ocf, 0)} Cr) against ₹${f(ev.netProfit, 0)} Cr net profit in ${period}: earnings entirely unbacked by operating cash.`;
    }
    return `Accruals divergence — operating cash backed only ${num(ev.cashBackPct) ?? "—"}% of ${period} net profit (₹${f(ev.accrualsGap, 0)} Cr of profit not converted to cash).`;
  },
  foundation_P8_receivables: (ev) => {
    const rev = num(ev.revenueGrowthPct);
    const dir = rev !== null && rev >= 0 ? "grew" : "fell";
    return `Capital tied in receivables — receivables grew ${f(ev.receivablesGrowthPct, 1)}% in ${str(ev.latestPeriod)} while revenue ${dir} ${abs1(rev)}% (a ${f(ev.outpacePp, 1)}pp gap).`;
  },
  ownership_P10_promoter_defense: (ev) => {
    const mkt = num(ev.marketPillar);
    const n = num(ev.buyTxns) ?? 0;
    return `Promoter defense buying — the promoter bought a net ₹${f(ev.promoterNetBuyCr, 0)} Cr (${n} trade${n === 1 ? "" : "s"}) into price weakness${mkt !== null ? ` (Market ${Math.round(mkt)})` : ""}.`;
  },
  // P11/P12/P13 — File 1 LOCKED copy, realized from the evidence series (verbatim render).
  momentum_P11_margin_compression: (ev) => {
    const ser = opmArrow(ev.opmSeries);
    return ser ? `Operating margin has been compressing for ${num(ev.quartersOfDecline) ?? ""} quarters: ${ser}.` : "";
  },
  momentum_P12_margin_recovery: (ev) => {
    const ser = opmArrow(ev.opmSeries);
    return ser ? `Operating margin recovering from trough: ${ser}.` : "";
  },
  momentum_P13_revenue_inflection: (ev) => {
    const prior = num(ev.priorTtmGrowthPct);
    const latest = num(ev.latestTtmGrowthPct);
    if (prior === null || latest === null) return "";
    const delta = num(ev.deltaPp);
    const accel = delta !== null ? delta > 0 : latest > prior;
    return `Revenue growth ${accel ? "accelerated" : "decelerated"} from ${prior.toFixed(1)}% to ${latest.toFixed(1)}%.`;
  },

  // ── C · Divergence (§5C — the read layer consolidates the family; each sub-type's
  //        File-1 sentence is authored here so the consolidated card can compose them) ──
  //
  // ★ 3d · THE C2 SUBTYPE AND C3 floorLed BRANCHES ARE COPY SELECTION, NOT LOGIC — AND THE LOGIC IS
  // ALREADY IN THE RIGHT PLACE. `subtype` is decided by ruleC2 from NATIVE_ZONES.foundation.weak +
  // K2_NOTABLE (a calibrated regime test); `floorLed` is decided by ruleC3 as `foundation > momentum`.
  // Both are stamped into evidence by the rule. The renderer does not judge direction — it reads the
  // discriminant the rule set and picks the matching sentence.
  //
  // ⚠ WHICH MEANS THE FRONTEND WAS RE-IMPLEMENTING THE RULE'S OWN BRANCH EXPRESSION, one repo away
  // from the rule that defines it. If C2's discriminant were ever renamed, or C3's polarity flipped,
  // the card would keep rendering and silently say "smart money building under weakness" about a
  // stock whose owners are walking out — a directional inversion, in front of a reader, with no error
  // anywhere. Moving the renderer next to the rule closes that by construction: they now read the
  // same evidence object in the same module tree.
  // ⚠ C1 / C2 / C3 / C-over-time are RETIRED (catalogue/retired-findings.ts) and have NO renderer
  //   here — deliberately, exactly as P2/P3 have none. A retired key never reaches renderVerdict
  //   because the read layer drops the row first; an entry here would be a second place to maintain a
  //   sentence for a finding we have decided is not true.

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family C · DIVERGENCE (Vytal_Divergence_Tool_Spec Parts 2–3)
  //
  // ★ THREE PLACES THE COPY IS GATED ON EVIDENCE, NOT ON TASTE:
  //   D1/D2  never claim an independently measured figure — the split was not separately measured,
  //          so the sentence says the direction is INHERITED from the shared configuration.
  //   D3/D4  the ±8 tier selects the register. `strong` ⇒ the study's figures may be spoken;
  //          otherwise the movement is stated and its DRIVER named, with no measured claim attached.
  //   D5     the n=5 caveat rides in the sentence itself, per the spec's "display prominently".
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  divergence_D1_price_ahead_quality: (ev) =>
    `The market is paying well above what the quality of this business currently supports — Market ${f(ev.market, 0)} against a Foundation of ${f(ev.foundation, 0)}, a ${f(ev.gapPp, 0)}-point gap. That closes one of two ways: the business improves into the price, or the price comes back to the business. Direction inherited from the combined price-ahead test (n=${num(ev.sharedN) ?? 79}); the quality-versus-trajectory split was not separately measured.`,

  divergence_D2_price_ahead_trajectory: (ev) =>
    `The price is running ahead of the company's current trajectory — Market ${f(ev.market, 0)} against a Momentum of ${f(ev.momentum, 0)}, a ${f(ev.gapPp, 0)}-point gap. The market is pricing an improvement the results have not yet shown. Direction inherited from the combined price-ahead test (n=${num(ev.sharedN) ?? 79}); this half was not separately measured.`,

  divergence_D3_ownership_building_weak_foundation: (ev) => {
    const d = num(ev.ownershipDeltaPp);
    const move = `Ownership rose ${d === null ? "—" : `${d.toFixed(2)}`} points (${f(ev.ownershipFrom, 0)}→${f(ev.ownershipTo, 0)}) while Foundation still reads ${f(ev.foundation, 0)}`;
    const driver = str(ev.driver);
    return ev.strong
      ? `${move}. Institutional ownership is rising while the fundamentals still read as weak — informed money buying against the visible evidence, historically one of the more meaningful things this model detects. ${driver}`.trim()
      : `${move}. A small move at a weak base — the same condition the evidenced pattern describes, but below the size that population was measured on, so no outcome is claimed. ${driver}`.trim();
  },

  divergence_D4_ownership_exiting_healthy: (ev) => {
    const d = num(ev.ownershipDeltaPp);
    const move = `Ownership fell ${d === null ? "—" : `${Math.abs(d).toFixed(2)}`} points (${f(ev.ownershipFrom, 0)}→${f(ev.ownershipTo, 0)}) while Foundation still reads ${f(ev.foundation, 0)}`;
    const driver = str(ev.driver);
    return ev.strong
      ? `${move}. Institutions have cut their position while the business still reads as healthy — when ownership moves before the fundamentals do, it is worth understanding what they are seeing. Sample-starved (n=${num(ev.evidencedN) ?? 11}): a reason to investigate, never a verdict. ${driver}`.trim()
      : `${move}. A small move against a healthy base — the same condition, below the size the evidenced population was measured on, so no outcome is claimed. ${driver}`.trim();
  },

  divergence_D5_laggard_catching_up: (ev) =>
    `The balance sheet was already strong; the trajectory is now turning up to match it — Momentum rose ${f(ev.momentumRisePp, 1)} points to ${f(ev.momentum, 0)} against a Foundation of ${f(ev.foundation, 0)}, closing a ${f(ev.gapPp, 0)}-point gap. The weaker pillar is converging toward the stronger one, which is the whole point: the same rise away from a weak base read −3.8%, 27% positive. Seen in four separate tests, but n=${num(ev.evidencedN) ?? 5} on the core cell — a directional hypothesis, not a proven edge.`,

  divergence_D6_quality_rolling_over: (ev) =>
    `A strong business the market already recognises as strong — Foundation ${f(ev.foundation, 0)} — whose trajectory has now turned down, Momentum crossing below ${f(ev.crossedBelow, 0)} to ${f(ev.momentum, 0)}. When quality is fully priced in, a cooling trajectory is the thing that tends to matter.`,

  divergence_D7_trajectory_breaking_base_holds: (ev) =>
    `The balance sheet is still sound at Foundation ${f(ev.foundation, 0)}, but the operating trajectory has broken into weak territory — Momentum crossed below ${f(ev.crossedBelow, 0)} to ${f(ev.momentum, 0)}. This is early: the base has not deteriorated yet, but the direction has changed. The intact Foundation does not cushion it — the version with fundamentals holding reads more negative than the bare Momentum break alone.`,

  divergence_S2_sticky_divergence: (ev) => {
    const n = num(ev.sustainedReadings) ?? 2;
    return `Foundation ${f(ev.foundation, 0)} and Momentum ${f(ev.momentum, 0)} have sat ${f(ev.gapPp, 0)} points apart for ${n} consecutive readings (since ${str(ev.sincePeriod) || "the prior reading"}) and are not converging. At this distance neither pillar reliably closes the gap at the next reading. The tension is unresolved — the model can show you that it exists, but not when it will close.`;
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family T · TRAJECTORY (Vytal_Trajectory_Tool_Spec Parts 2–3)
  //
  // ⚠ B / D / I are RETIRED and have NO renderers here, deliberately — a retired key never reaches
  //   renderVerdict because the read layer drops the row first.
  //
  // ★ THE REGIME TIERS DO THEIR WORK HERE. The rule stamps the CONTRACT (tier + which phases carry a
  //   read); the fire-time stamp under REGIME_EVIDENCE_KEY supplies the PHASE; this layer resolves
  //   the two into a sentence. That split is why a rule can stay pure while the copy stays honest.
  //
  //   Tier 1 (T3/T6) — regimeSentence() returns the no-directional-read line when the fired phase is
  //                    absent from the pattern's table. The CROSSING is still stated (§1.4 line 87);
  //                    only the direction is withheld.
  //   Tier 2 (T2)    — the phase is appended unconditionally, plus the spec's HOT sentence.
  //   Tier 3 (rest)  — HOT appends a "magnitude flattered" caveat; other phases add nothing.
  //
  // ⚠ Part 4 constrains every string below: no "early warning" (R2), no "you're early" (R3), and
  //   nothing scaled by move size (R1). scripts/verify-trajectory.ts lints these renderers' OUTPUT
  //   over fixture evidence, so a violation fails a gate rather than relying on review.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  trajectory_D_T1_recovery_low_zone: (ev) =>
    `This business is recovering from a weak position — the score rose from ${f(ev.compositePrior, 0)} to ${f(ev.compositeNow, 0)}. A real improvement in the underlying fundamentals, not just a price move: on shifts of this size the non-price pillars contribute most of the change. The market has typically already started repricing it by the time this shows.${regimeSentence(ev)}`,

  trajectory_B_T2_deterioration_high_base: (ev) =>
    `A business that was in good shape is measurably weakening — the score fell from ${f(ev.compositePrior, 0)} to ${f(ev.compositeNow, 0)}. This is the kind of change worth reviewing your reasons for holding it.${regimeSentence(ev)}`,

  trajectory_B_T3_falling_out_of_pristine: (ev) =>
    `This business has slipped out of the top health band, from ${f(ev.compositePrior, 0)} to ${f(ev.compositeNow, 0)}.${regimeSentence(ev)}`,

  trajectory_D_T4_recovering_out_of_below_par: (ev) =>
    `This business has moved out of below-par territory into steady, from ${f(ev.compositePrior, 0)} to ${f(ev.compositeNow, 0)} — a recovery that has held long enough to cross a band. Treat as directional: the sample behind this reading was not preserved, so it carries less weight than the other trajectory patterns.${regimeSentence(ev)}`,

  trajectory_D_T5_foundation_out_of_weak: (ev) =>
    `The latest results moved the balance-sheet reading out of weak territory, from ${f(ev.foundationPrior, 0)} to ${f(ev.foundationNow, 0)}. A real improvement from a low base — carried by small gains like this one rather than by large jumps.${regimeSentence(ev)}`,

  trajectory_B_T6_momentum_breaking_into_weak: (ev) =>
    `The operating trajectory has broken into weak territory, ${f(ev.momentumPrior, 0)} to ${f(ev.momentumNow, 0)}. The balance sheet may still be intact, but the direction of the business has changed.${regimeSentence(ev)}`,

  trajectory_D_T7_momentum_improving_while_weak: (ev) => {
    // ★ R3 — on a large rise the copy must state that the price has already moved. Never "you're
    //   early": before results producing a 15+ point gain the price had already run +3.0%
    //   sector-excess (70% positive) and did nothing afterwards.
    const late = ev.largeMovePriceAlreadyRan
      ? " On a move this size the price has usually already run before the reading catches up."
      : "";
    return `Still weak, but improving — the trajectory rose from ${f(ev.momentumPrior, 0)} to ${f(ev.momentumNow, 0)}, the earliest point at which a recovery becomes visible in the numbers.${late}${regimeSentence(ev)}`;
  },

  trajectory_D_T8_foundation_strong_improving: (ev) =>
    `An already-strong business that is still strengthening — the balance-sheet reading rose from ${f(ev.foundationPrior, 0)} to ${f(ev.foundationNow, 0)}, above its strong mark. Uncommon, and historically one of the more consistent positive readings.${regimeSentence(ev)}`,

  trajectory_B_T9_foundation_weak_declining: (ev) =>
    // ★ THE HIT-RATE, NOT THE MEAN. The +0.6% mean is dragged by outliers; roughly two-thirds of
    //   cases fell. Quoting the mean here would read as mildly positive — the opposite of the truth.
    `A business that was already weak is continuing to deteriorate, from ${f(ev.foundationPrior, 0)} to ${f(ev.foundationNow, 0)}. Of all the trajectory readings tested, this one had the poorest odds of the price holding up — only ${f(ev.evidencedPositivePct, 0)}% of cases rose.${regimeSentence(ev)}`,

  // ── F · Composition (§5F) ──
  composition_F1_atypical: (ev) => {
    const band = str(ev.band).replace("_", "-");
    return `A ${f(ev.composite, 0)} that isn't a typical ${band} — ${pl(ev.maskingPillar)} runs ${f(ev.maskingDevPp, 0)}pp above its band-typical (masking) while ${pl(ev.laggingPillar)} sits ${abs1(ev.laggingDevPp, 0)}pp below.`;
  },
  trajectory_F2_composition_shift: (ev) => {
    const held = ev.compositeHeld as { prior?: unknown; current?: unknown } | undefined;
    const prior = held ? f(held.prior, 0) : "—";
    const current = held ? f(held.current, 0) : "—";
    const lead = ev.leaderChanged ? ` — lead passed from ${pl(ev.leaderPrior)} to ${pl(ev.leaderCurrent)}` : "";
    return `Mix shifted while the score held (${prior}→${current})${lead}.`;
  },

  // ── G · Convergence — ⚠ RETIRED. No renderer, for the same reason as C1–C3. Its resolution
  //      typing lives on as findings/divergence/resolution.ts, un-fired and unregistered. ──

  // ── H · Ownership events (§5H) ──
  ownership_H_block_events: (ev) => {
    const n = num(ev.deals) ?? 0;
    const net = num(ev.netCr) ?? 0;
    const lean = net > 0 ? "net buying" : net < 0 ? "net selling" : "two-sided";
    return `Ownership event — ${n} block/bulk deal${n === 1 ? "" : "s"} (₹${f(ev.grossCr, 0)} Cr, ${lean}) this window.`;
  },

  // ── I · Band transition — ⚠ RETIRED (fired the excluded composite ↓62 and the untested ↑68). ──
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRAJECTORY REGIME SENTENCE — where §1.4's three tiers become words.
//
// Reads TWO things off the evidence, which were written by two different layers:
//   · the CONTRACT  (regimeTier + regimeReadPhases) — stamped by the RULE, static per pattern
//   · the PHASE     (REGIME_EVIDENCE_KEY.regime)    — stamped at FIRE TIME by the scoring pass
// Keeping them apart is what lets the rule stay a pure function while the copy stays phase-accurate.
//
// ★ THE UNKNOWN CASE IS NOT THE SAME AS THE NO-READ CASE. If the regime could not be established the
//   sentence says so; it never silently falls back to the "no directional read in this phase" line,
//   which would assert that we KNOW the phase and it happens to be uninformative.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The spec's own T3 copy for the phases where it carries no read (Part 2, T3 · "User copy
 *  (NORMAL / STRESSED)"). Verbatim. */
const T3_NO_READ = " In calm markets this crossing has not historically carried a directional read.";
/** The spec's HOT-append for T2 (Part 2, T2 · "In a HOT regime, append"). Verbatim. */
const T2_HOT_APPEND =
  " The sector is in a strong run, which has historically postponed this kind of deterioration showing up in the price rather than cancelling it.";
/** The spec's HOT copy for T3 (Part 2, T3 · "User copy (HOT)"). */
const T3_HOT =
  " Its sector is running hot — historically the least forgiving combination, a fully-priced business losing the thing that justified the price.";

function regimeSentence(ev: Ev): string {
  const tier = str(ev.regimeTier);
  if (!tier) return "";
  const stamp = ev[REGIME_EVIDENCE_KEY] as { regime?: unknown } | undefined;
  const phase = stamp && typeof stamp.regime === "string" ? stamp.regime : null;

  // Regime not established — say that, never imply we checked and found nothing.
  if (!phase) {
    return tier === "decides_read"
      ? " The market phase could not be established for this sector, and this reading depends on it."
      : "";
  }

  if (tier === "decides_read") {
    const phases = Array.isArray(ev.regimeReadPhases) ? (ev.regimeReadPhases as string[]) : [];
    if (phases.includes(phase)) {
      // The phase carries a measured read — name it.
      if (str(ev.card) === "T3") return T3_HOT;
      if (str(ev.card) === "T6") return " The sector is calm, which is the phase in which this reading has held.";
      return ` Its sector is in a ${phase} phase, where this reading has held.`;
    }
    // ★ §1.4 line 87 — the crossing stands; the direction does not.
    if (str(ev.card) === "T3") return T3_NO_READ;
    if (str(ev.card) === "T6") return " Its sector is running hot, and in that phase this break has not historically carried a directional read.";
    return ` In a ${phase} phase this reading has no directional history.`;
  }

  if (tier === "always_display") {
    const base = ` Market phase at the time of this reading: ${phase}.`;
    return phase === "HOT" ? `${base}${T2_HOT_APPEND}` : base;
  }

  // magnitude_caveat — HOT flatters the size of the move; other phases add nothing.
  return phase === "HOT" ? " The sector is running hot, which flatters the size of moves like this one." : "";
}

/** Generic last-resort copy when no renderer matched and the engine wrote no sentence. */
function genericVerdict(key: string): string {
  const name = findingName(key);
  return familyOf(key) === "A"
    ? `${name} — an override condition that takes precedence over the composite score.`
    : `${name} — a conditional signal; review the evidence below.`;
}

/**
 * The verdict SENTENCE for a finding, bound to its evidence JSON. Prefers File 1's authored copy;
 * falls back to the engine's own assembled `verbatim`/`verdict` string, then generic.
 *
 * ★ PRECEDENCE IS THE FRONTEND'S, UNCHANGED. Do not "simplify" it to read evidence.verdict first —
 * that would silently swap which of the two authorities wins, changing the sentence on every stock
 * page in the product without a single line of copy being edited.
 */
export function renderVerdict(key: string, evidence: unknown): string {
  const ev = (evidence && typeof evidence === "object" ? evidence : {}) as Ev;
  const fn = VERDICTS[key];
  if (fn) {
    try {
      const out = fn(ev);
      if (out) return out;
    } catch {
      /* fall through to the engine-assembled string */
    }
  }
  return str(ev.verbatim) || str(ev.verdict) || genericVerdict(key);
}
