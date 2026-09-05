// File: src/scoring/metrics/foundation.ts
//
// FOUNDATION raw-value metrics (F1–F10), annual, from STANDALONE `fundamentals`.
// PURE: each function takes normalized standalone rows and returns a MetricValue
// (raw value or unavailable+reason) with the formula, inputs, source, and flags.
// No scoring. No DB. Monetary inputs are ₹ Crore; ratios are unit-free.
//
// DEFINITIONS (stated, matching the repo's ingestion where one exists):
//   EBIT          = PBT + finance costs            (includes other income)
//   Capital Empl. = net worth + total debt         (repo convention; verified to
//                   reproduce the stored `roce` exactly on RELIANCE standalone)
//   Net worth     = totalEquity (else ESC+otherEquity)
//   Total debt    = current + non-current borrowings
//   FCF (F8)      = cash from operating − CAPEX-PROXY, where
//                   Capex-proxy = ΔNet Block + Depreciation + ΔCWIP  (a balance-sheet
//                   derivation, NOT the direct CF PP&E-purchase line and NOT full
//                   Investing Cash Flow). This matches the bar-derivation basis for
//                   FCF/PAT (vytal_pg_bars_*: "Capex=dNetBlock+Dep+dCWIP").
// Where we DERIVE a metric that also has a stored column, we cross-check and FLAG
// any disagreement (a stored value computed on the wrong basis at ingestion would
// surface here).

import {
  ebitFrom,
  netWorthFrom,
  totalDebtFrom,
  sumNonNull,
  type FoundationAnnual,
  type MomentumQuarter,
  type MetricValue,
  type BuybackPath,
} from "./types.js";

// Tolerances for the derived-vs-stored cross-check.
const REL_TOL = 0.01; // 1% relative
const ABS_TOL = 0.05; // or 0.05 absolute (for small ratios/percentages)

const r2 = (x: number) => Math.round(x * 10000) / 10000;

function crossCheck(flags: string[], name: string, derived: number, stored: number | null): void {
  if (stored === null) {
    flags.push(`stored ${name} is null (derived only)`);
    return;
  }
  const diff = Math.abs(derived - stored);
  const rel = Math.abs(stored) > 1e-9 ? diff / Math.abs(stored) : diff;
  if (diff > ABS_TOL && rel > REL_TOL) {
    flags.push(
      `⚠ stored ${name}=${r2(stored)} DISAGREES with derived ${r2(derived)} ` +
        `(Δ=${r2(diff)}) — ingestion pre-compute may use a different basis/formula`,
    );
  }
}

const unavailable = (
  key: string,
  label: string,
  unit: MetricValue["unit"],
  reason: MetricValue["reason"],
  detail: string,
  inputs: MetricValue["inputs"] = {},
): MetricValue => ({
  key, label, available: false, value: null, unit, source: "none",
  formula: detail, inputs, reason, flags: [],
});

// ── F1 ROCE % = EBIT / (net worth + total debt) × 100 ──────────────────────────
export function f1Roce(r: FoundationAnnual): MetricValue {
  const ebit = ebitFrom(r.profitBeforeTax, r.financeCosts);
  const nw = netWorthFrom(r);
  if (ebit === null) return unavailable("F1", "ROCE %", "%", "missing_line_item", "need PBT & finance costs");
  if (nw === null) return unavailable("F1", "ROCE %", "%", "missing_line_item", "need net worth");
  const debt = totalDebtFrom(r);
  // ⚠ ABSENCE IS NOT ZERO. `debt ?? 0` made capital employed = net worth alone,
  //   which OVERSTATES ROCE (a smaller denominator) on a company whose borrowings
  //   simply were not disclosed. crossCheck cannot catch it: `stored.roce` is
  //   computed from the same absent inputs, so both are wrong together.
  //   totalDebtFrom = sumNonNull(borrowingsCurrent, borrowingsNoncurrent) returns
  //   null ONLY when EVERY part is null, so null means NOTHING WAS DISCLOSED while
  //   0 means at least one part was reported and summed to zero. A genuinely
  //   debt-free company therefore still scores; only true absence goes unavailable.
  if (debt === null)
    return unavailable("F1", "ROCE %", "%", "missing_line_item",
      "borrowings not disclosed — capital employed is unknown (absence is not zero debt)",
      { ebit: r2(ebit), netWorth: r2(nw), totalDebt: null });
  const flags: string[] = [];
  const capEmployed = nw + debt;
  if (capEmployed === 0) return unavailable("F1", "ROCE %", "%", "divide_by_zero", "capital employed = 0");
  const value = (ebit / capEmployed) * 100;
  crossCheck(flags, "roce", value, r.stored.roce);
  return {
    key: "F1", label: "ROCE %", available: true, value, unit: "%", source: "derived",
    formula: `ROCE = EBIT ${r2(ebit)} / (net worth ${r2(nw)} + debt ${r2(debt)} = ${r2(capEmployed)}) × 100 = ${r2(value)}%`,
    inputs: { ebit: r2(ebit), netWorth: r2(nw), totalDebt: r2(debt), capitalEmployed: r2(capEmployed) },
    reason: null, flags,
  };
}

