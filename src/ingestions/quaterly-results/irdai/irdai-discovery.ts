// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// IRDAI DISCOVERY — turning an insurer's disclosure page into an INDEX of documents.
//
// This is the piece the lane was missing. Everything downstream already exists and is proven:
// irdai-parse (PDF -> form text), irdai-forms (L1/L2/L3, NL1/NL2/NL3), irdai-units, irdai-ratio-gate,
// irdai-fence, irdai-ledger, irdai-writer. What did not exist was a way to LEARN THE URLs.
//
// ⚠ AND THEY CANNOT BE CONSTRUCTED. MEASURED 2026-08-25:
//     godigit .../financials/2023-2024/q1/NL-1-B-RA.pdf   -> 200, a real 180 KB PDF
//     godigit .../financials/2020-2021/q1/NL-1-B-RA.pdf   -> 403
//     godigit .../financials/2021-2022/q1/NL-1-B-RA.pdf   -> 403
//   The same shape, two years apart, is refused. Pattern-guessing is not a discovery strategy here;
//   the listing page is the only source of truth for which documents exist.
//
// ── WHAT THIS MODULE COVERS, AND WHAT IT DOES NOT ──────────────────────────────────────────────────
// MEASURED across all nine reachable insurers, the disclosure list is in the served HTML for FOUR of
// them — their dropdowns/modals merely HIDE markup that is already present — and is fetched by
// JavaScript for the other five. Those five are deliberately absent from SITES below rather than
// half-supported: a site whose list needs an XHR endpoint we do not have would otherwise look
// "supported" and silently yield nothing.
//     STATIC (here):  ICICIPRULI · GODIGIT · HDFCLIFE · CANHLIFE
//     XHR (not here): SBILIFE · LICI · NIACL · GICRE · STARHEALTH
//
// ── THE FISCAL-YEAR CONVENTION, WHICH DIFFERS PER SITE ─────────────────────────────────────────────
// Indian FY2026 = Apr-2025 .. Mar-2026. Each site encodes it its own way, and getting this wrong
// silently shifts every document by a year:
//     ICICIPRULI  fy2026/fy2026q1/    -> FY2026 Q1 -> period ends 2025-06-30
//     GODIGIT     2017-2018/q3/       -> FY2018 Q3 -> period ends 2017-12-31   (SPAN form, not label)
//     HDFCLIFE    FY2026/Q1|H1|9M|FY/ -> CUMULATIVE folders: Jun / Sep / Dec / Mar
//     CANHLIFE    ...june-2025...     -> month + year straight out of the filename
// Each rule below is asserted against a real sample URL in stage7b-discovery-verify.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { fetchRaw } from "./irdai-http.js";

export type Grain = "quarterly" | "annual";
export type Basis = "standalone" | "consolidated";

export interface DiscoveredDoc {
  symbol: string;
  url: string;
  /** Period END, ISO. The quarter or fiscal year the document reports on. */
  periodEnd: string;
  grain: Grain;
  basis: Basis;
  /** Link text or filename — kept for the ledger so a decision can be re-read later. */
  label: string;
}

export interface SiteConfig {
  symbol: string;
  family: "life" | "general";
  entryUrl: string;
  /** Narrow the whole-page PDF list to this insurer's disclosure area. */
  keep: (url: string) => boolean;
  /** Period + grain + basis, or null when the URL is not a periodic disclosure. */
  classify: (url: string, label: string) => Omit<DiscoveredDoc, "symbol" | "url" | "label"> | null;
}

// ── shared helpers ────────────────────────────────────────────────────────────────────────────────

const QEND: Record<number, string> = { 1: "06-30", 2: "09-30", 3: "12-31", 4: "03-31" };

/**
 * Period end for (fiscal year label, quarter). FY2026 Q1 ends 2025-06-30; Q4 ends 2026-03-31.
 * The calendar year rolls only for Q4, which is the whole trap.
 */
function fyQuarterEnd(fyLabel: number, q: 1 | 2 | 3 | 4): string {
  const year = q === 4 ? fyLabel : fyLabel - 1;
  return `${year}-${QEND[q]}`;
}
/** Fiscal year END date for a FY label: FY2026 -> 2026-03-31. */
const fyEnd = (fyLabel: number): string => `${fyLabel}-03-31`;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
/** A month name only maps to a period end if it IS a quarter end. */
function monthYearToQuarterEnd(month: number, year: number): string | null {
  if (month === 6) return `${year}-06-30`;
  if (month === 9) return `${year}-09-30`;
  if (month === 12) return `${year}-12-31`;
  if (month === 3) return `${year}-03-31`;
  return null;
}
const basisOf = (s: string): Basis => (/consolidat/i.test(s) ? "consolidated" : "standalone");

// ── per-insurer rules ─────────────────────────────────────────────────────────────────────────────

