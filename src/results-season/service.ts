// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESULTS-SEASON BANNER — resolution. One reader, one stock, one answer: a banner or silence.
//
// ── ★ WHAT THIS SURFACE IS ABOUT ───────────────────────────────────────────────────────────────────
// Results are coming, or they have arrived. That is the subject. Whether OUR score has caught up is a
// different fact about a different thing, and it must not decide whether the reader is told.
//
// That sentence cost two gates. Both silenced the banner on a state the reader most wanted to see:
// gate 3 hid a stock that had filed that morning, gate 4 hid one whose score had been refreshed. The
// framing they served was wrong, so they are gone rather than tuned.
//
// ── THE THREE CHECKS THAT REMAIN ───────────────────────────────────────────────────────────────────
// Each was put there by a MEASUREMENT, not a hunch; the numbers are recorded so they can be re-checked.
//
//  1 · no scheduled date / outside T-7…T+7  → silence. Not an empty state, not a "nothing scheduled"
//      line. A results date is only interesting inside its window.
//
//  2 · ★ THE STOCK IS NOT SCORED → the UNSCORED COPY SET, not silence. It suppressed 180 of 205 dates
//      in a live window before this changed. A results date is a fact about the COMPANY, not about our
//      coverage. Only 95 of 504 active stocks carry a snapshot (the Nifty-500 expansion firewall), so
//      the unscored set is the COMMON case, not the edge one. What could not ship there was the scored
//      copy: its clauses name a score and pillars that do not exist on such a page. So this SELECTS.
//
//  5 · publication is CONFIRMED or it is not, and the copy branches on it. ★ THE ONLY SURVIVING CHECK
//      ON THE COPY, and it survives because it guards a claim about the WORLD — did this company
//      report? — rather than a claim about our coverage. Confirmation is the existence of a stored
//      filing for the period, an independent fact from a different NSE endpoint than the calendar row.
//      Measured: 380 of 398 past scheduled dates (95.5%) carry one, and its filing_date equals the
//      scheduled date in 379 of those 380.
//
// The numbering is kept from the original design so the deletions stay legible: 3 and 4 are absent on
// purpose, and a reader who remembers them can see that they were removed rather than renumbered away.
//
// ── ★ EVERY REMAINING PATH TO SILENCE ──────────────────────────────────────────────────────────────
// There are five, and only five. Four are typed; one is not reachable from this module at all.
//   · unknown_stock         no such stock, or inactive.
//   · no_scheduled_date     no earnings row inside T-7…T+7. Depends on calendar coverage, which was
//                           measured complete: all 385 June-2026 filers have a matching row.
//   · outside_window        UNREACHABLE — the query and `phaseFor` share WINDOW_DAYS. Defence in depth.
//   · filing_lookup_failed  the filing read threw. Fail-closed: gate 5 cannot be sound without it.
//   · (frontend)            `stockId` null while the health read resolves, or the fetch fails. The
//                           strip renders nothing; it is conditional and unskeletoned by design.
// `pickScheduledDate` CHOOSES among a stock's rows rather than silencing — a reschedule leaves the old
// row behind and the live one wins. `eventDate` is a non-null `@db.Date`, so a null or unparseable
// date is not representable.
//
// ── REUSE, NOT A SECOND IMPLEMENTATION ─────────────────────────────────────────────────────────────
// Held / watchlisted resolve through `probeStockRelationship` + `holdsPositiveQuantity` — the exact
// pair the relational layer routes on, quantity-gated so a fully-exited legacy row is not a position.
// Nothing about the reader is re-derived here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { probeStockRelationship } from "../ai/insight/relationship.js";
import { holdsPositiveQuantity } from "../relational/reader-context.js";
import { istDateOnly } from "../lib/ist-date.js";
import {
  formatBannerDate,
  periodDescriptorFor,
  periodEndFor,
  phaseFor,
  pickScheduledDate,
  pillarsAtStakeFor,
  today,
  WINDOW_DAYS,
} from "./window.js";
import { composeCopy, joinSegments, LINK_LABEL, linkHref } from "./copy.js";
import type {
  ReaderPosition,
  ResultsSeasonBanner,
  ResultsSeasonCopySet,
  ResultsSeasonPhase,
  ResultsSeasonResolution,
  ResultsSeasonSilence,
} from "./types.js";

const silence = (reason: ResultsSeasonSilence): ResultsSeasonResolution => ({ banner: null, silence: reason });

/** The stock-side facts, resolved in one statement. Everything the phase and the gates need. */
interface StockFacts {
  symbol: string;
  /** Every earnings date for this stock inside T-7…T+7. `pickScheduledDate` chooses among them. */
  scheduledDates: Date[];
  /** In-force snapshot head. `null` ⇒ never scored ⇒ the unscored copy set (gate 2), and the reason
   *  gate 4 cannot fire there. Two jobs, one field, deliberately — they are the same fact. */
  headSnapshotAt: Date | null;
}

