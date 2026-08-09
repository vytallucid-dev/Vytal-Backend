// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 3 — THE PERSONAL SECTION. Computed at READ TIME, deterministically, WITH NO MODEL.
//
// ── ★★ WHY THERE IS NO SLOT FOR THIS IN QuarterBriefFactBlock ────────────────────────────────────
// A brief is stored per (stock, quarter). A personal section is per (stock, quarter, READER). Storing
// it would mean generating 504 briefs times every reader and regenerating on every holding change —
// and it would put an unattended model in front of someone's money.
//
// ⚠ SO IT IS ABSENT FROM THE STORED SCHEMA ENTIRELY, AND THAT ABSENCE IS THE MECHANISM. A field on the
// fact block is how this accidentally gets generated: someone adds `personal` to the block, the block
// goes to renderFactText, and the model is holding a reader's position. There is no such field, this
// module is never imported by fact-block.ts or prompt.ts, and nothing here returns anything the model
// ever sees. Sections 1, 2, 4 and 5 are stored and shared. This one renders live, per reader.
//
// ── ★★★ THE LOAD-BEARING RULE, AND IT IS THE WHOLE DESIGN ────────────────────────────────────────
// THE SECTION STATES FACTS ABOUT THE READER'S POSITION. IT NEVER READS THE QUARTER THROUGH THAT
// POSITION. The sentence that connects the two has become advice.
//
//   SAFE     "You hold 40 shares at an average cost of ₹1,240, about 3.1% of the money you have
//             put into your holdings."                                        — arithmetic, checkable
//   SAFE     "The band on 14.7% of your book changed from Healthy to Steady."  — arithmetic, checkable
//   NOT SAFE "One of your best performers."                                   — a ranking, a verdict
//   NOT SAFE "A good quarter for your position."                              — a judgement
//   NOT SAFE "Given your cost of ₹1,240, this quarter's growth means…"        — advice wearing arithmetic
//
// ── ★★ STAGE 4 · THE ORIGINAL RULE WAS TOO STRICT, AND THE CORRECTION IS NARROW ──────────────────
// "You hold 408 shares at an average cost of ₹878.15" tells the reader what they already know. The
// section should say HOW THE QUARTER MOVED THEIR POSITION — and the reason the first build could not
// was a rule that forbade reading ANY figure that was not already in the holding.
//
// That rule was too wide. It banned two different things and only one of them is dangerous:
//
//   THE HEALTH SCORE AND ITS BAND are a Vytal reading of the company. Setting the reader's own
//   holding against a band change is ARITHMETIC — the band moved, they own 14.7% of their book in it,
//   and both halves are checkable. No opinion is added by putting them in one sentence.
//
//   THE ENTRY PRICE against a quarterly figure is a VALUATION CLAIM, every time, however it is
//   worded. That ban stands exactly as written (4b), and it is why nothing below reads `avgCost`
//   together with anything about the quarter. The price half of a position and the results half of a
//   company meet in the reader's head or not at all.
//
// So the test is no longer "does this touch the quarter" but "does joining these two facts ADD a
// claim". A band change does not. A cost basis does.
//
// ── ⚠ BEHAVIOURAL DATA DOES NOT SHIP (3c) ────────────────────────────────────────────────────────
// behavior_rollup works — ten consecutive nightly runs, tab_counts populated on 13 of 15 rows. It is
// also 35 view events across 2 users over 6 days. "You have been watching this closely" has nothing
// behind it at that volume, and a sentence about the reader's own attention is the one place a wrong
// claim is unmistakable to them. Not read here. Revisit on real traffic, not on a working job.
//
// ── QUERY COST (4e) — UNCHANGED BY STAGE 4, AND THAT WAS A CONSTRAINT, NOT AN OUTCOME ────────────
// ANONYMOUS:    ZERO queries. Returns on the null userId before touching the database.
// EMPTY PATH:   exactly ONE. Every relationship probe is a scalar subquery on an indexed
//               (user_id, stock_id) pair inside a single statement, so a reader who neither holds nor
//               watches costs one round trip and returns null. Absence is the default by two orders
//               of magnitude — 16 held stocks and 13 watched against a 504-stock universe — so this
//               is the path that must not regress, and it has not.
// PRESENT PATH: still TWO. Stage 4 added the score at the buy date, the two period snapshots for this
//               stock, and the book-wide band-change count — and put every one of them in the SECOND
//               statement as another scalar subquery rather than as a third round trip.
//
// ⚠ THE BOOK-WIDE COUNT (4c) IS ONE AGGREGATE, NEVER A FAN-OUT. It joins holdings to score_snapshots
// twice and counts; it does not loop over the reader's holdings. A fan-out here would be 16 queries
// on a 16-stock book and 300 on a large one, on a page that already renders without it.
//
// ⚠⚠ AND portfolio_health_snapshot CANNOT SUPPLY IT (4c, reported). PHS stores the book's own band,
// coverage, pillar and lens profiles and `fired_findings` — all book-level. It holds NO per-holding
// band history at all, so "several of your holdings changed band this quarter" cannot be read from
// it at any price. What PHS does supply, and what this module already used before Stage 4, is the
// findings that NAME this symbol. The count below is a separate aggregate for that reason.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { LABEL_BAND_MAP, scoreDisplay } from "../../scoring/composite/label.js";
import { money } from "./format.js";

