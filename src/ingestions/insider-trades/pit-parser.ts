// src/parser/pit-parser.ts
// Normalises raw NSE PIT response into clean, typed InsiderTradeNormalized records.
//
// NSE data is messy:
// - Dates come as DD-MM-YYYY strings (or blank)
// - Numbers come as strings (or blank or "N.A.")
// - Person categories are free-text with inconsistent capitalisation
// - Transaction types are free-text
//
// This parser handles all of that so the ingestion layer stays clean.

import type {
  NseInsiderRaw,
  InsiderTradeNormalized,
  PersonCategory,
  TransactionType,
  SecurityType,
  AcquisitionMode,
} from "./insider-types.js";

// ── Date parsing ─────────────────────────────────────────────────────────────
// NSE uses DD-Mon-YYYY (e.g. "20-Apr-2026") or DD-Mon-YYYY HH:MM for some fields.
// Some older fields may use DD-MM-YYYY. Both are handled below.
const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseNseDate(str: string | null | undefined): Date | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A.") return null;

  // Strip time component if present: "20-Apr-2026 19:20" → "20-Apr-2026"
  const datePart = str.trim().split(" ")[0];
  const parts = datePart.split("-");
  if (parts.length !== 3) return null;

  const [dStr, mStr, yStr] = parts;
  const d = Number(dStr);
  const y = Number(yStr);
  if (isNaN(d) || isNaN(y) || d < 1 || d > 31) return null;

  // Numeric month (DD-MM-YYYY) or abbreviated name (DD-Mon-YYYY)
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
  if (isNaN(date.getTime())) return null;

  return date;
}

// ── Number parsing ────────────────────────────────────────────────────────────
function parseBigInt(str: string | null | undefined): bigint | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A." || str.toLowerCase() === "nil") return null;
  const cleaned = str.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  return BigInt(cleaned);
}

