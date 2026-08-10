// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PEER-GROUP RESULTS-SEASON BANNER — resolution. One reader, one pond, one answer: a section or
// silence. THE SECOND CONSUMER of src/results-season, not a second implementation.
//
// ── ★ WHAT IS REUSED, VERBATIM ─────────────────────────────────────────────────────────────────────
//   · window.ts's arithmetic — `today`, `utcMidnight`, `pickScheduledDate`, `periodEndFor`,
//     `periodDescriptorFor`, `formatBannerDate`, and `WINDOW_DAYS` through `SEASON_EDGE_DAYS`. Widen
//     the stock strip's window and this one widens with it.
//   · `pickScheduledDate`'s RESCHEDULE-RESIDUE RULE, per member. The upsert key is
//     (stockId, eventType, eventDate), so a moved board meeting leaves the old row behind — measured
//     live on NAUKRI, JUBLPHARMA and ICICIGI. Applying "the nearest date" per member would put a
//     stale row in the pending row of capsules and mis-state the remaining count.
//   · `linkHref(symbol)` for every reported capsule — the SAME server-built results path the stock
//     strip's control opens.
//   · `resolveReaderExposure` (src/relational/reader-exposure.ts) for the reader's position — the
//     SHARED resolver, over `probeStockRelationship` + `holdsPositiveQuantity`. Nothing about the
//     reader is re-derived here, and nothing is re-derived by the peer-group tables either: they call
//     the same function, so one page cannot draw two vocabularies. ⚠ THE ONE DIVERGENCE from the
//     stock strip, and it is deliberate: no held-beats-watching precedence, because a row of capsules
//     draws a mark per member and "both" is a state the reader created.
//
// ── ★ THE FILING DECIDES WHO HAS REPORTED, NOT THE CALENDAR ────────────────────────────────────────
// Exactly the stock strip's ruling. A member has reported iff a stored filing exists for the season's
// period — an independent fact from a different NSE endpoint than the calendar row. Measured across
// the 13 scored ponds: 0 members filed before their scheduled date and 0 filed with no calendar row,
// so the filing ordering and the date ordering agree today; where they ever disagree, the filing wins.
//
// ── ★ THE READ COST, MEASURED ──────────────────────────────────────────────────────────────────────
// Two grouped reads for the season facts, whatever the roster size — one for members+events, one for
// the five-table filing union. All 13 ponds at once took 613 ms; a single pond is a fraction of it.
// The reader's exposure is the ONE fan-out, because the brief's instruction is to reuse the per-stock
// helpers: 319–603 ms over the largest pond (10 members), against 65–115 ms for an equivalent grouped
// read. The fan-out is kept, deliberately — semantic identity with the stock strip is worth 250 ms on
// a conditional, `no-store`, non-blocking fetch, and a second implementation of "what is held" is
// exactly the divergence holdings-in-peer-group.ts documents the cost of.
//
// ── ★ EVERY PATH TO SILENCE ────────────────────────────────────────────────────────────────────────
//   · unknown_group        no such pond, or no active members.
//   · no_member_dates      not one member carries an earnings row in the read band.
//   · outside_window       today sits outside T-7…T+7 of every season found. THE ORDINARY answer out
//                          of season — 2 of the 13 scored ponds are here today (IT Services closed
//                          30 Jul, Private Banks 29 Jul).
//   · filing_lookup_failed the union read threw. FAIL-CLOSED: without it, "reported" and "still to
//                          report" are both unknowable and the whole section is a guess.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { resolveReaderExposure } from "../relational/reader-exposure.js";
import { istDateOnly } from "../lib/ist-date.js";
import {
  formatBannerDate,
  periodDescriptorFor,
  pickScheduledDate,
  today as todayFn,
  utcMidnight,
} from "./window.js";
import {
  exposureCounts,
  groupIntoSeasons,
  orderPending,
  orderReported,
  pickSeason,
  SEASON_SCAN_DAYS,
  seasonStateFor,
  type SeasonMember,
} from "./group-window.js";
import { capsuleFor, composeGroupCopy, GROUP_LINK_LABEL, groupLinkHref } from "./group-copy.js";
import { joinSegments } from "./copy.js";
import type {
  CapsuleExposure,
  PeerGroupResultsSeasonBanner,
  PeerGroupResultsSeasonResolution,
  PeerGroupSeasonSilence,
} from "./group-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const silence = (reason: PeerGroupSeasonSilence): PeerGroupResultsSeasonResolution => ({
  banner: null,
  silence: reason,
});