/** One statement about the reader's own position. `display` is the whole sentence; nothing downstream
 *  composes these, because composition is where the two halves get joined. */
export interface PersonalFact {
  key: string;
  display: string;
  /**
   * ★ WHICH HALF OF THE SECTION THIS IS. The section exists to say how the quarter moved the reader's
   * position, and it also has to state the position itself — two different jobs that were reading as
   * one flat list, in which "the band on 14.7% of your book changed" sat level with "the oldest shares
   * you still hold were bought on 2024-07-15".
   *
   * ⚠ IT IS A FIELD, NOT A KEY PREFIX A RENDERER MATCHES ON. The alternative was for the frontend to
   * group by `key.startsWith("personal.band")` — which makes a renderer in another repository depend
   * on the spelling of identifiers this file is free to change, and fails SILENTLY into the wrong
   * group when it does. This module knows which facts are changes; it says so.
   */
  kind: "change" | "position";
}

/** A portfolio finding that NAMES this stock, reused with its authored copy. */
export interface PersonalFinding {
  /** PF id (PC1, PS1, …) — greppable against the portfolio library. */
  id: string;
  label: string;
  /** The library's own `read` string. Authored there, reproduced here, never rewritten. */
  read: string;
  /** Required by the portfolio library's own rule; carried so it cannot be dropped in transit. */
  doesntMean: string;
}

export interface PersonalSection {
  facts: PersonalFact[];
  findings: PersonalFinding[];
}

/** Rows the relationship probe returns. All scalar, all from one statement. */
interface Probe {
  qty: number;
  invested: number;
  realized: number;
  open_rows: number;
  wl_added: Date | null;
  wl_health: number | null;
  wl_band: string | null;
  alert_count: number;
}

const num = (x: unknown): number => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};

/** Shares, to a sensible precision. Fractional quantities exist (bonus issues, some brokers), and
 *  rounding 40.5 to 41 would misstate a holding the reader can check against their own statement. */
const qtyStr = (q: number): string =>
  Number.isInteger(q) ? q.toLocaleString("en-IN") : q.toLocaleString("en-IN", { maximumFractionDigits: 4 });

/** ₹ per SHARE — a price, not a crore figure, so it does NOT go through `money`.
 *  ⚠ format.ts's `money` takes ₹ CRORE. Passing a per-share cost of 1,240 through it would render
 *  "₹1,240 crore" for a share that costs twelve hundred rupees. Different unit, different function.
 *  ⚠ BOTH DECIMALS ALWAYS, AND THAT IS THE POINT OF A PRICE. Without `minimumFractionDigits` a cost of
 *  1444.30 rendered "₹1,444.3" — found by rendering, on a live holding. A reader checking that against
 *  their own contract note is looking at a price with one decimal place, which is not a price. */
