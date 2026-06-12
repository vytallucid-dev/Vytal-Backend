// ─────────────────────────────────────────────────────────────
// Step 1 of the shareholding pipeline:
// Hit NSE API to get the list of XBRL filing URLs for a stock.
//
// Endpoint (requires session):
//   /api/shareholding-patterns?symbol=TCS&segment=equities
//
// Returns metadata rows — one per quarter filed.
// Each row has the XBRL archive URL in the "action" field.
//
// Step 2 (parsing) is in xbrl-parser.ts
// ─────────────────────────────────────────────────────────────

import https from "https";
import { nseClient } from "../../lib/client.js";

// ── NSE response types ─────────────────────────────────────────

export interface NseShareholdingRow {
  symbol: string;
  companyName: string; // "Tata Consultancy Services Limited"
  promoter: string; // "71.77"  (promoter + promoter group %)
  public: string; // "28.23"  (public %)
  employeeTrust: string; // "0"
  asOnDate: string; // "31-DEC-2025"
  submissionDate: string; // "21-JAN-2026"
  xbrlUrl: string; // full XBRL XML URL (column "action")
}

interface NseShareholdingApiRow {
  symbol: string;
  name: string;
  date: string;
  submissionDate: string;
  xbrl: string;
  pr_and_prgrp: string;
  public_val: string;
  employeeTrusts: string;
}

// ── API caller ────────────────────────────────────────────────

/**
 * Fetch all shareholding filing metadata for a stock from NSE.
 * Returns one entry per quarter filed (typically 20+ quarters).
 * Each entry contains the XBRL URL which we then fetch separately.
 */
export async function fetchShareholdingIndex(
  symbol: string,
  signal?: AbortSignal,
): Promise<NseShareholdingRow[]> {
  const path = `/api/corporate-share-holdings-master?symbol=${encodeURIComponent(symbol)}&index=equities`;

  const data = await nseClient.get<NseShareholdingApiRow[]>(path, signal);

  if (!Array.isArray(data)) {
    throw new Error(`NSE shareholding index returned non-array for ${symbol}`);
  }

  return data
    .filter((row) => row.xbrl && row.xbrl.includes(".xml"))
    .map((row) => ({
      symbol: symbol.toUpperCase(),
      companyName: row.name ?? "",
      promoter: row.pr_and_prgrp ?? "0",
      public: row.public_val ?? "0",
      employeeTrust: row.employeeTrusts ?? "0",
      asOnDate: row.date ?? "",
      submissionDate: row.submissionDate ?? "",
      xbrlUrl: row.xbrl,
    }));
}

// ── XBRL XML fetcher ──────────────────────────────────────────
// The XBRL files are on nsearchives.nseindia.com — a static
// file server that does NOT require session cookies.

export function fetchXbrlXml(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Request aborted') as NodeJS.ErrnoException
      err.name = 'AbortError'
      reject(err)
      return
    }
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/xml,text/xml,*/*",
        },
        signal,
      } as Parameters<typeof https.get>[1],
      (res) => {
        if (res.statusCode === 404) {
          reject(new Error(`XBRL file not found: ${url}`));
          return;
        }
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`XBRL fetch HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(20_000, () =>
      req.destroy(new Error(`XBRL fetch timed out: ${url}`)),
    );
  });
}
