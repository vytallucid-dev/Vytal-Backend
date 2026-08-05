// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOOL SCAN CACHE — one in-process, stale-while-revalidate slot per research tool, holding the
// fully RANKED landing scan that GET /api/stocks/scan pages over.
//
// ── WHY: A RANKING IS NOT A PAGE READ ──────────────────────────────────────────────────────────────
// Every scan ranks the WHOLE scored universe before anything can be sliced — divergence by gap size,
// trajectory by severity, ownership by flow tell. None of that can be pushed into a LIMIT: the
// comparators run over data the database does not sort by. So a page request either re-ranks the
// universe or reads a ranking someone already built. Ownership makes the cost concrete — its scan
// does four round-trips, one of them the full shareholding history of every stock, and paying that
// again per scroll page to hand back sixteen cards is indefensible.
//
// ── ★ IT IS ALSO WHAT MAKES THE CURSOR CORRECT ─────────────────────────────────────────────────────
// The scan cursor names a position in a RANKED array. If every page re-ranked, a rescore landing
// mid-scroll would reshuffle the list under the reader and the same card could arrive twice. With one
// slot behind all of a session's pages, every page is a slice of the SAME ranking.
//
// ── ★ THE KEY IS A CLOSED LITERAL UNION AND CANNOT BECOME USER-SCOPED ──────────────────────────────
// universe-rows.cache.ts asserts "public data only" by taking NO argument. This one needs the tool,
// so it asserts the same thing by TYPE: the key is `ScanToolId` — three string literals, checked at
// the controller boundary. There is no shape here that a userId fits into, and widening the key type
// would be a review-visible act rather than a quiet one. ⚠ Do not widen it to `string`.
//
// ── ⚠ THE SLOTS ARE SHARED AND MUST STAY READ-ONLY ─────────────────────────────────────────────────
// Callers get THE SAME array the slot holds, already in rank order — filter and slice (which copy),
// never sort or reverse in place, or one reader's page order becomes everyone's.
//
// ── TTL: 5 MINUTES, STALE-WHILE-REVALIDATE ─────────────────────────────────────────────────────────
// Same policy and the same code as universe-rows.cache.ts, deliberately. The ranking changes ON
// RESCORE, not per request. A stale hit serves instantly while the rebuild runs behind it; a rebuild
// that FAILS keeps serving the last good ranking rather than turning a transient DB blip into an
// error in front of a reader. It evaporates on process restart and is persisted nowhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { buildToolScan } from "./stocks-list.service.js";
import type { ToolScanItem } from "./tool-scan.service.js";
import type { OwnershipScanItem } from "./stocks-list.types.js";

/** The three tools with a backed landing scan. ⚠ Closed on purpose — see the header. */
export type ScanToolId = "trajectory" | "divergence" | "ownership";

const SCAN_TOOLS: readonly string[] = ["trajectory", "divergence", "ownership"];

/** Narrow an untrusted query param to a tool with a scan. Returns null for anything else,
 *  which is what lets the controller answer "not implemented" instead of guessing. */
export const asScanTool = (raw: string): ScanToolId | null =>
  SCAN_TOOLS.includes(raw) ? (raw as ScanToolId) : null;

/** One ranked scan row. The two shapes share only `symbol` — which is all the pager reads. */
export type ScanRow = ToolScanItem | OwnershipScanItem;

/** Serve-stale-and-revalidate boundary. See the header for why five minutes. */
export const TOOL_SCAN_TTL_MS = 5 * 60 * 1000;

const cache = new Map<ScanToolId, { rows: ScanRow[]; builtAt: number }>();
const rebuildInFlight = new Map<ScanToolId, Promise<ScanRow[]>>();

/** Start (or join) a rebuild for one tool. One in flight per tool — a burst of cold callers
 *  on the same tool shares one ranking pass. */
function rebuild(tool: ScanToolId): Promise<ScanRow[]> {
  const running = rebuildInFlight.get(tool);
  if (running) return running;

  const p = buildToolScan(tool)
    .then((rows) => {
      // buildToolScan returns null only for a tool with no scan — asScanTool has already
      // excluded those, so this is a belt-and-braces empty rather than a cached null.
      const list = (rows ?? []) as ScanRow[];
      cache.set(tool, { rows: list, builtAt: Date.now() });
      return list;
    })
    .finally(() => {
      rebuildInFlight.delete(tool);
    });

  rebuildInFlight.set(tool, p);
  return p;
}

/**
 * One tool's ranked scan, cached.
 *
 * Cold  → ranks and waits (joining any pass already running for this tool).
 * Warm  → returns the cached ranking.
 * Stale → returns the cached ranking NOW and re-ranks behind it.
 */
export async function getToolScanRows(tool: ScanToolId): Promise<ScanRow[]> {
  const slot = cache.get(tool);
  if (!slot) return rebuild(tool);
  if (Date.now() - slot.builtAt > TOOL_SCAN_TTL_MS) {
    // A failed background rebuild must not reject an already-answered request.
    rebuild(tool).catch(() => {
      /* the last good ranking keeps serving; the next caller retries */
    });
  }
  return slot.rows;
}

/** Observability for a verification harness and for a future admin read. Carries no row data. */
export function toolScanCacheStats(): Record<
  string,
  { ageMs: number; rebuilding: boolean; rows: number }
> {
  const out: Record<string, { ageMs: number; rebuilding: boolean; rows: number }> = {};
  for (const [tool, slot] of cache) {
    out[tool] = {
      ageMs: Date.now() - slot.builtAt,
      rebuilding: rebuildInFlight.has(tool),
      rows: slot.rows.length,
    };
  }
  return out;
}

/** Test-only: drop the slots so a harness can measure a genuine cold path. Never called in product code. */
export function _clearToolScanCacheForVerification(): void {
  cache.clear();
}