// ── F2 ROE % = net profit / net worth × 100 (SPEC def: year-end NW, not avg) ────
export function f2Roe(r: FoundationAnnual): MetricValue {
  const nw = netWorthFrom(r);
  if (r.netProfit === null) return unavailable("F2", "ROE %", "%", "missing_line_item", "need net profit");
  if (nw === null) return unavailable("F2", "ROE %", "%", "missing_line_item", "need net worth");
  if (nw === 0) return unavailable("F2", "ROE %", "%", "divide_by_zero", "net worth = 0");
  const value = (r.netProfit / nw) * 100;
  const flags = [
    "uses YEAR-END net worth per spec; stored `roe` uses 2-year AVERAGE equity, so stored will differ legitimately",
  ];
  // Intentionally do NOT cross-check against stored roe (different denominator).
  return {
    key: "F2", label: "ROE %", available: true, value, unit: "%", source: "derived",
    formula: `ROE = net profit ${r2(r.netProfit)} / net worth ${r2(nw)} × 100 = ${r2(value)}%`,
    inputs: { netProfit: r2(r.netProfit), netWorth: r2(nw), storedRoe_avgEquity: r.stored.roe },
    reason: null, flags,
  };
}

// ── F3 Cash Conversion = (OCF + Buyback) / PAT  (buyback inference §7.5.2) ──────
export function f3CashConversion(
  curr: FoundationAnnual,
  prior: FoundationAnnual | null,
  periodAvgPrice: number | null = null,
): MetricValue {
  const ocf = curr.cashFromOperating;
  const pat = curr.netProfit;
  if (ocf === null) return unavailable("F3", "Cash Conversion", "ratio", "missing_line_item", "need cash from operating");
  if (pat === null) return unavailable("F3", "Cash Conversion", "ratio", "missing_line_item", "need PAT (net profit)");
  if (pat === 0) return unavailable("F3", "Cash Conversion", "ratio", "divide_by_zero", "PAT = 0");

  const bb = inferBuyback(curr, prior, periodAvgPrice);
  const flags = [...bb.flags];
  if (pat < 0) flags.push("PAT < 0 — cash-conversion ratio is sign-distorted (loss year)");
  // If buyback path detected a reduction but the rupee amount is unquantifiable
  // (no period price), we use 0 for the value and flag it loudly.
  const buybackUsed = bb.amount ?? 0;
  const value = (ocf + buybackUsed) / pat;
  return {
    key: "F3", label: "Cash Conversion", available: true, value, unit: "ratio", source: "derived",
    formula: `CashConv = (OCF ${r2(ocf)} + buyback ${r2(buybackUsed)}) / PAT ${r2(pat)} = ${r2(value)}`,
    inputs: {
      ocf: r2(ocf), pat: r2(pat), buyback: bb.amount === null ? null : r2(bb.amount),
      buybackPath: bb.path, buybackDetail: bb.detail,
    },
    reason: null, flags,
  };
}

/** §7.5.2 buyback inference. Path order: (i) separable financing line [NOT in our
 *  schema], (ii) ΔEquity-Share-Capital × period price, (iii) confirmed zero. */
export function inferBuyback(
  curr: FoundationAnnual,
  prior: FoundationAnnual | null,
  periodAvgPrice: number | null,
): { amount: number | null; path: BuybackPath; detail: string; flags: string[] } {
  const flags: string[] = [];
  // (i) Financing-line: the schema's cashFromFinancing is a BUNDLED total with no
  // separable buyback/treasury line, so path (i) is structurally unavailable.
  flags.push("buyback path (i) financing-line unavailable: cashFromFinancing has no separable buyback line in schema");

  // (ii) Equity-share-capital change. A buyback that cancels shares REDUCES ESC.
  if (prior === null || curr.equityShareCapital === null || prior.equityShareCapital === null) {
    flags.push("buyback path (ii) indeterminate: missing prior-year or ESC → cannot confirm; treated as 0");
    return { amount: null, path: "indeterminate", detail: "no prior-year ESC to compare", flags };
  }
  const escDrop = prior.equityShareCapital - curr.equityShareCapital; // >0 ⇒ capital reduced
  const ESC_FLOOR = 0.01; // ₹Cr rounding floor — ignore sub-rounding wiggle
  if (escDrop <= ESC_FLOOR) {
    return {
      amount: 0, path: "confirmed_zero",
      detail: `ESC stable/up (${r2(prior.equityShareCapital)}→${r2(curr.equityShareCapital)}); no capital reduction`,
      flags,
    };
  }
  // ESC dropped → buyback / capital reduction signal. Quantify needs a price.
  if (periodAvgPrice === null || curr.faceValueShare === null || curr.faceValueShare === 0) {
    flags.push(
      `⚠ buyback DETECTED via ESC reduction (Δ=${r2(escDrop)} ₹Cr face) but UNQUANTIFIABLE: ` +
        `no buyback-period weighted-avg price feed (and/or face value) — rupee amount left null`,
    );
    return {
      amount: null, path: "equity_capital_change",
      detail: `ESC reduced by ${r2(escDrop)} ₹Cr (face); price feed missing → amount unquantified`,
      flags,
    };
  }
  // buyback ₹Cr = ΔESC(₹Cr face) × price(₹/sh) / faceValue(₹/sh)
  const amount = escDrop * (periodAvgPrice / curr.faceValueShare);
  return {
    amount, path: "equity_capital_change",
    detail: `ESC reduced ${r2(escDrop)} ₹Cr face × price ${periodAvgPrice}/face ${curr.faceValueShare} = ${r2(amount)} ₹Cr`,
    flags,
  };
}

