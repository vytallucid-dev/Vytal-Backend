// src/types/insider.ts
// All types for the insider trading pipeline.
// Mirrors the Prisma schema exactly so there's no impedance mismatch.

// ─── NSE PIT V2.0 endpoint: /api/corporates-pit-gg ────────────────────────────
// NSE migrated insider trading disclosures to "PIT V2.0" around Apr 2026. The
// old /api/corporates-pit endpoint froze (returns 200 + empty for dates after
// ~02-May-2026). The gg endpoint returns a FILING INDEX — one entry per
// disclosure filing. The actual trade detail (acquirer, quantities, holdings,
// dates, mode) lives in the linked XBRL document, not in this JSON.
export interface PitFilingIndex {
  appId: string                   // unique filing id — used as exchangeRef / dedup hint
  symbol: string                  // "AXISBANK"
  companyName: string             // "Axis Bank Limited"
  regulation: string              // "Regulation 7 (2)"
  broadcastDateTime: string       // "19-Jun-2026 23:09:12" — NSE dissemination time
  exchdisstime?: string
  typeOfSubmission?: string       // "Original" | "Revised"
  revisionRemark?: string | null
  xmlFileName: string             // URL to the XBRL XML (the trade detail)
  ixbrl?: string                  // URL to the human-readable iXBRL HTML
  xbrlFileSize?: string
  ixbrlFileSize?: string
  prevAppId?: string | null
}

// ─── gg API wrapper response ──────────────────────────────────────────────────
export interface PitGgApiResponse {
  data: PitFilingIndex[]
}

// ─── A single parsed disclosure row from an XBRL filing ───────────────────────
// One filing (PitFilingIndex) can contain multiple disclosure rows
// (one per transaction), each keyed by an XBRL "DisclosureN" context.
export interface PitXbrlRow {
  personName: string | null
  personCategory: string | null   // raw, e.g. "Promoter Group" | "Connected Person"
  securityType: string | null     // raw "TypeOfInstrument", e.g. "Equity"
  transactionType: string | null  // raw "Buy" | "Sell"
  acquisitionMode: string | null  // raw "Market Purchase" | "Market Sale" | "ESOP" …
  tradeFromDate: string | null    // ISO "YYYY-MM-DD"
  tradeToDate: string | null      // ISO "YYYY-MM-DD"
  securitiesPre: string | null
  securitiesTraded: string | null
  securitiesPost: string | null
  holdingPctPre: string | null
  holdingPctPost: string | null
  valueOfSecurity: string | null  // total rupee value of the transaction
  remarks: string | null
}

// ─── Normalised record (after parsing) ───────────────────────────────────────
// Clean, typed, ready for DB insertion
export interface InsiderTradeNormalized {
  symbol: string
  stockId: string                 // resolved from symbol lookup

  regulation: string
  intimationDate: Date
  personName: string
  personCategory: PersonCategory

  transactionType: TransactionType
  securityType: SecurityType
  tradeDate: Date | null

  securitiesPre: bigint | null
  securitiesTraded: bigint | null
  securitiesPost: bigint | null

  holdingPctPre: number | null
  holdingPctPost: number | null
  holdingPctDelta: number | null

  tradePrice: number | null
  tradeValueCr: number | null

  acquisitionMode: AcquisitionMode | null

  remarks: string | null
  exchangeRef: string | null
}

// ─── Enums (normalised values) ────────────────────────────────────────────────
export type PersonCategory =
  | 'promoter'
  | 'promoter_group'
  | 'director'
  | 'kmp'
  | 'designated_employee'
  | 'immediate_relative'
  | 'other'

export type TransactionType =
  | 'buy'
  | 'sell'
  | 'pledge'
  | 'revoke_pledge'
  | 'inter_se_transfer'
  | 'esos'
  | 'other'

export type SecurityType =
  | 'equity_shares'
  | 'warrants'
  | 'convertible_debentures'
  | 'other'

export type AcquisitionMode =
  | 'market'
  | 'off_market'
  | 'preferential_allotment'
  | 'inter_se_transfer'
  | 'esos'
  | 'rights'
  | 'other'

// ─── Fetch job result ─────────────────────────────────────────────────────────
export interface FetchJobResult {
  fetchDate: Date
  fetchType: 'daily' | 'backfill' | 'manual'
  status: 'success' | 'partial' | 'failed' | 'no_data'
  totalFetched: number
  totalInserted: number
  totalSkipped: number
  totalFiltered: number
  error?: string
  durationMs: number
}

// ─── Backfill options ─────────────────────────────────────────────────────────
export interface BackfillOptions {
  fromDate: Date
  toDate: Date
  delayMs?: number    // delay between requests (rate limiting)
}
