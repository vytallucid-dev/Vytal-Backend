// Fetches SEBI PIT insider trading disclosures from NSE.
//
// Uses the shared NseClient (nse-client.ts) — same session management
// pattern as block deals and corporate events pipelines.
//
// NSE Endpoint: /api/corporates-pit
// Params built into path string: index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
//
// NSE returns ALL disclosures across all stocks for the date range.
// We filter to our 100-stock universe in the ingestion step.

import { nseClient } from "../../lib/client.js";
import type { NseInsiderApiResponse, NseInsiderRaw } from "./insider-types.js";

const CHUNK_DAYS = 7;

// ── Date formatting ───────────────────────────────────────────────────────────
function formatNseDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

// ── Single range fetch ────────────────────────────────────────────────────────
export async function fetchInsiderTradesForRange(
  fromDate: Date,
  toDate: Date,
  signal?: AbortSignal,
): Promise<NseInsiderRaw[]> {
  const from = formatNseDate(fromDate);
  const to = formatNseDate(toDate);

  // Path with query params as a string — NseClient.get() takes a full path
  const path = `/api/corporates-pit?index=equities&from_date=${from}&to_date=${to}`;

  console.log(`[PitFetcher] Fetching ${from} → ${to}`);

  const response = await nseClient.get<NseInsiderApiResponse>(path, signal);

  // NSE returns empty object or null when no data for the period
  if (!response || !Array.isArray(response.data)) {
    console.log(`[PitFetcher] No data for ${from} → ${to}`);
    return [];
  }

  console.log(`[PitFetcher] Received ${response.data.length} records`);
  return response.data;
}

// ── Single day fetch (daily job) ──────────────────────────────────────────────
export async function fetchInsiderTradesForDate(
  date: Date,
  signal?: AbortSignal,
): Promise<NseInsiderRaw[]> {
  return fetchInsiderTradesForRange(date, date, signal);
}

// ── Chunk range generator ──────────────────────────────────────────────────────
// Returns the ordered list of {chunkStart, chunkEnd} date pairs that cover
// [fromDate, toDate] in CHUNK_DAYS-sized windows. No network calls are made.
// The job orchestrator uses this to drive the fetch → parse → insert loop.
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