/** One member as the season read returns it, before the filing is consulted. */
interface RosterRow {
  stockId: string;
  symbol: string;
  name: string;
  scored: boolean;
  /** Every earnings date inside the read band. `pickScheduledDate` chooses among them. */
  dates: Date[];
}

/**
 * ★ ONE READ FOR THE WHOLE ROSTER — members, their earnings rows inside the band, and whether each
 * carries a snapshot. A LEFT JOIN on `corporate_events`, so a member with no calendar row still comes
 * back (Large-Cap Defense has two: COCHINSHIP and SOLARINDS) and is correctly excluded from the
 * season's denominator rather than silently shrinking the roster.
 *
 * `is_active = true`, matching the stock strip's `unknown_stock` gate: a delisted member is not part
 * of anyone's results season. (Measured: all 149 peer-group members are active today, so this filter
 * changes nothing yet — it is here so that it never has to be remembered later.)
 */
async function loadRoster(peerGroupId: string, todayDate: Date): Promise<RosterRow[]> {
  const from = new Date(todayDate.getTime() - SEASON_SCAN_DAYS * DAY_MS);
  const to = new Date(todayDate.getTime() + SEASON_SCAN_DAYS * DAY_MS);

  const rows = await prisma.$queryRaw<
    { stock_id: string; symbol: string; name: string; scored: boolean; event_date: Date | null }[]
  >`
    SELECT st.id AS stock_id, st.symbol, st.name,
           EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = st.id) AS scored,
           ce.event_date
    FROM stock_peer_groups spg
    JOIN stocks st ON st.id = spg.stock_id AND st.is_active = true
    LEFT JOIN corporate_events ce
      ON ce.stock_id = st.id AND ce.event_type = 'earnings'
     AND ce.event_date >= ${from} AND ce.event_date <= ${to}
    WHERE spg.peer_group_id = ${peerGroupId}
  `;

  const byStock = new Map<string, RosterRow>();
  for (const r of rows) {
    const cur = byStock.get(r.stock_id) ?? {
      stockId: r.stock_id,
      symbol: r.symbol,
      name: r.name,
      scored: r.scored,
      dates: [],
    };
    if (r.event_date) cur.dates.push(r.event_date);
    byStock.set(r.stock_id, cur);
  }
  return [...byStock.values()];
}

/**
 * ★ ONE QUERY, FIVE UNION'D FILING TABLES — the group form of the stock strip's `filingForPeriod`.
 *
 * A filing lives in whichever per-family table matches the company's industry (IndAS / banking /
 * NBFC / life / general insurance) and the banner does not care which — only that a row exists for
 * the period. `report_date` is the PERIOD END and carries the same calendar quarter-end in all five.
 *
 * EARLIEST filing date per stock, not latest: a period can carry both a standalone and a consolidated
 * row, and the results were published when the FIRST of them was filed — the same rule, for the same
 * reason, as the per-stock read.
 *
 * ⚠ `filing_date <= asOf` IS LOAD-BEARING, NOT TIDINESS. "Reported" means "has published", and a row
 * whose filing date is in the future has not. Without the bound the reported/remaining split is not a
 * function of the clock at all: walking the resolver back to 24 July showed Large-Cap Pharma at
 * "nine of the ten have reported", counting LUPIN's 6 August filing among them. In production that
 * surfaced only as a latent hole — a mis-dated or pre-announced row would be counted early — but the
 * split is the entire content of this banner, so it has to depend on the day it is read.
 */
