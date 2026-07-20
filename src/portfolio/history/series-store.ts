// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY SERIES STORE (Step 21) — the read/write face of `instrument_price_history`.
//
// WRITE is append-only + idempotent (ON CONFLICT DO NOTHING via skipDuplicates): re-running a
// backfill or the weekly refresh inserts only genuinely-new weeks, and the DB's AFTER INSERT
// trigger trims each instrument to its newest 4 years — so this module never has to prune, and can
// never make the table exceed 4y. (Ruling R2: constant by construction.)
//
// READ returns the stored weekly points per instrument, ascending — the historical portion of a
// blended chart. The LIVE final point is NOT here; the chart controllers pin it from
// price-resolver.ts at request time so the endpoint equals the overview (Ruling C).
// ─────────────────────────────────────────────────────────────────────────────
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import type { SeriesPoint } from "./weekly-sample.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Provenance of a stored point. A corrected fund NAV vs a raw-but-clean exchange close. */
export type SeriesSource = "nav_corrected" | "market_close";

const isoToDate = (iso: string) => new Date(iso + "T00:00:00Z");
const dateToIso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Upsert a set of weekly points for one instrument. Idempotent: existing (instrument, date) rows
 * are skipped, so this is safe to re-run. Returns how many rows were actually inserted (new weeks).
 */
export async function persistWeeklySeries(
  db: Db,
  instrumentId: string,
  points: SeriesPoint[],
  source: SeriesSource,
): Promise<number> {
  if (points.length === 0) return 0;
  const res = await db.instrumentPriceHistory.createMany({
    data: points.map((p) => ({
      instrumentId,
      date: isoToDate(p.date),
      value: p.value,
      source,
    })),
    skipDuplicates: true, // ON CONFLICT (instrument_id, date) DO NOTHING
  });
  return res.count;
}

/** The dates already stored for one instrument (so a refresh only fetches what it lacks). */
export async function existingDates(db: Db, instrumentId: string): Promise<Set<string>> {
  const rows = await db.instrumentPriceHistory.findMany({
    where: { instrumentId },
    select: { date: true },
  });
  return new Set(rows.map((r) => dateToIso(r.date)));
}

/** Read the stored weekly series for a set of instruments, ascending by date, as numbers. */
export async function readWeeklySeries(
  db: Db,
  instrumentIds: string[],
): Promise<Map<string, SeriesPoint[]>> {
  const out = new Map<string, SeriesPoint[]>();
  if (instrumentIds.length === 0) return out;
  const rows = await db.instrumentPriceHistory.findMany({
    where: { instrumentId: { in: instrumentIds } },
    orderBy: [{ instrumentId: "asc" }, { date: "asc" }],
    select: { instrumentId: true, date: true, value: true },
  });
  for (const r of rows) {
    const arr = out.get(r.instrumentId) ?? [];
    arr.push({ date: dateToIso(r.date), value: Number(r.value) });
    out.set(r.instrumentId, arr);
  }
  return out;
}

/** True if the instrument has at least one stored point (used to gate a redundant backfill). */
export async function hasSeries(db: Db, instrumentId: string): Promise<boolean> {
  const one = await db.instrumentPriceHistory.findFirst({
    where: { instrumentId },
    select: { instrumentId: true },
  });
  return one != null;
}

/** One stored point WITH its provenance. `readWeeklySeries` drops `source` (the portfolio-NAV chart
 *  does not need it); the per-instrument series endpoint keeps it, so the read can report a
 *  nav_corrected vs market_close (vs mixed) series. */
export interface StoredSeriesPoint {
  date: string; // "YYYY-MM-DD", ascending
  value: number;
  source: SeriesSource;
}

/** The full stored weekly series for ONE instrument, ascending by date, with each point's source.
 *  Reads the stored table ONLY — never mfapi, never the live chart. Empty array ⇒ nothing backfilled
 *  yet (a true state, not an error — the caller reports coverage, never a 404). */
export async function readInstrumentSeries(db: Db, instrumentId: string): Promise<StoredSeriesPoint[]> {
  const rows = await db.instrumentPriceHistory.findMany({
    where: { instrumentId },
    orderBy: { date: "asc" },
    select: { date: true, value: true, source: true },
  });
  return rows.map((r) => ({ date: dateToIso(r.date), value: Number(r.value), source: r.source as SeriesSource }));
}
