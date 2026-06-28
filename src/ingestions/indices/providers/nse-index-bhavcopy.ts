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
import { reportIngestionError } from "../../shared/ingestion-error.js";
import {
  INDEX_CRON,
  INDEX_SOURCE,
  MAX_SKIP_RATE,
  REQUIRED_INDEX_COLUMNS,
  checkShape,
  checkSkipRate,
  indexRunRef,
} from "../indices-guards.js";

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

    const { values, skipped } = await this.processIndexBody(res.body, d);

    if (values.length === 0) {
      errors.push("Parsed 0 index values — check CSV format");
    }

    console.log(
      `[NseIndex] Parsed ${values.length} index values (${skipped} skipped) for ${d.toDateString()}`,
    );

    return { values, skipped, source: this.name, fetchedAt, errors };
  }

  // Shape-assert + parse + skip-check on a raw CSV body. Separated from the
  // HTTP fetch so the guards can be exercised against synthetic bodies (the
  // dry-run) without network. THROWS on shape failure (GUARD 1 reject);
  // reports GUARD 1/2 violations as a side effect.
  async processIndexBody(
    body: string,
    date: Date,
  ): Promise<{ values: IndexEodValue[]; skipped: number }> {
    // ── GUARD 1: SHAPE (critical · source_code · REJECT) ──
    // Specific-column assertion over the exact parser-read set — replaces
    // the old substring check that let an Open/High/Low/Change/P-E/P-B/
    // Div-Yield rename through to silent nulls. Reject (throw) rather than
    // store contentless rows; no fallback source, so this lands as "failed".
    const headerLine = body.split(/\r?\n/, 1)[0] ?? "";
    const headerCols = headerLine.split(",").map((c) => c.trim());
    const missingCols = checkShape(headerCols);
    if (missingCols.length > 0) {
      await reportIngestionError({
        source: INDEX_SOURCE,
        cron: INDEX_CRON,
        guardType: "shape",
        targetTable: "IndexPrice",
        severity: "critical",
        resolutionPath: "source_code",
        expected: `index header to contain [${REQUIRED_INDEX_COLUMNS.join(", ")}]`,
        observed: `missing [${missingCols.join(", ")}] — header was [${headerCols.join(", ")}]`,
        detail:
          "NSE ind_close_all column rename/removal. Rejecting this fetch (would otherwise null the column silently).",
        runRef: indexRunRef(date),
      });
      throw new Error(
        `NseIndex shape assertion failed — missing columns: ${missingCols.join(", ")}`,
      );
    }

    const { values, skipped } = parseIndexBhavcopy(body, date);

    // ── GUARD 2: SKIP-RATE (high · source_code · flag) ──
    // A spike in dropped rows = a value-parse break. If it drops EVERY row
    // (skipped=N, values=0) it would masquerade as a market holiday — this
    // catches that before the ingest declares market_closed. Normal ~0%.
    const skipRate = checkSkipRate(skipped, skipped + values.length);
    if (skipRate != null) {
      await reportIngestionError({
        source: INDEX_SOURCE,
        cron: INDEX_CRON,
        guardType: "null_rate", // batch-level skip variant (targetField null)
        targetTable: "IndexPrice",
        severity: "high",
        resolutionPath: "source_code",
        expected: `≤${(MAX_SKIP_RATE * 100).toFixed(0)}% of rows skipped for no-valid-close`,
        observed: `${skipped}/${skipped + values.length} (${(skipRate * 100).toFixed(1)}%) rows skipped`,
        detail:
          "Unusual share of index rows dropped — a value-parse break (possibly masquerading as a holiday).",
        runRef: indexRunRef(date),
      });
    }

    return { values, skipped };
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