async function filingsForPeriod(
  stockIds: readonly string[],
  periodEnd: Date,
  asOf: Date,
): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<{ stock_id: string; filed_on: Date }[]>`
    SELECT stock_id, min(filing_date) AS filed_on FROM (
      SELECT stock_id, filing_date FROM quarterly_results                   WHERE report_date = ${periodEnd} AND filing_date <= ${asOf} AND stock_id = ANY(${stockIds}::text[])
      UNION ALL
      SELECT stock_id, filing_date FROM banking_quarterly_results           WHERE report_date = ${periodEnd} AND filing_date <= ${asOf} AND stock_id = ANY(${stockIds}::text[])
      UNION ALL
      SELECT stock_id, filing_date FROM nbfc_quarterly_results              WHERE report_date = ${periodEnd} AND filing_date <= ${asOf} AND stock_id = ANY(${stockIds}::text[])
      UNION ALL
      SELECT stock_id, filing_date FROM life_insurance_quarterly_results    WHERE report_date = ${periodEnd} AND filing_date <= ${asOf} AND stock_id = ANY(${stockIds}::text[])
      UNION ALL
      SELECT stock_id, filing_date FROM general_insurance_quarterly_results WHERE report_date = ${periodEnd} AND filing_date <= ${asOf} AND stock_id = ANY(${stockIds}::text[])
    ) f
    GROUP BY stock_id
  `;
  const out = new Map<string, Date>();
  for (const r of rows) if (r.filed_on) out.set(r.stock_id, r.filed_on);
  return out;
}

/**
 * The reader's relationship to EACH member of the season.
 *
 * ★ THE BODY MOVED TO src/relational/reader-exposure.ts, AND THAT IS THE POINT. The peer-group TABLES
 * now wear the same marks, so "what the reader's relationship to this stock is" had to stop being a
 * private function of this file — a second implementation is exactly how one page ends up drawing a
 * disc in the banner and nothing beside the same ticker in the table below it. Everything the old
 * note said still holds and is stated there: the same two helpers the stock strip routes on, no
 * held-beats-watching precedence (a row of capsules never has to pick, and "both" is a state the
 * reader created), anonymous resolving to "none" throughout as the third authored variant, and a
 * throw degrading all-or-nothing so the marks, the counts and the legend vanish together.
 */
async function resolvePerMemberExposure(
  userId: string | null,
  members: readonly SeasonMember[],
): Promise<Map<string, CapsuleExposure>> {
  return resolveReaderExposure(userId, members.map((m) => m.stockId));
}

/**
 * Resolve the section for one reader and one peer group. Never throws for a data reason; the caller
 * turns a genuine infrastructure failure into a 500 and the frontend renders nothing either way.
 */
