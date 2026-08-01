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
  divergence_C1_price_ahead: (ev) =>
    `Price (${f(ev.market, 0)}) sits ${f(ev.gap, 1)} pts above its fundamentals (F${f(ev.foundation, 0)} / M${f(ev.momentum, 0)}) — a wide gap.`,
  divergence_C2_ownership_vs_fundamentals: (ev) => {
    const fnd = f(ev.foundation, 0), own = f(ev.ownership, 0), g = f(ev.gap, 0);
    return str(ev.subtype) === "exit_under_strength"
      ? `Owners stepping back beneath a holding floor — Foundation ${fnd} but Ownership only ${own} (a ${g}pt gap).`
      : `Smart money building under weakness — Ownership ${own} above a weak Foundation ${fnd} (a ${g}pt gap, the regime-robust tell).`;
  },
  divergence_C3_floor_trajectory_split: (ev) => {
    const fnd = f(ev.foundation, 0), m = f(ev.momentum, 0), g = f(ev.gap, 0);
    return ev.floorLed
      ? `Floor–trajectory split — a strong Foundation ${fnd} over weak Momentum ${m} (a ${g}pt gap): the balance sheet holds while the near-term trajectory lags.`
      : `Floor–trajectory split — Momentum ${m} running well ahead of Foundation ${fnd} (a ${g}pt gap): the trajectory outruns the floor.`;
  },
  divergence_C_over_time_widening: (ev) =>
    `Price-vs-fundamentals gap widening — up from ${f(ev.recentLowGap, 1)} to ${f(ev.currentGap, 1)} pts over recent snapshots (a developing divergence, not yet wide).`,

  // ── B / D · Trajectory crosses (§5B / §5D) ──
  trajectory_B_deterioration: (ev) => {
    const variant = str(ev.variant);
    const where =
      variant === "pillar"
        ? `${pl(ev.leg)} slipped below its strong mark`
        : variant === "out_of_pristine"
          ? "composite fell below 74, out of Pristine"
          : "composite fell out of Healthy";
    return `Sliding from a high base — ${where}, sustained ${num(ev.sustainedSnapshots) ?? "≥2"} snapshots — an early risk-regime change, typically before price reacts.`;
  },
  trajectory_D_recovery: (ev) => {
    const where = ev.isPillar ? `${pl(ev.leg)} leads the recovery` : "composite crossed up out of Below-par";
    return `Turning up out of weakness — ${where}, sustained ${num(ev.sustainedSnapshots) ?? "≥2"} snapshots.`;
  },

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

  // ── G · Convergence (§5G) ──
  trajectory_G_convergence: (ev) => {
    const healthy = str(ev.type) === "healthy_resolution";
    const peak = f(ev.peakSpread, 1), cur = f(ev.currentSpread, 1);
    return healthy
      ? `Converging — the ${pl(ev.laggardPillar)} laggard rose ${f(ev.laggardRosePp, 1)}pp, closing a ${peak}pp pillar gap to ${cur}pp (healthy resolution).`
      : `Converging — the ${pl(ev.leaderPillar)} leader fell ${f(ev.leaderFellPp, 1)}pp, closing a ${peak}pp pillar gap to ${cur}pp (deterioration convergence).`;
  },

  // ── H · Ownership events (§5H) ──
  ownership_H_block_events: (ev) => {
    const n = num(ev.deals) ?? 0;
    const net = num(ev.netCr) ?? 0;
    const lean = net > 0 ? "net buying" : net < 0 ? "net selling" : "two-sided";
    return `Ownership event — ${n} block/bulk deal${n === 1 ? "" : "s"} (₹${f(ev.grossCr, 0)} Cr, ${lean}) this window.`;
  },

  // ── I · Band transition (§5I) ──
  trajectory_I_band_transition: (ev) => `Crossed into ${str(ev.toBand)}.`,
};

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
