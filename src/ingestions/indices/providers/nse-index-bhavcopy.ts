// ─────────────────────────────────────────────────────────────
// NSE INDEX bhavcopy (ind_close_all) provider.
//
// SEPARATE archive from the equity bhavcopy. One file per day,
// one row per NSE index, with OHLC + P/E + P/B + Div Yield.
// Published daily at ~6-7 PM IST after market close.
//
// URL: https://nsearchives.nseindia.com/content/indices/
//      ind_close_all_DDMMYYYY.csv
//
// Columns (verbatim header):
//   Index Name, Index Date, Open Index Value, High Index Value,
//   Low Index Value, Closing Index Value, Points Change, Change(%),
//   Volume, Turnover (Rs. Cr.), P/E, P/B, Div Yield
//
// Missing values arrive as "-" (e.g. G-Sec / rate / USD indices
// publish only a close). Decimals may drop the leading zero
// ("-.35", ".19") — parseFloat handles both.
//
// The HTTP transport (native https.get, headers, 30s timeout,
// 404 → market-closed) MIRRORS the equity nse-bhavcopy provider;
// only the URL path and the CSV columns differ.
// ─────────────────────────────────────────────────────────────

import https from "https";
import { parse as parseCsv } from "csv-parse/sync";
import type {
  IndexProvider,
  IndexProviderResult,
  IndexEodValue,
} from "./provider.js";

// ── URL builder ───────────────────────────────────────────────

function indexUrl(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear());
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}${mm}${yyyy}.csv`;
}

// ── HTTP fetch (identical transport to the equity bhavcopy provider) ──

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
      req.destroy(new Error("Index bhavcopy request timed out")),
    );
  });
}

// ── Parse helpers ─────────────────────────────────────────────
// "-" and "" → null. Strips commas; tolerates dropped-leading-zero
// decimals ("-.35"). Anything non-finite → null.

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || t === "-") return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function big(v: string | undefined): bigint | null {
  const n = num(v);
  if (n == null) return null;
  return BigInt(Math.round(n));
}

// ── Parser ────────────────────────────────────────────────────

interface IndexRow {
  "Index Name": string;
  "Index Date": string;
  "Open Index Value": string;
  "High Index Value": string;
  "Low Index Value": string;
  "Closing Index Value": string;
  "Points Change": string;
  "Change(%)": string;
  Volume: string;
  "Turnover (Rs. Cr.)": string;
  "P/E": string;
  "P/B": string;
  "Div Yield": string;
}

function parseIndexBhavcopy(
  csvText: string,
  date: Date,
): { values: IndexEodValue[]; skipped: number } {
  const rows: IndexRow[] = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const values: IndexEodValue[] = [];
  let skipped = 0;

  for (const row of rows) {
    const name = (row["Index Name"] ?? "").trim();
    const close = num(row["Closing Index Value"]);

    // close is the one essential field — skip rows that lack it.
    if (!name || close == null || close <= 0) {
      skipped++;
      continue;
    }

    values.push({
      indexName: name,
      date, // canonical fetch date (mirrors the equity pipeline — ignores the file's own date col)
      open: num(row["Open Index Value"]),
      high: num(row["High Index Value"]),
      low: num(row["Low Index Value"]),
      close,
      pointsChange: num(row["Points Change"]),
      changePct: num(row["Change(%)"]),
      volume: big(row.Volume),
      turnover: num(row["Turnover (Rs. Cr.)"]),
      pe: num(row["P/E"]),
      pb: num(row["P/B"]),
      divYield: num(row["Div Yield"]),
    });
  }

  return { values, skipped };
}

// ── Provider ──────────────────────────────────────────────────

export class NseIndexCsvProvider implements IndexProvider {
  readonly name = "nse-index-csv";

  async fetchEod(date: Date): Promise<IndexProviderResult> {
    const fetchedAt = new Date();
    const errors: string[] = [];

    // Normalise to UTC midnight
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);

    const url = indexUrl(d);
    console.log(`[NseIndex] Fetching: ${url}`);

    const res = await httpsGetText(url);

    if (res.status === 404) {
      // Market was closed that day (holiday/weekend) — no archive published.
      return {
        values: [],
        skipped: 0,
        source: this.name,
        fetchedAt,
        errors: [`No index archive for ${d.toDateString()} — market likely closed`],
      };
    }

    if (res.status !== 200) {
      throw new Error(`NseIndex returned HTTP ${res.status} for ${url}`);
    }

    if (!res.body.includes("Index Name") || !res.body.includes("Closing Index Value")) {
      throw new Error(`NseIndex response doesn't look like a valid CSV`);
    }

    const { values, skipped } = parseIndexBhavcopy(res.body, d);

    if (values.length === 0) {
      errors.push("Parsed 0 index values — check CSV format");
    }

    console.log(
      `[NseIndex] Parsed ${values.length} index values (${skipped} skipped) for ${d.toDateString()}`,
    );

    return { values, skipped, source: this.name, fetchedAt, errors };
  }

  async ping(): Promise<boolean> {
    try {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const res = await httpsGetText(indexUrl(yesterday));
      return res.status === 200 || res.status === 404; // 404 = holiday, still reachable
    } catch {
      return false;
    }
  }
}

// ── Single-source fetch (no fallback chain — only NSE publishes this) ──

const provider = new NseIndexCsvProvider();

export function fetchIndexBhavcopy(date: Date): Promise<IndexProviderResult> {
  return provider.fetchEod(date);
}
