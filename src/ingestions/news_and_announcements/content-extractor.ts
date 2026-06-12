// ─────────────────────────────────────────────────────────────
// Extracts full text content from:
//   1. NSE PDF attachments (via pdf-parse)
//   2. News article pages (via cheerio HTML parsing)
//
// Called after a news item is inserted, before AI processing.
//
// Dependencies:
//   npm install pdf-parse cheerio
//   npm install -D @types/pdf-parse @types/cheerio
// ─────────────────────────────────────────────────────────────

import https from "https";
import { createRequire } from "module";
import * as cheerio from "cheerio";

const require = createRequire(import.meta.url);

// ── Types ─────────────────────────────────────────────────────

export interface ExtractionResult {
  text: string | null;
  source: "pdf_extracted" | "article_scraped" | "rss_snippet" | "failed";
  tokenEstimate: number;
  error?: string;
}

// ── Paywalled sources — use RSS snippet instead of scraping ───

const PAYWALLED_DOMAINS = new Set([
  "economictimes.indiatimes.com",
  "livemint.com",
  "business-standard.com",
  "financialexpress.com", // partial paywall
  "wsj.com",
  "ft.com",
  "bloomberg.com",
]);

// ── Free sources — scrape article body ───────────────────────

const FREE_DOMAINS = new Set([
  "ndtvprofit.com",
  "ndtv.com",
  "thehindubusinessline.com",
  "thehindu.com",
  "reuters.com",
  "businesstoday.in",
  "zeebiz.com",
  "cnbctv18.com",
  "moneycontrol.com", // mostly free
  "indiainfoline.com",
  "equitypandit.com",
  "goodreturns.in",
]);

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isPaywalled(url: string): boolean {
  const domain = getDomain(url);
  return PAYWALLED_DOMAINS.has(domain);
}

// ── HTTP fetch (buffer) ───────────────────────────────────────

function fetchBuffer(url: string, timeoutMs = 15000, signal?: AbortSignal): Promise<Buffer> {
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
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/pdf,*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal,
      } as Parameters<typeof https.get>[1],
      (res) => {
        // Follow redirects (301, 302, 303, 307, 308)
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (location) {
            res.resume(); // drain the response body
            resolve(fetchBuffer(location, timeoutMs, signal));
            return;
          }
        }
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error(`Fetch timed out: ${url}`)),
    );
  });
}

// ── PDF text extraction ───────────────────────────────────────
// Uses pdf-parse to extract all text from NSE PDF attachments.
// NSE PDFs are text-based (not scanned images), so extraction
// is reliable and produces clean structured text.

export async function extractPdfText(
  pdfUrl: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  try {
    const buffer = await fetchBuffer(pdfUrl, 15000, signal);

    const { PDFParse, VerbosityLevel } = require("pdf-parse") as {
      PDFParse: new (opts: { data: Buffer; verbosity: number }) => {
        getText(opts?: {
          max?: number;
          pageJoiner?: string;
        }): Promise<{ pages: Array<{ text: string; num: number }> }>;
      };
      VerbosityLevel: { ERRORS: number };
    };

    const parser = new PDFParse({ data: buffer, verbosity: VerbosityLevel.ERRORS });
    const result = await parser.getText({ max: 10, pageJoiner: "\n" });
    const text = cleanPdfText(result.pages.map((p) => p.text).join("\n"));

    if (!text || text.length < 50) {
      return {
        text: null,
        source: "failed",
        tokenEstimate: 0,
        error: "PDF extracted but text was empty or too short",
      };
    }

    return {
      text,
      source: "pdf_extracted",
      tokenEstimate: Math.round(text.length / 4),
    };
  } catch (e) {
    return {
      text: null,
      source: "failed",
      tokenEstimate: 0,
      error: (e as Error).message,
    };
  }
}

/** Clean PDF-extracted text — remove excessive whitespace, page numbers */
function cleanPdfText(raw: string): string {
  return raw
    .replace(/\f/g, "\n") // form feed → newline
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ newlines to 2
    .replace(/[ \t]{2,}/g, " ") // collapse multiple spaces
    .replace(/^\d+\s*$/gm, "") // remove lone page numbers
    .trim()
    .slice(0, 8000); // cap at ~2000 tokens — enough for AI context
}

// ── Article text extraction ───────────────────────────────────
// Uses cheerio to parse HTML and extract article body content.
// Removes navigation, ads, footers, related articles sections.
// Falls back gracefully for sites with unusual structure.

