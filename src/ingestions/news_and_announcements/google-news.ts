// src/lib/news/google-news.ts
// ─────────────────────────────────────────────────────────────
// Fetches media news from Google News RSS.
// Marks each item with whether article scraping should be attempted.
// ─────────────────────────────────────────────────────────────

import https from "https";
import { shouldScrapeArticle } from "./content-extractor.js";

// ── Types ─────────────────────────────────────────────────────

export interface GoogleNewsItem {
  symbol: string;
  sourceId: string; // RSS GUID
  headline: string;
  summary: string | null; // RSS description snippet (always stored)
  externalUrl: string; // article URL (always stored)
  sourceName: string | null;
  publishedAt: Date;
  isHighImpact: boolean;
  shouldScrape: boolean; // should full article be scraped?
}

// ── High-impact detection ─────────────────────────────────────

const HIGH_IMPACT_KW = [
  "quarterly result",
  "q1 result",
  "q2 result",
  "q3 result",
  "q4 result",
  "annual result",
  "profit",
  "revenue",
  "earnings",
  "ebitda",
  "dividend",
  "bonus",
  "split",
  "buyback",
  "acquisition",
  "merger",
  "demerger",
  "takeover",
  "sebi",
  "rbi approval",
  "cci",
  "order win",
  "contract",
  "deal win",
  "ceo resign",
  "md resign",
  "management change",
  "block deal",
  "fii buying",
  "fii selling",
  "downgrade",
  "upgrade",
  "target price",
  "debt default",
  "insolvency",
  "nclt",
  "qip",
  "rights issue",
  "ipo",
  "fundraise",
];

function detectHighImpact(headline: string, summary: string | null): boolean {
  const text = `${headline} ${summary ?? ""}`.toLowerCase();
  return HIGH_IMPACT_KW.some((kw) => text.includes(kw));
}

// ── RSS fetch ─────────────────────────────────────────────────

function httpsGetText(url: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Request aborted') as NodeJS.ErrnoException
      err.name = 'AbortError'
      reject(err)
      return
    }
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; InvestIQ/1.0; RSS reader)",
          Accept: "application/rss+xml,application/xml,text/xml,*/*",
        },
        signal,
      } as Parameters<typeof https.get>[1],
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Google News RSS HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("RSS timed out")));
  });
}

// ── Minimal RSS parser ────────────────────────────────────────

function extractTag(xml: string, tag: string): string | null {
  const m =
    xml.match(
      new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`,
        "i",
      ),
    ) ?? xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function extractAllItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Google News title format: "Headline text - Publication Name" */
function parseTitle(raw: string): {
  headline: string;
  sourceName: string | null;
} {
  const clean = decodeEntities(raw).trim();
  const lastDash = clean.lastIndexOf(" - ");
  if (lastDash > 20) {
    return {
      headline: clean.slice(0, lastDash).trim(),
      sourceName: clean.slice(lastDash + 3).trim(),
    };
  }
  return { headline: clean, sourceName: null };
}

function parsePubDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d;
}

// Google News wraps article URLs in their own tracking redirect
// We store the Google redirect URL as-is — article scraper follows redirect
function resolveGoogleUrl(rawLink: string): string {
  return rawLink.trim();
}

// ── Main fetcher ───────────────────────────────────────────────

export async function fetchGoogleNews(
  symbol: string,
  companyName: string,
  maxItems: number = 20,
  signal?: AbortSignal,
): Promise<GoogleNewsItem[]> {
  // Short company name works better for search
  const shortName = companyName
    .replace(/\s+(limited|ltd\.?|private|pvt\.?)$/i, "")
    .trim();

  const query = encodeURIComponent(`"${shortName}" stock NSE India`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;

  const xml = await httpsGetText(url, signal);
  const items = extractAllItems(xml).slice(0, maxItems);
  const results: GoogleNewsItem[] = [];

  for (const itemXml of items) {
    const rawTitle = extractTag(itemXml, "title") ?? "";
    const guid = extractTag(itemXml, "guid") ?? "";
    const link = extractTag(itemXml, "link") ?? "";
    const pubDate = extractTag(itemXml, "pubDate") ?? "";
    const description = extractTag(itemXml, "description") ?? null;

    if (!rawTitle || !guid) continue;

    const publishedAt = parsePubDate(pubDate);
    if (!publishedAt) continue;

    const { headline, sourceName } = parseTitle(rawTitle);

    // RSS snippet — always store this as summary fallback
    const summary = description
      ? stripHtml(decodeEntities(description)).slice(0, 500)
      : null;

    const externalUrl = resolveGoogleUrl(link);

    results.push({
      symbol: symbol.toUpperCase(),
      sourceId: guid,
      headline,
      summary, // always stored (RSS snippet)
      externalUrl, // always stored (article URL)
      sourceName,
      publishedAt,
      isHighImpact: detectHighImpact(headline, summary),
      shouldScrape: shouldScrapeArticle(externalUrl),
    });
  }

  return results;
}
