// src/parser/pit-parser.ts
// Normalisation helpers + the XBRL-row → InsiderTradeNormalized mapper.
//
// NSE PIT V2.0 (gg endpoint) data is messy:
// - Dates come as ISO "YYYY-MM-DD" (XBRL) or "DD-Mon-YYYY HH:MM:SS" (index)
// - Numbers come as strings (or blank or "N.A." or "Nil")
// - Person categories / transaction types / modes are free-text
//
// These helpers handle all of that so the ingestion layer stays clean.

import type {
  InsiderTradeNormalized,
  PersonCategory,
  TransactionType,
  SecurityType,
  AcquisitionMode,
  PitFilingIndex,
  PitXbrlRow,
} from "./insider-types.js";

// ── Date parsing ─────────────────────────────────────────────────────────────
// Handles three shapes seen across PIT V2.0:
//   - ISO          "2026-06-17"                (XBRL transaction dates)
//   - DD-Mon-YYYY  "19-Jun-2026" / "19-Jun-2026 23:09:12"  (gg index broadcast)
//   - DD-MM-YYYY   "19-06-2026"                (legacy)
const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseNseDate(str: string | null | undefined): Date | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A.") return null;

  // Strip any time component: "19-Jun-2026 23:09:12" → "19-Jun-2026"
  const datePart = str.trim().split(/[ T]/)[0];

  // ISO yyyy-mm-dd (XBRL)
  const iso = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const d = Number(iso[3]);
    if (month < 0 || month > 11 || d < 1 || d > 31) return null;
    const date = new Date(y, month, d);
    return isNaN(date.getTime()) ? null : date;
  }

  // DD-Mon-YYYY or DD-MM-YYYY
  const parts = datePart.split("-");
  if (parts.length !== 3) return null;

  const [dStr, mStr, yStr] = parts;
  const d = Number(dStr);
  const y = Number(yStr);
  if (isNaN(d) || isNaN(y) || d < 1 || d > 31) return null;

  let month: number;
  const mNum = Number(mStr);
  if (!isNaN(mNum)) {
    if (mNum < 1 || mNum > 12) return null;
    month = mNum - 1;
  } else {
    const mLower = mStr.toLowerCase();
    if (!(mLower in MONTH_MAP)) return null;
    month = MONTH_MAP[mLower];
  }

  const date = new Date(y, month, d);
  return isNaN(date.getTime()) ? null : date;
}

// ── Number parsing ────────────────────────────────────────────────────────────
export function parseBigIntSafe(str: string | null | undefined): bigint | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A." || str.toLowerCase() === "nil") {
    return null;
  }
  // XBRL sometimes emits decimals like "1921.00" for share counts
  const cleaned = str.replace(/,/g, "").trim().replace(/\.0+$/, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return BigInt(cleaned);
}

