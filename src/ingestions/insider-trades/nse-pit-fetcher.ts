// Fetches SEBI PIT V2.0 insider trading disclosures from NSE.
//
// NSE migrated insider trading to the "gg" endpoint around Apr 2026; the old
// /api/corporates-pit endpoint is frozen (200 + empty for recent dates).
//
// Two-step source:
//   1. /api/corporates-pit-gg  → a filing INDEX (one entry per disclosure),
//      via the shared NseClient (needs a browser session/cookies).
//   2. Each entry's `xmlFileName` → an XBRL document on nsearchives
//      (public CDN, no session) that holds the actual trade detail.
//
// NSE returns ALL filings across all stocks for the date range; we filter to
// our universe in the ingestion step (after the cheap index fetch, before the
// per-filing XBRL fetch).

import https from "https";
import { nseClient } from "../../lib/client.js";
import type { PitGgApiResponse, PitFilingIndex } from "./insider-types.js";
import { isFeedMalformed } from "./insider-guards.js";

const CHUNK_DAYS = 7;

// ── Date formatting (gg endpoint wants DD-MM-YYYY) ────────────────────────────
function formatNseDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

// ── Filing index fetch (gg endpoint) ──────────────────────────────────────────
export async function fetchFilingIndexForRange(
  fromDate: Date,
  toDate: Date,
  signal?: AbortSignal,
): Promise<{ filings: PitFilingIndex[]; malformed: boolean }> {
  const from = formatNseDate(fromDate);
  const to = formatNseDate(toDate);

  const path = `/api/corporates-pit-gg?index=equities&from_date=${from}&to_date=${to}`;
  console.log(`[PitFetcher] Fetching filing index ${from} → ${to}`);

  const response = await nseClient.get<PitGgApiResponse>(path, signal);

  if (!response || !Array.isArray(response.data)) {
    console.log(`[PitFetcher] No filing index for ${from} → ${to}`);
    // GUARD 1 (SHAPE): a response whose `data` isn't an array = malformed
    // feed (the empty-array trap) — distinct from a legit `data:[]` (quiet
    // day). The caller reports the malformed case with the run's fetchType.
    return { filings: [], malformed: isFeedMalformed(response) };
  }

  console.log(`[PitFetcher] Received ${response.data.length} filings`);
  return { filings: response.data, malformed: false };
}

export async function fetchFilingIndexForDate(
  date: Date,
  signal?: AbortSignal,
): Promise<{ filings: PitFilingIndex[]; malformed: boolean }> {
  return fetchFilingIndexForRange(date, date, signal);
}

// ── XBRL document fetch (public CDN, no session) ──────────────────────────────
export function fetchFilingXbrl(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Request aborted") as NodeJS.ErrnoException;
      err.name = "AbortError";
      reject(err);
      return;
    }
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.nseindia.com/",
        },
        signal,
      } as Parameters<typeof https.get>[1],
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`XBRL fetch HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("XBRL request timed out after 30s")));
  });
}

// ── Chunk range generator ──────────────────────────────────────────────────────
// Returns the ordered list of {chunkStart, chunkEnd} date pairs that cover
// [fromDate, toDate] in CHUNK_DAYS-sized windows. No network calls are made.
export function generateChunkRanges(
  fromDate: Date,
  toDate: Date,
): { chunkStart: Date; chunkEnd: Date }[] {
  const chunks: { chunkStart: Date; chunkEnd: Date }[] = [];
  const current = new Date(fromDate);

  while (current <= toDate) {
    const chunkStart = new Date(current);
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
    if (chunkEnd > toDate) chunkEnd.setTime(toDate.getTime());

    chunks.push({ chunkStart, chunkEnd });
    current.setDate(current.getDate() + CHUNK_DAYS);
  }

  return chunks;
}
