// ─────────────────────────────────────────────────────────────────────────────
// BSE SHAREHOLDING — FETCH. The only I/O in the lane; parsing lives next door in
// bse-shp-extract.ts so the mapping stays unit-testable against saved payloads.
//
// Both endpoints go through ONE BsePacer, which serialises requests behind a
// spacing gate and treats "slow but a valid 200" as back-off rather than stop
// (see bse-http.ts — conflating degraded with broken cost a pilot run).
//
// ⚠️ There is NO quarter register. `shpDecleraction` looks like one but returns a
//    bare JSON array with a single row — the LATEST quarter only:
//      [{"qtr_id":"130.00","qtr_name":"June 2026","CompName":"…", …}]
//    So availability per quarter can only be discovered by PROBING. That is why
//    the backfill walks quarter ids instead of reading a list.
// ─────────────────────────────────────────────────────────────────────────────
import { BsePacer, BSE_API } from "../../quaterly-results/bse/bse-http.js";
import { toRows, qidParam, type BseRow } from "./bse-shp-extract.js";

export interface BseShpPayload {
  secRows: BseRow[];
  pubRows: BseRow[];
  /** Recorded on the row so a BSE-sourced quarter is greppable by provenance. */
  sourceUrl: string;
}

/** Table1 out of a BSE response body, tolerating a non-JSON or unshaped body. */
function table1(body: string): unknown {
  try {
    return (JSON.parse(body) as Record<string, unknown>).Table1 ?? [];
  } catch {
    return [];
  }
}

export function securityUrl(scripCode: string, qid: number): string {
  return `${BSE_API}/CorporatesSHPSecuritybeta/w?scripcode=${scripCode}&qtrid=${qidParam(qid)}`;
}
export function publicUrl(scripCode: string, qid: number): string {
  return `${BSE_API}/Corp_shpSec_SHPPubShold_ng/w?SCRIPCODE=${scripCode}&QtrCode=${qidParam(qid)}`;
}

/** The A/B/C partition, share counts and pledge. One request. */
export async function fetchSecurity(pacer: BsePacer, scripCode: string, qid: number): Promise<BseRow[]> {
  const res = await pacer.get(securityUrl(scripCode, qid));
  return toRows(table1(res.body));
}

/** The public breakdown (FII / DII / MF / insurance / banks). One request. */
export async function fetchPublic(pacer: BsePacer, scripCode: string, qid: number): Promise<BseRow[]> {
  const res = await pacer.get(publicUrl(scripCode, qid));
  return toRows(table1(res.body));
}

/**
 * Both payloads for one (scrip, quarter). Two requests — this is the unit the
 * backfill budgets in, so the cost model stays honest: N stock-quarters is 2N
 * requests, not N.
 *
 * Callers walking a long quarter range should instead fetchSecurity first and
 * only fetchPublic when the security payload shows the quarter actually exists:
 * BSE answers 200-with-zeros for quarters it does not hold, and paying the
 * second request for those is pure waste on a 12,000-request run.
 */
export async function fetchBseShp(
  pacer: BsePacer,
  scripCode: string,
  qid: number,
): Promise<BseShpPayload> {
  return {
    secRows: await fetchSecurity(pacer, scripCode, qid),
    pubRows: await fetchPublic(pacer, scripCode, qid),
    sourceUrl: securityUrl(scripCode, qid),
  };
}

/** The latest quarter id BSE holds for a scrip (the one thing shpDecleraction does give). */
export async function latestQuarterId(pacer: BsePacer, scripCode: string): Promise<number | null> {
  const res = await pacer.get(`${BSE_API}/shpDecleraction/w?scripcode=${scripCode}`);
  try {
    const arr = JSON.parse(res.body) as { qtr_id?: string }[];
    if (!Array.isArray(arr) || !arr.length) return null;
    const n = Number(arr[0].qtr_id);
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}
