// File: src/scoring/metrics/banking.ts
//
// BANKING live-value metrics — the 12 functions for PG5 (Private) + PG6 (PSU).
// PURE. No scoring, no DB. Monetary inputs ₹ Crore; EVERY function OUTPUTS PERCENT
// (to match the committed banking bars, which are in percent). Built per the
// ratified source routing (PG5 formula sheet):
//
//   Foundation (7, equal 1/7):
//     F1 Tier1  — XBRL-PRIMARY (cet1+at1)×100 for FY23+/live; BankSupplementary
//                 pre-FY23; at1-plausibility guard; cross-check vs BankSupp (>1pp flag).
//     F2 GNPA   — annual gnpaPct×100; fallback GrossNPA/(NetAdv+GrossNPA−NetNPA)×100.
//     F3 NNPA   — annual nnpaPct×100; fallback NetNPA/NetAdv×100.
//     F4 PCR    — (GrossNPA−NetNPA)/GrossNPA×100  EX-technical-write-offs (NOT headline).
//     F5 ROA    — NetProfit/TotalAssets×100 (annual).
//     F6 CI     — OpEx/(NII+OtherIncome)×100,  NII=IntEarned−IntExpended.
//     F7 CASA   — BankSupplementary casa_pct (already %); null → unavailable (→ §5.8).
//   Momentum (5, equal 1/5):
//     M1 NIM    — TTM_NII / avg_earning_assets × 100  (quarterly TTM; EA from annual BS).
//     M2 PPOP   — (PPOP_FY_t/PPOP_FY_{t-1}−1)×100   ANNUAL cohort (Master ruling).
//     M3 NII    — (NII_FY_t/NII_FY_{t-1}−1)×100      ANNUAL.
//     M4 NPyoy  — (NP_FY_t/NP_FY_{t-1}−1)×100        ANNUAL.
//     M5 GNPAttm— latest-quarter gnpaPct×100         quarterly (TTM-level).
//
// UNITS: gnpaPct/nnpaPct/cet1Ratio/additionalTier1Ratio/tier1Ratio/roaDisclosed/
// roaQuarterly are stored FRACTIONS → ×100 then sanity-bounded (banking-types.BOUNDS).

import {
  type BankingCtx, type BankingAnnual, type BankingQuarter, type MetricValue,
  pctFromFraction, BOUNDS, inBand, latestSupplementary, resolveCasa, bUnavailable, r2,
} from "./banking-types.js";

// Net interest income for a period: interestEarned − interestExpended.
const niiOf = (r: { interestEarned: number | null; interestExpended: number | null }): number | null =>
  r.interestEarned !== null && r.interestExpended !== null ? r.interestEarned - r.interestExpended : null;

// Earning assets (annual BS): advances + investments + cash&RBI + balances-with-banks.
const earningAssets = (a: BankingAnnual): number | null => {
  const parts = [a.advances, a.investments, a.cashAndBalancesWithRbi, a.balancesWithBanks];
  if (parts.some((p) => p === null)) return null;
  return parts.reduce((s, p) => s! + p!, 0)!;
};

const latestAnnual = (c: BankingCtx): BankingAnnual | null => c.annual.length ? c.annual[c.annual.length - 1] : null;
const priorAnnual = (c: BankingCtx): BankingAnnual | null => {
  if (c.annual.length < 2) return null;
  const last = c.annual[c.annual.length - 1];
  return c.annual.find((r) => r.fyOrdinal === last.fyOrdinal - 1) ?? null;
};
const latestQuarter = (c: BankingCtx): BankingQuarter | null => c.quarterly.length ? c.quarterly[c.quarterly.length - 1] : null;

// Maximal run of consecutive quarters ending at the latest (oldest→newest).
function consecutiveQtrTail(qs: BankingQuarter[]): BankingQuarter[] {
  if (qs.length === 0) return [];
  const sorted = [...qs].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const run: BankingQuarter[] = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].qOrdinal === run[0].qOrdinal - 1) run.unshift(sorted[i]);
    else break;
  }
  return run;
}

