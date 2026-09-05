// File: src/scoring/bars-loader/label-map.ts
//
// THE TRANSCRIPTION-RISK GUARD (Phase 6 loader, handoff §2).
//
// vytal_pg_bars.json carries metric LABELS that are inconsistent across PGs
// ("ROCE (%)" / "ROCE" / "N1_ROCE" / "ROCE %") and a `specMetricKey` that is
// UNRELIABLE: it is null in PG1/PG3/PG4, POSITIONAL in banking (PG5/PG6 key
// Tier-1 as "F1", GNPA as "F2" — colliding with the non-financial F1=ROCE,
// F2=ROE), and IDIOSYNCRATIC in PG8 ("N1_ROCE", "F3_DE" where F3 actually means
// D/E). So we NEVER trust specMetricKey — we map the LABEL to the engine's
// canonical key, scoped by (industryType, pillar), through an EXPLICIT,
// reviewable alias table that enumerates every real label form. Anything not in
// the table is an UNMAPPED label → the load FAILS for that PG (handoff §2:
// "Do NOT guess silently").
//
// This module is PURE (no DB, no I/O). It is the single source for:
//   • the engine canonical metric-key REGISTRY (valid keys + their expected unit
//     and direction — the second transcription cross-check), and
//   • the label→key resolver.
//
// CN-8: nothing here is tuned. The unit/direction a metric's bars are expressed
// in is a fixed property of the engine metric, asserted against the JSON at load.

/** Engine units (mirror of MetricUnit in scoring/metrics/types.ts, sans n/a). */
export type EngineUnit = "%" | "ratio" | "x" | "days" | "years";

export type Pillar = "foundation" | "momentum";
export type IndustryType = "non_financial" | "banking";
export type BarDirection = "higher_better" | "lower_better";

/** One engine canonical metric. The `unit`/`direction` here are the ENGINE's
 *  fixed truth; the loader hard-asserts the JSON's unit/direction match these
 *  (a ratio metric whose bars arrive labelled "percent" is exactly the §8
 *  silent-corruption path, caught here at load). */
export interface CanonicalMetric {
  key: string;
  label: string; // canonical human label (for the review printout)
  unit: EngineUnit;
  direction: BarDirection;
  pillar: Pillar;
  industry: IndustryType;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ HOW **VYTAL** COMPUTES IT, WHERE A READER'S PRIOR WOULD BE WRONG.
   *
   * ⚠ THIS EXISTS BECAUSE THE MODEL IS ABOUT TO EXPLAIN THESE MEASURES. Meta may hand a metric to the
   *   model for the GENERAL half — what it measures, why it matters — and a general explanation of
   *   ROCE would most likely describe a PRE-depreciation version. Vytal's is EBIT-based and
   *   post-depreciation. The reader would then learn a definition that does not match the number on
   *   their screen, which is worse than no definition at all. So the basis is authored, code-supplied
   *   and NOT the model's to write.
   *
   * ★ AUTHORED WHERE THE BASIS IS NON-OBVIOUS, NOT EVERYWHERE. ROE = net profit / net worth and
   *   D/E = debt / net worth are what anyone would assume; a line on each would be padding, and
   *   padding is how the one line that matters gets skimmed. `undefined` means "conventional".
   *
   * ⚠ THE PAIR THIS IS REALLY FOR IS THE EBIT/EBITDA SPLIT INSIDE ONE PRODUCT. ROCE (F1) and interest
   *   coverage (F5/M5) are POST-depreciation; operating margin (F1_OPM/M1) is EBITDA-based and
   *   therefore PRE-depreciation. `momentum.ts` states it outright. Homogenising the two would be a
   *   silent re-rating of every company, so both sides carry a line.
   *
   * ★ EVERY STRING HERE IS COPIED FROM THE SCORING CODE'S OWN `formula`, not restated from memory —
   *   see `metrics/foundation.ts` and `metrics/momentum.ts`. Where they disagree, the code is right
   *   and this is the bug.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  vytalBasis?: string;
}

// ── Engine canonical key REGISTRY ───────────────────────────────────────────────
// Non-financial Foundation F1..F10 + the PG8-only F1_OPM (Power scores Operating
// Margin as a foundation metric in addition to ROCE). Momentum M1..M5 + the
// PG8-only M1_OPM_TTM. Banking Tier1/GNPA/NNPA/PCR/ROA/CI/CASA (foundation) +
// NIM/PPOP/NII/NPyoy/GNPAttm (momentum).
const M = (
  key: string, label: string, unit: EngineUnit, direction: BarDirection,
  pillar: Pillar, industry: IndustryType,
  /** See `CanonicalMetric.vytalBasis` — omitted where the basis is the conventional one. */
  vytalBasis?: string,
): CanonicalMetric => ({ key, label, unit, direction, pillar, industry, vytalBasis });