/**
 * ★ ONE QUERY, FIVE UNION'D FILING TABLES. A filing lives in whichever per-family table matches the
 * company's industry (IndAS / banking / NBFC / life / general insurance) and the banner does not care
 * which — only that a row exists for the period. `report_date` is the PERIOD END and carries the same
 * calendar quarter-end in all five (verified: 591 / 47 / 61 / 6 / 3 rows, one distinct date each).
 *
 * ── ★ IT RETURNS THE FILING DATE, NOT THE INGEST TIME, AND THAT IS THE WHOLE RESHAPE ───────────────
 * It used to return `created_at` — when WE wrote the row — because the deleted gate 4 compared that
 * against the snapshot clock. Nothing needs our clock any more. What the copy needs is when the
 * company actually published, which is `filing_date`, and that is also what decides `filed_today`.
 *
 * EARLIEST, not latest: a period can carry both a standalone and a consolidated row, and the results
 * were published when the FIRST of them was filed. Measured, the two share a date in every case seen.
 */
async function filingForPeriod(
  stockId: string,
  periodEnd: Date,
): Promise<{ filedOn: Date } | null> {
  const rows = await prisma.$queryRaw<{ filed_on: Date | null }[]>`
    SELECT min(filing_date) AS filed_on FROM (
      SELECT filing_date FROM quarterly_results                  WHERE stock_id = ${stockId} AND report_date = ${periodEnd}
      UNION ALL
      SELECT filing_date FROM banking_quarterly_results          WHERE stock_id = ${stockId} AND report_date = ${periodEnd}
      UNION ALL
      SELECT filing_date FROM nbfc_quarterly_results             WHERE stock_id = ${stockId} AND report_date = ${periodEnd}
      UNION ALL
      SELECT filing_date FROM life_insurance_quarterly_results   WHERE stock_id = ${stockId} AND report_date = ${periodEnd}
      UNION ALL
      SELECT filing_date FROM general_insurance_quarterly_results WHERE stock_id = ${stockId} AND report_date = ${periodEnd}
    ) f
  `;
  const at = rows[0]?.filed_on ?? null;
  return at ? { filedOn: at } : null;
}

async function loadStockFacts(stockId: string, todayDate: Date): Promise<StockFacts | null> {
  const from = new Date(todayDate.getTime() - WINDOW_DAYS * 86400000);
  const to = new Date(todayDate.getTime() + WINDOW_DAYS * 86400000);

  const [stock, events, head] = await Promise.all([
    prisma.stock.findUnique({ where: { id: stockId }, select: { symbol: true, isActive: true } }),
    prisma.corporateEvent.findMany({
      where: { stockId, eventType: "earnings", eventDate: { gte: from, lte: to } },
      select: { eventDate: true },
    }),
    // The supersede-aware head, the SAME resolution the read layer uses: newest period, newest version.
    prisma.scoreSnapshot.findFirst({
      where: { stockId },
      orderBy: [{ periodKey: "desc" }, { version: "desc" }],
      select: { createdAt: true },
    }),
  ]);

  if (!stock || !stock.isActive) return null;
  return {
    symbol: stock.symbol,
    scheduledDates: events.map((e) => e.eventDate),
    headSnapshotAt: head?.createdAt ?? null,
  };
}

/** The reader's position on this object. Anonymous is a valid caller, never an error — it resolves
 *  "none", which is the third authored variant, not a degraded one. */
async function resolvePosition(userId: string | null, stockId: string): Promise<ReaderPosition> {
  if (!userId) return "none";
  try {
    const probe = await probeStockRelationship(userId, stockId);
    // HELD TAKES PRECEDENCE OVER WATCHLIST (Part 1), and it is quantity-gated: a fully-exited legacy
    // row (quantity 0) is not a position. Same rule, same helper, as the relational card.
    if (probe.held && (await holdsPositiveQuantity(userId, stockId))) return "held";
    if (probe.watchlist) return "watching";
    return "none";
  } catch {
    // A reader-side read failing must not turn the banner into an error. Degrade to the stranger
    // variant, which is true of everyone — never to a held/watching claim we cannot stand behind.
    return "none";
  }
}

/**
 * Resolve the banner for one reader and one stock. Never throws for a data reason; the caller turns a
 * genuine infrastructure failure into a 500 and the frontend renders nothing either way.
 */