export const SITES: SiteConfig[] = [
  {
    // .../PublicDisclosures/fy2026/fy2026q1/Standalone_Q1_FY_26.pdf
    // .../PublicDisclosures/FY2027/FY2027Q1/Standalone_Q1.pdf
    // .../PublicDisclosures/fy2026/yearly/<name>.pdf
    symbol: "ICICIPRULI",
    family: "life",
    entryUrl: "https://www.iciciprulife.com/about-us/investor-relations/yearly-public-disclosures.html",
    keep: (u) => /\/PublicDisclosures\//i.test(u),
    classify: (u, label) => {
      // Shape A: /fy2026/fy2026q1/
      const q = /\/fy(\d{4})\/fy\1q([1-4])/i.exec(u);
      if (q) {
        return { periodEnd: fyQuarterEnd(Number(q[1]), Number(q[2]) as 1 | 2 | 3 | 4),
          grain: "quarterly", basis: basisOf(u + label) };
      }
      // Shape B: /FY2024/FY2024_Q1_Standalone/ — the same period under an older folder
      // convention. 86 documents sit here; without this the whole of FY2024 and its
      // neighbours read as "not a periodic disclosure" and vanish silently.
      const q2 = /\/fy(\d{4})\/fy\1_q([1-4])_(standalone|consolidated)/i.exec(u);
      if (q2) {
        return { periodEnd: fyQuarterEnd(Number(q2[1]), Number(q2[2]) as 1 | 2 | 3 | 4),
          grain: "quarterly", basis: q2[3].toLowerCase() as Basis };
      }
      const y = /\/fy(\d{4})\/yearly\//i.exec(u);
      // "yearly" holds governance documents as well as accounts; only take the ones that
      // read as financial statements, or the index fills with stewardship policies.
      if (y && /standalone|consolidat|financial|annual|audited/i.test(u + label)) {
        return { periodEnd: fyEnd(Number(y[1])), grain: "annual", basis: basisOf(u + label) };
      }
      return null;
    },
  },
  {
    // .../financials/2017-2018/q3/nl-1.pdf   — a SPAN (2017-2018), so FY label is the SECOND year
    symbol: "GODIGIT",
    family: "general",
    entryUrl: "https://www.godigit.com/financials",
    keep: (u) => /\/financials\//i.test(u),
    classify: (u) => {
      // GODIGIT has reorganised its tree repeatedly and FIVE shapes are live at once.
      // Each was observed on the page; the bracketed counts are how many documents sit
      // in each. Missing one loses whole years, so they are enumerated rather than
      // approximated by a single loose pattern.
      //   A [797] /2019-2020/q1/                   span, then quarter folder
      //   B  [31] /2017-2018/quater1/              the same, "quarter" misspelled
      //   C [155] /q12018-2019/ and /q12018-19/    quarter PREFIXED to the span
      //   D [136] /public-disclosure/fy-24-25/quarter-1/   a second tree entirely
      //   E  [71] /2017-2018/<file>.pdf            no quarter segment: a year-end drop
      /** "2018-2019" -> 2019 ; "18-19" -> 2019 ; "24-25" -> 2025 */
      const yr2 = (a: string, b: string): number => (b.length === 4 ? Number(b) : 2000 + Number(b));

      const a = /\/(\d{4})-(\d{4})\/(?:q|quarter|quater)\s*-?([1-4])\//i.exec(u);
      if (a) return { periodEnd: fyQuarterEnd(yr2(a[1], a[2]), Number(a[3]) as 1 | 2 | 3 | 4),
        grain: "quarterly", basis: "standalone" };

      const c = /\/q([1-4])(\d{4})-(\d{2,4})\//i.exec(u);
      if (c) return { periodEnd: fyQuarterEnd(yr2(c[2], c[3]), Number(c[1]) as 1 | 2 | 3 | 4),
        grain: "quarterly", basis: "standalone" };

      const d = /\/fy-(\d{2})-(\d{2})\/(?:quarter|quater|q)\s*-?([1-4])/i.exec(u);
      if (d) return { periodEnd: fyQuarterEnd(2000 + Number(d[2]), Number(d[3]) as 1 | 2 | 3 | 4),
        grain: "quarterly", basis: "standalone" };

      const an = /\/(\d{4})-(\d{4})\/(?:annual|yearly)\//i.exec(u);
      if (an) return { periodEnd: fyEnd(yr2(an[1], an[2])), grain: "annual", basis: "standalone" };

      // E — a span folder with no quarter marker. These are year-end drops, and the
      // fiscal year is the only defensible reading of them.
      const e = /\/(\d{4})-(\d{4})\/[^/]+\.pdf/i.exec(u);
      if (e) return { periodEnd: fyEnd(yr2(e[1], e[2])), grain: "annual", basis: "standalone" };

      return null;
    },
  },
  {
    // .../public-disclosure/FY2026/Q1/Website-publication-life-Quarter-ended-June-2025.pdf
    // Folders are CUMULATIVE: Q1=Jun, H1=Sep, 9M=Dec, FY=Mar. "H1" is NOT a half-year row for us —
    // it is the document covering the quarter that ENDS in September.
    symbol: "HDFCLIFE",
    family: "life",
    entryUrl: "https://www.hdfclife.com/about-us/public-disclosure",
    keep: (u) => /\/public-disclosure\//i.test(u),
    classify: (u, label) => {
      const m = /\/public-disclosure\/FY(\d{4})\/(Q1|H1|9M|FY)\//i.exec(u);
      if (!m) return null;
      const fyLabel = Number(m[1]);
      const seg = m[2].toUpperCase();
      const q = seg === "Q1" ? 1 : seg === "H1" ? 2 : seg === "9M" ? 3 : 4;
      return {
        periodEnd: fyQuarterEnd(fyLabel, q as 1 | 2 | 3 | 4),
        // The FY folder's document is the year-end one; it serves the annual row.
        grain: seg === "FY" ? "annual" : "quarterly",
        basis: basisOf(u + label),
      };
    },
  },
  {
    // .../public-disclosure/disclosure/67/website-disclosures-june-2025.pdf
    // The numeric folder is a CMS id, not a period — the month/year in the FILENAME is the period.
    // Its "other-disclosure/" tree (ULIP daily reconciliations, agent lists) is excluded outright:
    // hundreds of daily files that are not periodic accounts.
    symbol: "CANHLIFE",
    family: "life",
    entryUrl: "https://www.canarahsbclife.com/public-disclosures",
    keep: (u) => /\/public-disclosure\//i.test(u) && !/other-disclosure/i.test(u),
    classify: (u, label) => {
      const s = `${u} ${label}`.toLowerCase();
      const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-_]*(20\d{2})/i.exec(s);
      if (!m) return null;
      const end = monthYearToQuarterEnd(MONTHS[m[1].toLowerCase()], Number(m[2]));
      if (!end) return null; // a non-quarter month is not a periodic disclosure
      return {
        periodEnd: end,
        grain: end.endsWith("03-31") && /annual|year/i.test(s) ? "annual" : "quarterly",
        basis: basisOf(s),
      };
    },
  },
];

