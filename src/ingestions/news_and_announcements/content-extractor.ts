// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONTENT EXTRACTION — NSE PDF ATTACHMENTS. THAT IS THE WHOLE SURFACE.
//
// ★★★ THERE WAS A SECOND HALF AND IT WAS DELETED ON 2026-08-09. DO NOT RESTORE IT. ★★★
//
// This file used to also scrape NEWS ARTICLE BODIES (`extractArticleText`, `parseArticleBody`,
// `cleanArticleText`, `PAYWALLED_DOMAINS`, `FREE_DOMAINS`, `getDomain`, `isPaywalled`,
// `shouldScrapeArticle`, and a cheerio dependency). It is gone, and its absence is a CONCLUSION, not an
// omission — a future reader must not "finish the missing half".
//
// FOUR INDEPENDENT REASONS, EACH MEASURED:
//
//  1. IT NEVER WORKED ONCE. `content_source = 'article_scraped'`: 0 rows out of 23,150 eligible items.
//     Not "low yield" — zero, across the entire history of the table.
//
//  2. THE STORED URL DOES NOT RESOLVE TO AN ARTICLE. `external_url` is a news.google.com redirect, and
//     Google stopped 302-ing it to the publisher. Followed live with a browser UA: HTTP 200, final URL
//     still news.google.com, body ~600 KB of Google's own JS shell. The scraper's last-resort selector
//     is `$("body").text()`, so a re-enabled worker would have stored GOOGLE'S CHROME labelled
//     "article_scraped" — a fabricated body, indistinguishable downstream from a real one.
//
//  3. THE TARGET PUBLISHERS FORBID IT BY NAME. Checked live against the FREE_DOMAINS list this file
//     itself shipped: cnbctv18.com and thehindubusinessline.com both `Disallow: /` for **ClaudeBot**
//     and **Claude-Web** (thehindubusinessline also for **Anthropic-ai**), alongside GPTBot, CCBot,
//     Google-Extended and PerplexityBot. moneycontrol.com bans GPTBot, CCBot and ChatGPT-User. Scraping
//     them as model input is a stated-terms violation, and the deleted code sent a Chrome User-Agent,
//     which would have made it evasion of a stated prohibition rather than a grey area.
//
//  4. THERE IS NOTHING TO RECOVER ANYWAY. Google News RSS carries no snippet — `<description>` is an
//     anchor tag plus a font tag, so stripped it is "{headline} {publisher}". The old paywall branch
//     copied that into `contentText` and labelled it "rss_snippet", which is how 1,281 rows came to
//     hold a headline in a field named content. Those have been cleared.
//
// ── ⚠ THE PDF HALF STAYS, AND IT IS DELIBERATELY UNREACHABLE ─────────────────────────────────────
// `extractPdfText` WORKS: 278 filings already carry genuinely parsed text, nsearchives.nseindia.com
// needs no session or cookie (unlike the rest of NSE), the PDFs have a real text layer, and a 356 KB
// filing fetches and parses in ~80 ms. It is a statutory disclosure the company is required to publish
// — no publisher terms, no paywall, no crawler ban. It is the foundation of the queued
// filing-summaries build, so deleting it would mean rebuilding it.
//
// It is held behind CONTENT_EXTRACTION_ENABLED = false (below), and re-enabling is deliberately TWO
// edits: that flag AND a cron entry in lib/scheduler.ts.
//
// Dependencies: pdf-parse only. cheerio went with the article half.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import https from "https";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Types ─────────────────────────────────────────────────────

export interface ExtractionResult {
  text: string | null;
  /**
   * ⚠ "article_scraped" IS RETAINED IN THIS UNION AND NOTHING PRODUCES IT. It stays because
   * `stock_news.content_source` is a free-text column and the value must remain READABLE if it ever
   * appears in an old row — not because anything may write it again. See the header.
   * "rss_snippet" is likewise historical: those rows have been cleared and nothing writes it now.
   */
  source: "pdf_extracted" | "article_scraped" | "rss_snippet" | "failed";
  tokenEstimate: number;
  error?: string;
}

// ── HTTP fetch (buffer) ───────────────────────────────────────
// Shared with nothing now — the PDF path is its only caller. Kept as its own function because the
// retry/redirect/timeout behaviour is the fiddly part and inlining it into extractPdfText would bury it.

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

// ══ ★★★ THE MASTER SWITCH — THE CAUSE, NOT THE SYMPTOM ════════════════════════════════════════════
//
// Content extraction has been OFF since 2026-07-26, when `news-extraction-worker` was removed from
// lib/scheduler.ts. Nothing consumes `contentText`, and the publishers worth scraping ban AI crawlers
// by name (cnbctv18.com and thehindubusinessline.com Disallow ClaudeBot and Claude-Web explicitly).
//
// ⚠ BUT THE INGEST KEPT WRITING `extraction_status: "pending"`, so the queue refilled itself. The
// scheduler comment records that the 6,544 rows pending at switch-off were re-marked "skipped"
// PRECISELY so nothing would infer work that will never happen — and two weeks of ingest put 15,805
// rows back. Re-marking the rows again without closing this door would repeat that exactly.
//
// This flag is the door. While it is false:
//   · no row is ever written with status "pending" — see the insert functions in ingest-news.ts;
//   · `pendingExtraction` counters stay 0, so runDailyNewsIngest does not invoke the worker inline;
//   · the worker, its job type, its dispatcher entry and its admin trigger ALL still work, so a
//     one-off manual run remains possible. Nothing is deleted.
//
// RE-ENABLING IS TWO EDITS, DELIBERATELY: flip this flag AND re-add the cron entry in scheduler.ts.
// One without the other is a half-state — a scheduled worker with an empty queue, or a filling queue
// with no worker. Rows written while it was off are "skipped" and will NOT be picked up; that is the
// same intended behaviour the 2026-07-26 note describes, and stock_news prunes at 90 days anyway.
export const CONTENT_EXTRACTION_ENABLED = false;

/**
 * The honest `extraction_status` for a row we are choosing not to extract. "skipped" is the value the
 * worker itself writes when it declines, and it is what the 2026-07-26 re-marking used — one value,
 * one meaning, rather than a second synonym for the same decision.
 */
export const EXTRACTION_DECLINED = "skipped" as const;

export function shouldExtractPdf(
  category: string | null,
  isHighImpact: boolean,
): boolean {
  if (!CONTENT_EXTRACTION_ENABLED) return false;
  if (!isHighImpact) return false;
  if (!category) return isHighImpact; // if high impact but no category, still extract
  return PDF_EXTRACTION_CATEGORIES.has(category.toLowerCase());
}

// ⚠ `shouldScrapeArticle` WAS HERE AND IS DELETED. Nothing decides whether to scrape an article,
// because nothing scrapes articles — see the four reasons in the file header. Press rows are inserted
// with extraction_status = EXTRACTION_DECLINED unconditionally; there is no branch left to take.
