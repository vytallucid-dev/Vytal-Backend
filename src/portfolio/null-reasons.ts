// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOG'S HONEST-NULL TAXONOMY (Construction v2 Stage 10a · ODL cv2-s10a-nullreason-honest)
//
// Every null in `instruments.attributes` is stamped with WHY it is null. The ingestion layer has always
// done this — bond-guards.ts, govt-guards.ts, reit-distributions.ts each decide the reason at the moment
// they fail to find the value, which is the only moment the reason is knowable. This file is the READ
// side of that discipline: it turns a stored reason into a sentence, and it refuses to turn two different
// reasons into the same sentence.
//
// ── ★ THE RULE: THE CLASS PICKS THE SHAPE. THE REASON PICKS THE SENTENCE. ─────────────────────────
//
//   our_gap    — WE cannot get it. The gap is ours, and we say so.
//   world_gap  — the source we read does not publish it.
//   not_a_gap  — ★ THERE IS NOTHING TO GET. Not a gap at all — a FACT about the instrument.
//   refused    — ★ WE COULD HAVE PUBLISHED SOMETHING AND CHOSE NOT TO. The quality gate fired.
//
// ── ★ WHY `refused` IS A FOURTH CLASS AND NOT A KIND OF GAP (Stage 10a batch 3) ──────────────────
//
// "We computed it and won't publish it" is not our gap, not the world's, and not a non-gap. Nothing is
// missing — a number EXISTS and we are standing in front of it. `withheld_implausible` saw a −99% drawdown
// on a liquid fund and refused to ship it. `credit_benchmark_unavailable` HAS a G-Sec index available and
// declines to use it, because a credit fund's excess return over G-Secs is its CREDIT SPREAD and calling
// that alpha would dress a risk premium up as manager skill.
//
// It is the most Vytal sentence in the set: it says THE QUALITY GATE EXISTS AND FIRED. Collapse it into
// "unavailable" and the user learns we are missing data, when what actually happened is that we caught
// something and protected them from it.
//
// ── ⚠ TWO SOURCES, ONE TAXONOMY — AND THE VOCABULARY IS NOT COPIED HERE ──────────────────────────
//
// Nulls are stamped in two places, and this file classifies BOTH without restating either:
//   · `instruments.attributes.*NullReason` — 6 reasons, declared by the ingestion GUARDS. Owned below,
//     because nothing else owns them.
//   · `mf_analytics.omissions`            — 23 codes, declared by `ingestions/amfi/mf-omissions.ts`,
//     which ALREADY owns the codes AND composes their sentences at read time. ★ NOT DUPLICATED HERE.
//     `OMISSION_CLASS` IMPORTS `OmissionCode` and adds only the one thing that module lacks: THE CLASS.
//     Copying the codes and their sentences into this file to make the two sources look symmetric would
//     be a second home for a vocabulary that already has a good one — and mf-omissions.ts has a
//     documented reason for its shape (storing prose per scheme pushed the table to 15.1 MB against a
//     single-digit-MB promise, so it stores codes and composes at read).
//     ★ ONE VOCABULARY, ONE TAXONOMY, TWO SOURCES — by importing, not by mirroring.
//
//     (23 is COUNTED — `verify-phs-pd-readtime.ts` §8 prints `Object.values(OmissionCode).length`. An
//     earlier draft of this comment said 26, twice, from reading rather than counting. The gate is what
//     corrected it, which is the whole argument for having one.)
//
// ── ⚠ WHY `not_a_gap` IS NOT A ROUNDING ERROR ────────────────────────────────────────────────────
//
// A T-BILL HAS NO COUPON. It is issued at a discount and redeems at par; that IS the instrument. 54 of
// our 170 gsecs are discount instruments. Render `discount_instrument` as "coupon unavailable" and we
// tell a user we are missing a number THAT DOES NOT EXIST — inventing a gap in our own data to apologise
// for. The same is true of `no_distributions_in_window`: a newly-listed REIT has not skipped a payout,
// it has not had one yet. Zero occurrences is INFORMATION, not absence of information.
//
// The ingestion layer already knew this, in its own words (govt-guards.ts:160):
//     base.couponNullReason = "discount_instrument"; // NOT a gap — a T-bill genuinely has no coupon
// The distinction was recorded at write and lost on the way to the read. This file is where it stops
// being lost. Six reasons, three shapes, NEVER ONE BUCKET (the same law as PV4/PV5/PV6).
//
// ── ⚠ AN UNKNOWN REASON IS OMITTED, NEVER BUCKETED ───────────────────────────────────────────────
//
// `attributes` is JSON: at runtime a reason is whatever string the ingestion wrote, and a new ingestion
// can add a seventh tomorrow. `classifyNullReason` returns null for anything it does not know, and every
// render site SKIPS an unclassified reason rather than describing it.
//
// It does NOT throw. A read path that 500s the whole portfolio because an ingestion added a reason is a
// worse failure than the one it prevents — and this is the read path. Nor does it fall back to
// "unavailable": that is the collapse this file exists to forbid, and a fallback would commit it in the
// exact case we know least about. So: DEGRADE BY OMISSION (honest), never by mislabel (the disease).
// The build catches the seventh reason instead — `verify-phs-null-reasons.ts` scans the ingestion guards
// for every `*NullReason` literal and fails if one is missing here. Silence at runtime, loud at CI.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** WHOSE gap this null is. The class picks the SHAPE of the sentence — see the header. */
export type NullReasonClass = "our_gap" | "world_gap" | "not_a_gap" | "refused";