// ════════════════════════════════════════════════════════════════════════════
// F1 — Tier-1 Capital % (higher_better). XBRL-primary; BankSupp fallback/cross-check.
// ════════════════════════════════════════════════════════════════════════════
export function f1Tier1(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  const flags: string[] = [];

  // XBRL primary: (cet1 + at1) × 100, with the at1-plausibility guard.
  let xbrl: number | null = null;
  if (a && a.cet1Ratio !== null) {
    const cet1 = a.cet1Ratio * 100;
    let at1 = a.additionalTier1Ratio !== null ? a.additionalTier1Ratio * 100 : 0;
    // AT1 can NEVER exceed CET1 (it is a thin sliver, ~0–2.5%). at1 ≥ cet1 ⇒ the
    // source field is corrupt (e.g. AXISBANK at1=14.78% > cet1=14.38%). Drop it.
    if (at1 >= cet1) {
      flags.push(`at1 (${r2(at1)}%) ≥ cet1 (${r2(cet1)}%) — implausible AT1 (corrupt source); dropped, using CET1 alone`);
      at1 = 0;
    }
    const sum = cet1 + at1;
    if (inBand(sum, BOUNDS.tier1)) xbrl = sum;
    else flags.push(`XBRL tier-1 ${r2(sum)}% out of band [${BOUNDS.tier1.lo},${BOUNDS.tier1.hi}] — rejected`);
  }

  // Cross-check XBRL vs BankSupplementary for the SAME period (the snapshot FY) —
  // not a historical year (that would false-flag a real change over time).
  const sameFy = a ? c.tier1.get(a.fiscalYear) : null;
  if (xbrl !== null && sameFy && sameFy.status === "found" && sameFy.value !== null) {
    const d = Math.abs(xbrl - sameFy.value);
    if (d > 1.0) flags.push(`XBRL ${r2(xbrl)}% vs BankSupp ${a!.fiscalYear} ${r2(sameFy.value)}% diverge ${r2(d)}pp (>1pp)`);
  }

  const supp = latestSupplementary(c.tier1); // fallback only (XBRL-absent / pre-FY23)

  if (xbrl !== null) {
    return {
      key: "Tier1", label: "Tier-1 Capital %", available: true, value: xbrl, unit: "%", source: "derived",
      formula: `Tier-1 = (CET1 ${r2((a!.cet1Ratio!) * 100)}% + AT1 ${r2((a!.additionalTier1Ratio ?? 0) * 100)}%) [XBRL] = ${r2(xbrl)}%`,
      inputs: { cet1Pct: r2((a!.cet1Ratio!) * 100), at1Pct: r2((a!.additionalTier1Ratio ?? 0) * 100), suppXcheck: supp?.value ?? null },
      reason: null, flags,
    };
  }

  // Fallback: BankSupplementary tier1_pct (pre-FY23 path / XBRL absent).
  if (supp && supp.value !== null) {
    return {
      key: "Tier1", label: "Tier-1 Capital %", available: true, value: supp.value, unit: "%", source: "stored_column",
      formula: `Tier-1 = ${r2(supp.value)}% [BankSupplementary ${supp.fiscalYear}, conf ${supp.confidence ?? "—"}]`,
      inputs: { bankSupp: supp.value, fy: supp.fiscalYear },
      reason: null, flags: [...flags, "XBRL cet1/at1 unavailable — used BankSupplementary tier1_pct"],
    };
  }

  // Genuinely unreconstructable → unavailable (scoring layer applies neutral-60,
  // NOT a §5.8 drop — CN-3/CN-1 basis preservation).
  return bUnavailable("Tier1", "Tier-1 Capital %", "missing_line_item",
    "no XBRL cet1/at1 and no BankSupplementary tier1 — Tier-1 unreconstructable", {},
    [...flags, "unreconstructable Tier-1 → neutral-60 (not dropped)"]);
}

// ════════════════════════════════════════════════════════════════════════════
// F2 — Gross NPA % (lower_better). annual gnpaPct×100; fallback from absolutes.
// ════════════════════════════════════════════════════════════════════════════
function gnpaFromAbsolutes(gross: number | null, net: number | null, advances: number | null): number | null {
  // GNPA% = GrossNPA / (NetAdvances + GrossNPA − NetNPA) × 100  (gross-advance base).
  if (gross === null || net === null || advances === null) return null;
  const denom = advances + gross - net;
  if (denom <= 0) return null;
  return (gross / denom) * 100;
}

export function f2Gnpa(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  if (!a) return bUnavailable("GNPA", "Gross NPA %", "standalone_absent", "no standalone annual row");
  const primary = pctFromFraction(a.gnpaPct);
  const fallback = gnpaFromAbsolutes(a.gnpaAbsolute, a.nnpaAbsolute, a.advances);
  const flags: string[] = [];

  if (primary !== null && inBand(primary, BOUNDS.gnpa)) {
    if (fallback !== null && Math.abs(primary - fallback) > 0.5)
      flags.push(`primary ${r2(primary)}% vs annual-derived ${r2(fallback)}% diverge ${r2(Math.abs(primary - fallback))}pp`);
    return mk("GNPA", "Gross NPA %", primary, `GNPA = gnpaPct ${r2(a.gnpaPct!)} ×100 = ${r2(primary)}% [${a.fiscalYear}]`, { gnpaPctFrac: a.gnpaPct, derived: fallback }, flags);
  }
  if (fallback !== null && inBand(fallback, BOUNDS.gnpa)) {
    flags.push(`primary out of band (${primary === null ? "null" : r2(primary)}) — used annual-derived`);
    return mk("GNPA", "Gross NPA %", fallback, `GNPA = GrossNPA ${r2(a.gnpaAbsolute!)} / (Adv ${r2(a.advances!)} + Gross − Net) ×100 = ${r2(fallback)}% [${a.fiscalYear}]`, { grossNpa: a.gnpaAbsolute, netNpa: a.nnpaAbsolute, advances: a.advances }, flags);
  }
  return bUnavailable("GNPA", "Gross NPA %", "missing_line_item", `GNPA insane: primary=${primary === null ? "null" : r2(primary)} fallback=${fallback === null ? "null" : r2(fallback)} (both ∉ band)`, {}, flags);
}

