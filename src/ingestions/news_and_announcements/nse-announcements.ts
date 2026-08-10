// ─────────────────────────────────────────────────────────────
// Fetches official NSE corporate announcements.
// Endpoint: /api/corporate-announcements
// Session required (uses NseClient).
// ─────────────────────────────────────────────────────────────

import { nseClient } from "../../lib/client.js";
import { shouldExtractPdf } from "./content-extractor.js";

// ── NSE raw response ──────────────────────────────────────────

interface NseAnnouncementRaw {
  symbol: string;
  desc: string; // headline / subject
  an_dt: string; // "20-Apr-2026 18:49:01"
  attchmntFile: string; // PDF path (relative or absolute)
  attchmntText: string; // short text excerpt from PDF
  categoryId?: string;
  category?: string; // "Results", "Dividend", etc. — absent on some endpoints
  sub_category?: string;
  seq_id: string; // unique NSE ID — use as sourceId (snake_case in actual API)
  smIndustry?: string | null;
  isinCode?: string;
}

// ── Transformed announcement ──────────────────────────────────

export interface NseAnnouncement {
  symbol: string;
  sourceId: string;
  headline: string;
  summary: string | null; // attchmntText (short excerpt)
  category: string | null;
  subcategory: string | null;
  pdfUrl: string | null; // always stored
  publishedAt: Date;
  isHighImpact: boolean;
  shouldExtract: boolean; // should PDF text be extracted?
}

// ══ MATERIALITY — WHAT "HIGH IMPACT ONLY" FILTERS ON ══════════════════════════════════════════════
//
// ★★★ WHAT THIS REPLACES, AND WHY IT WAS WORSE THAN NO FILTER AT ALL. ★★★
// The previous rule was `detectHighImpact(category, headline)`: prefer NSE's `category`, else scan the
// headline for keyword SUBSTRINGS. Both halves were broken, and the shipped toggle was near-inverted.
//
//   1. `category` IS NULL ON EVERY ROW. Measured: 0 of 6,933. The corporate-announcements endpoint
//      does not return it, so the category branch never once executed and the keyword branch always did.
//   2. `headline` IS NOT A DESCRIPTION — IT IS A FILING-TYPE BUCKET. "Outcome of Board Meeting",
//      "General Updates", "Certificate under SEBI (Depositories and Participants) Regulations, 2018".
//      There are 82 of them. Scanning a bucket LABEL for event keywords asks the wrong question.
//   3. ⚠ THE CANONICAL FAILURE: the keyword "sebi" matched inside the bucket "Certificate under SEBI
//      (Depositories and Participants) Regulations, 2018" — a SUBSTRING OF A REGULATION'S NAME, not a
//      signal about the filing. That single substring flagged 360 routine quarterly RTA certificates as
//      high impact. With "Trading Window" (166) and the takeover-regulation disclosures (117), 643 of
//      884 flagged filings — 72.7% — were routine compliance.
//   4. And the substance was MISSED, because it lives in `summary` (NSE's attchmntText, informative on
//      6,927 of 6,933 rows) which the rule never read. 516 filings whose own summary says "financial
//      result" were NOT flagged — including CUMMINSIND's Q1 results, filed as "Outcome of Board
//      Meeting" — along with 80 resignations, one of them a Managing Director's.
//
// ── THE SHAPE OF THE FIX ─────────────────────────────────────────────────────────────────────────
// Key off the BUCKET as an identity, not as a bag of characters, and read the SUMMARY for the buckets
// that are generic containers:
//
//   ROUTINE_BUCKETS   → never material. ⚠ CHECKED FIRST AND SHORT-CIRCUITS, which is the structural
//                       point: it is what makes the "sebi"-inside-a-regulation-name bug UNREACHABLE
//                       rather than merely unlikely. A summary scan can never promote one of these.
//   MATERIAL_BUCKETS  → the bucket alone decides. A "Dividend" or "Credit Rating- Revision" filing is
//                       material whatever its summary says.
//   everything else   → decide from the SUMMARY (the five generic containers, plus any bucket NSE adds
//                       later). No material phrase found ⇒ NOT flagged: absence is the safe state, the
//                       same default the rest of this codebase takes.
//
// Every bucket below was classified against real summaries sampled from that bucket, not from its name.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** Normalise a bucket for comparison — NSE varies case and spacing across endpoints. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Compliance and procedural filings. Verified routine by reading their summaries:
 *  · "Certificate under SEBI (Depositories and Participants)…" — the quarterly Reg 74(5) RTA
 *    confirmation. 360 rows, every one identical in substance. THE case that motivated this rewrite.
 *  · "Disclosure under SEBI Takeover Regulations" — Reg 31(1)/31(2)/31(4) periodic encumbrance and
 *    annual promoter declarations. Filed on a calendar, not on an event.
 *  · "Analysts/Institutional Investor Meet/Con. Call Updates" (1,168 rows, the single largest bucket) —
 *    call schedules and audio-recording links. The RESULT is the event; the call notice is not.
 *  · "Investor Presentation", "Copy of Newspaper Publication" — a document exists. That is all it says.
 *  · "Record Date", "Trading Window", "ESOP/ESOS/ESPS", "Monitoring Agency Report" — procedural, and
 *    the dividend/bonus action itself arrives through the corporate-events pipeline, not here.
 */