/** Every reason the ingestion layer can stamp. Asserted exhaustive against the guards at CI. */
export type NullReason =
  | "not_sourceable"
  | "not_in_our_universe"
  | "unparseable_name"
  | "not_in_source"
  | "no_distributions_in_window"
  | "discount_instrument";

/** The reason's OWN clause — what is true about THIS reason, not about its class. Six reasons, six
 *  clauses: `not_sourceable` and `unparseable_name` are both our gap, but "no source publishes it" and
 *  "we could not read it off the name" are different admissions and cost different things to close.
 *
 *  ★ A DISCRIMINATED UNION, so `fact` is REQUIRED on `not_a_gap` and impossible elsewhere — the COMPILER
 *  proves the not-a-gap sentence exists before the verify runs. `fact?: string` on a flat interface would
 *  have made the one sentence that matters most the one easiest to forget, and its absence would degrade
 *  to a clause that reads like an absence — the precise failure this file exists to prevent, reintroduced
 *  as a default. (Same discipline as `copy.ts`'s required `job`: a comment cannot be asserted.) */
export type NullReasonMeaning =
  | { cls: "our_gap" | "world_gap"; clause: string }
  | {
      cls: "not_a_gap" | "refused";
      clause: string;
      /** ★ The WHOLE sentence, authored per reason rather than composed from `field`.
       *
       *  The other two classes take the field as a subject and predicate the same thing of it ("we do not
       *  have X", "X is not published"), so one shape serves any field. `not_a_gap` cannot work that way:
       *  its sentence is not ABOUT a missing field at all, it is about what the instrument IS. And each
       *  not-a-gap reason explains exactly one field by its nature — `discount_instrument` only ever
       *  explains a coupon, because that is the only thing being issued at a discount explains. */
      fact: string;
    };

export const NULL_REASON: Record<NullReason, NullReasonMeaning> = {
  // ── our gap ──────────────────────────────────────────────────────────────────────────────────────
  not_sourceable: { cls: "our_gap", clause: "we have no source for it" },
  not_in_our_universe: { cls: "our_gap", clause: "the issuer is outside the universe we catalogue" },
  unparseable_name: { cls: "our_gap", clause: "we could not read it off the instrument's name" },
  // ── the world's gap ──────────────────────────────────────────────────────────────────────────────
  not_in_source: { cls: "world_gap", clause: "the source we read does not publish it" },
  // ── ★ not a gap at all — nothing is missing, and the sentence must not imply that anything is ─────
  no_distributions_in_window: {
    cls: "not_a_gap",
    clause: "there have not been any yet",
    // ⚠ THE EARLIER DRAFT READ "…there is no yield to report, RATHER THAN ONE WE ARE MISSING", and the
    // absence-vocabulary gate caught it on the word "missing" — inside a clause DENYING missingness.
    // That looks like a false positive, and the reflex is to loosen the gate. It is not one: the rule for
    // `not_a_gap` is stronger than "do not assert absence", it is DO NOT RAISE ABSENCE AT ALL, EVEN TO
    // DENY IT. A sentence that says "not a gap" has already put the gap in the reader's head and is then
    // arguing with it. `discount_instrument` below never does this — it just says what the instrument
    // does — which is what proved the positive form was available here too.
    fact: "it has not made a distribution yet — a trust that has paid nothing has no yield, and zero payouts is itself the answer",
  },
  discount_instrument: {
    cls: "not_a_gap",
    clause: "it is issued at a discount and redeems at par",
    fact: "it pays no coupon at all — it is issued at a discount and redeems at par, which is how it pays",
  },
};