// ════════════════════════════════════════════════════════════════════════════
// F3 — Net NPA % (lower_better). annual nnpaPct×100; fallback NetNPA/NetAdv×100.
// ════════════════════════════════════════════════════════════════════════════
export function f3Nnpa(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  if (!a) return bUnavailable("NNPA", "Net NPA %", "standalone_absent", "no standalone annual row");
  const primary = pctFromFraction(a.nnpaPct);
  const fallback = a.nnpaAbsolute !== null && a.advances !== null && a.advances > 0 ? (a.nnpaAbsolute / a.advances) * 100 : null;
  const flags: string[] = [];

  if (primary !== null && inBand(primary, BOUNDS.nnpa)) {
    if (fallback !== null && Math.abs(primary - fallback) > 0.5)
      flags.push(`primary ${r2(primary)}% vs derived ${r2(fallback)}% diverge ${r2(Math.abs(primary - fallback))}pp`);
    return mk("NNPA", "Net NPA %", primary, `NNPA = nnpaPct ${r2(a.nnpaPct!)} ×100 = ${r2(primary)}% [${a.fiscalYear}]`, { nnpaPctFrac: a.nnpaPct, derived: fallback }, flags);
  }
  if (fallback !== null && inBand(fallback, BOUNDS.nnpa)) {
    flags.push(`primary out of band (${primary === null ? "null" : r2(primary)}) — used derived`);
    return mk("NNPA", "Net NPA %", fallback, `NNPA = NetNPA ${r2(a.nnpaAbsolute!)} / Adv ${r2(a.advances!)} ×100 = ${r2(fallback)}% [${a.fiscalYear}]`, { netNpa: a.nnpaAbsolute, advances: a.advances }, flags);
  }
  return bUnavailable("NNPA", "Net NPA %", "missing_line_item", `NNPA insane: primary=${primary === null ? "null" : r2(primary)} fallback=${fallback === null ? "null" : r2(fallback)}`, {}, flags);
}

// ════════════════════════════════════════════════════════════════════════════
// F4 — PCR % (higher_better) = (GrossNPA − NetNPA)/GrossNPA × 100, EX-technical-write-offs.
// ════════════════════════════════════════════════════════════════════════════
export function f4Pcr(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  if (!a) return bUnavailable("PCR", "Provision Coverage Ratio %", "standalone_absent", "no standalone annual row");
  const gross = a.gnpaAbsolute, net = a.nnpaAbsolute;
  if (gross === null || net === null) return bUnavailable("PCR", "Provision Coverage Ratio %", "missing_line_item", "GrossNPA or NetNPA null");
  if (gross === 0) return bUnavailable("PCR", "Provision Coverage Ratio %", "divide_by_zero", "GrossNPA = 0");
  const value = ((gross - net) / gross) * 100;
  if (value < 0 || value > 100) return bUnavailable("PCR", "Provision Coverage Ratio %", "missing_line_item", `PCR ${r2(value)}% ∉ [0,100] (Net>Gross?)`);
  const flags: string[] = [];
  if (a.stored.pcr !== null) {
    const storedPct = a.stored.pcr <= 1 ? a.stored.pcr * 100 : a.stored.pcr; // stored may be fraction or %
    if (Math.abs(storedPct - value) > 5) flags.push(`ex-TWO PCR ${r2(value)}% vs stored/headline ${r2(storedPct)}% diverge ${r2(Math.abs(storedPct - value))}pp (headline likely incl technical write-offs)`);
  }
  return mk("PCR", "Provision Coverage Ratio %", value, `PCR(ex-TWO) = (Gross ${r2(gross)} − Net ${r2(net)})/Gross ×100 = ${r2(value)}% [${a.fiscalYear}]`, { grossNpa: gross, netNpa: net }, flags);
}

// ════════════════════════════════════════════════════════════════════════════
// F5 — ROA % (higher_better) = NetProfit / TotalAssets × 100 (annual).
// ════════════════════════════════════════════════════════════════════════════
export function f5Roa(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  if (!a) return bUnavailable("ROA", "Return on Assets %", "standalone_absent", "no standalone annual row");
  if (a.netProfit === null || a.totalAssets === null) return bUnavailable("ROA", "Return on Assets %", "missing_line_item", "netProfit or totalAssets null");
  if (a.totalAssets <= 0) return bUnavailable("ROA", "Return on Assets %", "divide_by_zero", "totalAssets ≤ 0");
  const value = (a.netProfit / a.totalAssets) * 100;
  const flags: string[] = [];
  const disc = pctFromFraction(a.roaDisclosed);
  if (disc !== null && Math.abs(disc - value) > 0.3) flags.push(`derived ROA ${r2(value)}% vs disclosed ${r2(disc)}% diverge ${r2(Math.abs(disc - value))}pp`);
  if (!inBand(value, BOUNDS.roa)) flags.push(`ROA ${r2(value)}% out of band [${BOUNDS.roa.lo},${BOUNDS.roa.hi}]`);
  return mk("ROA", "Return on Assets %", value, `ROA = NetProfit ${r2(a.netProfit)} / TotalAssets ${r2(a.totalAssets)} ×100 = ${r2(value)}% [${a.fiscalYear}]`, { netProfit: a.netProfit, totalAssets: a.totalAssets, disclosed: disc }, flags);
}