const perShare = (r: number): string =>
  `₹${r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ★ THE FLOOR BELOW WHICH A REALISED AMOUNT CANNOT BE PRINTED. `money` renders under a crore in lakh
 *  and rounds to whole lakh, so anything below ₹50,000 comes out as "₹0 lakh" — found by rendering, on
 *  a live holding whose card read "You have realised a profit of ₹0 lakh." Never claim a figure you
 *  cannot show: the same rule quarter-section.ts's displayFloor enforces, in the same shape. Expressed
 *  in ₹ crore, the unit `money` takes. */
const REALISED_FLOOR_CR = 0.005;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** The reader-facing name of a stored band value. The STORED band, never re-derived from a composite:
 *  a snapshot is pinned to the band mapping in force when it was written, and relabelling it under
 *  today's mapping would tell the reader their holding moved when only our vocabulary did. Same rule,
 *  and the same words, as fact-block.ts's `bandLabel`. */
const bandLabel = (band: string): string => LABEL_BAND_MAP.find((b) => b.band === band)?.label ?? band;

/**
 * The reader's own relationship with this stock, or null.
 *
 * `userId` null (an anonymous reader) returns null without touching the database at all — the public
 * stock page is the common case and it must not pay for a section it cannot have.
 *
 * `symbol` is taken as an argument rather than looked up: the caller already resolved it to reach this
 * card, and a lookup here would add a query to the EMPTY path, which is the one path that must stay at
 * one. It is what the portfolio findings' `bind` names them by.
 *
 * `periodKey` is the quarter the card is about. ★ STAGE 4 — it is what makes "how the quarter moved
 * your position" answerable at all: without it this module could describe a holding but not a change.
 * It is passed rather than derived because the caller already split the period to read the brief row,
 * and a second derivation is a second chance to disagree about which quarter this card is.
 */
export async function buildPersonalSection(
  stockId: string,
  symbol: string,
  userId: string | null,
  periodKey: string,
): Promise<PersonalSection | null> {
  if (!userId) return null;

  // ── ONE QUERY. Every probe is an indexed point lookup; the empty path stops here. ──
  const probe = (await prisma.$queryRaw<Probe[]>`
    SELECT
      COALESCE((SELECT SUM(quantity)       FROM holdings WHERE user_id = ${userId} AND stock_id = ${stockId} AND quantity > 0), 0) AS qty,
      COALESCE((SELECT SUM(invested_value) FROM holdings WHERE user_id = ${userId} AND stock_id = ${stockId} AND quantity > 0), 0) AS invested,
      COALESCE((SELECT SUM(realized_pnl)   FROM holdings WHERE user_id = ${userId} AND stock_id = ${stockId}), 0)                  AS realized,
      COALESCE((SELECT COUNT(*)            FROM holdings WHERE user_id = ${userId} AND stock_id = ${stockId} AND quantity > 0), 0) AS open_rows,
      (SELECT added_at      FROM watchlist WHERE user_id = ${userId} AND stock_id = ${stockId}) AS wl_added,
      (SELECT pinned_health FROM watchlist WHERE user_id = ${userId} AND stock_id = ${stockId}) AS wl_health,
      (SELECT pinned_band   FROM watchlist WHERE user_id = ${userId} AND stock_id = ${stockId}) AS wl_band,
      COALESCE((SELECT COUNT(*) FROM alerts WHERE user_id = ${userId} AND stock_id = ${stockId} AND active), 0) AS alert_count
  `)[0];

  const qty = num(probe?.qty);
  const invested = num(probe?.invested);
  const realized = num(probe?.realized);
  const alertCount = num(probe?.alert_count);
  const holds = qty > 0;
  const watches = probe?.wl_added != null;
  // ⚠ THE GATE USES THE SAME FLOOR THE SENTENCE DOES. A closed position worth ₹200 would otherwise
  // open the section and then render nothing in it — a heading with no content, which is the one
  // outcome schema.ts's empty-section guard exists to refuse on the stored side.
  const realisedShowable = Math.abs(realized) / 1e7 >= REALISED_FLOOR_CR;
  const hasClosedPosition = !holds && realisedShowable;

  // ★ THE PRESENCE GATE. No holding, no pin, no alert, no closed position ⇒ the section does not exist.
  // ⚠ It renders as ABSENT, never as "You do not hold this stock" — telling a reader what they do not
  // own is noise on 490 of 504 cards, and it reads as a prompt to buy.
  if (!holds && !watches && alertCount === 0 && !hasClosedPosition) return null;

  // ── Second query, only now that there is something to describe. ──
  //
  // ★ STAGE 4 — ONE STATEMENT, NOT FOUR. The three new readings (the score when they bought, the two
  // period snapshots for this stock, and the book-wide band-change count) are CTEs and scalar
  // subqueries inside the SAME round trip that already fetched the book total and the earliest lot.
  //
  // ⚠ `snap` DEDUPLICATES ON (stock, period) BY version DESC. score_snapshots is an append-only
  // supersede chain and the newest VERSION wins on read — the same rule fact-block.ts applies when it
  // builds the health section. Reading the chain without it would compare an old version of one
  // quarter against a new version of another and report a band change that never happened.
  //
  // ⚠ PERIOD ORDER IS LEXICAL ON period_key, WHICH IS TRUE ONLY FOR THIS ENCODING. "FY26Q1" is
  // fixed-width and zero-padded, so string order IS chronological order. write.ts's markBriefsStale
  // relies on the identical property and says so; both break together if the FY format ever changes.
  const detail = (await prisma.$queryRaw<
    {
      book_invested: number | null;
      first_lot: Date | null;
      findings: unknown;
      buy_composite: number | null;
      buy_band: string | null;
      buy_as_of: Date | null;
      cur_band: string | null;
      cur_composite: number | null;
      prior_band: string | null;
      prior_period: string | null;
      fired: number | null;
      cleared: number | null;
      book_moves: unknown;
      book_scored: number | null;
    }[]
  >`
    WITH lot AS (
      SELECT MIN(l.buy_date) AS first_lot
      FROM holding_lots l JOIN holdings h ON h.id = l.holding_id
      WHERE h.user_id = ${userId} AND h.stock_id = ${stockId}
    ),
    held AS (
      SELECT DISTINCT stock_id FROM holdings
      WHERE user_id = ${userId} AND quantity > 0 AND stock_id IS NOT NULL
    ),
    -- ⚠ THE SCOPE IS THE BOOK **PLUS THIS STOCK**. A reader who only WATCHES this stock is not in
    -- held, and scoping the snapshot scan to held alone would silently drop the band change on the
    -- very card they are reading. The book-wide counts below join back to held explicitly, so the
    -- watched stock is described without ever being counted as a holding.
    -- (No backticks anywhere in this SQL: it is a template literal and a backtick ends the string.)
    scope AS (SELECT stock_id FROM held UNION SELECT ${stockId} AS stock_id),
    snap AS (
      SELECT DISTINCT ON (s.stock_id, s.period_key)
             s.id, s.stock_id, s.period_key, s.composite, s.label_band::text AS label_band
      FROM score_snapshots s
      JOIN scope ON scope.stock_id = s.stock_id
      WHERE s.snapshot_type::text = 'quarterly' AND s.period_key <= ${periodKey}
      ORDER BY s.stock_id, s.period_key, s.version DESC
    ),
    cur AS (SELECT * FROM snap WHERE period_key = ${periodKey}),
    prv AS (
      SELECT DISTINCT ON (stock_id) id, stock_id, period_key, composite, label_band
      FROM snap WHERE period_key < ${periodKey}
      ORDER BY stock_id, period_key DESC
    ),
    mine_cur AS (SELECT * FROM cur WHERE stock_id = ${stockId}),
    mine_prv AS (SELECT * FROM prv WHERE stock_id = ${stockId})
    SELECT
      (SELECT SUM(invested_value) FROM holdings WHERE user_id = ${userId} AND quantity > 0) AS book_invested,
      (SELECT first_lot FROM lot) AS first_lot,
      (SELECT fired_findings FROM portfolio_health_snapshot WHERE user_id = ${userId}
         ORDER BY created_at DESC LIMIT 1) AS findings,
      -- The score in force ON THE DAY THEY BOUGHT. A LOOKUP, not a computation: the snapshot with the
      -- newest as-of date at or before the oldest open lot, newest version first.
      (SELECT s.composite FROM score_snapshots s
         WHERE s.stock_id = ${stockId} AND s.snapshot_type::text = 'quarterly'
           AND s.as_of_date <= (SELECT first_lot FROM lot)
         ORDER BY s.as_of_date DESC, s.version DESC LIMIT 1) AS buy_composite,
      (SELECT s.label_band::text FROM score_snapshots s
         WHERE s.stock_id = ${stockId} AND s.snapshot_type::text = 'quarterly'
           AND s.as_of_date <= (SELECT first_lot FROM lot)
         ORDER BY s.as_of_date DESC, s.version DESC LIMIT 1) AS buy_band,
      (SELECT s.as_of_date FROM score_snapshots s
         WHERE s.stock_id = ${stockId} AND s.snapshot_type::text = 'quarterly'
           AND s.as_of_date <= (SELECT first_lot FROM lot)
         ORDER BY s.as_of_date DESC, s.version DESC LIMIT 1) AS buy_as_of,
      (SELECT label_band FROM mine_cur) AS cur_band,
      (SELECT composite   FROM mine_cur) AS cur_composite,
      (SELECT label_band FROM mine_prv) AS prior_band,
      (SELECT period_key FROM mine_prv) AS prior_period,
      -- Findings are re-derived on every snapshot with no active/resolved flag, so the honest diff is
      -- a set difference of flag keys between the two — the same rule fact-block.ts applies. Both
      -- counts are meaningless with no prior snapshot and are DISCARDED in code when prior_period is
      -- null, rather than being made to return zero here: NOT IN over an empty set is TRUE, so a
      -- first-ever snapshot would otherwise report every finding as newly fired.
      (SELECT COUNT(*) FROM score_red_flags f WHERE f.snapshot_id = (SELECT id FROM mine_cur)
         AND f.flag_key NOT IN (SELECT flag_key FROM score_red_flags WHERE snapshot_id = (SELECT id FROM mine_prv))) AS fired,
      (SELECT COUNT(*) FROM score_red_flags f WHERE f.snapshot_id = (SELECT id FROM mine_prv)
         AND f.flag_key NOT IN (SELECT flag_key FROM score_red_flags WHERE snapshot_id = (SELECT id FROM mine_cur))) AS cleared,
      -- ★ 4c — THE BOOK-WIDE MOVE, AS ONE AGGREGATE. The band PAIRS come back raw and are ranked in
      -- TypeScript against LABEL_BAND_MAP; ranking them here would put a second copy of the band order
      -- in SQL, where nothing would notice it drifting from the one source that owns it.
      (SELECT json_agg(json_build_object('from', prv.label_band, 'to', cur.label_band))
         FROM cur JOIN prv ON prv.stock_id = cur.stock_id JOIN held ON held.stock_id = cur.stock_id
         WHERE cur.label_band <> prv.label_band) AS book_moves,
      (SELECT COUNT(*) FROM cur JOIN held ON held.stock_id = cur.stock_id) AS book_scored
  `)[0];

  const facts: PersonalFact[] = [];

  // ── The book share, computed once. Two facts use it and they must not disagree about the basis. ──
  // ⚠ THE BASIS IS NAMED IN EVERY SENTENCE THAT USES IT, NOT ASSUMED. "3.1% of your book" is ambiguous
  // — cost or market value? — and the two differ by every rupee of gain. Cost is used because it needs
  // no price join and is checkable against the reader's own contract notes, and the words say so.
  const book = num(detail?.book_invested);
  const share = holds && book > 0 ? (invested / book) * 100 : null;

  // ═══ ★★ WHAT THE QUARTER DID TO THIS POSITION — Stage 4, and it leads the section ════════════════
  //
  // ⚠ THE ORDER IS THE CHANGE, THEN THE POSITION. "You hold 408 shares at an average cost of ₹878.15"
  // tells the reader what they already know, and putting it first taught them the whole section was
  // things they already knew. What they cannot see anywhere else is what MOVED.

  // ── 4a · THE BAND, AND THE SHARE OF THE BOOK IT SITS ON ────────────────────────────────────────
  // "The band on 14.7% of your book changed from Healthy to Steady" is two arithmetic facts in one
  // sentence: the band moved, and this is how much of their money is in it. Neither half is an
  // opinion and joining them adds no claim — which is exactly the test the header sets.
  const curBand = detail?.cur_band ?? null;
  const priorBand = detail?.prior_band ?? null;
  // ★ THE SHARE OF THE BOOK IS SAID ONCE, ON WHICHEVER FACT IS PRESENT. It gives the band move its
  // weight, so it belongs there when there is one; with no band move it belongs on the holding line,
  // which is the only other sentence that can carry it. Stating it in both would put one figure on
  // one card twice, in two sections.
  const bandChanged = Boolean(curBand && priorBand && curBand !== priorBand);
  const shareSentence = share === null ? "" : ` This company is ${share.toFixed(1)}% of the money you have put into your holdings.`;

  if (curBand && priorBand && curBand !== priorBand) {
    // ⚠⚠ THE BAND LABEL ENDS ITS SENTENCE, AND THAT IS NOT A STYLE CHOICE — FOUND BY RENDERING TCS.
    // One of the five labels is "Pristine — fully priced", and an em dash swallows everything after
    // it: "…changed from Healthy to Pristine — fully priced this quarter, on a holding that is
    // 15.2%…" reads as a claim about the share price. The first fix put the label last.
    //
    // ★ THAT FIX NOW HAS TO HOLD TWICE, BECAUSE BOTH BANDS ARE NAMED. "…moved down from Pristine —
    // fully priced to Healthy" has the same defect on the FROM side: the dash swallows "to Healthy".
    // So each label ends a sentence of its own, and the split into short sentences — which is what
    // this rewrite was for anyway — is also what makes the label safe. One rule, two problems.
    const rank = (b: string): number => LABEL_BAND_MAP.findIndex((x) => x.band === b);
    const dir = Math.sign(rank(curBand) - rank(priorBand));
    const verb = dir < 0 ? "moved down to" : dir > 0 ? "moved up to" : "changed to";
    facts.push({
      key: "personal.bandChange",
      kind: "change",
      display:
        `Vytal's health band on this company ${verb} ${bandLabel(curBand)}. ` +
        `Last quarter it was ${bandLabel(priorBand)}.` +
        (holds ? shareSentence : " You are watching this company."),
    });
  }

  // ── 4a · FINDINGS FIRED OR CLEARED ON A STOCK THEY HOLD ────────────────────────────────────────
  // ⚠ COUNTS, NOT NAMES. The health section three inches above already lists every one of them by
  // name; repeating the names here would print the same list twice on one card. What this section
  // adds is the one thing that section cannot say — that it happened on THEIR stock.
  // ⚠ AND ONLY WITH A PRIOR SNAPSHOT. With none, "fired" would be every finding the stock has ever
  // carried, which is the NOT-IN-over-an-empty-set trap the query comment names.
  const firedN = detail?.prior_period ? num(detail?.fired) : 0;
  const clearedN = detail?.prior_period ? num(detail?.cleared) : 0;
  if ((holds || watches) && firedN + clearedN > 0) {
    const parts: string[] = [];
    if (firedN > 0) parts.push(`${firedN} of Vytal's checks started flagging`);
    if (clearedN > 0) parts.push(`${clearedN} ${firedN > 0 ? "stopped" : "of Vytal's checks stopped flagging"}`);
    facts.push({
      key: "personal.findingChanges",
      kind: "change",
      // WAS: "On this quarter's score, 2 of Vytal's checks started flagging and 1 stopped — on a
      // stock you hold. They are named in the health section above." — opened on an adverbial phrase
      // and hung the reader's own connection to the stock off an em dash at the end.
      display:
        `${parts.join(" and ")} on this quarter's score. ` +
        `You ${holds ? "hold" : "are watching"} this company, and the health section above names them.`,
    });
  }

  // ── 4c · THE PORTFOLIO-LEVEL SENTENCE, WHERE THERE IS ONE ──────────────────────────────────────
  // ⚠ ONLY WHEN IT IS ACTUALLY PLURAL. One holding changing band is already stated above, in a
  // sentence that names the bands; repeating it as "1 of your 9 holdings" says less, twice.
  // ⚠ AND ONLY ON A CARD WHERE THE SAME MEASURE EXISTS. Without `curBand` the reader is being told
  // about band movement across their book on a page for a stock Vytal has not scored — a fact with no
  // anchor on the card carrying it, and identical on every such page they open.
  const moves = bandMoves(detail?.book_moves);
  if (holds && curBand && moves.length >= 2) {
    const down = moves.filter((m) => m.direction < 0).length;
    const up = moves.filter((m) => m.direction > 0).length;
    const scored = num(detail?.book_scored);
    const split =
      down > 0 && up > 0
        ? `${down} moved to a lower band and ${up} to a higher one`
        : down > 0
          ? "All of them moved to a lower band"
          : "All of them moved to a higher band";
    facts.push({
      key: "personal.bookBands",
      kind: "change",
      // WAS: "…changed health band on this quarter's scores — 2 to a lower band and 1 to a higher
      // one." — the split is a second idea and was hanging off an em dash.
      display:
        `${moves.length} of the ${scored} scored ${scored === 1 ? "holding" : "holdings"} in your book changed ` +
        `health band on this quarter's scores. ${split}.`,
    });
  }

  // ═══ THE POSITION ITSELF ═════════════════════════════════════════════════════════════════════════

  if (holds) {
    const avgCost = invested / qty;
    facts.push({
      key: "personal.holding",
      kind: "position",
      // WAS: "You hold 408 shares at an average cost of ₹878.15, about 15.2% of the money you have
      // put into your holdings." — the trailing appositive attaches to the nearest noun, so "about
      // 15.2%" reads as a qualifier on the COST rather than on the position. Its own sentence with
      // its own subject removes the ambiguity.
      // ⚠ AND IT IS SUPPRESSED WHEN THE BAND-CHANGE FACT ALREADY CARRIED IT — see shareSentence.
      display:
        `You hold ${qtyStr(qty)} ${qty === 1 ? "share" : "shares"} at an average cost of ${perShare(avgCost)}.` +
        (share !== null && !bandChanged ? shareSentence : ""),
    });
    if (num(probe?.open_rows) > 1) {
      facts.push({
        key: "personal.accounts",
        kind: "position",
        // WAS: "That is held across 3 of your accounts." — "That" is a pronoun for the previous
        // fact, which is a different bullet in a list a reader may not read in order.
        display: `Those shares sit across ${num(probe.open_rows)} of your accounts.`,
      });
    }
    if (detail?.first_lot) {
      // ★ 4a · WHAT THE SCORE WAS WHEN THEY BOUGHT. The same shape as the watchlist pin baseline this
      // module already shipped, for the reader who bought rather than pinned.
      //
      // ⚠⚠ AND IT IS THE SCORE, NEVER THE PRICE. This sentence deliberately does not mention what they
      // paid, and it is not next to a sentence that does. Reading the quarter through the entry price
      // is a valuation claim however it is worded (4b), and the band is not a price.
      // ⚠ ABSENCE RENDERS AS ABSENCE. `buy_composite` is null when the stock was unscored on that day
      // — which is the common case for anything bought before the scoring layer existed — and "it
      // scored 0" would be a fabricated reading of a stock we simply had not scored.
      // Band-safe, against the band that snapshot itself stored — the same rule the health section
      // rounds by, so a score quoted on this card cannot disagree with the band printed beside it.
      // WAS: "…were bought on 2024-07-15. It scored 71 out of 100 then, in the Healthy band." — "It"
      // had no antecedent: the previous sentence's subject is the SHARES, and what scored 71 is the
      // company. Naming Vytal as the subject makes the sentence stand on its own, which is the rule
      // the takeaway's bullets already follow.
      const buyScore =
        detail.buy_composite !== null && detail.buy_band
          ? ` Vytal scored this company ${scoreDisplay(Number(detail.buy_composite), detail.buy_band)} out of 100 that day, in the ${bandLabel(detail.buy_band)} band.`
          : "";
      facts.push({
        key: "personal.since",
        kind: "position",
        // WAS passive ("The oldest shares you still hold were bought on…").
        display: `You bought the oldest shares you still hold on ${ymd(detail.first_lot)}.${buyScore}`,
      });
    }
  }

  // ⚠ REALISED ONLY. There is no unrealised figure here and that is deliberate: it moves with the live
  // price, which would put a number on this card that is different every time the page is opened,
  // beside quarterly figures that never move. Two clocks again. Realised profit is banked and final.
  if (realisedShowable) {
    facts.push({
      key: "personal.realized",
      kind: "position",
      display:
        // WAS: "…on shares of this company you have already sold." — the relative clause has no
        // "that", so "this company you have already sold" is momentarily readable as the object.
        realized > 0
          ? `You have already sold some shares of this company. On those you made a profit of ${money(realized / 1e7)}.`
          : `You have already sold some shares of this company. On those you made a loss of ${money(realized / 1e7)}.`,
    });
  }

  if (watches && probe.wl_added) {
    // ⚠ ABSENCE RENDERS AS ABSENCE, NEVER AS ZERO. pinnedHealth is null on 6 of 14 live rows — the
    // stock was unscored when it was pinned. "Health 0 when you added it" would be a fabricated
    // reading of a stock we simply had not scored.
    // ★ STAGE 4 — AND THE PIN NOW HAS SOMETHING TO BE COMPARED WITH. The baseline was already
    // captured; what was missing was the other end of it. `bandLabel` replaces the old
    // `.replace(/_/g, " ")`, which rendered the raw enum ("below par") instead of the label the rest
    // of the product prints ("Below Par") — the same figure under two names on one page.
    // WAS: "It scored 68 out of 100 that day…" — same dangling "It" as personal.since had.
    const pinned =
      probe.wl_health !== null && probe.wl_band !== null
        ? ` Vytal scored this company ${probe.wl_health} out of 100 that day, in the ${bandLabel(probe.wl_band)} band.`
        : "";
    // ⚠⚠ 2c — THE BAND IS NAMED ONCE, AND ONLY WHEN IT SAYS SOMETHING. This read "…in the Steady band.
    // As scored for this quarter it is 65.2, in the Steady band." — two band statements in one
    // sentence, the second of which repeats the first whenever they match, which is the common case.
    // Naming a band twice teaches the reader that the second naming carries no information, which is
    // exactly the lesson that makes them skip the one time it differs. When the bands MATCH the
    // sentence says the score moved and the band did not; when they DIFFER it names the new one.
    const nowBand =
      probe.wl_band !== null && curBand !== null && curBand !== probe.wl_band
        ? `, now in the ${bandLabel(curBand)} band`
        : probe.wl_band !== null && curBand !== null
          ? `, still in that band`
          : "";
    // WAS: "As scored for this quarter it is 65.2, still in that band." — opened on an adverbial
    // clause, and "it" again stood for the company while the sentence before it was about a score.
    const now =
      detail?.cur_composite !== null && detail?.cur_composite !== undefined && curBand
        ? ` This quarter it scores ${scoreDisplay(Number(detail.cur_composite), curBand)}${nowBand}.`
        : "";
    facts.push({
      key: "personal.watchlist",
      kind: "position",
      display: `You added this company to your watchlist on ${ymd(probe.wl_added)}.${pinned}${now}`,
    });
  }

  if (alertCount > 0) {
    facts.push({
      key: "personal.alerts",
      kind: "position",
      display: `You have ${alertCount} active ${alertCount === 1 ? "alert" : "alerts"} on this company.`,
    });
  }

  // ── Portfolio findings that NAME this stock ────────────────────────────────────────────────────
  // ⚠ THE COPY IS THE PORTFOLIO LIBRARY'S, REPRODUCED VERBATIM. Its `read` strings are authored and
  // already carry their own `doesntMean`; rewriting them here would fork copy that has one home.
  // ⚠ NOT AN INDEXED LOOKUP, AND IT DOES NOT NEED TO BE. `fired_findings` is jsonb with no index on
  // its contents, but nothing here queries BY symbol: the reader's latest snapshot is fetched by
  // (user_id, created_at) — which is the row we want anyway — and filtered in memory. Measured: 9
  // findings per snapshot on average, 12 at most, ~4.4 KB of jsonb, 5.3 KB at worst. Scanning twelve
  // objects in memory is cheaper than the index would be to maintain.
  // ── Portfolio findings that NAME this stock ────────────────────────────────────────────────────
  // ⚠ THE COPY IS THE PORTFOLIO LIBRARY'S, REPRODUCED VERBATIM. Its `read` strings are authored and
  // already carry their own `doesntMean`; rewriting them here would fork copy that has one home. Only
  // findings that pass BOTH filters are shown: the bind must name this symbol, and the entry must
  // carry a read and a doesntMean. A finding with no reader-facing sentence is a scoring artefact.
  //
  // ⚠ NOT AN INDEXED LOOKUP, AND IT DOES NOT NEED TO BE. `fired_findings` is jsonb with no index on
  // its contents, but nothing here queries BY symbol: the reader's latest snapshot is fetched by
  // (user_id, created_at) — the row we want anyway — and filtered in memory. Measured: 9 findings per
  // snapshot on average, 12 at most, ~4.4 KB of jsonb and 5.3 KB at worst. Scanning twelve objects in
  // memory costs less than the GIN index would cost to maintain, and only two PF ids name a symbol at
  // all (PS1 via `symbols`, PS2 via `symbol`), so the match is narrow by construction.
  const findings = collectFindings(detail?.findings, symbol);

  return { facts, findings };
}