// ── F4 D/E = total debt / net worth (RATIO) ────────────────────────────────────
export function f4DebtEquity(r: FoundationAnnual): MetricValue {
  const nw = netWorthFrom(r);
  const debt = totalDebtFrom(r);
  if (nw === null) return unavailable("F4", "D/E", "ratio", "missing_line_item", "need net worth");
  if (nw === 0) return unavailable("F4", "D/E", "ratio", "divide_by_zero", "net worth = 0");
  // ⚠ ABSENCE IS NOT ZERO — and here it was the worst possible direction: `debt ?? 0`
  //   yielded D/E = 0.00, the TOP band, so a leveraged company whose borrowings were
  //   not disclosed scored as debt-free with only a flags string dissenting. A flag
  //   does not move a band. See the F1 note for why null ≠ 0 in this column.
  if (debt === null)
    return unavailable("F4", "D/E", "ratio", "missing_line_item",
      "borrowings not disclosed — leverage is unknown (absence is not zero debt)",
      { totalDebt: null, netWorth: r2(nw), storedDebtToEquityPct: r.stored.debtToEquity });
  const flags: string[] = [];
  const value = debt / nw;
  // stored debtToEquity is a PERCENT (ratio×100) — compare against value×100.
  crossCheck(flags, "debtToEquity(%)", value * 100, r.stored.debtToEquity);
  return {
    key: "F4", label: "D/E", available: true, value, unit: "ratio", source: "derived",
    formula: `D/E = total debt ${r2(debt)} / net worth ${r2(nw)} = ${r2(value)}`,
    inputs: { totalDebt: r2(debt), netWorth: r2(nw), storedDebtToEquityPct: r.stored.debtToEquity },
    reason: null, flags,
  };
}

// ── F5 Interest Coverage (annual) = EBIT / finance costs ───────────────────────
export function f5InterestCoverage(r: FoundationAnnual): MetricValue {
  const ebit = ebitFrom(r.profitBeforeTax, r.financeCosts);
  if (ebit === null) return unavailable("F5", "Interest Coverage", "x", "missing_line_item", "need PBT & finance costs");
  if (r.financeCosts === null) return unavailable("F5", "Interest Coverage", "x", "missing_line_item", "need finance costs");
  if (r.financeCosts <= 0)
    return unavailable("F5", "Interest Coverage", "x", "divide_by_zero",
      `finance costs ${r2(r.financeCosts)} ≤ 0 → coverage undefined (effectively unconstrained)`,
      { ebit: r2(ebit), financeCosts: r2(r.financeCosts) });
  const value = ebit / r.financeCosts;
  const flags: string[] = [];
  crossCheck(flags, "interestCoverage", value, r.stored.interestCoverage);
  return {
    key: "F5", label: "Interest Coverage", available: true, value, unit: "x", source: "derived",
    formula: `IC = EBIT ${r2(ebit)} / finance costs ${r2(r.financeCosts)} = ${r2(value)}x`,
    inputs: { ebit: r2(ebit), financeCosts: r2(r.financeCosts) },
    reason: null, flags,
  };
}

// ── F6 Receivables Days = (trade receivables / revenue) × 365 ───────────────────
export function f6ReceivablesDays(r: FoundationAnnual): MetricValue {
  const recv = sumNonNull(r.tradeReceivablesCurrent, r.tradeReceivablesNoncurrent);
  if (recv === null) return unavailable("F6", "Receivables Days", "days", "missing_line_item", "need trade receivables");
  if (r.revenue === null) return unavailable("F6", "Receivables Days", "days", "missing_line_item", "need revenue");
  if (r.revenue === 0) return unavailable("F6", "Receivables Days", "days", "divide_by_zero", "revenue = 0");
  const value = (recv / r.revenue) * 365;
  const flags: string[] = [];
  crossCheck(flags, "receivablesDays", value, r.stored.receivablesDays);
  return {
    key: "F6", label: "Receivables Days", available: true, value, unit: "days", source: "derived",
    formula: `RecvDays = receivables ${r2(recv)} / revenue ${r2(r.revenue)} × 365 = ${r2(value)} days`,
    inputs: { tradeReceivables: r2(recv), revenue: r2(r.revenue) },
    reason: null, flags,
  };
}