// ════════════════════════════════════════════════════════════════════════════
// F6 — Cost-to-Income % (lower_better) = OpEx / (NII + OtherIncome) × 100.
// ════════════════════════════════════════════════════════════════════════════
export function f6CostIncome(c: BankingCtx): MetricValue {
  const a = latestAnnual(c);
  if (!a) return bUnavailable("CI", "Cost-to-Income %", "standalone_absent", "no standalone annual row");
  const nii = niiOf(a);
  if (a.operatingExpenses === null || nii === null || a.otherIncome === null) return bUnavailable("CI", "Cost-to-Income %", "missing_line_item", "opEx, NII, or otherIncome null");
  const denom = nii + a.otherIncome; // net total income
  if (denom <= 0) return bUnavailable("CI", "Cost-to-Income %", "divide_by_zero", `net total income ${r2(denom)} ≤ 0`);
  const value = (a.operatingExpenses / denom) * 100;
  // NOTE: the stored `costToIncomeRatio` column uses a DIFFERENT definition
  // (total-cost incl cost-of-funds / total income, ~68%) — deliberately NOT compared
  // here. The banking cost-to-income is opEx / net-total-income (ex interest), ~38–51%.
  const flags: string[] = [];
  if (!inBand(value, BOUNDS.ci)) flags.push(`C/I ${r2(value)}% out of band [${BOUNDS.ci.lo},${BOUNDS.ci.hi}]`);
  return mk("CI", "Cost-to-Income %", value, `C/I = OpEx ${r2(a.operatingExpenses)} / (NII ${r2(nii)} + OthInc ${r2(a.otherIncome)}) ×100 = ${r2(value)}% [${a.fiscalYear}]`, { opEx: a.operatingExpenses, nii, otherIncome: a.otherIncome }, flags);
}