export const CANONICAL_METRICS: CanonicalMetric[] = [
  // Non-financial Foundation
  M("F1", "ROCE", "%", "higher_better", "foundation", "non_financial",
    // foundation.ts:66 — EBIT / (net worth + total debt) × 100, EBIT = PBT + finance costs.
    "Vytal computes ROCE as EBIT divided by capital employed, where EBIT is profit before tax plus " +
    "finance costs — so it is AFTER depreciation — and capital employed is net worth plus total debt. " +
    "Many published definitions use a pre-depreciation figure, which gives a higher number."),
  M("F2", "ROE", "%", "higher_better", "foundation", "non_financial"),
  M("F3", "Cash Conversion", "ratio", "higher_better", "foundation", "non_financial",
    // foundation.ts — (OCF + buyback) / PAT. The buyback add-back is ours and nobody would assume it.
    "Vytal computes cash conversion as operating cash flow PLUS any buyback outflow, divided by " +
    "profit after tax. The buyback is added back because it is a return of capital rather than a " +
    "failure to convert profit into cash."),
  M("F4", "Debt/Equity", "ratio", "lower_better", "foundation", "non_financial"),
  M("F5", "Interest Coverage", "x", "higher_better", "foundation", "non_financial",
    // foundation.ts:220 — EBIT / finance costs, the same post-depreciation EBIT as ROCE.
    "Vytal computes interest coverage as EBIT divided by finance costs, using the same " +
    "post-depreciation EBIT as ROCE. A definition based on EBITDA would give a higher number."),
  M("F6", "Receivables Days", "days", "lower_better", "foundation", "non_financial"),
  M("F7", "Asset Turnover", "x", "higher_better", "foundation", "non_financial"),
  M("F8", "FCF/PAT (4y avg)", "ratio", "higher_better", "foundation", "non_financial",
    // foundation.ts — FCF = OCF − (ΔNetBlock + Dep + ΔCWIP), averaged over four years.
    "Vytal derives free cash flow as operating cash flow minus capital spending, where capital " +
    "spending is reconstructed as the change in net block plus depreciation plus the change in " +
    "capital work in progress. It is then averaged against profit after tax over four years."),
  M("F9", "OCF Consistency", "%", "higher_better", "foundation", "non_financial"),
  M("F10", "Revenue 3y CAGR", "%", "higher_better", "foundation", "non_financial"),
  M("F1_OPM", "Operating Margin (PG8)", "%", "higher_better", "foundation", "non_financial",
    // foundation.ts:391 — EBITDA / revenue. ⚠ THE OPPOSITE SIDE OF THE SPLIT FROM ROCE AND F5.
    "Vytal computes operating margin on an EBITDA basis — BEFORE depreciation — which is the " +
    "opposite convention to ROCE and interest coverage in the same product. That is deliberate and " +
    "the two must not be read as though they share a basis."),
  // Non-financial Momentum
  M("M1", "TTM Operating Margin", "%", "higher_better", "momentum", "non_financial",
    // momentum.ts — Σ(PBT + interest + depreciation) / Σrevenue, i.e. EBITDA, over trailing 12 months.
    "Vytal computes this on an EBITDA basis — profit before tax plus interest plus depreciation, " +
    "over the trailing twelve months — so it is BEFORE depreciation, unlike ROCE and interest " +
    "coverage."),
  M("M2", "TTM Net Margin", "%", "higher_better", "momentum", "non_financial"),
  M("M3", "Revenue YoY (TTM)", "%", "higher_better", "momentum", "non_financial"),
  M("M4", "Net Profit YoY (TTM)", "%", "higher_better", "momentum", "non_financial"),
  M("M5", "TTM Interest Coverage", "x", "higher_better", "momentum", "non_financial",
    // momentum.ts:26 — ΣEBIT / Σinterest over the trailing twelve months, post-depreciation.
    "Vytal computes this as trailing-twelve-month EBIT divided by trailing-twelve-month interest, " +
    "after depreciation — the same basis as the annual measure."),
  M("M1_OPM_TTM", "TTM Operating Margin (PG8)", "%", "higher_better", "momentum", "non_financial"),
  // Banking Foundation
  M("Tier1", "Tier-1 Capital", "%", "higher_better", "foundation", "banking"),
  M("GNPA", "Gross NPA", "%", "lower_better", "foundation", "banking"),
  M("NNPA", "Net NPA", "%", "lower_better", "foundation", "banking"),
  M("PCR", "Provision Coverage Ratio", "%", "higher_better", "foundation", "banking"),
  M("ROA", "Return on Assets", "%", "higher_better", "foundation", "banking"),
  M("CI", "Cost-to-Income", "%", "lower_better", "foundation", "banking"),
  M("CASA", "CASA Ratio", "%", "higher_better", "foundation", "banking"),
  // Banking Momentum
  M("NIM", "Net Interest Margin (TTM)", "%", "higher_better", "momentum", "banking"),
  M("PPOP", "Pre-Provision Operating Profit YoY", "%", "higher_better", "momentum", "banking"),
  M("NII", "Net Interest Income YoY", "%", "higher_better", "momentum", "banking"),
  M("NPyoy", "Net Profit YoY", "%", "higher_better", "momentum", "banking"),
  M("GNPAttm", "Gross NPA (TTM)", "%", "lower_better", "momentum", "banking"),
];

