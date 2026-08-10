// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELEVANCE SCREENING FOR STORED NEWS ROWS — the read-path half of the entity guard.
//
// ★ WHY THIS RUNS ON READ AND NOT AT INGEST. Measured: only ~30% of stored google_news rows are about
// the company they are filed under. The binding rule is a Google search string — `"{shortName}" stock
// NSE India when:Nd` — with no entity verification of any kind, so whatever the query returns is
// written against that stockId. CUMMINSIND held 84 rows for a 90-day window; 18 survive this screen.
// The two remaining top items before it were a Sensex wrap and a POWERGRID quote page.
//
// Screening on READ rather than at ingest is deliberate and reversible:
//   · a calibration change takes effect immediately, with no re-fetch and no backfill;
//   · the raw row is preserved, so a mis-tuned rule loses nothing permanently;
//   · the screen can be measured against the stored corpus at any time (that is how every number in
//     this file's comments was obtained).
// The cost is one indexed scan per request instead of a LIMIT — see `MAX_WINDOW_ROWS`.
//
// ── ⚠⚠ FILINGS ARE NEVER SCREENED. THE TWO STREAMS ARE NOT SYMMETRIC. ────────────────────────────
// `nse_announcement` rows come from NSE's own per-symbol corporate-announcements endpoint. They are
// bound to the company BY THE EXCHANGE, so there is no relevance question to answer and no screen to
// apply — passing a filing through an entity guard could only ever produce a false drop, because the
// `headline` is a filing-type bucket ("Outcome of Board Meeting") that frequently does not contain the
// company's name at all. `screenStoredNews` therefore keeps every filing untouched, and the split is
// asserted in the return value (`considered` counts ONLY google_news rows).
//
// The PURE core lives in chat/web/news-filter.ts and is shared with the chat tool's getStockNews.
// That tool screens LIVE Serper results; this screens STORED rows. Same rules, different input — the
// only thing duplicated here is the sibling read, and it is duplicated because the shapes differ.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import {
  buildEntityGuard,
  screenNewsItems,
  shortenCompanyName,
  type DropReason,
  type EntityGuard,
} from "../../chat/web/news-filter.js";

/**
 * Upper bound on rows pulled for one (stock, window) screen. Retention prunes stock_news at 90 days
 * by published_at, and the busiest covered stock holds 146 rows across that whole window, so this
 * ceiling is ~7× the real maximum and exists only so a future retention change cannot turn this read
 * into an unbounded scan. If it is ever hit, the screen is still correct — it just sees a truncated
 * window, and `considered` says so.
 */
const MAX_WINDOW_ROWS = 1_000;

/** The subset of a StockNews row this screen needs. Kept structural so callers choose their own select. */
export interface ScreenableRow {
  sourceType: string;
  headline: string;
  summary: string | null;
  publisherDomain: string | null;
  /** The publisher's DISPLAY name. Carried for the screen's `source` field only — never as a host. */
  category: string | null;
}

export interface ScreenOutcome<T> {
  /** Kept rows, ordered SUBJECTS first then MENTIONS, each block newest-first. See `isSubject`. */
  kept: T[];
  /** google_news rows examined. Filings are excluded — they are never screened. */
  considered: number;
  /** google_news rows removed. `kept.length + hidden` = considered + (filings, all kept). */
  hidden: number;
  /** Kept rows where the company is the SUBJECT. Filings always count here — see `isSubject`. */
  subjects: number;
  /** Kept rows that name the company but are about something else (a watchlist, a market wrap). */
  mentions: number;
  byReason: Partial<Record<DropReason, number>>;
}

