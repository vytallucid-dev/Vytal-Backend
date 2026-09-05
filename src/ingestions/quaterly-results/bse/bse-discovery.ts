// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BSE DISCOVERY — the only genuinely new path in this lane.
//
// One call per scrip returns EVERY period the company has filed:
//   Corp_FinanceResult_ng_new/w?SCRIP_CD=<code>&FlagDur=0&HFQ=&ISUBGROUP_CODE=&segment=
// and each row carries the two documents separately:
//   XMLName        → the STANDALONE instance
//   Consol_XMLName → the CONSOLIDATED instance
// fetched from https://www.bseindia.com/XBRLFILES/<name>.
//
// ⚠ BASIS IS EXPLICIT AND MUST BE CHECKED TWICE. The URL field says which basis we asked for, and
//   the instance itself carries <in-bse-fin:NatureOfReportStandaloneConsolidated>. Both are read and
//   asserted to agree (see bse-period-guard.ts). Basis is NEVER inferred from magnitude.
//
// ⚠ quarter_code IS BSE'S OWN CALENDAR, NOT THE COMPANY'S. MEASURED: AMBUJACEM ran a Jan–Dec fiscal
//   year in 2019, and its 2019-03-31 filing — which is its Q1 — is coded MQ2018-2019 all the same.
//   So the code below maps an April–March EXCHANGE calendar, and that is deliberate.
//   ★ Because of that, quarter_code is used ONLY AS A SELECTION HINT. After parsing, the document's
//     own DateOfEndOfReportingPeriod is asserted against the period we wanted. A wrong hint yields
//     "no document for this period", never a wrong row. That assertion is the guarantee, not the map.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { isInlineXbrl, ixbrlToXbrl } from "./bse-ixbrl.js";
import { BSE_API, BSE_FILES, type BsePacer } from "./bse-http.js";

export type Grain = "quarterly" | "annual";

export interface BseListingRow {
  quarterCode: string;
  audited: string | null;
  standaloneXml: string | null;
  consolidatedXml: string | null;
  createdAt: string | null;
}

export interface BseListing {
  scripCode: string;
  rows: BseListingRow[];
}

/**
 * Map a period end to BSE's exchange-calendar quarter_code.
 *
 * ⚠ SELECTION HINT ONLY — see the header. Never treat the result as the document's real period.
 *   MC = the year-end ("March cumulative") slot; for a March-FY company MC and MQ resolve to the
 *   SAME uploaded file, which is why one March document serves both the Q4 row and the annual row.
 */
export function quarterCodeFor(periodEnd: Date, grain: Grain): string {
  const y = periodEnd.getUTCFullYear();
  const m = periodEnd.getUTCMonth() + 1;
  const fyStart = m >= 4 ? y : y - 1;
  const fy = `${fyStart}-${fyStart + 1}`;
  // ⚠ THE CUMULATIVE SLOT FOLLOWS THE YEAR-END MONTH, NOT ALWAYS MARCH.
  //   BSE files a year-end cumulative under the prefix of the month it ends in:
  //     March → MC · December → DC · June → JC · September → SC
  //   MEASURED 2026-08-24: hardcoding MC asked for MC2020-2021 on every December-FY filer and
  //   got `not_listed`, while the real annual sat at DC2020-2021. That silently starved TEN
  //   active non-financial stocks (ABB, ACC, AMBUJACEM, CASTROLIND, CIEINDIA, CRISIL,
  //   LINDEINDIA, POWERINDIA, SCHAEFFLER, VBL) of every balance-sheet line — 36 of 42 December
  //   annual rows had a null total_equity — and it read as "BSE does not serve this period".
  //   ACC's own listing is the proof: DC2018-2019..DC2021-2022, then MC2022-2023 onward, the
  //   switch landing exactly on its December→March FY migration.
  if (grain === "annual") {
    const cumPrefix: Record<number, string> = { 3: "MC", 6: "JC", 9: "SC", 12: "DC" };
    const c = cumPrefix[m];
    if (!c) {
      throw new Error(
        `Cannot form a BSE annual quarter_code for period end ${periodEnd.toISOString().slice(0, 10)}: ` +
          `month ${m} is not a fiscal-year end of the exchange calendar`,
      );
    }
    return `${c}${fy}`;
  }
  const prefix: Record<number, string> = { 6: "JQ", 9: "SQ", 12: "DQ", 3: "MQ" };
  const p = prefix[m];
  if (!p) {
    throw new Error(
      `Cannot form a BSE quarter_code for period end ${periodEnd.toISOString().slice(0, 10)}: ` +
        `month ${m} is not a quarter boundary of the exchange calendar`,
    );
  }
  return `${p}${fy}`;
}