export async function resolveResultsSeasonBanner(
  userId: string | null,
  stockId: string,
  now: Date = new Date(),
): Promise<ResultsSeasonResolution> {
  const todayDate = today(now);

  const facts = await loadStockFacts(stockId, todayDate);
  if (!facts) return silence("unknown_stock");

  // ── Gate 1 · a scheduled date, inside the window ────────────────────────────────────────────────
  const eventDate = pickScheduledDate(facts.scheduledDates, todayDate);
  if (!eventDate) return silence("no_scheduled_date");
  const calendarPhase = phaseFor(eventDate, todayDate);
  if (!calendarPhase) return silence("outside_window"); // unreachable — see the type's note

  // ── Gate 2 · which copy set the page can carry ──────────────────────────────────────────────────
  // Selection, not suppression. A snapshot means the sentence may speak about the score; no snapshot
  // means it says the results fact and the reader's position, and stops there.
  const copySet: ResultsSeasonCopySet = facts.headSnapshotAt ? "scored" : "unscored";

  const periodEnd = periodEndFor(eventDate);
  let filing: Awaited<ReturnType<typeof filingForPeriod>>;
  try {
    filing = await filingForPeriod(stockId, periodEnd);
  } catch (e) {
    // FAIL CLOSED. Without this read we cannot tell "were published" from "were scheduled for", and
    // gate 5 exists to keep those apart. A banner that guesses which is worse than no banner.
    console.warn(`[results-season] filing lookup failed for ${stockId}: ${(e as Error).message}`);
    return silence("filing_lookup_failed");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE PHASE — THE FILING DECIDES THE PAST, THE CALENDAR DECIDES THE FUTURE.
  //
  // This replaces two gates that used to SILENCE the banner, and it is the whole reframe:
  //
  //   · GATE 3 IS GONE. It silenced `before`/`day_of` once a filing existed, on the reasoning that
  //     "results are due today" is untrue of a filing in hand. The reasoning was right and the remedy
  //     was wrong — the answer to "the calendar is out of date" is to believe the filing, not to say
  //     nothing. A stock that reported this morning now gets `filed_today`, the most interesting
  //     state this surface has, where it previously rendered nothing at all.
  //
  //   · GATE 4 IS GONE. It silenced the post-result phases once our snapshot post-dated the filing's
  //     ingest. Whether OUR score has caught up is a fact about us; it is not what the reader came to
  //     learn and it must not decide whether they learn anything. Nineteen stocks sat silent on it,
  //     including GODREJCP — filed 07 Aug, rescored thirty minutes later, banner suppressed.
  //
  // Believing the filing over the calendar also closes a hole gate 3 was incidentally covering: a
  // stale row still listing a meeting as upcoming while the results are already stored. There is no
  // longer any state in which the copy says "results are due" about a filing we hold.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  let phase: ResultsSeasonPhase;
  let publicationConfirmed: boolean;
  /** The date the SENTENCE names. A published filing names when it was published, not when a meeting
   *  was scheduled — we hold the real one, so inferring it from the calendar would be a downgrade. */
  let dateForCopy: Date;

  if (filing) {
    const filedOnDay = istDateOnly(filing.filedOn);
    phase = filedOnDay.getTime() === todayDate.getTime() ? "filed_today" : "after";
    publicationConfirmed = true;
    dateForCopy = filedOnDay;
  } else {
    phase = calendarPhase;
    publicationConfirmed = false; // nothing filed ⇒ `after` says "were scheduled for" (gate 5)
    dateForCopy = eventDate;
  }

  // ── Gate 5 · publication is a fact we hold, or it is not stated ─────────────────────────────────
  // THE ONE CHECK THAT SURVIVES, because it guards a claim about the WORLD — did this company report?
  // — rather than a claim about our coverage. `publicationConfirmed` is set above and is true exactly
  // when a filing row for the period exists.

  const position = await resolvePosition(userId, stockId);
  // No date in either "today" phase: "today" IS the date, and repeating it would be noise.
  const dateText = phase === "day_of" || phase === "filed_today" ? null : formatBannerDate(dateForCopy);

  // ★ THE PILLAR SET IS AN INPUT TO THE SENTENCE, not a note beside it — so it is empty wherever the
  //   sentence names no pillar. That is now BOTH the unscored set AND the scored set's post-result
  //   phases, which dropped their score clause. The payload never advertises a pillar the copy
  //   did not use.
  const namesAPillar = copySet === "scored" && (phase === "before" || phase === "day_of");
  // ⚠ THE COMPOSER ALWAYS GETS THE TRUE SET; only the PAYLOAD field is zeroed. Passing `[]` into the
  //   composer would silently select the singular voice, so a pillar clause added to a post-result
  //   phase later would read "Momentum" on a Q4 filing that moves both. The payload field answers a
  //   different question — "did the sentence name a pillar?" — and answers it honestly.
  const truePillars = pillarsAtStakeFor(eventDate);
  const pillarsAtStake = namesAPillar ? truePillars : [];
  // ★ AND THE PERIOD — what the filing is OF, for the contents clause. Derived from the MEETING date
  //   rather than the filing date: the period is a property of the reporting calendar, and a filing
  //   that slipped a day or two still reports on the same quarter.
  const period = periodDescriptorFor(eventDate);
  const { segments, shortSegments } = composeCopy(
    phase,
    position,
    copySet,
    dateText,
    publicationConfirmed,
    truePillars,
    period,
  );

  const banner: ResultsSeasonBanner = {
    phase,
    position,
    copySet,
    eventDate: eventDate.toISOString().slice(0, 10),
    dateText,
    // Which date `dateText` actually names. The post-result phases name the FILING date — when the
    // company published — while the forward phases name the scheduled meeting. Without this the
    // payload would carry a date string and an `eventDate` that quietly disagree.
    dateBasis: filing ? "filing" : "meeting",
    publicationConfirmed,
    sentence: joinSegments(segments),
    segments,
    shortSentence: joinSegments(shortSegments),
    shortSegments,
    link: { label: LINK_LABEL, href: linkHref(facts.symbol) },
    pillarsAtStake,
  };
  return { banner, silence: null };
}
