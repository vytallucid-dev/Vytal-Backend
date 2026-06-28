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
import { reportIngestionError } from "../../shared/ingestion-error.js";
import {
  PRICES_CRON,
  REQUIRED_BHAV_COLUMNS,
  MAX_PARSE_SKIP_RATE,
  checkShape,
  checkSkipRate,
  runRef,
} from "../prices-guards.js";

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

interface ParseResult {
  prices: EodPrice[];
  totalEq: number; // EQ-series rows seen (skipped + kept)
  skippedBadValue: number; // EQ rows dropped for NaN/≤0 required values
}

function parseBhavcopy(csvText: string, date: Date): ParseResult {
  const rows: BhavRow[] = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const prices: EodPrice[] = [];
  let totalEq = 0;
  let skippedBadValue = 0;

  for (const row of rows) {
    // Only equity series — skip BE, BL, SM, ST etc.
    if (row.SERIES.trim() !== "EQ") continue;
    totalEq++;

    const close = parseFloat(row.CLOSE_PRICE);
    const open = parseFloat(row.OPEN_PRICE);
    const high = parseFloat(row.HIGH_PRICE);
    const low = parseFloat(row.LOW_PRICE);
    const volume = row.TTL_TRD_QNTY
      ? parseInt(row.TTL_TRD_QNTY.replace(/,/g, ""), 10)
      : 0;

    // Skip rows with invalid core values (unchanged — GUARD 2 only COUNTS
    // these skips; it does not widen the drop criteria, which would alter
    // ingestion).
    if (isNaN(close) || isNaN(open) || close <= 0) {
      skippedBadValue++;
      continue;
    }

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

  return { prices, totalEq, skippedBadValue };
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

    const prices = await this.processBhavcopyBody(res.body, d);

    if (prices.length === 0) {
      errors.push("Parsed 0 prices from bhavcopy — check CSV format");
    }

    console.log(
      `[NseBhavcopy] Parsed ${prices.length} equity prices for ${d.toDateString()}`,
    );

    return { prices, provider: this.name, fetchedAt, errors };
  }

  // Shape-assert + parse + skip-check on a raw CSV body. Separated from
  // the HTTP fetch so the guards can be exercised against synthetic bodies
  // (see the dry-run harness) without any network. THROWS on shape failure
  // (the GUARD 1 reject); reports GUARD 1/2 violations as a side effect.
  async processBhavcopyBody(body: string, date: Date): Promise<EodPrice[]> {
    // ── GUARD 1: SHAPE (critical · source_code · REJECT + flag) ──
    // Specific-column assertion BEFORE row iteration. A missing/renamed
    // column means the parser would silently NaN→empty and look like a
    // closed market — so we REJECT (throw) rather than insert garbage.
    // The throw also lets fetchWithFallback try BSE; only if every
    // provider fails does the run log "failed".
    const headerLine = body.split(/\r?\n/, 1)[0] ?? "";
    const headerCols = headerLine.split(",").map((c) => c.trim());
    const missingCols = checkShape(headerCols);
    if (missingCols.length > 0) {
      await reportIngestionError({
        source: this.name,
        cron: PRICES_CRON,
        guardType: "shape",
        targetTable: "DailyPrice",
        severity: "critical",
        resolutionPath: "source_code",
        expected: `bhavcopy header to contain [${REQUIRED_BHAV_COLUMNS.join(", ")}]`,
        observed: `missing [${missingCols.join(", ")}] — header was [${headerCols.join(", ")}]`,
        detail:
          "NSE bhavcopy column rename/removal. Rejecting this fetch (would otherwise NaN→empty and masquerade as a market holiday).",
        runRef: runRef(date, this.name),
      });
      throw new Error(
        `NseBhavcopy shape assertion failed — missing columns: ${missingCols.join(", ")}`,
      );
    }

    const { prices, totalEq, skippedBadValue } = parseBhavcopy(body, date);

    // ── GUARD 2: SKIP-RATE (high · source_code · flag) ──
    // A spike in rows dropped for bad required values = silent data loss
    // (a parse break eating rows). Corroborated by a low totalInserted
    // (GUARD 3). Normal ≈ 0%.
    const skipRate = checkSkipRate(skippedBadValue, totalEq);
    if (skipRate != null) {
      await reportIngestionError({
        source: this.name,
        cron: PRICES_CRON,
        guardType: "null_rate", // batch-level skip variant (targetField null)
        targetTable: "DailyPrice",
        severity: "high",
        resolutionPath: "source_code",
        expected: `≤${(MAX_PARSE_SKIP_RATE * 100).toFixed(0)}% of EQ rows skipped for NaN/≤0 close/open`,
        observed: `${skippedBadValue}/${totalEq} (${(skipRate * 100).toFixed(1)}%) EQ rows skipped`,
        detail:
          "Parser dropped an unusual share of EQ rows — possible column shift or value corruption upstream of insert.",
        runRef: runRef(date, this.name),
      });
    }

    return prices;
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
