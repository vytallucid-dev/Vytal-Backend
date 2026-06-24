// ─────────────────────────────────────────────────────────────
// IndexProvider abstraction — sibling of the equity PriceProvider.
// The ingestion service only talks to this interface.
//
// NOTE: unlike equities (NSE primary + BSE fallback), there is no
// second source for the NSE index archive, so there is no fallback
// chain — the single provider is called directly by the ingest.
// ─────────────────────────────────────────────────────────────

// ── Core types ────────────────────────────────────────────────

export interface IndexEodValue {
  indexName: string; // "Nifty 50", "Nifty Bank", "Nifty IT" …
  date: Date; // trading date (UTC midnight)
  // OHL are nullable: G-Sec / rate / USD indices publish only a close
  // (open/high/low arrive as "-" in the file).
  open: number | null;
  high: number | null;
  low: number | null;
  close: number; // always present — rows without a close are skipped
  pointsChange: number | null;
  changePct: number | null;
  volume: bigint | null;
  turnover: number | null; // ₹ Cr
  pe: number | null;
  pb: number | null;
  divYield: number | null;
}

export interface IndexProviderResult {
  values: IndexEodValue[];
  /** Rows dropped during parse (no valid close). */
  skipped: number;
  source: string;
  fetchedAt: Date;
  errors: string[];
}

// ── Interface every index provider must implement ─────────────

export interface IndexProvider {
  readonly name: string;

  /** Fetch EOD index values for a specific date (one archive file = all indices). */
  fetchEod(date: Date): Promise<IndexProviderResult>;

  /** Health check — verify the archive endpoint is reachable. */
  ping(): Promise<boolean>;
}