const ROUTINE_BUCKETS = new Set(
  [
    "Certificate under SEBI (Depositories and Participants) Regulations, 2018",
    "Disclosure under SEBI Takeover Regulations",
    "Analysts/Institutional Investor Meet/Con. Call Updates",
    "Investor Presentation",
    "Copy of Newspaper Publication",
    "Shareholders meeting",
    "Trading Window",
    "Record Date",
    "ESOP/ESOS/ESPS",
    "Options to purchase securities",
    "Monitoring Agency Report",
    "Committee Meeting Updates",
    "Loss of Share Certificates",
    "Corrigendum",
    "Change in Company Secretary/Compliance Officer",
    "Amendment to AOA/MOA",
    "Statement of deviation(s) or variation(s) under Reg. 32",
    "Book Closure",
    "Notice Of Shareholders Meetings",
  ].map(norm),
);

/**
 * Buckets whose identity is already the event. No summary read required.
 * Judgement calls, stated so they can be argued with rather than discovered:
 *  · "News Verification" / "Rumour Verification" — the EXCHANGE asking a company to confirm or deny a
 *    market-moving report ("Instamart ties up with HPCL"). Kept: a reader wants that.
 *  · "Spurt in Volume" — an exchange volume query. It is a prompt for disclosure rather than a
 *    disclosure, and it is 13 rows; kept because unusual activity the exchange noticed is a real signal.
 *  · "Appointment"/"Cessation"/"Retirement" — verified to be directors, CFOs and KMP, not clerical.
 *  · "Monthly Business Updates" — real monthly operating data (Eicher, Ashok Leyland volumes).
 *  · "Agreements" — definitive transaction agreements, share purchase, strategic investment.
 */
const MATERIAL_BUCKETS = new Set(
  [
    "Dividend",
    "Acquisition",
    "Amalgamation/Merger",
    "Scheme of Arrangement",
    "Other Restructuring",
    "Sale or disposal",
    "Credit Rating",
    "Credit Rating- Revision",
    "Credit Rating- New",
    "Credit Rating- Others",
    "Change in Management",
    "Change in Director(s)",
    "Change in Auditors",
    "Resignation",
    "Resignation of Director/KMP/SMP",
    "Resignation of Statutory Auditor",
    "Cessation",
    "Retirement",
    "Appointment",
    "Bagging/Receiving of orders/contracts",
    "Awarding of order(s)/contract(s)",
    "Issue of Securities",
    "Offer for sale",
    "Action(s) taken or orders passed",
    "Action(s) initiated or orders passed",
    "Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company",
    "Suspension of Trading",
    "Disruption of Operations",
    "Closure of operations",
    "Capacity addition",
    "Commencement of commercial production/operations",
    "Reply to Clarification- Financial results",
    "Integrated Filing- Financial",
    "News Verification",
    "Rumour Verification - Regulation 30(11)",
    "Spurt in Volume",
    "Spurt in Price",
    "Monthly Business Updates",
    "Agreements",
    "Giving guarantees/indemnity/ becoming a surety for third party",
    "Financial Result Updates",
    "Bonus",
    "Stock Split",
    "Buyback",
    "Rights Issue",
    "Preferential Issue",
    "Delisting",
    "Open Offer",
    "Insolvency",
  ].map(norm),
);