export async function extractArticleText(
  articleUrl: string,
  rssFallback: string | null,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const domain = getDomain(articleUrl);

  // Paywalled — use RSS snippet
  if (isPaywalled(articleUrl)) {
    return {
      text: rssFallback ?? null,
      source: "rss_snippet",
      tokenEstimate: rssFallback ? Math.round(rssFallback.length / 4) : 0,
    };
  }

  try {
    const buffer = await fetchBuffer(articleUrl, 15000, signal);
    const html = buffer.toString("utf-8");
    const text = parseArticleBody(html, domain);

    if (!text || text.length < 100) {
      // Scraping got too little — fall back to RSS snippet
      return {
        text: rssFallback ?? null,
        source: rssFallback ? "rss_snippet" : "failed",
        tokenEstimate: rssFallback ? Math.round(rssFallback.length / 4) : 0,
        error: "Article body too short after scraping",
      };
    }

    return {
      text: text.slice(0, 6000), // cap at ~1500 tokens
      source: "article_scraped",
      tokenEstimate: Math.round(Math.min(text.length, 6000) / 4),
    };
  } catch (e) {
    // Any fetch/parse error — fall back to RSS snippet
    return {
      text: rssFallback ?? null,
      source: rssFallback ? "rss_snippet" : "failed",
      tokenEstimate: rssFallback ? Math.round(rssFallback.length / 4) : 0,
      error: (e as Error).message,
    };
  }
}

/** Parse article body from HTML using cheerio */
function parseArticleBody(html: string, domain: string): string {
  const $ = cheerio.load(html);

  // Remove noise elements
  $(
    "script, style, nav, header, footer, aside, " +
      ".advertisement, .ads, .social-share, .related-articles, " +
      ".newsletter-signup, .comments, .sidebar, " +
      '[class*="subscribe"], [class*="paywall"], [class*="modal"], ' +
      '[id*="cookie"], [class*="cookie"]',
  ).remove();

  // Try domain-specific selectors first for best extraction
  const domainSelectors: Record<string, string> = {
    "ndtvprofit.com": "article .article__body, .story-content",
    "ndtv.com": "article .story__content, .ins_storybody",
    "thehindubusinessline.com": "article .article-body, .storyline",
    "thehindu.com": "article .article-body-content",
    "reuters.com": 'article [class*="article-body"], .StandardArticleBody_body',
    "businesstoday.in": ".story-content, .article-body",
    "zeebiz.com": ".article-body, .storyDetail",
    "cnbctv18.com": ".article-body, .articleContent",
    "moneycontrol.com": "#article-content, .article-desc",
  };

  const specificSelector = domainSelectors[domain];
  if (specificSelector) {
    const specificText = $(specificSelector).text();
    if (specificText.length > 200) {
      return cleanArticleText(specificText);
    }
  }

  // Generic fallbacks in order of preference
  const genericSelectors = [
    "article",
    '[itemprop="articleBody"]',
    ".article-body",
    ".article-content",
    ".story-content",
    ".post-content",
    ".entry-content",
    "main",
  ];

  for (const sel of genericSelectors) {
    const text = $(sel).text();
    if (text.length > 200) {
      return cleanArticleText(text);
    }
  }

  // Last resort: body text
  return cleanArticleText($("body").text());
}

function cleanArticleText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ── High-impact category check ────────────────────────────────
// Determines whether a news item warrants PDF extraction

const PDF_EXTRACTION_CATEGORIES = new Set([
  "results",
  "dividend",
  "dividends",
  "mergers/acquisitions",
  "amalgamation",
  "credit rating",
  "sebi",
  "insolvency",
  "pledge",
  "pledging",
  "buyback",
  "rights issue",
  "bonus",
  "stock split",
  "preferential issue",
  "fundraising",
  "ipo",
  "fpo",
  "trading window",
]);

export function shouldExtractPdf(
  category: string | null,
  isHighImpact: boolean,
): boolean {
  if (!isHighImpact) return false;
  if (!category) return isHighImpact; // if high impact but no category, still extract
  return PDF_EXTRACTION_CATEGORIES.has(category.toLowerCase());
}

export function shouldScrapeArticle(externalUrl: string | null): boolean {
  if (!externalUrl) return false;
  if (isPaywalled(externalUrl)) return false;
  const domain = getDomain(externalUrl);
  // Only scrape domains we know work well
  return FREE_DOMAINS.has(domain) || !PAYWALLED_DOMAINS.has(domain);
}