/** A stored reason string → its meaning. `null` ⇔ WE DO NOT KNOW THIS REASON — the caller must OMIT the
 *  field, never describe it. See the header: degrade by omission, never by mislabel. */
export function classifyNullReason(reason: unknown): NullReasonMeaning | null {
  if (typeof reason !== "string") return null;
  return (NULL_REASON as Record<string, NullReasonMeaning>)[reason] ?? null;
}

/**
 * The one place a null becomes a sentence. `field` is the human name of the missing thing ("a credit
 * rating", "the maturity date") — it is the SUBJECT, and the class decides what is predicated of it.
 *
 * ★ The three shapes are genuinely different sentences, not three tones of one sentence:
 *     our_gap   — an ADMISSION. We say the gap is ours, out loud, because it is.
 *     world_gap — an ATTRIBUTION. Nobody publishes it; we are not hiding anything.
 *     not_a_gap — a STATEMENT OF FACT about the instrument. Nothing is missing. Nobody failed.
 *
 * Returns null for an unknown reason — the caller omits the field.
 */
export function describeNull(field: string, reason: unknown): { cls: NullReasonClass; sentence: string } | null {
  const m = classifyNullReason(reason);
  if (!m) return null;
  switch (m.cls) {
    case "our_gap":
      return { cls: m.cls, sentence: `we do not have ${field} — ${m.clause}` };
    case "world_gap":
      return { cls: m.cls, sentence: `${field} is not published by the source we read` };
    case "not_a_gap":
      // ⚠ NOT "unavailable", NOT "missing", NOT "we don't have". There is nothing to have, so `field` is
      // deliberately UNUSED here: the sentence is about what the instrument IS, and naming the field as a
      // subject is the first step toward implying it is absent. Asserted in verify-phs-null-reasons.ts
      // against the absence vocabulary — this is the sentence the whole file exists to protect.
      return { cls: m.cls, sentence: m.fact };
    case "refused":
      return { cls: m.cls, sentence: m.fact };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SOURCE 2 — `mf_analytics.omissions`. THE CLASS ONLY. The codes and their sentences live in
// `ingestions/amfi/mf-omissions.ts` and are imported, never mirrored (see the header).
//
// ★ EVERY CLASSIFICATION BELOW WAS READ OFF THE INGESTION'S OWN PROSE, NOT INFERRED FROM THE CODE NAME —
// and that mattered more than expected, because SEVERAL CODES CLASSIFY AGAINST THEIR OWN NAME:
//
//   `credit_benchmark_unavailable` says "unavailable" and is a REFUSAL. Its own sentence: "We could
//   measure it against a government-bond index instead — but a credit fund's excess return over G-Secs is
//   mostly its CREDIT SPREAD… Reporting that as 'alpha' would dress a risk premium up as manager skill.
//   We would rather show you nothing than that." Nothing is unavailable. We have the alternative and we
//   refuse it.
//
//   `benchmark_too_short` sounds like a fact about the benchmark and its sentence says the opposite:
//   "This is a gap in OUR index history, not in the fund's record." → our_gap, in its own words.
//
// A name is a label someone chose; the sentence is the argument they made. Classify the argument.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { OmissionCode, type OmissionCodeValue } from "../ingestions/amfi/mf-omissions.js";

/**
 * Reason code → class, for the codes we can classify HONESTLY. 24 of 26.
 *
 * ── ★ WHY `Partial` AND NOT A TOTAL `Record` (Stage 10a · ODL cv2-s10a-unclassified-is-a-class) ────
 *
 * The total `Record` was written when the assumption was "every code is classifiable". THE ASSUMPTION IS
 * FALSE — two codes carry two classes for ONE null — and a total type does not discover that, it FORCES A
 * FABRICATION TO SATISFY ITSELF. The type should describe the world, not compel it.
 *
 * The taxonomy's own law already had the answer: an ambiguous code is OMITTED, NEVER BUCKETED. No class →
 * no sentence shape → the field simply is not rendered. It is `not_sourceable` one level up: we do not
 * have the classification, and that gap is ours.
 *
 * ⚠ `Partial` ALONE WOULD BE A REGRESSION, and this is the whole point: it makes a FORGOTTEN code look
 * IDENTICAL to a DELIBERATELY UNCLASSIFIED one — which is precisely the confusion the four classes exist
 * to abolish for data, reappearing in the taxonomy itself. So absence is never the signal:
 * `OMISSION_UNCLASSIFIED` below names every deliberate omission and says why, and the gate asserts the two
 * sets are disjoint and together cover every code the ingestion writes.
 */
export const OMISSION_CLASS: Partial<Record<OmissionCodeValue, NullReasonClass>> = {
  // ── not_a_gap — nothing is missing; the question has no answer, or nothing happened ──────────────
  /** "This is a data state, not an error — a young fund genuinely has no long-run number." */
  [OmissionCode.INSUFFICIENT_HISTORY]: "not_a_gap",
  /** "it stopped pricing long before it. There is nothing to compute from." */
  [OmissionCode.NO_NAV_IN_WINDOW]: "not_a_gap",
  /** "a risk-adjusted return is undefined — not infinite, and not zero." */
  [OmissionCode.ZERO_DISPERSION]: "not_a_gap",
  /** ★ `discount_instrument`'s twin: "'How sensitive is this fund to an asset that carries no risk' is
   *  not a question with an answer." A liquid fund's beta is not missing. It is meaningless. */
  [OmissionCode.BENCHMARK_NO_MARKET_RISK]: "not_a_gap",
  /** "Too few days where BOTH this fund and its benchmark moved together." Not enough to mean anything. */
  [OmissionCode.INSUFFICIENT_PAIRED_HISTORY]: "not_a_gap",
  /** "A rank in a pool that small is noise, not information." */
  [OmissionCode.NOT_RANKED_BUCKET_TOO_SMALL]: "not_a_gap",
  // ── our_gap — we could hold it and don't ─────────────────────────────────────────────────────────
  /** "Deepen the index backfill to fix this." Ours, and it says so. */
  [OmissionCode.RISK_FREE_TOO_SHORT]: "our_gap",
  /** "No G-Sec / overnight-rate series is loaded." */
  [OmissionCode.RISK_FREE_ABSENT]: "our_gap",
  /** ★ "This is a gap in OUR index history, not in the fund's record." — classified against its name. */
  [OmissionCode.BENCHMARK_TOO_SHORT]: "our_gap",
  /** "we hold no overseas index series." */
  [OmissionCode.OVERSEAS_INDEX_UNAVAILABLE]: "our_gap",

  // ── world_gap — the world does not publish it ────────────────────────────────────────────────────
  /** "this category has no standard index we can honestly measure it against." */
  [OmissionCode.NO_BENCHMARK_FOR_CATEGORY]: "world_gap",
  [OmissionCode.NO_DEFENSIBLE_BENCHMARK]: "world_gap",
  /** "no AMFI category for this scheme." */
  [OmissionCode.NOT_RANKED_NO_CATEGORY]: "world_gap",

  // ── ★ refused — a number existed and we declined to ship it ──────────────────────────────────────
  /** "Rather than round an absurd number into a plausible-looking one, it is withheld." */
  [OmissionCode.OUT_OF_RANGE]: "refused",
  /** "we will not show it… we can see that, but we cannot source what it was, and we will not guess." */
  [OmissionCode.WITHHELD_IMPLAUSIBLE]: "refused",
  /** "it is withheld rather than guessed." ★ The refusal PI5 must inherit rather than route around. */
  [OmissionCode.IDCW_NAV_NOT_TOTAL_RETURN]: "refused",
  /** ★ "We would rather show you nothing than that." Classified against its name — see the header. */
  [OmissionCode.CREDIT_BENCHMARK_UNAVAILABLE]: "refused",
  /** "Forcing a plausible-looking index onto it would produce a beta and an alpha that are wrong in a way
   *  you could not see." An index could be forced. We decline. */
  [OmissionCode.THEMATIC_NO_CLEAN_INDEX]: "refused",
  /** "ranking it against open-ended funds would pollute their percentiles." */
  [OmissionCode.NOT_RANKED_CLOSE_ENDED]: "refused",
  /** "A stale return would distort a live pool." */
  [OmissionCode.NOT_RANKED_DORMANT]: "refused",
  /** "we will not guess which pool this belongs to — guessing the bucket would be as dishonest as
   *  guessing the plan." AMFI's silence is the world's gap; the REFUSAL TO GUESS is the operative act. */
  [OmissionCode.NOT_RANKED_PLAN_UNKNOWN]: "refused",
};

/**
 * ★ THE CODES WE DELIBERATELY DO NOT CLASSIFY — named, with the reason, so that ABSENCE IS NEVER THE
 * SIGNAL. A code missing from `OMISSION_CLASS` and missing from here is a code someone FORGOT; a code
 * here is a code we looked at and could not answer honestly. The gate asserts the two sets are disjoint
 * and jointly cover everything the ingestion writes, so "forgotten" and "deliberate" can never be
 * confused — the distinction the four classes make about DATA, applied to the taxonomy itself.
 *
 * Both entries below are blocked on the same thing: TWO CLASSES FOR ONE NULL. Measured, each explains
 * exactly one key — `benchmark` — so both halves of each sentence answer the same question ("why does
 * this fund have no benchmark?"). That is what makes them two codes rather than one ambiguous one, and
 * splitting a code the ingestion writes and 563 rows already store is the fold's job, not a findings
 * batch's. Filed as T-2.
 */
export const OMISSION_UNCLASSIFIED: ReadonlyMap<OmissionCodeValue, string> = new Map([
  [
    OmissionCode.COMMODITY_NO_EQUITY_BENCHMARK,
    "Two classes, one null (25 rows, key `benchmark`). Its sentence says BOTH 'No equity index is a " +
      "meaningful benchmark for it' (not_a_gap — a gold fund's beta-vs-Nifty is not missing, the question " +
      "has no answer) AND 'we do not hold a commodity price series' (our_gap — its beta-vs-gold IS missing, " +
      "and that one is ours). Classifying either way buries a true sentence. Needs the ingestion split — T-2.",
  ],
  [
    OmissionCode.FOF_NO_DIRECT_BENCHMARK,
    "Two classes, one null (538 rows, key `benchmark`). 'A fund-of-funds' benchmark is whatever its " +
      "UNDERLYING funds are benchmarked to' and no index expresses that (not_a_gap); 'We hold no such " +
      "mapping' says we could build the look-through and have not (our_gap). The prose argues both. Needs " +
      "the ingestion split — T-2.",
  ],
]);

/** The row-level omission key. Its value explains EVERY metric on the row at once. */
export const OMISSION_ALL = "_all";

/**
 * Why a metric on an `mf_analytics` row is null. `null` ⇔ the metric is not omitted (it has a value), or
 * the code is one we do not classify (omit the field — never bucket it).
 *
 * ★ THE TWO-LEVEL RULE, ENFORCED HERE SO NO CALLER HAS TO REMEMBER IT.
 *
 * The ledger is two-level: a row-level `_all` covers every metric, and per-metric keys cover the rest.
 * `_all` is NOT repeated into the per-metric keys. So a consumer that reads only `omissions[metric]` sees
 * a null with no reason and concludes the honest-null design has a hole — 993 rows of `max_drawdown_5y`
 * look exactly like that, and are fully explained one level up by `_all: no_nav_in_window`.
 *
 * ⚠ I NEARLY FILED THAT AS A DEFECT. The next reader will too, unless the code makes checking `_all`
 * impossible to skip. Hence: there is no accessor that reads the per-metric key alone.
 */
export function omissionFor(
  omissions: unknown,
  metric: string,
): { code: OmissionCodeValue; cls: NullReasonClass; level: "row" | "metric" } | null {
  if (!omissions || typeof omissions !== "object" || Array.isArray(omissions)) return null;
  const o = omissions as Record<string, unknown>;
  // ★ `_all` FIRST — it is the row saying "nothing on me is computable", and it outranks any per-metric
  // key precisely because it is the more fundamental statement.
  const raw = o[OMISSION_ALL] ?? o[metric];
  const level: "row" | "metric" = o[OMISSION_ALL] != null ? "row" : "metric";
  if (typeof raw !== "string") return null;
  const cls = (OMISSION_CLASS as Record<string, NullReasonClass>)[raw];
  if (!cls) return null; // an unclassified code is OMITTED, never bucketed — same law as above
  return { code: raw as OmissionCodeValue, cls, level };
}
