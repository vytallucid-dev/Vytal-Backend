// ─────────────────────────────────────────────────────────────
// PriceProvider abstraction layer.
// Your ingestion service ONLY talks to this interface.
// Swap providers by changing PRICE_PROVIDER env var.
// ─────────────────────────────────────────────────────────────

// ── Core types ────────────────────────────────────────────────

export interface EodPrice {
  symbol: string; // NSE symbol e.g. "TCS"
  isin: string | null;
  date: Date; // trading date (UTC midnight)
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number | null;
  volume: bigint;
  tradedValue: number | null; // ₹ Cr (total traded value)
}

export interface PriceProviderResult {
  prices: EodPrice[];
  provider: string;
  fetchedAt: Date;
  errors: string[];
}

// ── Interface every provider must implement ───────────────────

export interface PriceProvider {
  readonly name: string;

  /**
   * Fetch EOD prices for a specific date.
   * Returns prices for ALL available stocks (bhavcopy-style)
   * or a filtered subset — ingestion layer handles universe filtering.
   */
  fetchEod(date: Date): Promise<PriceProviderResult>;

  /**
   * Health check — verify the provider is reachable.
   */
  ping(): Promise<boolean>;
}
