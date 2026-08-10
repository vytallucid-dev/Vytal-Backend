// src/lib/news/google-news.ts
// ─────────────────────────────────────────────────────────────
// Fetches media news from Google News RSS.
//
// ⚠ IT NO LONGER MARKS ITEMS FOR SCRAPING. The `shouldScrape` field and the article scraper behind it
// were deleted on 2026-08-09 — 0 successes in 23,150 attempts, the stored URL resolves to Google's JS
// shell rather than the article, and three of the target publishers ban Anthropic's crawler by name.
// See the header of content-extractor.ts for the full reasoning; do not reintroduce the field.
// ─────────────────────────────────────────────────────────────

import https from "https";
import { looksLikeRss } from "./news-guards.js";

// ── Types ─────────────────────────────────────────────────────

export interface GoogleNewsItem {
  symbol: string;
  sourceId: string; // RSS GUID
  headline: string;
  /**
   * ⚠ NOT A SNIPPET, AND NEVER HAS BEEN. Google News RSS `<description>` is markup, not prose:
   *     <a href="{the same link}">{the title minus the publisher}</a>&nbsp;&nbsp;<font>{publisher}</font>
   * Stripped of HTML that is "{headline} {publisher}" — measured byte-exact on 22,870 of 23,150
   * stored rows, and 0 of 29 items in a live fetch deviated from the pattern. So this field carries
   * ZERO information beyond `headline` + `sourceName`.
   *
   * It is still stored, deliberately: a licensed source with real article text would land here, and
   * the NSE stream's `summary` (attchmntText) IS genuine content in the same column. Consumers must
   * branch on sourceType — never render this for google_news, and never feed it to a model.
   */
  summary: string | null;
  externalUrl: string; // article URL (always stored)
  sourceName: string | null;
  /** The publisher's real host from `<source url>`, lowercased and www-stripped. See publisherDomain. */
  publisherDomain: string | null;
  publishedAt: Date;
  isHighImpact: boolean;
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
          "User-Agent": "Mozilla/5.0 (compatible; Vytal/1.0; RSS reader)",
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
//
// ⚠ THE REDIRECT NO LONGER RESOLVES TO THE ARTICLE. Followed live with a browser UA it returns
// HTTP 200 whose final URL is still news.google.com and whose body is ~600 KB of Google's own JS
// shell. This is why `content_source = 'article_scraped'` has 0 rows out of 23,150 eligible items,
// and why the publisher must be read from `<source url>` instead of parsed out of this link.
function resolveGoogleUrl(rawLink: string): string {
  return rawLink.trim();
}

/**
 * The publisher's real host, from `<source url="https://www.moneycontrol.com">Moneycontrol.com</source>`.
 * Present on 29/29 items in a live fetch and previously discarded by this parser.
 *
 * Returns a bare lowercase host with `www.` stripped, so it compares directly against the JUNK_HOSTS
 * / JUNK_PATHS rules in chat/web/news-filter.ts (which normalise the same way in `hostOf`). Null when
 * the element is missing or unparseable — never a guess, and never an empty string, because the
 * screen distinguishes "no domain known" from "a domain that matched nothing".
 */
function extractSourceDomain(itemXml: string): string | null {
  const m = itemXml.match(/<source\b[^>]*\burl\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  try {
    return new URL(decodeEntities(m[1].trim())).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// ── Main fetcher ───────────────────────────────────────────────

/**
 * Result of one RSS fetch. `malformed` = the 200 body was NOT RSS-shaped
 * (consent/captcha/HTML block page) → 0 items silently. A valid-but-empty
 * RSS feed (genuine quiet stock) is `malformed: false, items: []`. HTTP
 * errors (403/timeout) still THROW (the caller counts those as a dead fetch).
 */
export interface GoogleNewsFetch {
  items: GoogleNewsItem[];
  malformed: boolean;
}

/**
 * The `when:` recency operator for the search query.
 *
 * ★ WHY THIS EXISTS — THE FETCH BUDGET WAS BEING SPENT ON ARCHIVE MATERIAL.
 * Google News ranks this query by RELEVANCE, not date, and the unconstrained feed spans years
 * (measured: up to 9.6 years, median item age ~6 months). The caller takes the first `maxItems`
 * and then drops anything older than its cutoff — so almost nothing survived. Measured across six
 * symbols: 6 of 120 fetched items were inside a 7-day window; for two of them, ZERO, meaning a
 * daily run stored nothing at all for those names. With the operator: 95 of 120.
 *
 * The window is DERIVED FROM THE CALLER'S `daysBack`, never hardcoded, so the query and the
 * caller's `publishedAt >= cutoff` filter cannot disagree about what "recent" means.
 *
 * ⚠ `when:0d` IS NOT AN EMPTY WINDOW — it is silently ignored, and the feed comes back
 * unconstrained (measured: 48 items, oldest 3.5 years). So a non-positive window must omit the
 * operator rather than emit `when:0d`, which would look like a filter while being none.
 */
function whenClause(windowDays?: number): string {
  if (windowDays === undefined || !Number.isFinite(windowDays)) return "";
  const d = Math.floor(windowDays);
  return d >= 1 ? ` when:${d}d` : "";
}

export async function fetchGoogleNews(
  symbol: string,
  companyName: string,
  maxItems: number = 20,
  signal?: AbortSignal,
  /** Recency window in days — pass the caller's `daysBack`. Omitted ⇒ unconstrained (legacy). */
  windowDays?: number,
): Promise<GoogleNewsFetch> {
  // Short company name works better for search
  const shortName = companyName
    .replace(/\s+(limited|ltd\.?|private|pvt\.?)$/i, "")
    .trim();

  const query = encodeURIComponent(
    `"${shortName}" stock NSE India${whenClause(windowDays)}`,
  );
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;

  const xml = await httpsGetText(url, signal);
  const malformed = !looksLikeRss(xml);
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
      summary, // stored, but carries no information beyond headline + publisher — see the type
      externalUrl, // always stored (the Google redirect, NOT the publisher)
      sourceName,
      publisherDomain: extractSourceDomain(itemXml),
      publishedAt,
      isHighImpact: detectHighImpact(headline, summary),
    });
  }

  return { items: results, malformed };
}