/**
 * ⚠ REGULATION NAMES ARE NOT EVENT DESCRIPTIONS — STRIP THEM BEFORE SCANNING.
 *
 * This is the second, independent defence against the bug that motivated the rewrite. Statutory titles
 * live inside parentheses and in "…Regulations, YYYY" tails, and they are full of words that look like
 * events: "(Substantial Acquisition of Shares and Takeovers) Regulations, 2011" contains "Acquisition
 * of"; "(Depositories and Participants)" sits next to "SEBI". A generic-container summary that quotes a
 * regulation would otherwise be promoted by the name of the rule it is complying with.
 *
 * ROUTINE_BUCKETS already short-circuits the known cases. This covers the ones NSE has not invented yet.
 */
function stripRegulationNames(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bregulations?,?\s*\d{4}\b/gi, " ")
    .replace(/\bregulation\s+\d+[A-Za-z]?(\(\d+\))?\b/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * Event phrases for the generic containers. These describe THINGS THAT HAPPENED, never the name of a
 * rule or a document. Deliberately narrow: a container whose summary says nothing on this list is not
 * flagged, because over-flagging is what made the old toggle useless.
 */
const MATERIAL_SUMMARY_RE = new RegExp(
  [
    String.raw`financial results?`,
    String.raw`results? for the (quarter|period|year|half)`,
    String.raw`(un)?audited (standalone|consolidated|financial)`,
    String.raw`dividend`,
    String.raw`bonus (issue|shares)`,
    String.raw`stock split|sub-?division of (equity )?shares`,
    String.raw`buy-?back`,
    String.raw`acquisition of|acquires?|acquired|stake (purchase|sale)|divestment`,
    String.raw`amalgamation|merger|demerger|slump sale`,
    String.raw`credit rating|rating (upgrade|downgrade|revision|assigned)`,
    String.raw`resign(ation|ed|s)?\b`,
    String.raw`appointed as|appointment of`,
    String.raw`orders? (worth|valued|received|bagged|awarded)|contract (worth|valued|awarded)|letter of (award|intent)`,
    String.raw`qip|rights issue|preferential (issue|allotment)|convertible|warrants|fund ?rais(e|ing)|capital raise`,
    String.raw`us ?fda|fda (inspection|observation|approval|warning)|form 483`,
    String.raw`penalt(y|ies)|fine of|show cause|adjudication order|prosecution`,
    String.raw`insolvency|nclt|cirp|liquidation`,
    String.raw`plant (shutdown|closure|fire)|production (halt|suspension|shutdown)`,
    String.raw`arbitration award|court (order|ruling)|judgment`,
  ].join("|"),
  "i",
);

/**
 * Is this filing material enough for "High impact only"?
 *
 * ⚠ ORDER IS LOAD-BEARING. Routine first (so nothing can promote it), then material buckets, then and
 * only then the summary. Reversing the first two re-opens the 360-certificate bug.
 */
export function detectHighImpact(bucket: string, summary: string | null): boolean {
  const b = norm(bucket);
  if (ROUTINE_BUCKETS.has(b)) return false;
  if (MATERIAL_BUCKETS.has(b)) return true;
  // Prefix match for the versioned/suffixed variants NSE emits ("Press Release (Revised)",
  // "Integrated Filing- Financial ..."). Routine has already had its say, so this cannot promote one.
  for (const m of MATERIAL_BUCKETS) if (b.startsWith(`${m} `) || b.startsWith(`${m}-`)) return true;
  if (!summary) return false;
  return MATERIAL_SUMMARY_RE.test(stripRegulationNames(summary));
}

// ── Date formatters ───────────────────────────────────────────

function toNseDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseNseAnDate(s: string): Date | null {
  if (!s) return null;
  const m = s
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(
    Date.UTC(
      parseInt(m[3]),
      month,
      parseInt(m[1]),
      parseInt(m[4] ?? "0"),
      parseInt(m[5] ?? "0"),
      parseInt(m[6] ?? "0"),
    ),
  );
}

// ══ ★★★ NSE SENDS "-" WHEN THERE IS NO ATTACHMENT, AND IT USED TO BECOME A URL. ★★★ ═════════════
//
// `attchmntFile` is not always a path. On exchange-INITIATED filings — News Verification, Spurt in
// Volume, Suspension of Trading, Price movement — NSE publishes the query BEFORE the company has
// replied, and sends a bare "-" in place of a filename. The old guard only rejected empty strings, so
// "-" fell through to the concatenation below and produced the literal string
//
//     https://nsearchives.nseindia.com-
//
// A bare host with a trailing dash: no scheme-relative path, no file, nothing to fetch. 33 of 6,933
// stored rows hold exactly that value, and every one of them rendered a "View filing (PDF)" button
// that could only ever fail. 28 of the 33 say "The response from the Company is awaited" in their own
// excerpt — so the honest state is A FILING WITH NO ATTACHMENT, and null is how this table spells that.
//
// ⚠ THE POINT OF FIXING IT HERE RATHER THAN ON THE 33 ROWS. Cleaning rows without closing the source
// is how `extraction_status: "pending"` refilled itself twice — 6,544 rows re-marked on 2026-07-26,
// then 15,805 more written by an ingest that still had a path to write them. The rows are the symptom;
// this function is the source. A backfill without this edit would be the same mistake a third time.
//
// NOTE: this returns null, it does not drop the row. The filing is real and its excerpt is often the
// whole story ("The Exchange has sought clarification from Dabur India Limited with respect to …").
// Only the attachment is absent, and absence is stored as absence.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** A usable attachment path: absolute, and ending in a filename with an extension. */
const ATTACHMENT_PATH = /^\/.*\/[^/]+\.[A-Za-z0-9]{2,5}$/;

function buildPdfUrl(attchmntFile: string): string | null {
  const raw = attchmntFile?.trim();
  if (!raw) return null;
  // "-", "NA", "." and friends: a placeholder for "nothing attached", never a path.
  if (!raw.includes("/")) return null;
  if (raw.startsWith("http")) {
    // An absolute URL still has to point at a file, not at a host.
    return /^https?:\/\/[^/]+\/.+\.[A-Za-z0-9]{2,5}$/.test(raw) ? raw : null;
  }
  if (!ATTACHMENT_PATH.test(raw)) return null;
  // Relative path → prepend NSE archives base
  return `https://nsearchives.nseindia.com${raw}`;
}

// ── Fetcher ───────────────────────────────────────────────────

/**
 * Result of one announcements fetch. `nonArray` = the envelope trap (the
 * 200 response was an object/error-shaped, not an array → would silently
 * yield 0). `rawRows`/`passed` expose the required-field filter so a
 * seq_id/desc/an_dt rename (rows present, all dropped) is detectable. An
 * empty-but-array response (legit quiet symbol) is `nonArray:false, rawRows:0`.
 */
export interface NseAnnouncementsFetch {
  announcements: NseAnnouncement[];
  nonArray: boolean;
  rawRows: number;
  passed: number;
}

export async function fetchNseAnnouncements(
  symbol: string,
  from: Date,
  to: Date,
  signal?: AbortSignal,
): Promise<NseAnnouncementsFetch> {
  const path =
    `/api/corporate-announcements?index=equities` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&from_date=${toNseDate(from)}&to_date=${toNseDate(to)}`;

  const data = await nseClient.get<NseAnnouncementRaw[]>(path, signal);
  const nonArray = !Array.isArray(data);
  const rows: NseAnnouncementRaw[] = nonArray
    ? []
    : (data as NseAnnouncementRaw[]);

  // Required-field filter (a seq_id/desc/an_dt rename drops every row here).
  const withFields = rows.filter((r) => r.seq_id && r.desc && r.an_dt);

  const announcements = withFields
    .map((r): NseAnnouncement | null => {
      const publishedAt = parseNseAnDate(r.an_dt);
      if (!publishedAt) return null;

      const category = r.category?.trim() || null;
      const subcategory = r.sub_category?.trim() || null;
      const headline = r.desc?.trim() || "";
      const summary = r.attchmntText?.trim() || null;
      const pdfUrl = buildPdfUrl(r.attchmntFile);
      // ★ The BUCKET and the SUMMARY — never `category`, which this endpoint has never returned.
      const isHighImpact = detectHighImpact(headline, summary);

      return {
        symbol: symbol.toUpperCase(),
        sourceId: r.seq_id,
        headline,
        summary: summary?.slice(0, 500) ?? null,
        category,
        subcategory,
        pdfUrl,
        publishedAt,
        isHighImpact,
        shouldExtract:
          shouldExtractPdf(category, isHighImpact) && pdfUrl !== null,
      };
    })
    .filter((r): r is NseAnnouncement => r !== null);

  return { announcements, nonArray, rawRows: rows.length, passed: withFields.length };
}