// ── F7 Asset Turnover = revenue / total assets ─────────────────────────────────
export function f7AssetTurnover(r: FoundationAnnual): MetricValue {
  if (r.revenue === null) return unavailable("F7", "Asset Turnover", "x", "missing_line_item", "need revenue");
  if (r.totalAssets === null) return unavailable("F7", "Asset Turnover", "x", "missing_line_item", "need total assets");
  if (r.totalAssets === 0) return unavailable("F7", "Asset Turnover", "x", "divide_by_zero", "total assets = 0");
  const value = r.revenue / r.totalAssets;
  const flags: string[] = [];
  crossCheck(flags, "assetTurnover", value, r.stored.assetTurnover);
  return {
    key: "F7", label: "Asset Turnover", available: true, value, unit: "x", source: "derived",
    formula: `AssetTurn = revenue ${r2(r.revenue)} / total assets ${r2(r.totalAssets)} = ${r2(value)}x`,
    inputs: { revenue: r2(r.revenue), totalAssets: r2(r.totalAssets) },
    reason: null, flags,
  };
}

// ── F8 FCF/PAT — 4-YEAR AVERAGE OF RATIOS (avg of ratios, not ratio of avgs) ────
// Per-year FCF = OCF − CAPEX-PROXY, where the capex-proxy is the canonical balance-
// sheet derivation Capex = ΔNet Block + Depreciation + ΔCWIP (NOT the direct CF
// PP&E-purchase line `capex`, NOT full Investing Cash Flow). ΔNet Block / ΔCWIP need
// the PRIOR fiscal year, so a window year whose immediate predecessor is absent is
// skipped (flagged). CWIP absent in a year contributes ΔCWIP=0 (flagged). This makes
// the live value match the bar-derivation basis ("Capex=dNetBlock+Dep+dCWIP").
export const F8_WINDOW_YEARS = 4;
export function f8FcfPatAvg(rows: FoundationAnnual[], snapshotOrdinal: number): MetricValue {
  // Window = the 4 fiscal years ENDING at the snapshot (by calendar ordinal).
  const windowOrdinals = [0, 1, 2, 3].map((k) => snapshotOrdinal - k);
  const byOrd = new Map(rows.map((r) => [r.fyOrdinal, r]));
  const flags: string[] = [];
  const perYear: { fy: string; fcf: number; pat: number; ratio: number; capex: number }[] = [];
  const absentYears: number[] = [];
  const noPriorYears: number[] = [];
  for (const ord of windowOrdinals) {
    const row = byOrd.get(ord);
    if (!row) { absentYears.push(ord); continue; }
    const prior = byOrd.get(ord - 1) ?? null; // ΔNet Block / ΔCWIP need FY-1
    // Capex-proxy = ΔNet Block + Depreciation + ΔCWIP. Net Block & Depreciation are
    // essential; CWIP absent → its delta contributes 0 (flagged).
    if (prior === null || row.propertyPlantAndEquipment === null || prior.propertyPlantAndEquipment === null || row.depreciation === null) {
      if (prior === null) noPriorYears.push(ord);
      flags.push(`FY${ord}: skipped (capex-proxy needs FY-1 + net block + depreciation; one is absent)`);
      continue;
    }
    const dNetBlock = row.propertyPlantAndEquipment - prior.propertyPlantAndEquipment;
    let dCwip = 0;
    if (row.capitalWorkInProgress !== null && prior.capitalWorkInProgress !== null) {
      dCwip = row.capitalWorkInProgress - prior.capitalWorkInProgress;
    } else {
      flags.push(`FY${ord}: CWIP absent in a year → ΔCWIP treated as 0`);
    }
    const capexProxy = dNetBlock + row.depreciation + dCwip;
    const fcf = row.cashFromOperating !== null ? row.cashFromOperating - capexProxy : null;
    if (fcf === null || row.netProfit === null || row.netProfit === 0) {
      flags.push(`FY${ord}: skipped (OCF or PAT missing/zero)`);
      continue;
    }
    if (row.netProfit < 0) flags.push(`FY${ord}: PAT<0 — ratio ${(fcf / row.netProfit).toFixed(2)} sign-distorted`);
    perYear.push({ fy: row.fiscalYear, fcf, pat: row.netProfit, ratio: fcf / row.netProfit, capex: capexProxy });
  }
  if (absentYears.length > 0)
    flags.push(`standalone absent for ${absentYears.map((o) => "FY" + o).join(", ")} (excluded from the 4y window)`);
  const n = perYear.length;
  if (n === 0)
    return unavailable("F8", "FCF/PAT (4y avg)", "ratio",
      absentYears.length === F8_WINDOW_YEARS || noPriorYears.length > 0 ? "standalone_absent" : "missing_line_item",
      "no usable year in the trailing-4 window (capex-proxy needs net block + FY-1 + depreciation)", { windowYears: F8_WINDOW_YEARS, absent: absentYears.length });
  if (n < F8_WINDOW_YEARS) flags.push(`only ${n} of ${F8_WINDOW_YEARS} window years usable — averaged available N`);
  const value = perYear.reduce((a, b) => a + b.ratio, 0) / n;
  return {
    key: "F8", label: "FCF/PAT (4y avg)", available: true, value, unit: "ratio", source: "derived",
    formula: `mean of ${n} yearly (FCF/PAT), FCF=OCF−(ΔNetBlock+Dep+ΔCWIP): ${perYear.map((y) => `${y.fy} ${r2(y.fcf)}/${r2(y.pat)}=${r2(y.ratio)}`).join(" ; ")} → ${r2(value)}`,
    inputs: { nUsed: n, windowYears: F8_WINDOW_YEARS, years: perYear.map((y) => y.fy).join(","), capexBasis: "proxy:dNetBlock+Dep+dCWIP" },
    reason: null, flags,
  };
}