const REGISTRY: Map<string, CanonicalMetric> = new Map(
  CANONICAL_METRICS.map((m) => [m.key, m]),
);

/** Look up a canonical metric by engine key (null if unknown). */
export const canonicalMetric = (key: string): CanonicalMetric | null =>
  REGISTRY.get(key) ?? null;

/** The engine-authoritative unit a metric's bars are expressed in. Used by the
 *  §8 unit-match guard as the BAR-SET unit (the loader has already proven the
 *  JSON agrees with this at load time). Throws on an unknown key. */
export function expectedUnit(metricKey: string): EngineUnit {
  const m = REGISTRY.get(metricKey);
  if (!m) throw new Error(`expectedUnit: unknown engine metric key "${metricKey}"`);
  return m.unit;
}

/** The engine-authoritative direction for a metric key (null if unknown). */
export const expectedDirection = (metricKey: string): BarDirection | null =>
  REGISTRY.get(metricKey)?.direction ?? null;

// ── JSON unit → engine unit ─────────────────────────────────────────────────────
// The source file writes "percent" / "times"; the engine speaks "%" / "x".
export const KNOWN_JSON_UNITS = ["percent", "ratio", "times", "days", "years"] as const;
export type JsonUnit = (typeof KNOWN_JSON_UNITS)[number];

const JSON_UNIT_TO_ENGINE: Record<JsonUnit, EngineUnit> = {
  percent: "%",
  ratio: "ratio",
  times: "x",
  days: "days",
  years: "years",
};

export const isKnownJsonUnit = (u: string): u is JsonUnit =>
  (KNOWN_JSON_UNITS as readonly string[]).includes(u);

/** Normalize a JSON unit string to an engine unit. null if not a known unit. */
export const toEngineUnit = (jsonUnit: string): EngineUnit | null =>
  isKnownJsonUnit(jsonUnit) ? JSON_UNIT_TO_ENGINE[jsonUnit] : null;

// ── Label normalization ─────────────────────────────────────────────────────────
// Lower-case; drop parenthetical qualifiers ("(%)", "(x)", "(annual)", "(TTM…)");
// drop section refs (§7.5.1) and version refs (v5.1.2); strip all non-alphanumerics.
//
// VERSION-TOKEN STRIP (hardened): the strip removes a genuine version TOKEN
// ("v5.1.2", a standalone "v" + digits) but must NEVER clip a "v<digit>" sequence
// that lives INSIDE a content word — e.g. "Rev3yCAGR" must stay "rev3ycagr", NOT
// become "reycagr". The negative lookbehind `(?<![a-z])` anchors the strip to a
// token boundary: it fires only when the "v" is not immediately preceded by a
// letter (so after a space, paren, or start-of-string — where a real version ref
// sits), and is inert on the "v" inside "Re[v]enue" / "Re[v3]yCAGR". This keeps
// the explicit alias table the authoritative resolver while making the normalizer
// a SAFE fallback rather than a silent-corruption trap (CN-8: correctness only —
// no scoring value changes).
export function normalizeLabel(label: string): string {
  return String(label)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // parenthetical qualifiers
    .replace(/§\S*/g, " ") // section refs
    .replace(/(?<![a-z])v\d[\d.]*/g, " ") // version refs (boundary-anchored — not "v<digit>" inside a word)
    .replace(/[^a-z0-9]+/g, ""); // everything else
}

