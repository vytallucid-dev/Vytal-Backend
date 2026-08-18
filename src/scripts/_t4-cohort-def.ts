// ═══════════════════════════════════════════════════════════════
// T4a — THE PILOT COHORT. 27 stocks, each with a stated reason.
// Shared by the snapshot, run and verify scripts so all three agree.
// ═══════════════════════════════════════════════════════════════

export interface CohortEntry {
  symbol: string;
  group: string;
  why: string;
}

export const COHORT: CohortEntry[] = [
  // ── the three dry-run cases: live results must match the T2d predictions ──
  { symbol: "SIEMENS", group: "Capital Goods", why: "T2d case — both bases every year; ALSO a September fiscal-year-end (odd period boundaries)" },
  { symbol: "COLPAL", group: "FMCG", why: "T2d case + CONTROL — files standalone only; behaviour must be byte-identical to before" },
  { symbol: "SUNPHARMA", group: "Pharma", why: "T2d case — mixed; 2 rows/period except FY21 where NSE has no consolidated" },

  // ── banking: the fix has NEVER been exercised on this path ──
  { symbol: "HDFCBANK", group: "Private Banks", why: "banking — largest private bank; must land in banking_* tables" },
  { symbol: "SBIN", group: "PSU Banks", why: "banking — largest PSU bank, different filer conventions" },
  { symbol: "ICICIBANK", group: "Private Banks", why: "banking — second private filer, cross-checks HDFCBANK" },
  { symbol: "AUBANK", group: "Private Banks", why: "banking + ODD — holds sa6/co0, the in-banking analogue of COLPAL" },

  // ── known gaps / odd filing patterns ──
  { symbol: "UPL", group: "Specialty Chemicals", why: "ODD — sa=0/co=5, ZERO standalone annual rows today; the defect at its worst" },
  { symbol: "ADANIGREEN", group: "Power", why: "ODD — sa=0/co=5, zero standalone; second instance, different sector" },
  { symbol: "ABB", group: "Capital Goods", why: "ODD — December fiscal-year-end; period keying differs from March filers" },
  { symbol: "NESTLEIND", group: "FMCG", why: "ODD — December FYE; also holds only co1, an unusual thin history" },
  { symbol: "VBL", group: "Consumer", why: "ODD — December FYE, third calendar-year filer" },

  // ── peer-group spread (one per PG not already represented) ──
  { symbol: "TCS", group: "IT Services", why: "T1b listing sample — both bases FY19-FY24 known from discovery" },
  { symbol: "DLF", group: "Real Estate", why: "T1b listing sample — has a standalone-only year (FY19) mid-history" },
  { symbol: "RELIANCE", group: "Oil & Gas", why: "PG spread — largest conglomerate, deepest subsidiary tree" },
  { symbol: "TATASTEEL", group: "Metals & Mining", why: "PG spread" },
  { symbol: "MARUTI", group: "Auto OEMs", why: "PG spread" },
  { symbol: "BHARATFORG", group: "Auto Ancillaries", why: "PG spread" },
  { symbol: "ULTRACEMCO", group: "Cement", why: "PG spread" },
  { symbol: "HAVELLS", group: "Consumer Durables", why: "PG spread" },
  { symbol: "BEL", group: "Defense", why: "PG spread" },
  { symbol: "APOLLOHOSP", group: "Hospitals", why: "PG spread" },
  { symbol: "ASIANPAINT", group: "Paints", why: "PG spread" },
  { symbol: "NTPC", group: "Power & Utilities", why: "PG spread" },
  { symbol: "TITAN", group: "Retail & Apparel", why: "PG spread" },
  { symbol: "PIDILITIND", group: "Specialty Chemicals", why: "PG spread" },
  { symbol: "BHARTIARTL", group: "Telecom", why: "PG spread" },
];

// ── The window, derived from the Jan-2022 snapshot target (Aman's ruling) ──
// ⚠ backfillLegacySymbol applies ONE fromDate to BOTH legs. The annual leg needs
//   the earlier date (2017-04-01, asking for FY18 onward), so that is what is
//   passed. The quarterly leg therefore receives a SUPERSET of its own
//   2018-10-01 requirement; NSE's XBRL floor is expected to truncate it anyway,
//   and the measured result is reported rather than assumed.
export const FROM_DATE = "2017-04-01";
// ⚠ THE ONLY PROTECTION for v3-era rows. T3d: the legacy path hardcodes the
//   "ingest" decision, never consults decideIngest, and would stamp
//   nse_xbrl_*_legacy over good v3 rows. 2025-01-31 sits in the clean gap
//   between the legacy ceiling (2024-12-31) and the v3 floor (2025-03-31).
export const TO_DATE = "2025-01-31";