/**
 * ⚠ AN EMPTY `{}` IS A FAULT, NOT AN ANSWER — and telling them apart is load-bearing.
 *
 * MEASURED 2026-08-22: this endpoint intermittently answers HTTP 200 with a 2-byte body `{}` for a
 * request that succeeds normally seconds later. Six banks in a row returned it, then all six
 * returned full 30–70 KB tables on retry. It is fast (~70 ms), so it is not the latency throttle.
 *
 * The distinction that matters:
 *     {"Table":[...]}  → a real answer
 *     {"Table":[]}     → a real answer: this scrip has filed nothing
 *     {}               → NO Table key at all. THE SERVER DID NOT ANSWER.
 *
 * Reading `{}` as "no rows" marks every period of that stock `not_listed` — a whole company silently
 * recorded as having no filings, which is indistinguishable in the ledger from the truth. So it is
 * retried, and if it persists it THROWS, which the runner records as fetch_failed. A fault must never
 * be able to masquerade as an absence.
 */
export async function fetchResultsListing(pacer: BsePacer, scripCode: string): Promise<BseListing> {
  const url = `${BSE_API}/Corp_FinanceResult_ng_new/w?SCRIP_CD=${encodeURIComponent(scripCode)}&FlagDur=0&HFQ=&ISUBGROUP_CODE=&segment=`;
  let table: unknown = undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await pacer.get(url);
    if (res.status !== 200) {
      throw new Error(`BSE results listing for scrip ${scripCode} returned HTTP ${res.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new Error(`BSE results listing for scrip ${scripCode} was not JSON`);
    }
    table = (parsed as { Table?: unknown }).Table;
    if (Array.isArray(table)) break;
    if (attempt === 3) {
      throw new Error(
        `BSE results listing for scrip ${scripCode} returned a body with no Table key ` +
          `(${res.body.length} bytes: ${res.body.slice(0, 40)}) on 3 attempts — treating as a FAULT, ` +
          `not as "this scrip has filed nothing"`,
      );
    }
  }

  const rows: BseListingRow[] = (table as Array<Record<string, unknown>>).map((r) => ({
    quarterCode: String(r.quarter_code ?? "").trim(),
    audited: r.audited ? String(r.audited).trim() : null,
    standaloneXml: r.XMLName ? String(r.XMLName).trim() : null,
    consolidatedXml: r.Consol_XMLName ? String(r.Consol_XMLName).trim() : null,
    createdAt: r.Fld_CreateDate ? String(r.Fld_CreateDate) : null,
  }));
  return { scripCode, rows };
}

export type DocumentLookup =
  | { kind: "found"; xmlName: string; url: string; alternates: string[]; quarterCode: string; audited: string | null }
  | { kind: "listed_without_xbrl"; quarterCode: string }
  | { kind: "not_listed"; quarterCode: string };

/**
 * Find the STANDALONE instance for a period.
 *
 * The three outcomes are kept distinct on purpose and must not be collapsed:
 *   found                → we have a document
 *   listed_without_xbrl  → BSE HAS the filing but published no XBRL for it. MEASURED on ASHOKLEY,
 *                          whose Jun/Sep/Dec 2018 filings carry XBRL and whose March-2019 annual
 *                          does not. This kills the ROW, and it is not the same fact as the next one.
 *   not_listed           → BSE has no results row at that period at all.
 */
/**
 * ⚠ BSE LISTS THE SAME PERIOD TWICE, AND ONE OF THE TWO IS DEAD.
 *
 * MEASURED on ABBOTINDIA (scrip 500488): every quarterCode from MQ2024-2025 onward carries BOTH
 *     IFIndasDuplicateUploadDocument/..._IFIndAs.html   -> HTTP 200   (inline XBRL, current)
 *     FourOneUploadDocument/....xml                     -> HTTP 404   (legacy path, retired)
 * `hits.find(r => r.standaloneXml)` took whichever row came first, so a live filing looked like a
 * dead one. That single line is the largest cause of failure in the Stage 8 sweep — 62 fetch_failed
 * — and the reason three stocks' results stop at 2024-12-31, the exact BSE cutover.
 *
 * So gather EVERY candidate for the period and rank them: inline-XBRL first (it is what BSE
 * publishes now), legacy .xml second (still correct for everything before the cutover). The reader
 * tries them in order, so a stale first choice costs one request rather than the whole filing.
 */
/**
 * Find the instance for a period ON A GIVEN BASIS.
 *
 * ★ BSE PUBLISHES BOTH, IN TWO SEPARATE COLUMNS, AND WE READ ONLY ONE OF THEM. `fetchResultsListing`
 *   has always parsed `Consol_XMLName` into `consolidatedXml` — the field was sitting there, unread,
 *   because this lookup hard-coded `standaloneXml`. MEASURED on MARKSANS, SPARC and TARC at
 *   JQ2025-2026: every one lists a DISTINCT consolidated document beside its standalone one, each
 *   declares `NatureOfReportStandaloneConsolidated = "Consolidated"`, and each passes
 *   assertPeriodAndBasis with `expectedBasis: "consolidated"` unchanged.
 *
 * ⚠ THE BASIS IS NOT A HINT — IT IS ASSERTED AGAINST THE DOCUMENT. The caller passes the basis it
 *   asked for, and the period trap (bse-period-guard.ts) refuses any document whose own declared
 *   basis disagrees with the URL field it came from. So picking the wrong column cannot silently
 *   write a standalone P&L into a consolidated row: it fails loud and the document is discarded.
 *
 * The three outcomes are kept distinct on purpose and must not be collapsed:
 *   found                → we have a document
 *   listed_without_xbrl  → BSE HAS the filing but published no XBRL for it ON THIS BASIS. MEASURED
 *                          on ASHOKLEY, whose Jun/Sep/Dec 2018 filings carry XBRL and whose
 *                          March-2019 annual does not. This kills the ROW, and it is not the same
 *                          fact as the next one.
 *   not_listed           → BSE has no results row at that period at all.
 */
export function findDocument(
  listing: BseListing,
  quarterCode: string,
  basis: "standalone" | "consolidated" = "standalone",
): DocumentLookup {
  const hits = listing.rows.filter((r) => r.quarterCode === quarterCode);
  if (hits.length === 0) return { kind: "not_listed", quarterCode };

  const pick = (r: BseListingRow) => (basis === "consolidated" ? r.consolidatedXml : r.standaloneXml);
  const names = [...new Set(hits.map(pick).filter((n): n is string => Boolean(n)))];
  if (names.length === 0) return { kind: "listed_without_xbrl", quarterCode };

  const rank = (n: string): number => (/_IFIndAs\.html?$/i.test(n) ? 0 : /\.html?$/i.test(n) ? 1 : 2);
  const ordered = [...names].sort((a, b) => rank(a) - rank(b));
  const audited = hits.find((r) => pick(r) === ordered[0])?.audited ?? null;

  return {
    kind: "found",
    xmlName: ordered[0],
    url: BSE_FILES + ordered[0],
    alternates: ordered.slice(1).map((n) => BSE_FILES + n),
    quarterCode,
    audited,
  };
}

/** The standalone lookup, unchanged in behaviour — `findDocument` defaults to this basis. */
export function findStandaloneDocument(listing: BseListing, quarterCode: string): DocumentLookup {
  return findDocument(listing, quarterCode, "standalone");
}

/**
 * Fetch an instance, transparently handling BOTH shapes BSE now publishes.
 *
 * An inline-XBRL document is converted to the equivalent XBRL instance (bse-ixbrl.ts) so that every
 * extractor, the period guard and the ratio gate see the shape they were built and proven against.
 *
 * `alternates` are tried in order when the preferred document does not resolve — BSE keeps a retired
 * .xml path listed alongside the live .html one, and a 404 on the first is normal, not fatal.
 */
export async function fetchInstance(
  pacer: BsePacer,
  url: string,
  alternates: readonly string[] = [],
): Promise<string> {
  const tried: string[] = [];
  for (const candidate of [url, ...alternates]) {
    const res = await pacer.get(candidate, "application/xml, text/xml, text/html, */*");
    if (res.status !== 200) { tried.push(`${candidate} -> HTTP ${res.status}`); continue; }

    if (isInlineXbrl(res.body)) {
      try {
        const t = ixbrlToXbrl(res.body);
        return t.xml;
      } catch (e) {
        // A malformed inline document is a REFUSAL for that candidate, not for the period — the
        // legacy path may still serve it.
        tried.push(`${candidate} -> inline-XBRL rejected: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    if (res.body.includes("<xbrli:xbrl")) return res.body;
    tried.push(`${candidate} -> neither inline XBRL nor an XBRL root element`);
  }
  throw new Error(`BSE instance unavailable. Tried: ${tried.join(" | ")}`);
}