// ════════════════════════════════════════════════════════════════════════════
// F7 — CASA % (higher_better) = BankSupplementary casa_pct (already %).
// TIERED READ (preserving cutover): newest QUARTER-KEYED row → legacy LIVE → §5.8.
// null → unavailable (scoring layer §5.8-excludes F7, redistributes weight).
// ════════════════════════════════════════════════════════════════════════════
export function f7Casa(c: BankingCtx): MetricValue {
  // The CASA snapshot is the NEWEST quarter-keyed value (FYxx/Qn) if any exists; else
  // the legacy "LIVE" row (so the 8 live banks score exactly as before until their first
  // quarter lands); else no current CASA → §5.8 missing-lens (F7 excluded from Foundation,
  // weight redistributed across the other 6). Legacy ANNUAL FY rows are L3 own-history
  // only, NOT a snapshot tier — a bank with only annual CASA stays on §5.8, as today.
  const resolved = resolveCasa(c.casa);
  if (!resolved) {
    return bUnavailable("CASA", "CASA Ratio %", "missing_line_item", "no quarter-keyed or LIVE CASA in BankSupplementary → §5.8 missing-lens (F7 excluded, weight redistributed across other 6)", {}, ["§5.8 missing-lens (no current CASA)"]);
  }
  const { point, tier, periodLabel } = resolved;
  return {
    key: "CASA", label: "CASA Ratio %", available: true, value: point.value!, unit: "%", source: "stored_column",
    formula: `CASA = ${r2(point.value!)}% [BankSupplementary ${periodLabel}${tier === "legacy_live" ? " (legacy)" : ""}, conf ${point.confidence ?? "—"}]`,
    inputs: { casa: point.value!, period: periodLabel, tier, confidence: point.confidence },
    reason: null, flags: point.confidence === "C" ? ["confidence=C (operator-verify before trusting)"] : [],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// M1 — NIM (TTM) % (higher_better) = TTM_NII / avg_earning_assets × 100.
// TTM_NII = Σ latest-4-consecutive-quarters NII; avg EA = (EA_{prior FY}+EA_{latest FY})/2.
// ════════════════════════════════════════════════════════════════════════════
export function m1NimTtm(c: BankingCtx): MetricValue {
  const run = consecutiveQtrTail(c.quarterly);
  if (run.length < 4) return bUnavailable("NIM", "Net Interest Margin (TTM) %", "insufficient_history", `need 4 consecutive quarters, have ${run.length}`);
  const ttm = run.slice(-4);
  let ttmNii = 0;
  for (const q of ttm) { const v = niiOf(q); if (v === null) return bUnavailable("NIM", "Net Interest Margin (TTM) %", "missing_line_item", "interestEarned/Expended null in a TTM quarter"); ttmNii += v; }

  const last = latestAnnual(c), prior = priorAnnual(c);
  const eaLast = last ? earningAssets(last) : null;
  const eaPrior = prior ? earningAssets(prior) : null;
  let avgEa: number | null = null, eaNote = "";
  if (eaLast !== null && eaPrior !== null) { avgEa = (eaLast + eaPrior) / 2; eaNote = `avg(EA ${r2(eaPrior)}, ${r2(eaLast)})`; }
  else if (eaLast !== null) { avgEa = eaLast; eaNote = `EA ${r2(eaLast)} (single FY, no prior avg)`; }
  if (avgEa === null || avgEa <= 0) return bUnavailable("NIM", "Net Interest Margin (TTM) %", "missing_line_item", "earning assets unavailable (advances/investments/cash/balances null)");

  const value = (ttmNii / avgEa) * 100;
  const flags: string[] = [];
  if (!inBand(value, BOUNDS.nim)) flags.push(`NIM ${r2(value)}% out of band [${BOUNDS.nim.lo},${BOUNDS.nim.hi}]`);
  const span = `${ttm[0].fiscalYear}${ttm[0].quarter}…${ttm[ttm.length - 1].fiscalYear}${ttm[ttm.length - 1].quarter}`;
  return mk("NIM", "Net Interest Margin (TTM) %", value, `NIM = TTM_NII ${r2(ttmNii)} [${span}] / ${eaNote} ×100 = ${r2(value)}%`, { ttmNii: r2(ttmNii), avgEarningAssets: r2(avgEa) }, flags);
}

// ── Annual YoY helper (M2/M3/M4): (cur/prior − 1)×100 from the 2 annual rows ─────
function annualYoy(c: BankingCtx, key: string, label: string, pick: (a: BankingAnnual) => number | null, pickName: string): MetricValue {
  const cur = latestAnnual(c), prior = priorAnnual(c);
  if (!cur || !prior) return bUnavailable(key, label, "insufficient_history", `need 2 consecutive annual FYs, have ${c.annual.length}`);
  const vCur = pick(cur), vPrior = pick(prior);
  if (vCur === null || vPrior === null) return bUnavailable(key, label, "missing_line_item", `${pickName} null in FY${cur.fyOrdinal} or FY${prior.fyOrdinal}`);
  if (vPrior <= 0) return bUnavailable(key, label, "non_positive_base", `prior ${pickName} ${r2(vPrior)} ≤ 0 — YoY undefined`);
  const value = ((vCur - vPrior) / vPrior) * 100;
  return mk(key, label, value, `${label} = (${cur.fiscalYear} ${r2(vCur)} / ${prior.fiscalYear} ${r2(vPrior)} − 1) ×100 = ${r2(value)}%  [ANNUAL cohort]`, { cur: r2(vCur), prior: r2(vPrior) }, ["annual-cohort YoY (Master ruling); live read recomputed each period"]);
}

// M2 — PPOP YoY % (annual). M3 — NII YoY % (annual). M4 — Net Profit YoY % (annual).
export const m2PpopYoy = (c: BankingCtx): MetricValue => annualYoy(c, "PPOP", "Pre-Provision Operating Profit YoY %", (a) => a.ppop, "ppop");
export const m3NiiYoy = (c: BankingCtx): MetricValue => annualYoy(c, "NII", "Net Interest Income YoY %", niiOf, "NII");
export const m4NpYoy = (c: BankingCtx): MetricValue => annualYoy(c, "NPyoy", "Net Profit YoY %", (a) => a.netProfit, "netProfit");

// ════════════════════════════════════════════════════════════════════════════
// M5 — Gross NPA (TTM) % (lower_better) = latest-quarter gnpaPct×100 (quarterly level).
// ════════════════════════════════════════════════════════════════════════════
export function m5GnpaTtm(c: BankingCtx): MetricValue {
  const q = latestQuarter(c);
  if (!q) return bUnavailable("GNPAttm", "Gross NPA (TTM) %", "standalone_absent", "no standalone quarter");
  const primary = pctFromFraction(q.gnpaPct);
  const fallback = gnpaFromAbsolutes(q.gnpaAbsolute, q.nnpaAbsolute, null); // no advances on quarterly → null
  const flags: string[] = [];
  if (primary !== null && inBand(primary, BOUNDS.gnpa)) {
    return mk("GNPAttm", "Gross NPA (TTM) %", primary, `GNPAttm = gnpaPct ${r2(q.gnpaPct!)} ×100 = ${r2(primary)}% [${q.fiscalYear}${q.quarter}]`, { gnpaPctFrac: q.gnpaPct }, flags);
  }
  if (fallback !== null && inBand(fallback, BOUNDS.gnpa)) {
    flags.push(`primary out of band — used quarterly-absolutes-derived`);
    return mk("GNPAttm", "Gross NPA (TTM) %", fallback, `GNPAttm(derived) = ${r2(fallback)}% [${q.fiscalYear}${q.quarter}]`, { grossNpa: q.gnpaAbsolute, netNpa: q.nnpaAbsolute }, flags);
  }
  return bUnavailable("GNPAttm", "Gross NPA (TTM) %", "missing_line_item", `GNPAttm insane: primary=${primary === null ? "null" : r2(primary)}`, {}, flags);
}

// ── small builder for an available % metric ─────────────────────────────────────
function mk(key: string, label: string, value: number, formula: string, inputs: MetricValue["inputs"], flags: string[]): MetricValue {
  return { key, label, available: true, value, unit: "%", source: "derived", formula, inputs, reason: null, flags };
}

// ── Dispatch maps (engine key → banking live-value fn) ──────────────────────────
export type BankingFn = (c: BankingCtx) => MetricValue;

/** The ANNUAL readings. Not a v1 survival - changes 2.2/2.3 fall back to these when a bank
 *  is short of quarterly history, so they are a branch of the current instrument. */
export const BANKING_FOUNDATION_FNS_ANNUAL: Record<string, BankingFn> = {
  Tier1: f1Tier1, GNPA: f2Gnpa, NNPA: f3Nnpa, PCR: f4Pcr, ROA: f5Roa, CI: f6CostIncome, CASA: f7Casa,
};
export const BANKING_MOMENTUM_FNS_ANNUAL: Record<string, BankingFn> = {
  NIM: m1NimTtm, PPOP: m2PpopYoy, NII: m3NiiYoy, NPyoy: m4NpYoy, GNPAttm: m5GnpaTtm,
};

/** Compute one PG's banking foundation + momentum live values for the given keys. */
// ═══════════════════════════════════════════════════════════════════════════════════
// CHANGES 2.2 / 2.3 — BANK CADENCE (v2)
//
// v1 reads banks almost entirely from the ANNUAL cohort: all seven Foundation metrics
// plus PPOP, NII and net-profit growth step once a year, so a bank's Foundation takes
// SIX distinct values across twelve quarters. The quarterly data exists for every one of
// them (144 of 144 bank-quarters for gross NPA and provision cover, 141-143 for the rest).
//
// PER METRIC TYPE, and the type is what decides the construction:
//   Tier1 / GNPA / NNPA / PCR are POINT-IN-TIME LEVELS. A balance-sheet ratio's current
//     value IS its current value; there is nothing to average, and the annual figure is
//     simply a stale copy of the same number. Use the quarter's own.
//   ROA is a FLOW ratio, and roaQuarterly is ALREADY ANNUALISED — so a trailing year is
//     the MEAN of four, never the sum. (Verified against roa_disclosed: AXISBANK
//     0.015/0.015, CANBK 0.011/0.011, ICICIBANK 0.023/0.023.)
//   PPOP / NII / net profit are FLOWS. Trailing-twelve-months against trailing-twelve-
//     months, matching the non-financial construction.
//
// ★ COST-TO-INCOME IS DELIBERATELY EXCLUDED AND STAYS ANNUAL. Checked at the fiscal year
//   end, where the quarterly and annual figures describe the same date, every other metric
//   agrees with its annual source at a ratio of 1.000 (ROA 0.998). Cost-to-income comes out
//   at 0.653 with 0% of readings inside 20%. A trailing-twelve-month costs-over-net-income
//   figure gives 38-55% for most banks against the stored annual 64-83%, and it LOOKS more
//   like a real cost-to-income ratio — but "looks more plausible" is not a scale check
//   passing. CI keeps its stored annual value and the discrepancy stays on the defect list.
//
// ★ CASA is unchanged (BankSupplementary, already percent).
//
// ★ THE UNITS TRAP IS ALREADY HANDLED HERE. Defect R34-extended: all six bank fields are
//   stored as FRACTIONS in both the quarterly and annual tables while every bar is cut in
//   percentage points. Feeding a fraction to a percentage-point bar pins every reading at
//   one end and the run still completes looking clean. banking.ts already multiplies via
//   pctFromFraction, and the quarterly path below uses the same helper - so this is one
//   trap that needed no new work, only not to be re-introduced.
//
// ★ EVERY ONE FALLS BACK TO ITS ANNUAL FORM. Same discipline as the rolling Foundation:
//   a bank short of quarterly history keeps the metric it already had rather than losing
//   it and thinning its pillar against the §14.4 floor.

/** Mean of the last four quarterly values of an ALREADY-ANNUALISED fraction, as a percent. */
function meanOf4Annualised(run: BankingQuarter[], pick: (q: BankingQuarter) => number | null): number | null {
  if (run.length < 4) return null;
  let s = 0;
  for (const q of run.slice(-4)) {
    const v = pick(q);
    if (v === null) return null;
    s += v;
  }
  return (s / 4) * 100;
}

/** TTM sum of a quarterly flow over the last 4; null if short or any leg is null. */
function ttmFlow(run: BankingQuarter[], pick: (q: BankingQuarter) => number | null): number | null {
  if (run.length < 4) return null;
  let s = 0;
  for (const q of run.slice(-4)) {
    const v = pick(q);
    if (v === null) return null;
    s += v;
  }
  return s;
}

/** Fall back to the v1 (annual) reading, stamping WHY, so a mixed-cadence pillar is
 *  legible in the stored metric rather than silently indistinguishable. */
function annualFallback(v1: MetricValue, why: string): MetricValue {
  return { ...v1, flags: [...v1.flags, `changes 2.2/2.3: quarterly form unavailable (${why}) — fell back to the annual value`] };
}

// ── Foundation, quarterly ────────────────────────────────────────────────────────
/** Tier-1 from the QUARTER's own cet1 + at1, with the same at1-plausibility guard v1 uses. */
export function f1Tier1Q(c: BankingCtx): MetricValue {
  const q = latestQuarter(c);
  if (!q || q.cet1Ratio === null) return annualFallback(f1Tier1(c), q ? "quarter carries no cet1" : "no quarterly row");
  const cet1 = q.cet1Ratio * 100;
  let at1 = q.additionalTier1Ratio !== null ? q.additionalTier1Ratio * 100 : 0;
  const flags: string[] = [];
  if (at1 >= cet1) { flags.push(`at1 (${r2(at1)}%) >= cet1 (${r2(cet1)}%) — implausible AT1 (corrupt source); dropped, using CET1 alone`); at1 = 0; }
  const value = cet1 + at1;
  if (!inBand(value, BOUNDS.tier1)) return annualFallback(f1Tier1(c), `quarterly tier-1 ${r2(value)}% out of band`);
  return mk("Tier1", "Tier-1 Capital %", value, `Tier-1 = (CET1 ${r2(cet1)}% + AT1 ${r2(at1)}%) [${q.fiscalYear}${q.quarter} XBRL] = ${r2(value)}%`,
    { cet1Pct: r2(cet1), at1Pct: r2(at1), quarter: `${q.fiscalYear}${q.quarter}` }, [...flags, "change 2.2: the quarter's own point-in-time level"]);
}

/** Gross NPA from the QUARTER's own ratio. */
export function f2GnpaQ(c: BankingCtx): MetricValue {
  const q = latestQuarter(c);
  const v = q ? pctFromFraction(q.gnpaPct) : null;
  if (v === null || !inBand(v, BOUNDS.gnpa)) return annualFallback(f2Gnpa(c), q ? "quarterly gnpaPct null or out of band" : "no quarterly row");
  return mk("GNPA", "Gross NPA %", v, `GNPA = gnpaPct ${r2(q!.gnpaPct!)} x100 = ${r2(v)}% [${q!.fiscalYear}${q!.quarter}]`,
    { gnpaPctFrac: q!.gnpaPct, quarter: `${q!.fiscalYear}${q!.quarter}` }, ["change 2.2: the quarter's own point-in-time level"]);
}

/** Net NPA from the QUARTER's own ratio. */
export function f3NnpaQ(c: BankingCtx): MetricValue {
  const q = latestQuarter(c);
  const v = q ? pctFromFraction(q.nnpaPct) : null;
  if (v === null || !inBand(v, BOUNDS.nnpa)) return annualFallback(f3Nnpa(c), q ? "quarterly nnpaPct null or out of band" : "no quarterly row");
  return mk("NNPA", "Net NPA %", v, `NNPA = nnpaPct ${r2(q!.nnpaPct!)} x100 = ${r2(v)}% [${q!.fiscalYear}${q!.quarter}]`,
    { nnpaPctFrac: q!.nnpaPct, quarter: `${q!.fiscalYear}${q!.quarter}` }, ["change 2.2: the quarter's own point-in-time level"]);
}

/** PCR from the QUARTER's own absolutes, ex-technical-write-offs — v1's derivation,
 *  applied to the quarter. The quarterly table carries no `pcr` column, so this is the
 *  same formula rather than a different source. */
export function f4PcrQ(c: BankingCtx): MetricValue {
  const q = latestQuarter(c);
  if (!q || q.gnpaAbsolute === null || q.nnpaAbsolute === null || q.gnpaAbsolute === 0)
    return annualFallback(f4Pcr(c), q ? "quarterly GrossNPA/NetNPA null or zero" : "no quarterly row");
  const value = ((q.gnpaAbsolute - q.nnpaAbsolute) / q.gnpaAbsolute) * 100;
  if (value < 0 || value > 100) return annualFallback(f4Pcr(c), `quarterly PCR ${r2(value)}% outside [0,100]`);
  return mk("PCR", "Provision Coverage Ratio %", value, `PCR(ex-TWO) = (Gross ${r2(q.gnpaAbsolute)} - Net ${r2(q.nnpaAbsolute)})/Gross x100 = ${r2(value)}% [${q.fiscalYear}${q.quarter}]`,
    { grossNpa: q.gnpaAbsolute, netNpa: q.nnpaAbsolute, quarter: `${q.fiscalYear}${q.quarter}` }, ["change 2.2: the quarter's own point-in-time level"]);
}

/** ROA as the MEAN of the last four ALREADY-ANNUALISED quarterly figures. */
export function f5RoaQ(c: BankingCtx): MetricValue {
  const run = consecutiveQtrTail(c.quarterly);
  const value = meanOf4Annualised(run, (q) => q.roaQuarterly);
  if (value === null) return annualFallback(f5Roa(c), `need 4 consecutive quarters with roaQuarterly, have ${run.length}`);
  if (!inBand(value, BOUNDS.roa)) return annualFallback(f5Roa(c), `quarterly ROA ${r2(value)}% out of band`);
  const ttm = run.slice(-4);
  return mk("ROA", "Return on Assets %", value, `ROA = mean of 4 annualised quarterly ROA [${ttm[0].fiscalYear}${ttm[0].quarter}..${ttm[3].fiscalYear}${ttm[3].quarter}] = ${r2(value)}%`,
    { quarters: ttm.map((q) => `${q.fiscalYear}${q.quarter}`).join(","), }, ["change 2.2: roaQuarterly is already annualised, so a trailing year is the MEAN of four, not the sum"]);
}

// ── Momentum, trailing-twelve-months vs trailing-twelve-months ───────────────────
/** TTM-vs-TTM growth on a quarterly flow. Needs EIGHT consecutive quarters (two windows). */
function ttmYoy(c: BankingCtx, key: string, label: string, pick: (q: BankingQuarter) => number | null, v1: MetricValue): MetricValue {
  const run = consecutiveQtrTail(c.quarterly);
  if (run.length < 8) return annualFallback(v1, `need 8 consecutive quarters, have ${run.length}`);
  const now = ttmFlow(run, pick);
  const prior = ttmFlow(run.slice(0, run.length - 4), pick);
  if (now === null || prior === null) return annualFallback(v1, "a leg is null inside a TTM window");
  if (prior <= 0) return annualFallback(v1, `prior TTM ${r2(prior)} <= 0 — YoY undefined`);
  const value = ((now - prior) / prior) * 100;
  const span = `${run[run.length - 4].fiscalYear}${run[run.length - 4].quarter}..${run[run.length - 1].fiscalYear}${run[run.length - 1].quarter}`;
  return mk(key, label, value, `${label} = (TTM ${r2(now)} [${span}] / prior TTM ${r2(prior)} - 1) x100 = ${r2(value)}%`,
    { ttmNow: r2(now), ttmPrior: r2(prior) }, ["change 2.3: TTM-vs-TTM, matching the non-financial construction"]);
}

export const m2PpopYoyTtm = (c: BankingCtx): MetricValue => ttmYoy(c, "PPOP", "Pre-Provision Operating Profit YoY %", (q) => q.ppop, m2PpopYoy(c));
export const m3NiiYoyTtm = (c: BankingCtx): MetricValue => ttmYoy(c, "NII", "Net Interest Income YoY %", niiOf, m3NiiYoy(c));
export const m4NpYoyTtm = (c: BankingCtx): MetricValue => ttmYoy(c, "NPyoy", "Net Profit YoY %", (q) => q.netProfit, m4NpYoy(c));

/** The v2 banking tables. CI and CASA are absent from the Foundation override on purpose
 *  (CI's scale check failed; CASA does not move), and NIM/GNPAttm are absent from the
 *  Momentum override because they already move quarterly. */
export const BANKING_FOUNDATION_FNS: Record<string, (c: BankingCtx) => MetricValue> = {
  ...BANKING_FOUNDATION_FNS_ANNUAL,
  Tier1: f1Tier1Q, GNPA: f2GnpaQ, NNPA: f3NnpaQ, PCR: f4PcrQ, ROA: f5RoaQ,
};
export const BANKING_MOMENTUM_FNS: Record<string, (c: BankingCtx) => MetricValue> = {
  ...BANKING_MOMENTUM_FNS_ANNUAL,
  PPOP: m2PpopYoyTtm, NII: m3NiiYoyTtm, NPyoy: m4NpYoyTtm,
};

export function computeBankingLiveValues(c: BankingCtx, foundationKeys: string[], momentumKeys: string[]): {
  foundation: MetricValue[]; momentum: MetricValue[]; snapshotFy: string | null; snapshotQuarter: string | null;
} {
  const fFns = BANKING_FOUNDATION_FNS;
  const mFns = BANKING_MOMENTUM_FNS;
  const foundation = foundationKeys.map((k) => (fFns[k] ? fFns[k](c) : bUnavailable(k, k, "missing_line_item", `DISPATCH GAP: no banking fn for foundation key "${k}"`, {}, [`⚠ DISPATCH GAP: ${k}`])));
  const momentum = momentumKeys.map((k) => (mFns[k] ? mFns[k](c) : bUnavailable(k, k, "missing_line_item", `DISPATCH GAP: no banking fn for momentum key "${k}"`, {}, [`⚠ DISPATCH GAP: ${k}`])));
  const la = latestAnnual(c), lq = latestQuarter(c);
  return { foundation, momentum, snapshotFy: la?.fiscalYear ?? null, snapshotQuarter: lq ? `${lq.fiscalYear}${lq.quarter}` : null };
}

// ── L3 own-history series (re-dispatch over prefixes / supplementary FY series) ──
const subCtxAnnual = (c: BankingCtx, n: number): BankingCtx => ({ ...c, annual: c.annual.slice(0, n) });
const subCtxQuarterly = (c: BankingCtx, n: number): BankingCtx => ({ ...c, quarterly: c.quarterly.slice(0, n) });

function suppSeries(m: BankingCtx["casa"]): number[] {
  // L3 own-history = the curated ANNUAL FY series (oldest→newest). Exclude "LIVE" and
  // exclude quarter-keyed rows (those are the live snapshot, not history) — iterating
  // point fields (not map keys) keeps this correct now that keys can be composite "FY/Qn".
  const annual = [...m.values()]
    .filter((p) => p.quarter === null && p.fiscalYear !== "LIVE" && p.status === "found" && p.value !== null)
    .sort((a, b) => Number(a.fiscalYear.replace(/\D/g, "")) - Number(b.fiscalYear.replace(/\D/g, "")));
  return annual.map((p) => p.value!);
}

/** Own-history series (oldest→newest) for L3, per metric key. Tier1/CASA use the
 *  BankSupplementary FY series (the curated history incl pre-FY23); the XBRL-derived
 *  metrics re-dispatch over annual prefixes; NIM/GNPAttm over quarterly prefixes. */
export function bankingSeriesForKey(c: BankingCtx, key: string): number[] {
  // CASA never moves to a quarterly cadence, and Tier-1's own-history is the curated
  // BankSupplementary FY series (which reaches back past FY23 where XBRL does not) — so
  // both keep the annual series even under v2. Tier-1's LIVE VALUE does move to the
  // quarter (f1Tier1Q); its HISTORY is a different question with a different best source.
  if (key === "Tier1") return suppSeries(c.tier1);
  if (key === "CASA") return suppSeries(c.casa);
  // Quarterly-cadence keys: the two that always were, plus the five changes 2.2/2.3 move.
  const quarterly = new Set(["NIM", "GNPAttm", "GNPA", "NNPA", "PCR", "ROA", "PPOP", "NII", "NPyoy"]);
  const fFns = BANKING_FOUNDATION_FNS;
  const mFns = BANKING_MOMENTUM_FNS;
  const fn = fFns[key] ?? mFns[key];
  if (!fn) return [];
  const out: number[] = [];
  if (quarterly.has(key)) {
    // ⚠ THE HISTORY MUST ROLL IN THE METRIC'S OWN CADENCE. Feed a now-quarterly metric
    //   annual prefixes and L3 sees six points where it should see twelve, which is the
    //   very starvation change 2.2 exists to end — and it would fail silently.
    for (let j = 1; j <= c.quarterly.length; j++) { const v = fn(subCtxQuarterly(c, j)); if (v.available && v.value !== null) out.push(v.value); }
    return out;
  }
  for (let i = 1; i <= c.annual.length; i++) { const v = fn(subCtxAnnual(c, i)); if (v.available && v.value !== null) out.push(v.value); }
  return out;
}