export async function resolvePeerGroupResultsSeason(
  userId: string | null,
  peerGroupId: string,
  now: Date = new Date(),
): Promise<PeerGroupResultsSeasonResolution> {
  const todayDate = todayFn(now);

  const roster = await loadRoster(peerGroupId, todayDate);
  if (roster.length === 0) return silence("unknown_group");

  // ── The dated members, after the reschedule-residue pick ────────────────────────────────────────
  const dated = roster
    .map((r) => ({ row: r, scheduledDate: pickScheduledDate(r.dates, todayDate) }))
    .filter((x): x is { row: RosterRow; scheduledDate: Date } => x.scheduledDate !== null)
    .map(
      ({ row, scheduledDate }): SeasonMember => ({
        stockId: row.stockId,
        symbol: row.symbol,
        name: row.name,
        scheduledDate: utcMidnight(scheduledDate),
        filedOn: null,
        scored: row.scored,
        exposure: "none", // resolved once the season is chosen — only its members need a probe
      }),
    );
  if (dated.length === 0) return silence("no_member_dates");

  // ── THE SEASON: group by reporting period, then take the one whose window contains today ────────
  const season = pickSeason(groupIntoSeasons(dated), todayDate);
  if (!season) return silence("outside_window");

  // ── The filings, one read ───────────────────────────────────────────────────────────────────────
  const periodEnd = new Date(`${season.seasonKey}T00:00:00.000Z`);
  let filings: Map<string, Date>;
  try {
    filings = await filingsForPeriod(
      season.members.map((m) => m.stockId),
      periodEnd,
      todayDate,
    );
  } catch (e) {
    // FAIL CLOSED. Every count, both capsule rows and all four states rest on this distinction.
    console.warn(`[results-season/group] filing lookup failed for ${peerGroupId}: ${(e as Error).message}`);
    return silence("filing_lookup_failed");
  }

  // ⚠ `istDateOnly` ON THE FILING TIMESTAMP, not the raw value. `filing_date` is a `@db.Date` today,
  //   but the ordering and the "filed today" test both compare CALENDAR DAYS, and normalising here
  //   means a column that ever gains a time component cannot quietly shift a capsule across midnight.
  //
  // ★ AND THE READER'S MARKER, resolved for the season's members ONLY — the probe is a fan-out, and
  //   a pond member with no date this season has no capsule to wear a mark on.
  const marks = await resolvePerMemberExposure(userId, season.members);
  const members: SeasonMember[] = season.members.map((m) => {
    const filedOn = filings.get(m.stockId);
    return {
      ...m,
      filedOn: filedOn ? istDateOnly(filedOn) : null,
      exposure: marks.get(m.stockId) ?? "none",
    };
  });

  // ── Ordering. Reported DESCENDING (a feed); pending ASCENDING (a schedule). Both live in the pure
  //    module so the build gate asserts them directly rather than through a live row. ──────────────
  const reportedMembers = orderReported(members);
  const pendingMembers = orderPending(members);
  const due = members.length;
  const reported = reportedMembers.length;
  const state = seasonStateFor(reported, due);

  const next = pendingMembers[0] ?? null;
  const lastFiled = reportedMembers[0] ?? null; // the list is descending, so [0] is the most recent

  // ★ ONE FACT, ONE SOURCE. The sentence's counts are COUNTED OFF THE MARKERS the capsules will
  //   wear — not resolved a second time — so the two renderings of the reader's exposure cannot
  //   drift apart. `exposureCounts` lives in the pure module and the gate asserts the identity
  //   against `capsuleFor`'s output directly.
  const exposure = exposureCounts(members);

  const { segments, shortSegments } = composeGroupCopy({
    state,
    due,
    reported,
    scored: members.filter((m) => m.scored).length,
    held: exposure.held,
    watching: exposure.watching,
    // ★ THE PERIOD IS DERIVED FROM A MEETING DATE, not a filing one — the period is a property of the
    //   reporting calendar, and a filing that slipped a day still reports on the same quarter. The
    //   same derivation, and the same reasoning, as the stock strip.
    period: periodDescriptorFor(season.window.firstDate),
    firstDateText: formatBannerDate(season.window.firstDate),
    firstIsAhead: season.window.firstDate.getTime() >= todayDate.getTime(),
    lastDateText: formatBannerDate(season.window.lastDate),
    nextDateText: next ? formatBannerDate(next.scheduledDate) : null,
    nextIsAhead: next ? next.scheduledDate.getTime() >= todayDate.getTime() : false,
    lastFiledDateText: lastFiled ? formatBannerDate(lastFiled.filedOn as Date) : null,
    // ★ THE NAMED MEMBER CROSSES AS A CAPSULE'S WORTH OF FACTS, off `capsuleFor` — the SAME function
    //   that builds the rows below, so the sentence's capsule and the row's capsule cannot disagree
    //   about the ticker, the marker, or whether there is anything filed to open. (`next` is pending
    //   by construction, so the href resolves null; it is derived rather than hardcoded so "linked
    //   iff filed" stays a rule with one home.)
    lastOne:
      state === "one_remaining" && next
        ? { symbol: next.symbol, name: next.name, exposure: next.exposure, href: capsuleFor(next).href }
        : null,
  });

  // ★ "TODAY" — a member filed today, or one is scheduled today. Presence only: a marginally heavier
  //   rail and a filled icon chip inside the SAME colour family, which is the group's form of the
  //   stock strip's two "today" phases. It is never stated in the sentence, because the four states
  //   are the copy and this is the render.
  const activeToday =
    members.some((m) => m.filedOn !== null && m.filedOn.getTime() === todayDate.getTime()) ||
    members.some((m) => m.scheduledDate.getTime() === todayDate.getTime());

  const banner: PeerGroupResultsSeasonBanner = {
    state,
    seasonKey: season.seasonKey,
    windowFrom: iso(season.window.from),
    windowTo: iso(season.window.to),
    counts: { due, reported, remaining: due - reported, scored: members.filter((m) => m.scored).length },
    exposure,
    activeToday,
    sentence: joinSegments(segments),
    segments,
    shortSentence: joinSegments(shortSegments),
    shortSegments,
    reported: reportedMembers.map(capsuleFor),
    pending: pendingMembers.map(capsuleFor),
    link: { label: GROUP_LINK_LABEL, href: groupLinkHref() },
  };
  return { banner, silence: null };
}