// ── F9 OCF Consistency % — % of trailing-window years with positive OCF ─────────
export const F9_WINDOW_YEARS = 5; // chosen consistency horizon (stated, count-based)
export function f9OcfConsistency(rows: FoundationAnnual[], snapshotOrdinal: number): MetricValue {
  const windowOrdinals = Array.from({ length: F9_WINDOW_YEARS }, (_, k) => snapshotOrdinal - k);
  const byOrd = new Map(rows.map((r) => [r.fyOrdinal, r]));
  const flags: string[] = [];
  let present = 0, positive = 0;
  const absentYears: number[] = [];
  const detail: string[] = [];
  for (const ord of windowOrdinals) {
    const row = byOrd.get(ord);
    if (!row || row.cashFromOperating === null) { absentYears.push(ord); continue; }
    present++;
    const pos = row.cashFromOperating > 0;
    if (pos) positive++;
    detail.push(`FY${ord}:${r2(row.cashFromOperating)}${pos ? "+" : "−"}`);
  }
  if (absentYears.length > 0)
    flags.push(`standalone absent (OCF unknown, excluded from denominator) for ${absentYears.map((o) => "FY" + o).join(", ")}`);
  if (present === 0)
    return unavailable("F9", "OCF Consistency %", "%", "standalone_absent", "no standalone OCF in the window",
      { windowYears: F9_WINDOW_YEARS });
  const value = (positive / present) * 100; // count-based % over PRESENT years
  flags.push(`count-based: ${positive}/${present} present years OCF>0 (window=${F9_WINDOW_YEARS}y; denominator = PRESENT years, not absent)`);
  return {
    key: "F9", label: "OCF Consistency %", available: true, value, unit: "%", source: "derived",
    formula: `OCFConsistency = ${positive} positive / ${present} present × 100 = ${r2(value)}% [${detail.join(" ")}]`,
    inputs: { positive, present, windowYears: F9_WINDOW_YEARS, absent: absentYears.length },
    reason: null, flags,
  };
}

// ── F10 Revenue 3y CAGR % = (rev_t / rev_{t-3})^(1/3) − 1 × 100 ─────────────────
export const F10_CAGR_YEARS = 3;
export function f10Revenue3yCagr(rows: FoundationAnnual[], snapshotOrdinal: number): MetricValue {
  const byOrd = new Map(rows.map((r) => [r.fyOrdinal, r]));
  const end = byOrd.get(snapshotOrdinal);
  const beginOrd = snapshotOrdinal - F10_CAGR_YEARS;
  const begin = byOrd.get(beginOrd);
  if (!end || end.revenue === null)
    return unavailable("F10", "Revenue 3y CAGR %", "%", "missing_line_item", "snapshot revenue missing");
  if (!begin)
    return unavailable("F10", "Revenue 3y CAGR %", "%", "standalone_absent",
      `standalone absent for begin year FY${beginOrd} (need rev 3y prior)`, { endFy: end.fiscalYear, beginFy: "FY" + beginOrd });
  if (begin.revenue === null)
    return unavailable("F10", "Revenue 3y CAGR %", "%", "missing_line_item", `begin year FY${beginOrd} revenue missing`);
  if (begin.revenue <= 0)
    return unavailable("F10", "Revenue 3y CAGR %", "%", "non_positive_base", `begin revenue ${r2(begin.revenue)} ≤ 0`);
  const value = (Math.pow(end.revenue / begin.revenue, 1 / F10_CAGR_YEARS) - 1) * 100;
  return {
    key: "F10", label: "Revenue 3y CAGR %", available: true, value, unit: "%", source: "derived",
    formula: `CAGR = (rev ${r2(end.revenue)} [${end.fiscalYear}] / rev ${r2(begin.revenue)} [${begin.fiscalYear}])^(1/3) − 1 = ${r2(value)}%`,
    inputs: { endRevenue: r2(end.revenue), beginRevenue: r2(begin.revenue), endFy: end.fiscalYear, beginFy: begin.fiscalYear },
    reason: null,
    flags: ["true CAGR (no cap here; the ≤10% intra-pillar WEIGHT cap is a pillar-layer concern, not a value cap)"],
  };
}

