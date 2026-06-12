// src/types/insider.ts
// All types for the insider trading pipeline.
// Mirrors the Prisma schema exactly so there's no impedance mismatch.

// ─── Raw NSE API response ─────────────────────────────────────────────────────
// NSE PIT endpoint returns an array of these objects.
// Field names are exactly as returned by the API — ugly but accurate.
export interface NseInsiderRaw {
  symbol: string                  // "HDFCBANK"
  company: string                 // "HDFC Bank Limited"
  anex: string                    // regulation: "7(2)", "29(1)" etc. (NSE calls it "anex")
  acqName: string                 // "Sashidhar Jagdishan"
  personCategory: string          // "Promoter Group" | "Director" | "KMP" etc.
  intimDt: string                 // "20-Apr-2026" — intimation date (DD-Mon-YYYY)
  date: string                    // "20-Apr-2026 19:20" — trade date/time (sometimes blank)
  acqfromDt: string               // trade from date "18-Apr-2026"
  acqtoDt: string                 // trade to date
  befAcqSharesNo: string          // shares held before ("Nil" or number string)
  afterAcqSharesNo: string        // shares held after
  secAcq: string                  // securities acquired/disposed
  noOfSharesAcq?: string          // duplicate of secAcq in some responses
  secType: string                 // "Equity Shares"
  tdpTransactionType: string      // "Buy" | "Sell" | "Pledge" etc.
  befAcqSharesPer: string         // % holding before: "0.01"
  afterAcqSharesPer: string       // % holding after: "3.65"
  acqMode: string                 // "Preferential Offer" | "Market Purchase" etc.
  remarks: string                 // free text
  exchange: string                // NSE exchange ref (can be "NA")
  xbrl?: string                   // XBRL filing URL
  // Less common fields — may or may not be present
  pid?: string
  did?: string
  tkdAcqm?: string | null
  buyValue?: string
  sellValue?: string
  buyQuantity?: string
  sellquantity?: string
  secVal?: string
  securitiesTypePost?: string
  tdpDerivativeContractType?: string
  derivativeType?: string
  xbrlFileSize?: string
}

// ─── NSE API wrapper response ─────────────────────────────────────────────────
export interface NseInsiderApiResponse {
  data: NseInsiderRaw[]
  total: number
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