function parseFloat2(str: string | null | undefined): number | null {
  if (!str || str.trim() === "" || str === "-" || str === "N.A.") return null;
  const n = parseFloat(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// ── Person category normalisation ─────────────────────────────────────────────
function normalisePersonCategory(raw: string): PersonCategory {
  const s = raw.toLowerCase().trim();

  if (s.includes("promoter group") || s.includes("promoter grp")) {
    return "promoter_group";
  }
  if (s.includes("promoter")) return "promoter";
  if (s.includes("immediate relative") || s.includes("imm. relative")) {
    return "immediate_relative";
  }
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

  return "other";
}

// ── Transaction type normalisation ───────────────────────────────────────────
function normaliseTransactionType(raw: string): TransactionType {
  const s = raw.toLowerCase().trim();

  if (s.includes("pledge") && (s.includes("revoke") || s.includes("release"))) {
    return "revoke_pledge";
  }
  if (s.includes("pledge")) return "pledge";
  if (s.includes("inter") && s.includes("se")) return "inter_se_transfer";
  if (s.includes("esos") || s.includes("stock option") || s.includes("esop")) {
    return "esos";
  }
  if (
    s.includes("buy") ||
    s.includes("purchase") ||
    s.includes("acqui") ||
    s === "b"
  ) {
    return "buy";
  }
  if (
    s.includes("sell") ||
    s.includes("sale") ||
    s.includes("disposal") ||
    s.includes("dispos") ||
    s === "s"
  ) {
    return "sell";
  }

  return "other";
}

// ── Security type normalisation ──────────────────────────────────────────────
function normaliseSecurityType(raw: string): SecurityType {
  const s = raw.toLowerCase().trim();

  if (s.includes("warrant")) return "warrants";
  if (s.includes("convertible") || s.includes("debenture")) {
    return "convertible_debentures";
  }
  if (s.includes("equity") || s.includes("share") || s === "eq") {
    return "equity_shares";
  }

  return "other";
}

// ── Acquisition mode normalisation ──────────────────────────────────────────
function normaliseAcquisitionMode(
  raw: string | null | undefined,
): AcquisitionMode | null {
  if (!raw || raw.trim() === "" || raw === "-") return null;
  const s = raw.toLowerCase().trim();

  if (
    s.includes("market purchase") ||
    s.includes("open market") ||
    s === "market"
  ) {
    return "market";
  }
  if (s.includes("off market") || s.includes("off-market")) return "off_market";
  if (s.includes("preferential")) return "preferential_allotment";
  if (s.includes("inter") && s.includes("se")) return "inter_se_transfer";
  if (s.includes("esos") || s.includes("stock option")) return "esos";
  if (s.includes("rights")) return "rights";

  return "other";
}

// ── Regulation normalisation ─────────────────────────────────────────────────
function normaliseRegulation(raw: string): string {
  const s = raw.trim();
  // Map common variations
  const map: Record<string, string> = {
    "7(2)": "7(2)",
    "7 (2)": "7(2)",
    "reg 7(2)": "7(2)",
    "29(1)": "29(1)",
    "29 (1)": "29(1)",
    "29(2)": "29(2)",
    "30": "30",
    "reg 30": "30",
    "31": "31",
    "reg 31": "31",
  };
  return map[s.toLowerCase()] ?? s;
}

// ── Main parser ───────────────────────────────────────────────────────────────
// Returns null if the record is fundamentally unparseable.
// Partial data (missing optional fields) is still returned — never reject valid data.
export function parseInsiderTradeRecord(
  raw: NseInsiderRaw,
  stockIdMap: Map<string, string>, // symbol → stockId
): InsiderTradeNormalized | null {
  // Symbol is mandatory
  const symbol = raw.symbol?.trim().toUpperCase();
  if (!symbol) return null;

  // Check if this stock is in our universe
  const stockId = stockIdMap.get(symbol);
  if (!stockId) return null; // Not in our universe — will be counted as filtered

  // Intimation date is mandatory
  const intimationDate = parseNseDate(raw.intimDt);
  if (!intimationDate) {
    console.warn(
      `[PitParser] Cannot parse intimation date for ${symbol}: ${raw.intimDt}`,
    );
    return null;
  }

  // Validate we have at least a person name
  const personName = raw.acqName?.trim();
  if (!personName) return null;

  // Parse quantities
  const securitiesPre = parseBigInt(raw.befAcqSharesNo);
  const securitiesTraded = parseBigInt(raw.secAcq || raw.noOfSharesAcq);
  const securitiesPost = parseBigInt(raw.afterAcqSharesNo);

  // Parse holding percentages
  const holdingPctPre = parseFloat2(raw.befAcqSharesPer);
  const holdingPctPost = parseFloat2(raw.afterAcqSharesPer);
  const holdingPctDelta =
    holdingPctPre !== null && holdingPctPost !== null
      ? parseFloat((holdingPctPost - holdingPctPre).toFixed(4))
      : null;

  // Trade value: NSE provides secVal = total rupee value of the transaction.
  // tradeValueCr = secVal / 1e7 (rupees → crore)
  // tradePrice   = secVal / securitiesTraded (per-share price)
  const secValRaw = parseFloat2(raw.secVal);
  const tradeValueCr =
    secValRaw !== null && secValRaw > 0
      ? parseFloat((secValRaw / 1e7).toFixed(4))
      : null;
  const tradePrice =
    secValRaw !== null && secValRaw > 0 && securitiesTraded !== null && securitiesTraded > 0n
      ? parseFloat((secValRaw / Number(securitiesTraded)).toFixed(2))
      : null;

  return {
    symbol,
    stockId,
    regulation: normaliseRegulation(raw.anex || ""),
    intimationDate,
    personName,
    personCategory: normalisePersonCategory(raw.personCategory || ""),
    transactionType: normaliseTransactionType(raw.tdpTransactionType || ""),
    securityType: normaliseSecurityType(raw.secType || ""),
    tradeDate: parseNseDate(raw.date),
    securitiesPre,
    securitiesTraded,
    securitiesPost,
    holdingPctPre,
    holdingPctPost,
    holdingPctDelta,
    tradePrice,
    tradeValueCr,
    acquisitionMode: normaliseAcquisitionMode(raw.acqMode),
    remarks: raw.remarks?.trim() || null,
    exchangeRef: raw.exchange?.trim() || null,
  };
}

// ── Batch parser ──────────────────────────────────────────────────────────────
export interface ParseResult {
  records: InsiderTradeNormalized[];
  skippedCount: number; // parse failures (bad data)
  filteredCount: number; // not in our universe
  totalRaw: number;
}

export function parseInsiderTradesBatch(
  rawRecords: NseInsiderRaw[],
  stockIdMap: Map<string, string>,
): ParseResult {
  let skippedCount = 0;
  let filteredCount = 0;
  const records: InsiderTradeNormalized[] = [];

  for (const raw of rawRecords) {
    const symbol = raw.symbol?.trim().toUpperCase();

    // Check universe membership before full parse (fast path)
    if (symbol && !stockIdMap.has(symbol)) {
      filteredCount++;
      continue;
    }

    const parsed = parseInsiderTradeRecord(raw, stockIdMap);
    if (!parsed) {
      skippedCount++;
      continue;
    }

    records.push(parsed);
  }

  return {
    records,
    skippedCount,
    filteredCount,
    totalRaw: rawRecords.length,
  };
}
