// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SYMBOL → BSE SCRIP CODE, resolved by ISIN.
//
// ★★ WHY THIS FILE IS NOT A ONE-LINE LOOKUP — READ BEFORE CHANGING THE MASTER QUERY.
//
// The obvious call is ListofScripData/w?...&status=Active. It returns 4,977 scrips and it is WRONG.
// MEASURED 2026-08-22, the same endpoint with `status=` blank returns 10,824:
//     Active 4,977 · Delisted 4,612 · Suspended 1,232 · "N" 3
//
// JB CHEMICALS & PHARMACEUTICALS (NSE: JBCHEPHARM, BSE: 506943) is flagged **Suspended** in that
// master. It is not suspended. It trades, and it files results — VERIFIED: its BSE results listing
// carries 140 periods including XBRL for MC2022-2023 and MC2023-2024, which are exactly the two
// periods our manifest wants. Filtering on Status silently dropped a live, filing company.
//
// ⚠ SO: BSE's `Status` IS ADVISORY METADATA, NOT A FILTER. We take the FULL master and never filter
//   on it. A stock's real availability is decided by whether its results listing has documents —
//   which is a fact we fetch — not by a flag that is demonstrably stale.
//
// This is the exact failure the resolver must not repeat at cohort scale: the miss was SILENT. One
// stock was noticed because a probe happened to name it. `resolveAll` therefore returns the
// unresolved set as a FIRST-CLASS VALUE, never an omission — see ResolutionReport.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { BSE_API, type BsePacer } from "./bse-http.js";

export interface BseScrip {
  scripCode: string;
  scripName: string;
  isin: string | null;
  status: string;
  scripId: string | null;
}

export interface ResolvedStock {
  symbol: string;
  isin: string;
  scripCode: string;
  scripName: string;
  /** BSE's own status flag. ADVISORY — never used to include or exclude. */
  bseStatus: string;
  /** True when >1 scrip row shares this ISIN and a tie-break was applied. */
  ambiguous: boolean;
}

export interface UnresolvedStock {
  symbol: string;
  isin: string;
  reason: "isin_absent_from_bse_master";
}

export interface ResolutionReport {
  resolved: ResolvedStock[];
  /** ⚠ A FIRST-CLASS OUTPUT. Never an empty absence — every miss is named. */
  unresolved: UnresolvedStock[];
  masterSize: number;
  statusCounts: Record<string, number>;
}

/** Status preference for the 41 ISINs carrying more than one scrip row. Deterministic, and it
 *  prefers a live listing over a dead one without ever EXCLUDING on status. */
const STATUS_RANK: Record<string, number> = { Active: 0, Suspended: 1, N: 2, Delisted: 3 };

export async function fetchScripMaster(pacer: BsePacer): Promise<BseScrip[]> {
  // ⚠ status= is deliberately BLANK. See the header. Do not "tidy" this to Active.
  const url = `${BSE_API}/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=`;
  const res = await pacer.get(url);
  if (res.status !== 200) {
    throw new Error(`BSE scrip master returned HTTP ${res.status} — refusing to resolve against a partial master`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    throw new Error("BSE scrip master was not JSON — refusing to resolve against an unparsable master");
  }
  if (!Array.isArray(raw)) {
    throw new Error("BSE scrip master was not an array — shape changed upstream");
  }
  const rows = raw as Array<Record<string, unknown>>;
  // A master this much smaller than the measured 10,824 means the query silently narrowed again.
  if (rows.length < 8000) {
    throw new Error(
      `BSE scrip master returned only ${rows.length} rows; expected ~10,824. ` +
        `A narrowed master is how JBCHEPHARM was lost — refusing to resolve against it.`,
    );
  }
  return rows.map((r) => ({
    scripCode: String(r.SCRIP_CD ?? "").trim(),
    scripName: String(r.Scrip_Name ?? "").trim(),
    isin: r.ISIN_NUMBER ? String(r.ISIN_NUMBER).trim() : null,
    status: String(r.Status ?? "").trim(),
    scripId: r.scrip_id ? String(r.scrip_id).trim() : null,
  }));
}

export function resolveAgainstMaster(
  stocks: Array<{ symbol: string; isin: string }>,
  master: BseScrip[],
): ResolutionReport {
  const byIsin = new Map<string, BseScrip[]>();
  for (const s of master) {
    if (!s.isin) continue;
    const arr = byIsin.get(s.isin);
    if (arr) arr.push(s);
    else byIsin.set(s.isin, [s]);
  }

  const statusCounts: Record<string, number> = {};
  for (const s of master) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

  const resolved: ResolvedStock[] = [];
  const unresolved: UnresolvedStock[] = [];

  for (const stock of stocks) {
    const hits = byIsin.get(stock.isin);
    if (!hits || hits.length === 0) {
      unresolved.push({ symbol: stock.symbol, isin: stock.isin, reason: "isin_absent_from_bse_master" });
      continue;
    }
    const sorted = [...hits].sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 9;
      const rb = STATUS_RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.scripCode.localeCompare(b.scripCode);
    });
    const win = sorted[0];
    resolved.push({
      symbol: stock.symbol,
      isin: stock.isin,
      scripCode: win.scripCode,
      scripName: win.scripName,
      bseStatus: win.status,
      ambiguous: hits.length > 1,
    });
  }

  return { resolved, unresolved, masterSize: master.length, statusCounts };
}