export function parseFloatSafe(str: string | null | undefined): number | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A.") return null;
  const n = parseFloat(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// ── Person category normalisation ─────────────────────────────────────────────
export function normalisePersonCategory(raw: string): PersonCategory {
  const s = raw.toLowerCase().trim();

  if (s.includes("promoter group") || s.includes("promoter grp")) return "promoter_group";
  if (s.includes("promoter")) return "promoter";
  if (s.includes("immediate relative") || s.includes("imm. relative")) return "immediate_relative";
  if (s.includes("managing director") || s.includes("md")) return "director";
  if (s.includes("director")) return "director";
  if (
    s.includes("key managerial") ||
    s.includes("kmp") ||
    s.includes("chief financial") ||
    s.includes("cfo") ||
    s.includes("company secretary") ||
    s.includes("cs ")
  ) {
    return "kmp";
  }
  if (s.includes("designated")) return "designated_employee";
  if (s.includes("employee")) return "designated_employee";

  // PIT V2.0 introduces "Connected Person" (Reg 7(3)) → no dedicated bucket
  return "other";
}

// ── Transaction type normalisation ───────────────────────────────────────────
export function normaliseTransactionType(raw: string): TransactionType {
  const s = raw.toLowerCase().trim();

  if (s.includes("pledge") && (s.includes("revoke") || s.includes("release"))) return "revoke_pledge";
  if (s.includes("pledge")) return "pledge";
  if (s.includes("inter") && s.includes("se")) return "inter_se_transfer";
  if (s.includes("esos") || s.includes("stock option") || s.includes("esop")) return "esos";
  if (s.includes("buy") || s.includes("purchase") || s.includes("acqui") || s === "b") return "buy";
  if (s.includes("sell") || s.includes("sale") || s.includes("disposal") || s.includes("dispos") || s === "s") {
    return "sell";
  }

  return "other";
}

// ── Security type normalisation ──────────────────────────────────────────────
export function normaliseSecurityType(raw: string): SecurityType {
  const s = raw.toLowerCase().trim();

  if (s.includes("warrant")) return "warrants";
  if (s.includes("convertible") || s.includes("debenture")) return "convertible_debentures";
  if (s.includes("equity") || s.includes("share") || s === "eq") return "equity_shares";

  return "other";
}

// ── Acquisition mode normalisation ──────────────────────────────────────────
export function normaliseAcquisitionMode(raw: string | null | undefined): AcquisitionMode | null {
  if (!raw || raw.trim() === "" || raw === "-") return null;
  const s = raw.toLowerCase().trim();

  if (s.includes("off market") || s.includes("off-market")) return "off_market";
  if (s.includes("preferential")) return "preferential_allotment";
  if (s.includes("inter") && s.includes("se")) return "inter_se_transfer";
  if (s.includes("esos") || s.includes("stock option") || s.includes("esop")) return "esos";
  if (s.includes("rights")) return "rights";
  // "Market Purchase" | "Market Sale" | "Open Market" | "Market"
  if (s.includes("market")) return "market";

  return "other";
}

// ── Regulation normalisation ─────────────────────────────────────────────────
// PIT V2.0 emits "Regulation 7 (2)" / "Regulation 7 (3)" / "Regulation 29 (1)".
// Collapse to the compact form: "7(2)", "7(3)", "29(1)", "30", "31".
export function normaliseRegulation(raw: string): string {
  if (!raw) return "";
  const compact = raw
    .replace(/regulation/i, "")
    .replace(/\s+/g, "")
    .trim();
  return compact || raw.trim();
}

// ── XBRL row → normalised record ─────────────────────────────────────────────
// Combines a filing-index entry (header) with one parsed XBRL disclosure row.
// Returns null if the row is fundamentally unusable (no person, no quantities).
export function normaliseXbrlRow(
  index: PitFilingIndex,
  row: PitXbrlRow,
  stockId: string,
  symbol: string,
): InsiderTradeNormalized | null {
  const personName = row.personName?.trim();
  if (!personName) return null;

  const intimationDate = parseNseDate(index.broadcastDateTime);
  if (!intimationDate) return null;

  // Guard: a future intimation date is impossible — disclosures can only happen
  // after a trade. NSE's gg index sometimes assigns bad broadcast dates to
  // pre-migration filings (appId="NA"). Reject rather than storing wrong data.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (intimationDate > tomorrow) {
    console.warn(
      `[pit-parser] Skipping ${symbol} / ${row.personName?.trim()} — future intimationDate ${
        intimationDate.toISOString().slice(0, 10)
      } (raw broadcastDateTime: "${index.broadcastDateTime}")`,
    );
    return null;
  }

  const securitiesPre = parseBigIntSafe(row.securitiesPre);
  const securitiesTraded = parseBigIntSafe(row.securitiesTraded);
  const securitiesPost = parseBigIntSafe(row.securitiesPost);

  // A row with no traded quantity and no person holding change is noise.
  if (securitiesTraded === null && securitiesPre === null && securitiesPost === null) {
    return null;
  }

  const holdingPctPre = parseFloatSafe(row.holdingPctPre);
  const holdingPctPost = parseFloatSafe(row.holdingPctPost);
  const holdingPctDelta =
    holdingPctPre !== null && holdingPctPost !== null
      ? parseFloat((holdingPctPost - holdingPctPre).toFixed(4))
      : null;

  // valueOfSecurity = total rupee value of the transaction.
  const value = parseFloatSafe(row.valueOfSecurity);
  const tradeValueCr = value !== null && value > 0 ? parseFloat((value / 1e7).toFixed(4)) : null;
  const tradePrice =
    value !== null && value > 0 && securitiesTraded !== null && securitiesTraded > 0n
      ? parseFloat((value / Number(securitiesTraded)).toFixed(2))
      : null;

  // Trade date: prefer the "to" date (execution / allotment), fall back to "from".
  const tradeDate = parseNseDate(row.tradeToDate) ?? parseNseDate(row.tradeFromDate);

  return {
    symbol,
    stockId,
    regulation: normaliseRegulation(index.regulation || ""),
    intimationDate,
    personName,
    personCategory: normalisePersonCategory(row.personCategory || ""),
    transactionType: normaliseTransactionType(row.transactionType || ""),
    securityType: normaliseSecurityType(row.securityType || ""),
    tradeDate,
    securitiesPre,
    securitiesTraded,
    securitiesPost,
    holdingPctPre,
    holdingPctPost,
    holdingPctDelta,
    tradePrice,
    tradeValueCr,
    acquisitionMode: normaliseAcquisitionMode(row.acquisitionMode),
    remarks: row.remarks?.trim() || null,
    exchangeRef: index.appId?.trim() || null,
  };
}

// ── Parse result (consumed by the ingester) ──────────────────────────────────
export interface ParseResult {
  records: InsiderTradeNormalized[];
  skippedCount: number; // parse failures (bad data)
  filteredCount: number; // filings whose symbol is not in our universe
  totalRaw: number; // total filings seen in the index
  feedMalformed: boolean; // GUARD 1: gg feed returned a non-array `data` (the trap)
}
