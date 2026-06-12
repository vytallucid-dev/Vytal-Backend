// ─────────────────────────────────────────────────────────────
// PRIMARY provider. Uses NSE's official end-of-day bhavcopy CSV.
//
// Published daily at ~6 PM IST after market close.
// URL: https://nsearchives.nseindia.com/products/content/
//      sec_bhavdata_full_DDMMYYYY.csv
//
// No API key. No session. No rate limits.
// One file = OHLCV for every NSE-listed equity.
// ─────────────────────────────────────────────────────────────

import https from "https";
import { parse as parseCsv } from "csv-parse/sync";
import type {
  PriceProvider,
  PriceProviderResult,
  EodPrice,
} from "./provider.js";

// ── URL builder ───────────────────────────────────────────────

function bhavUrl(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear());
  return `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dd}${mm}${yyyy}.csv`;
}

// ── HTTP fetch ────────────────────────────────────────────────

function httpsGetText(url: string): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,application/octet-stream,*/*",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () =>
      req.destroy(new Error("Bhavcopy request timed out")),
    );
  });
}

// ── Parser ────────────────────────────────────────────────────

interface BhavRow {
  SYMBOL: string;
  SERIES: string;
  OPEN_PRICE: string;
  HIGH_PRICE: string;
  LOW_PRICE: string;
  CLOSE_PRICE: string;
  LAST_PRICE: string;
  PREV_CLOSE: string;
  TTL_TRD_QNTY: string;
  TURNOVER_LACS: string;
  DATE1: string;
  NO_OF_TRADES: string;
  ISIN: string;
}

function parseBhavcopy(csvText: string, date: Date): EodPrice[] {
  const rows: BhavRow[] = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const prices: EodPrice[] = [];

  for (const row of rows) {
    // Only equity series — skip BE, BL, SM, ST etc.
    if (row.SERIES.trim() !== "EQ") continue;

    const close = parseFloat(row.CLOSE_PRICE);
    const open = parseFloat(row.OPEN_PRICE);
    const high = parseFloat(row.HIGH_PRICE);
    const low = parseFloat(row.LOW_PRICE);
    const volume = row.TTL_TRD_QNTY
      ? parseInt(row.TTL_TRD_QNTY.replace(/,/g, ""), 10)
      : 0;

    // Skip rows with invalid core values
    if (isNaN(close) || isNaN(open) || close <= 0) continue;

    const tradedValueCr = parseFloat(row.TURNOVER_LACS) / 100; // convert to Cr

    prices.push({
      symbol: row.SYMBOL.trim(),
      isin: row.ISIN?.trim() || null,
      date,
      open,
      high,
      low,
      close,
      prevClose: parseFloat(row.PREV_CLOSE) || null,
      volume: BigInt(isNaN(volume) ? 0 : volume),
      tradedValue: isNaN(tradedValueCr)
        ? null
        : Math.round(tradedValueCr * 100) / 100,
    });
  }

  return prices;
}

// ── Provider ──────────────────────────────────────────────────

export class NseBhavcopyCsvProvider implements PriceProvider {
  readonly name = "nse-bhavcopy-csv";

  async fetchEod(date: Date): Promise<PriceProviderResult> {
    const fetchedAt = new Date();
    const errors: string[] = [];

    // Normalise to UTC midnight
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);

    const url = bhavUrl(d);
    console.log(`[NseBhavcopy] Fetching: ${url}`);

    const res = await httpsGetText(url);

    if (res.status === 404) {
      // Market was closed that day (holiday/weekend)
      return {
        prices: [],
        provider: this.name,
        fetchedAt,
        errors: [`No bhavcopy for ${d.toDateString()} — market likely closed`],
      };
    }

    if (res.status !== 200) {
      throw new Error(`NseBhavcopy returned HTTP ${res.status} for ${url}`);
    }

    if (!res.body.includes("SYMBOL") || !res.body.includes("CLOSE")) {
      throw new Error(`NseBhavcopy response doesn't look like a valid CSV`);
    }

    const prices = parseBhavcopy(res.body, d);

    if (prices.length === 0) {
      errors.push("Parsed 0 prices from bhavcopy — check CSV format");
    }

    console.log(
      `[NseBhavcopy] Parsed ${prices.length} equity prices for ${d.toDateString()}`,
    );

    return { prices, provider: this.name, fetchedAt, errors };
  }

  async ping(): Promise<boolean> {
    try {
      // Check if yesterday's bhavcopy URL is reachable
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const url = bhavUrl(yesterday);
      const res = await httpsGetText(url);
      return res.status === 200 || res.status === 404; // 404 = holiday, still reachable
    } catch {
      return false;
    }
  }
}