/**
 * ★ 4c — THE BOOK'S BAND MOVES, RANKED AGAINST THE ONE SOURCE THAT OWNS THE ORDER.
 *
 * The SQL returns raw `{from, to}` band pairs and nothing else; the direction is decided here, by
 * INDEX INTO LABEL_BAND_MAP, which is documented as ordered low→high and is the same array the health
 * section reads its labels from. Ranking in SQL would have meant a CASE expression listing the five
 * bands in order — a second copy of the ordering, in a language where nothing would notice it drifting
 * from the first. A band renamed or a band inserted breaks both halves here at once, visibly.
 *
 * A pair naming a band the map does not contain yields direction 0 and is counted as a change with no
 * direction, never silently as an improvement.
 */
function bandMoves(raw: unknown): { direction: number }[] {
  if (!Array.isArray(raw)) return [];
  const rank = (b: unknown): number => LABEL_BAND_MAP.findIndex((x) => x.band === b);
  const out: { direction: number }[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { from, to } = m as { from?: unknown; to?: unknown };
    const a = rank(from);
    const b = rank(to);
    out.push({ direction: a < 0 || b < 0 ? 0 : Math.sign(b - a) });
  }
  return out;
}

/** Symbols a finding's `bind` names — `symbol` (one) or `symbols` (several). Anything else is a
 *  portfolio-level finding about the whole book and is NOT this stock's business to report. */
function boundSymbols(bind: unknown): string[] {
  if (!bind || typeof bind !== "object") return [];
  const b = bind as Record<string, unknown>;
  const out: string[] = [];
  if (typeof b.symbol === "string") out.push(b.symbol);
  if (Array.isArray(b.symbols)) out.push(...b.symbols.filter((x): x is string => typeof x === "string"));
  return out;
}

/** Findings from the reader's latest portfolio snapshot whose bind names `symbol`. */
function collectFindings(raw: unknown, symbol: string): PersonalFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonalFinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    if (!boundSymbols(f.bind).includes(symbol)) continue;
    const id = typeof f.id === "string" ? f.id : null;
    const label = typeof f.label === "string" ? f.label : null;
    const read = typeof f.read === "string" ? f.read : null;
    const doesntMean = typeof f.doesntMean === "string" ? f.doesntMean : null;
    // The portfolio library's own rule: a finding without a doesnt-mean does not ship. Enforced on the
    // way in as well as the way out, because this is a different surface reading its data.
    if (!id || !label || !read || !doesntMean) continue;
    out.push({ id, label, read, doesntMean });
  }
  return out;
}