/**
 * ★★★ HOW FAR INTO THE HEADLINE THE COMPANY APPEARS — THE ONE MEASUREMENT THAT SPLITS
 * "ABOUT THIS COMPANY" FROM "MENTIONS IT". ★★★
 *
 * The entity guard separates about-or-mentions from neither. It cannot separate the first two, so a
 * listicle that names the company survives it: "Stocks to Watch Today: Aurobindo Pharma, Cohance,
 * Hindalco, Cummins, PB Fintech, …" was the top item on CUMMINSIND's card. Honest, and still the first
 * thing a reader saw.
 *
 * ── ⚠ POSITION 0 IS NOT THE RULE, AND THE CORPUS SAYS WHY ────────────────────────────────────────
 * "ONGC, Oil India fall up to 2% as Brent crude drops below $90" is genuinely about Oil India, and its
 * name starts at character 6. "Mazagon Dock, Cochin Shipyard to GRSE: Defence Shipbuilding stocks
 * rise" is about Cochin Shipyard, at character 14. A first-position test throws both away.
 *
 * ── ⚠⚠ AND CO-MENTION COUNTING WAS TESTED AND REJECTED, WHICH WAS THE SURPRISE ───────────────────
 * The obvious refinement is "…and few other covered companies are named". Measured, it is HARMFUL:
 * "Bank of Baroda, Canara Bank, Federal Bank shares rally; NIFTY Bank surges" names FOUR other covered
 * companies and is unambiguously about Bank of Baroda, at position 0. Every co-mention threshold
 * demoted it, and none of them improved the split on the labelled set (B→subject stayed at 1 of 6
 * whether the threshold was 0, 1 or 2). So the rule is position ALONE.
 *
 * ── THE NUMBERS ──────────────────────────────────────────────────────────────────────────────────
 * Against the hand-labelled set: all 10 "about" items are SUBJECT, all 5 genuine multi-company
 * stories are SUBJECT, and 5 of 6 listicles/wraps demote. The one that survives as a subject is
 * "Urban Company, ITC, Redington among buzzing stocks" at exactly 20 — weak, not wrong, and it is
 * DEMOTED not dropped, so the cost of that error is a row one place too high.
 * Corpus-wide, post-screen: 81.5% SUBJECT / 18.5% MENTION.
 */
export const SUBJECT_LEAD_CHARS = 20;

/**
 * Is the company the subject of this row?
 *
 * ⚠ A FILING IS ALWAYS A SUBJECT, and not as a convenience. Filings come from NSE's own per-symbol
 * endpoint — the exchange binds them to the company — and their `headline` is a type bucket
 * ("Outcome of Board Meeting") that usually does not contain the company's name at all. Measuring
 * position on a filing would rank every one of them as a mention and bury the regulatory record under
 * press coverage on the `type=all` view the watchlist sheet uses.
 */
export function isSubject(row: ScreenableRow, guard: EntityGuard): boolean {
  if (row.sourceType !== "google_news") return true;
  const low = row.headline.toLowerCase();
  let pos = Number.POSITIVE_INFINITY;
  for (const alias of guard.aliases) {
    const i = low.indexOf(alias.toLowerCase());
    if (i >= 0) pos = Math.min(pos, i);
  }
  // The ticker, case-sensitively — "NSE: CYIENT" is an unambiguous reference; "idea" is not.
  if (guard.symbol.length >= 3) {
    const i = row.headline.indexOf(guard.symbol);
    if (i >= 0) pos = Math.min(pos, i);
  }
  return pos <= SUBJECT_LEAD_CHARS;
}

/**
 * Build the entity guard for one covered stock.
 *
 * ⚠ THE SIBLING READ IS DELIBERATELY WIDER THAN "NAMES EXTENDING OURS" — it matches covered companies
 * sharing our FIRST WORD, because that same list does two jobs: it supplies sibling markers AND it is
 * the collision test that decides whether a shorter alias is safe to admit. A narrow read cannot see
 * that "Adani" is shared by five listings and would hand every Adani headline to whichever one the
 * reader opened. Over-matching here only ever REFUSES an alias, never admits one.
 */
export async function buildGuardForStock(symbol: string, name: string): Promise<EntityGuard> {
  const shortName = shortenCompanyName(name) || name;
  const firstWord = shortName.split(/\s+/)[0];
  const siblings = await prisma.stock.findMany({
    where: { name: { startsWith: firstWord, mode: "insensitive" }, NOT: { symbol } },
    select: { name: true },
    take: 60,
  });
  return buildEntityGuard(symbol, name, siblings.map((s) => s.name));
}