// ── the crawl ─────────────────────────────────────────────────────────────────────────────────────

/** Every .pdf reference in the document, however embedded — dropdowns and modals hide markup. */
function findPdfLinks(html: string, base: string): { url: string; label: string }[] {
  const seen = new Map<string, string>();
  const add = (raw: string, label: string): void => {
    let u = raw.replace(/&amp;/g, "&").trim();
    if (!u || u.startsWith("data:")) return;
    try { u = new URL(u, base).toString(); } catch { return; }
    const clean = label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // An anchor's text beats a bare attribute match, so only upgrade an empty label.
    if (!seen.has(u) || (!seen.get(u) && clean)) seen.set(u, clean);
  };
  let m: RegExpExecArray | null;
  const a = /<a\b[^>]*href\s*=\s*["']([^"']*\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = a.exec(html)) !== null) add(m[1], m[2]);
  const attr = /(?:href|src|data-[a-z-]*)\s*=\s*["']([^"']*\.pdf[^"']*)["']/gi;
  while ((m = attr.exec(html)) !== null) add(m[1], "");
  const js = /["']([^"'\s]{4,300}?\.pdf(?:\?[^"'\s]*)?)["']/gi;
  while ((m = js.exec(html)) !== null) add(m[1], "");
  return [...seen].map(([url, label]) => ({ url, label }));
}

export interface DiscoveryResult {
  symbol: string;
  entryUrl: string;
  status: number | null;
  totalPdfs: number;
  kept: number;
  classified: number;
  docs: DiscoveredDoc[];
  /** Kept by `keep` but not classifiable — surfaced, never silently dropped. */
  unclassified: { url: string; label: string }[];
  error: string | null;
}

export async function discoverSite(cfg: SiteConfig): Promise<DiscoveryResult> {
  const r = await fetchRaw(cfg.entryUrl, { timeoutMs: 60_000 });
  if (r.status === null || r.status >= 400) {
    return { symbol: cfg.symbol, entryUrl: cfg.entryUrl, status: r.status, totalPdfs: 0, kept: 0,
      classified: 0, docs: [], unclassified: [], error: r.error ?? `HTTP ${r.status}` };
  }
  const all = findPdfLinks(r.text ?? "", r.finalUrl ?? cfg.entryUrl);
  const kept = all.filter((l) => cfg.keep(l.url));
  const docs: DiscoveredDoc[] = [];
  const unclassified: { url: string; label: string }[] = [];
  for (const l of kept) {
    const c = cfg.classify(l.url, l.label);
    if (c) docs.push({ symbol: cfg.symbol, url: l.url, label: l.label || l.url.split("/").pop()!, ...c });
    else unclassified.push(l);
  }
  // A period can legitimately be served by several files (per-form PDFs at GODIGIT); dedupe on URL only.
  return { symbol: cfg.symbol, entryUrl: cfg.entryUrl, status: r.status, totalPdfs: all.length,
    kept: kept.length, classified: docs.length, docs, unclassified, error: null };
}

export async function discoverAll(symbols?: string[]): Promise<DiscoveryResult[]> {
  const targets = symbols ? SITES.filter((s) => symbols.includes(s.symbol)) : SITES;
  const out: DiscoveryResult[] = [];
  for (const cfg of targets) out.push(await discoverSite(cfg));
  return out;
}
