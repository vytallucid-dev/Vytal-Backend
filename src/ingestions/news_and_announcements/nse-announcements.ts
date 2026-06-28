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

// ── High-impact detection ─────────────────────────────────────

const HIGH_IMPACT_CATEGORIES = new Set([
  "Results",
  "Dividend",
  "Dividends",
  "Mergers/Acquisitions",
  "Amalgamation",
  "Credit Rating",
  "SEBI",
  "Insolvency",
  "Pledge",
  "Buyback",
  "Rights Issue",
  "Bonus",
  "Stock Split",
  "Preferential Issue",
  "Fundraising",
  "Trading Window",
]);

const HIGH_IMPACT_KEYWORDS = [
  "financial result",
  "quarterly result",
  "annual result",
  "order received",
  "order win",
  "contract awarded",
  "management change",
  "ceo",
  "md resignation",
  "sebi order",
  "pledge",
  "revoke",
  "invoke",
  "acquisition",
  "merger",
  "demerger",
  "credit rating",
  "downgrade",
  "upgrade",
  "insolvency",
  "nclt",
  "cci approval",
  "fundraise",
  "qip",
  "rights issue",
  // ── Added: headline fallbacks for when NSE omits category field ──
  "dividend",
  "buyback",
  "bonus",
  "stock split",
  "preferential",
  "amalgamation",
  "open offer",
  "delisting",

  "results",
  "dividend",
  "dividends",
  "mergers/acquisitions",
  "amalgamation",
  "credit rating",
  "sebi",
  "insolvency",
  "pledge",
  "buyback",
  "rights issue",
  "bonus",
  "stock split",
  "preferential issue",
  "fundraising",
  "trading window",
];

function detectHighImpact(category: string | null, headline: string): boolean {
  if (category && HIGH_IMPACT_CATEGORIES.has(category)) return true;
  const lower = headline.toLowerCase();
  return HIGH_IMPACT_KEYWORDS.some((kw) => lower.includes(kw));
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

function buildPdfUrl(attchmntFile: string): string | null {
  if (!attchmntFile || attchmntFile.trim() === "") return null;
  if (attchmntFile.startsWith("http")) return attchmntFile;
  // Relative path → prepend NSE archives base
  return `https://nsearchives.nseindia.com${attchmntFile}`;
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
      const isHighImpact = detectHighImpact(category, headline);

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