/**
 * Screen stored rows. Filings pass through untouched; press rows must name the company and must not
 * be a quote page, a recommendation listicle or a sibling entity.
 *
 * ── ★ NULL `publisherDomain` MEANS "NO HOST CLAIM", NOT "A CLEAN HOST" ──────────────────────────
 * Every host rule in news-filter.ts is a POSITIVE-MATCH BAN (`host === h`, `host.endsWith('.'+h)`, a
 * path regex). Passing an empty link makes `hostOf` return "", which matches no ban, so the host rules
 * ABSTAIN — they neither keep nor drop on host grounds, and the entity guard and title rules decide
 * the item on their own. That is exactly the behaviour we want while the column backfills, and it is
 * why nothing here changes when the column later fills: the same code simply starts having a host to
 * test. The alternative — passing the stored `externalUrl` — would hand the screen a REAL host
 * (news.google.com) for every row, which is a lie about the publisher and would drop the entire table
 * the day anyone added news.google.com to JUNK_HOSTS.
 *
 * ⚠ Do NOT "fix" the null case by falling back to `category`. It is a display name ("The Economic
 * Times"), not a domain; 70.6% of stored rows carry one, and mapping names to hosts is guessing.
 *
 * ── ★ WHAT THIS SCREEN DOES NOT DO, AND THE MEASURED OPENING FOR A LATER PASS ────────────────────
 * It separates ABOUT-or-MENTIONS from NEITHER. It does NOT separate ABOUT from MENTIONS, so a listicle
 * that names the company survives: "Stocks to Watch Today: Aurobindo Pharma, Cohance, Hindalco,
 * Cummins, …" is kept, because the company IS named in the title. In the hand-classified sample all 6
 * of 6 such items survived. That is why the count line says "press items" and never "stories about
 * this company" — the copy is built around this residual, not in spite of it.
 *
 * THE VIABLE NEXT RULE, already measured: 80% of kept items name the company within the FIRST 30
 * CHARACTERS of the headline, i.e. as the grammatical subject rather than as the fourth name in a list.
 * A leading-subject test would split the two classes with no model and no new data. It is not built
 * here because it needs its own calibration pass — a genuine two-company story ("ONGC, Oil India fall
 * up to 2% as Brent crude drops") leads with one name and is legitimately about both, so the rule
 * cannot simply be "position 0".
 */
export function screenStoredNews<T extends ScreenableRow>(rows: T[], guard: EntityGuard): ScreenOutcome<T> {
  const kept: T[] = [];
  const byReason: Partial<Record<DropReason, number>> = {};
  let considered = 0;
  let hidden = 0;

  for (const row of rows) {
    if (row.sourceType !== "google_news") {
      kept.push(row); // a filing — bound by the exchange, never screened
      continue;
    }
    considered++;
    const result = screenNewsItems(
      [
        {
          title: row.headline,
          // `summary` on a google_news row is "{headline} {publisher}" and carries nothing extra, but
          // the screen's snippet path is harmless on it and is the field a licensed source would fill.
          snippet: row.summary ?? "",
          link: row.publisherDomain ? `https://${row.publisherDomain}/` : "",
          source: row.category ?? "",
          // The screen reads title, snippet and link only. `date` exists on the shared item shape
          // because Serper reports a RELATIVE string ("9 hours ago"); a stored row has a real
          // timestamp, and inventing a relative rendering of it here would be a fabricated field.
          date: "",
        },
      ],
      guard,
    );
    if (result.kept.length) kept.push(row);
    else {
      hidden++;
      const reason = result.dropped[0].reason;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }

  // ★ DEMOTE, DO NOT DROP. A "Stocks to Watch" item that names the company is WEAK, not WRONG — it is
  // true that the stock is in focus today. Hiding it would discard a real (if thin) signal and make the
  // screen look more decisive than the evidence supports; the position rule is one measurement, and the
  // one labelled error it makes is a borderline row at exactly 20 characters. Ranking is the honest
  // response to a weak signal: subjects lead, mentions remain reachable, and the count line says which
  // is which so the top of the list is never mistaken for the whole of it.
  //
  // A STABLE partition, so recency order survives inside each block — `rows` arrives publishedAt DESC
  // and Array.prototype.filter preserves it. (A comparator-based sort would need an explicit tiebreak;
  // two filters need none, which is why this is not `.sort()`.)
  const subjectRows = kept.filter((r) => isSubject(r, guard));
  const mentionRows = kept.filter((r) => !isSubject(r, guard));

  return {
    kept: [...subjectRows, ...mentionRows],
    considered,
    hidden,
    subjects: subjectRows.length,
    mentions: mentionRows.length,
    byReason,
  };
}

export { MAX_WINDOW_ROWS };