// ── The EXPLICIT alias table (handoff §2 "explicit, reviewable mapping") ─────────
// Keyed `${industry}|${pillar}` → { normalizedLabel: canonicalKey }. EVERY entry
// was derived from a real label present in vytal_pg_bars.json (v5.5.1) and is
// listed so a reviewer can audit each label→key decision. Add a row here ONLY
// after eyeballing the source label it covers.
type AliasTable = Record<string, Record<string, string>>;

export const LABEL_ALIASES: AliasTable = {
  "non_financial|foundation": {
    roce: "F1",
    roe: "F2",
    cashconv: "F3", cashconversion: "F3", cashconvpat: "F3", cashconversionpat: "F3",
    de: "F4", deratio: "F4",
    ic: "F5", intcov: "F5", interestcov: "F5", interestcoverage: "F5",
    recvd: "F6", recvdays: "F6", receivabledays: "F6", receivablesdays: "F6",
    asstt: "F7", assetturn: "F7", assetturnover: "F7",
    fcfpat: "F8", fcf4y: "F8", fcfpat4y: "F8", fcfpat4yavg: "F8",
    ocfcons: "F9", ocfconsist: "F9", ocfconsistency: "F9",
    // Revenue-3y-CAGR forms, now normalized correctly (intra-word "v3" preserved):
    //   "Rev3yCAGR"→rev3ycagr · "Rev3yC %"→rev3yc · "Revenue 3y CAGR (%)"→revenue3ycagr
    //   "Rev 3y CAGR (%)"→rev3ycagr · "3y Rev CAGR (%)"→3yrevcagr · "3-Year Revenue CAGR"→3yearrevenuecagr
    rev3yc: "F10", rev3ycagr: "F10", revenue3ycagr: "F10",
    "3yrevcagr": "F10", "3yearrevenuecagr": "F10",
    opm: "F1_OPM", // PG8 only — Operating Margin scored as a foundation metric
  },
  "non_financial|momentum": {
    ttmopm: "M1", ttmoperatingmargin: "M1",
    opmttm: "M1_OPM_TTM", // PG8 only — sscu-bearing OPM momentum
    ttmnpm: "M2", ttmnetmargin: "M2", ttmnetprofitmargin: "M2", npmttm: "M2",
    revyoy: "M3", revyoyann: "M3", revyoyttm: "M3", revenueyoy: "M3",
    npyoy: "M4", npyoyann: "M4", npyoyttm: "M4", netprofityoy: "M4",
    ttmic: "M5", ttmintcov: "M5", ttminterestcov: "M5", ttminterestcoverage: "M5",
  },
  "banking|foundation": {
    tier1: "Tier1",
    gnpa: "GNPA",
    nnpa: "NNPA",
    pcr: "PCR",
    roa: "ROA",
    ci: "CI",
    casa: "CASA",
  },
  "banking|momentum": {
    nimttm: "NIM",
    ppopyoy: "PPOP",
    niiyoy: "NII",
    npyoy: "NPyoy", // banking-scoped: "NP YoY %" here → NPyoy (NOT the non-fin M4)
    gnpattm: "GNPAttm",
  },
};

export interface LabelResolution {
  ok: boolean;
  rawLabel: string;
  normalized: string;
  key: string | null; // null when unmapped
  reason: string | null; // set when !ok
}

/** Resolve a metric LABEL to its engine canonical key for a given industry+pillar.
 *  Returns { ok:false, key:null } when the normalized label is not in the explicit
 *  alias table (the caller FAILS the PG load and names it). Pure. */
export function resolveMetricKey(
  industry: IndustryType,
  pillar: Pillar,
  rawLabel: string,
): LabelResolution {
  const normalized = normalizeLabel(rawLabel);
  const table = LABEL_ALIASES[`${industry}|${pillar}`];
  const key = table?.[normalized] ?? null;
  if (!key) {
    return {
      ok: false, rawLabel, normalized, key: null,
      reason: `unmapped label "${rawLabel}" (normalized "${normalized}") in ${industry}/${pillar} — add an explicit alias→key entry after review`,
    };
  }
  // Defensive: the alias must point at a real registered key in this industry+pillar.
  const cm = REGISTRY.get(key);
  if (!cm || cm.industry !== industry || cm.pillar !== pillar) {
    return {
      ok: false, rawLabel, normalized, key,
      reason: `alias "${normalized}"→"${key}" does not resolve to a ${industry}/${pillar} canonical metric (registry corruption)`,
    };
  }
  return { ok: true, rawLabel, normalized, key, reason: null };
}