// ── F1_OPM Operating Margin % — PG8's EXTRA Foundation metric (EBITDA-based) ─────
// PG8 (Power/Utilities) scores Operating Margin as an ADDITIONAL Foundation metric
// (engine key F1_OPM) alongside ROCE (F1). The value REUSES the EBITDA-based
// operating margin already computed at ingestion (operatingMargin = EBITDA/Revenue
// ×100, from the STANDALONE row — the same column the rest of the engine reads);
// CN-8: no new derivation, no value tuned. Unit percent (matches the PG8 F1_OPM
// bars). This is NOT part of computeFoundation's universal F1..F10 list — only the
// PG-aware dispatch calls it, and only for a PG whose metric set contains F1_OPM
// (today: PG8). So the 11 standard non-financial PGs are entirely unaffected.
export function fOpmOperatingMargin(r: FoundationAnnual): MetricValue {
  const om = r.stored.operatingMargin;
  if (om === null)
    return unavailable("F1_OPM", "Operating Margin % (PG8)", "%", "missing_line_item",
      "stored operatingMargin (EBITDA/Revenue) is null on the standalone row",
      { ebitda: r.stored.ebitda, revenue: r.revenue });
  return {
    key: "F1_OPM", label: "Operating Margin % (PG8)", available: true, value: om, unit: "%",
    source: "stored_column",
    formula: `Operating Margin = EBITDA ${r.stored.ebitda === null ? "?" : r2(r.stored.ebitda)} / revenue ${r.revenue === null ? "?" : r2(r.revenue)} × 100 = ${r2(om)}% (stored standalone column)`,
    inputs: { operatingMargin: r2(om), ebitda: r.stored.ebitda === null ? null : r2(r.stored.ebitda), revenue: r.revenue === null ? null : r2(r.revenue) },
    reason: null,
    flags: ["F1_OPM = EBITDA-based operating margin (stored STANDALONE column EBITDA/Revenue×100); reused as PG8's 11th Foundation metric — CN-8: no new derivation"],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CHANGE 2.1 — FOUNDATION ON A ROLLING TWELVE MONTHS (v2)
//
// Six of the ten metrics are recomputed on a trailing twelve months instead of the last
// annual statement. THE SPLIT IS FORCED, NOT CHOSEN: quarterly operating cash flow and
// quarterly balance-sheet lines do not exist in this database (defect R31), so F3 cash
// conversion, F4 debt/equity, F8 FCF/PAT and F9 cash consistency CANNOT move and stay
// annual. That caps the fix at six of ten and is the honest half of cadence.
//
// THE CONSTRUCTION, per _tools/u-metrics.cjs TTM: the P&L NUMERATOR rolls every quarter;
// the balance-sheet DENOMINATOR stays at the most recent annual close. A 12-month
// numerator over a year-end base is scale-correct — a 3-month numerator would be a
// quarter of the true ratio.
//
// ★ WHY NO BAR MOVED. A rolling figure must MEAN the same thing as the annual figure it
//   replaces, or the ladders would have to be re-cut. Measured across all six metrics the
//   median TTM / annual ratio is 1.000. That check is what made this shippable, and it is
//   re-run as a Phase-2 gate rather than taken on trust.
//
// ★ THE DENOMINATOR IS FROZEN FOR THREE QUARTERS OF EVERY YEAR, and that is accepted, not
//   overlooked. F1/F2/F6/F7 take their denominator from the annual statement: 75% frozen in
//   Q1-Q3, 1% in Q4, which is the complete explanation of the Q4 concentration (40% of all
//   Foundation movement lands in one quarter). Two remedies were tested and BOTH rejected —
//   rolling the balance sheet forward on retained earnings cost -9.2/1000, resolved; and
//   carrying each annual change forward over four quarters was rejected on product grounds,
//   because smearing a known change forward makes the score misrepresent what it knows on
//   the day the annual report lands. The ranking is undamaged: tau against the Foundation
//   verdict is 0.667/0.675/0.686/0.671 across Q1-Q4, flat. (Addendum A.4.)

/** Sum a quarterly field over the last 4 of `run`; null if the run is short or any is null. */
function ttm4(run: MomentumQuarter[], pick: (q: MomentumQuarter) => number | null): number | null {
  if (run.length < 4) return null;
  let s = 0;
  for (const q of run.slice(-4)) {
    const v = pick(q);
    if (v === null) return null;
    s += v;
  }
  return s;
}

/** TTM EBIT = sum over 4 quarters of (PBT + interest). Quarterly `interest` IS the
 *  finance-costs line, so this is term-for-term the annual ebitFrom(PBT, financeCosts)
 *  the bars were cut on. */
const ttmEbit = (run: MomentumQuarter[]): number | null =>
  ttm4(run, (q) => (q.profitBeforeTax !== null && q.interest !== null ? q.profitBeforeTax + q.interest : null));

const shortRun = (key: string, label: string, unit: MetricValue["unit"], need: number, have: number): MetricValue =>
  unavailable(key, label, unit, "insufficient_history", `rolling ${key} needs ${need} consecutive quarters, have ${have}`, { consecutive: have });

/** F1 ROCE %, rolling. TTM EBIT over the ANNUAL capital employed. */
export function f1RoceTtm(r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  const e = ttmEbit(run);
  if (e === null) return shortRun("F1", "ROCE % (TTM)", "%", 4, run.length);
  const nw = netWorthFrom(r);
  if (nw === null) return unavailable("F1", "ROCE % (TTM)", "%", "missing_line_item", "need net worth");
  const debt = totalDebtFrom(r);
  if (debt === null)
    return unavailable("F1", "ROCE % (TTM)", "%", "missing_line_item",
      "borrowings not disclosed — capital employed is unknown (absence is not zero debt)",
      { ttmEbit: r2(e), netWorth: r2(nw), totalDebt: null });
  const ce = nw + debt;
  if (ce === 0) return unavailable("F1", "ROCE % (TTM)", "%", "divide_by_zero", "capital employed = 0");
  const value = (e / ce) * 100;
  return {
    key: "F1", label: "ROCE % (TTM)", available: true, value, unit: "%", source: "derived",
    formula: `ROCE = TTM EBIT ${r2(e)} / (net worth ${r2(nw)} + debt ${r2(debt)} = ${r2(ce)}) x 100 = ${r2(value)}%`,
    inputs: { ttmEbit: r2(e), netWorth: r2(nw), totalDebt: r2(debt), capitalEmployed: r2(ce), cadence: "ttm" },
    reason: null, flags: ["change 2.1: rolling numerator over the annual balance-sheet base"],
  };
}

/** F2 ROE %, rolling. TTM net profit over the ANNUAL year-end net worth. */
export function f2RoeTtm(r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  const p = ttm4(run, (q) => q.netProfit);
  if (p === null) return shortRun("F2", "ROE % (TTM)", "%", 4, run.length);
  const nw = netWorthFrom(r);
  if (nw === null) return unavailable("F2", "ROE % (TTM)", "%", "missing_line_item", "need net worth");
  if (nw === 0) return unavailable("F2", "ROE % (TTM)", "%", "divide_by_zero", "net worth = 0");
  const value = (p / nw) * 100;
  return {
    key: "F2", label: "ROE % (TTM)", available: true, value, unit: "%", source: "derived",
    formula: `ROE = TTM net profit ${r2(p)} / net worth ${r2(nw)} x 100 = ${r2(value)}%`,
    inputs: { ttmNetProfit: r2(p), netWorth: r2(nw), cadence: "ttm" },
    reason: null, flags: ["uses YEAR-END net worth per spec; change 2.1 rolls only the numerator"],
  };
}

/** F5 Interest Coverage, rolling. Wholly quarterly — no annual anchor. */
export function f5InterestCoverageTtm(_r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  const e = ttmEbit(run), f = ttm4(run, (q) => q.interest);
  if (e === null || f === null) return shortRun("F5", "Interest Coverage (TTM)", "x", 4, run.length);
  if (f <= 0)
    return unavailable("F5", "Interest Coverage (TTM)", "x", "divide_by_zero",
      `TTM finance costs ${r2(f)} <= 0 -> coverage undefined (effectively unconstrained)`,
      { ttmEbit: r2(e), ttmFinanceCosts: r2(f) });
  const value = e / f;
  return {
    key: "F5", label: "Interest Coverage (TTM)", available: true, value, unit: "x", source: "derived",
    formula: `IC = TTM EBIT ${r2(e)} / TTM finance costs ${r2(f)} = ${r2(value)}x`,
    inputs: { ttmEbit: r2(e), ttmFinanceCosts: r2(f), cadence: "ttm" },
    reason: null, flags: ["change 2.1: both legs roll - F5 needs no annual anchor"],
  };
}

/** F6 Receivables Days, rolling. ANNUAL receivables over TTM revenue.
 *  WARNING - this carries defect F6-inverted (Addendum A.3): the numerator is annual and
 *  the denominator rolls, so outside Q4 a revenue fall reads as a working-capital problem
 *  (83% of the movement is denominator-driven, median numerator share 0%). Recorded, not
 *  repaired: repairing it means moving the metric's definition, which is not a v2 change. */
export function f6ReceivablesDaysTtm(r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  const rev = ttm4(run, (q) => q.revenue);
  if (rev === null) return shortRun("F6", "Receivables Days (TTM)", "days", 4, run.length);
  const recv = sumNonNull(r.tradeReceivablesCurrent, r.tradeReceivablesNoncurrent);
  if (recv === null) return unavailable("F6", "Receivables Days (TTM)", "days", "missing_line_item", "need trade receivables");
  if (rev === 0) return unavailable("F6", "Receivables Days (TTM)", "days", "divide_by_zero", "TTM revenue = 0");
  const value = (recv / rev) * 365;
  return {
    key: "F6", label: "Receivables Days (TTM)", available: true, value, unit: "days", source: "derived",
    formula: `RecvDays = receivables ${r2(recv)} / TTM revenue ${r2(rev)} x 365 = ${r2(value)} days`,
    inputs: { tradeReceivables: r2(recv), ttmRevenue: r2(rev), cadence: "ttm" },
    reason: null, flags: ["change 2.1: annual receivables over a rolling revenue base - see defect F6-inverted"],
  };
}

/** F7 Asset Turnover, rolling. TTM revenue over ANNUAL total assets. */
export function f7AssetTurnoverTtm(r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  const rev = ttm4(run, (q) => q.revenue);
  if (rev === null) return shortRun("F7", "Asset Turnover (TTM)", "x", 4, run.length);
  if (r.totalAssets === null) return unavailable("F7", "Asset Turnover (TTM)", "x", "missing_line_item", "need total assets");
  if (r.totalAssets === 0) return unavailable("F7", "Asset Turnover (TTM)", "x", "divide_by_zero", "total assets = 0");
  const value = rev / r.totalAssets;
  return {
    key: "F7", label: "Asset Turnover (TTM)", available: true, value, unit: "x", source: "derived",
    formula: `AssetTurn = TTM revenue ${r2(rev)} / total assets ${r2(r.totalAssets)} = ${r2(value)}x`,
    inputs: { ttmRevenue: r2(rev), totalAssets: r2(r.totalAssets), cadence: "ttm" },
    reason: null, flags: ["change 2.1: rolling revenue over the annual asset base"],
  };
}

/** F10 Revenue 3y CAGR %, rolling. TTM-now against TTM three years back - wholly quarterly,
 *  so it needs SIXTEEN consecutive quarters (two windows twelve apart). */
export const F10_TTM_QUARTERS = 16;
export function f10Revenue3yCagrTtm(_r: FoundationAnnual, run: MomentumQuarter[]): MetricValue {
  if (run.length < F10_TTM_QUARTERS) return shortRun("F10", "Revenue 3y CAGR % (TTM)", "%", F10_TTM_QUARTERS, run.length);
  const now = ttm4(run, (q) => q.revenue);
  const then = ttm4(run.slice(0, run.length - 12), (q) => q.revenue);
  if (now === null || then === null) return unavailable("F10", "Revenue 3y CAGR % (TTM)", "%", "missing_line_item", "revenue null in a TTM window");
  if (then <= 0) return unavailable("F10", "Revenue 3y CAGR % (TTM)", "%", "non_positive_base", `TTM revenue 3y ago ${r2(then)} <= 0`);
  if (now <= 0) return unavailable("F10", "Revenue 3y CAGR % (TTM)", "%", "non_positive_base", `TTM revenue now ${r2(now)} <= 0`);
  const value = (Math.pow(now / then, 1 / F10_CAGR_YEARS) - 1) * 100;
  return {
    key: "F10", label: "Revenue 3y CAGR % (TTM)", available: true, value, unit: "%", source: "derived",
    formula: `CAGR = (TTM rev ${r2(now)} / TTM rev 3y ago ${r2(then)})^(1/3) - 1 = ${r2(value)}%`,
    inputs: { ttmRevenueNow: r2(now), ttmRevenue3yAgo: r2(then), cadence: "ttm" },
    reason: null,
    flags: ["change 2.1: TTM-vs-TTM twelve quarters apart; the <=10% intra-pillar WEIGHT cap is a pillar-layer concern, not a value cap"],
  };
}

/** The six metrics change 2.1 moves to a rolling twelve months. The other four (F3, F4, F8,
 *  F9) cannot move: their numerator or denominator needs quarterly cash flow or a quarterly
 *  balance sheet, and neither exists (R31). */
export const FOUNDATION_TTM: Record<string, (r: FoundationAnnual, run: MomentumQuarter[]) => MetricValue> = {
  F1: f1RoceTtm, F2: f2RoeTtm, F5: f5InterestCoverageTtm,
  F6: f6ReceivablesDaysTtm, F7: f7AssetTurnoverTtm, F10: f10Revenue3yCagrTtm,
};

// ── Aggregate: compute all 10 Foundation metrics at the latest standalone FY ─────
export interface FoundationResult {
  snapshotFy: string;
  metrics: MetricValue[];
}
export function computeFoundation(
  rows: FoundationAnnual[],
  periodAvgPrice: number | null = null,
): FoundationResult | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const snap = sorted[sorted.length - 1];
  const prior = sorted.find((r) => r.fyOrdinal === snap.fyOrdinal - 1) ?? null;
  return {
    snapshotFy: snap.fiscalYear,
    metrics: [
      f1Roce(snap),
      f2Roe(snap),
      f3CashConversion(snap, prior, periodAvgPrice),
      f4DebtEquity(snap),
      f5InterestCoverage(snap),
      f6ReceivablesDays(snap),
      f7AssetTurnover(snap),
      f8FcfPatAvg(sorted, snap.fyOrdinal),
      f9OcfConsistency(sorted, snap.fyOrdinal),
      f10Revenue3yCagr(sorted, snap.fyOrdinal),
    ],
  };
}
