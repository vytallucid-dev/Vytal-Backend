// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READ-TIME FINDINGS — fired by the READ, never by `persist`. Joined to the persisted set at render.
//
// ★ THE RULE THAT PUTS A FINDING HERE RATHER THAN IN `patterns.ts` — TWO DOORS, AND PD USES THE SECOND:
//
//   ① PROVENANCE (PE6, Stage 9): the fired set is derived from HASHED INPUTS → persistable.
//                                 PE6 is derived from a LIVE FACT           → not.
//
//   ② SUBJECT (the PD family, Stage 10a — ODL cv2-s10a-pd-read-time):
//
//        ★ A PD FINDING DESCRIBES VYTAL, NOT THE BOOK.
//          The persisted row is a snapshot of the USER'S PORTFOLIO. A fact about OUR DATA COVERAGE has
//          a DIFFERENT SUBJECT — wrong subject, wrong lifetime, wrong home. It was never eligible for
//          the book's snapshot in the first place.
//
//      Doc 2 named this without noticing it had named the home: "Facts about OUR DATA, not about the
//      holding" + "reference only, always". The family's own definition implies its address.
//
//      PD7 makes it unarguable: `oldestSyncAgeDays = f(now)`, and `fingerprintOf` has NO time input — so
//      a persisted PD7 gets no new fingerprint, no write, and serves "synced 3 days ago" forever.
//      STALE-BY-CONSTRUCTION: the exact bug the hash exists to make impossible. PD1/PD2/PD3/PD5 fail the
//      same way more slowly — they change when WE improve, not when the user trades, so freezing "we have
//      no credit ratings" means every stored row still says so the day after we source ratings.
//
// ★ AND PD1's "NEVER SUPPRESSIBLE" IS ENFORCED HERE, BY ARCHITECTURE, WITH NO FLAG. Triage and ranking
// operate on the PERSISTED fired set (`reshapeSnapshot` partitions `s.firedFindings`). PD is never in it.
// The sort does not decline to drop PD1 — THE SORT NEVER SEES IT. Nothing to respect, nothing to forget.
// ⚠ If PD is ever moved into `patterns.ts`, PD1 becomes suppressible the same day, silently.
//
// `firePortfolioFindings` runs INSIDE `persist`, and `persist` deliberately does not take
// `heldNotValued` (ODL `cv2-s7-refuse-live-facts`):
//
//   persist.ts — "`heldNotValued` is deliberately NOT taken here… whether a symbol is valuable is a
//                 LIVE fact (the catalog can learn it tomorrow)… The READ serves it, fresh."
//
// So PE6 CANNOT be a compute-time finding: computing it there would freeze the same staleness one layer
// up — an append-only row asserting "₹270 of your book has no price" long after the catalog learned one,
// with nothing to correct it. §12's refusal of `unvaluedShare`/`unvaluedValue` as PERSISTED FIELDS is
// the same ruling; this file is that ruling applied to the FINDING built from them.
//
// ⚠ THIS FILE EXISTS TO BE VISIBLE. The danger is not that PE6 is wrong — it is that a future reader
// sees one finding computed in the controller, assumes it was an oversight, and "tidies" it into
// `firePortfolioFindings`, where it silently freezes. A finding computed late but SHAPED like a
// persisted one invites exactly that. So: its own module, its own function, its own copy map
// (`READ_TIME_COPY`), and this comment. The shape must announce the reason.
//
// PURE. No DB, no I/O — the caller (the read controller) is the only place the live disclosure and the
// valued book meet, and it passes both in. The PD family's catalog reads live in `read-time-catalog.ts`
// for the same reason: purity here is what lets a synthetic fixture prove a finding fires, and SIX OF THE
// SEVEN PD FINDINGS CANNOT FIRE AGAINST THE LIVE COHORT (zero bonds, gsecs, sgbs, reits, stale accounts).
// A fire function that needed a database could only be tested by a database that cannot exercise it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { PfFinding } from "./patterns.js";
import { READ_TIME_COPY } from "./copy.js";
import type { HeldNotValued, StaleAccount } from "./assemble.js";
import type { UnpricedReason } from "../price-resolver.js";
import type { HeldInstrumentFacts, HeldFundAnalytics } from "./read-time-catalog.js";
import { describeNull, classifyNullReason, omissionFor, type NullReasonClass } from "../null-reasons.js";
import { disclosuresFor, HoldingDisclosure, REASON_CLAUSE } from "../disclosures.js";
import { natureOf } from "./entity.js";
import * as K from "./constants.js";

// `REASON_CLAUSE` (the `unpricedReason` → clause map) moved to ../disclosures.ts so /me/holdings renders
// the SAME prose per holding — one home, imported above. PE6/PD4 read it exactly as before; the finding
// text is byte-identical. See disclosures.ts for the reasoning (the asset-class.ts extraction pattern).

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * PE6 · "Capital we couldn't value" — Caution, Loud. Fires when ANY held capital has no price we can
 * source. NOT gated on the provisional threshold: `constructionProvisional` (> 25%) is about whether the
 * NUMBER is trustworthy; PE6 is about whether we told the user the truth about their book. A ₹270
 * position we cannot value is a fact at 0.4% just as much as at 40% — the honest sentence does not wait
 * for a threshold.
 *
 * `unvaluedValue`/`unvaluedShare` come from `constructionValuation()`, which the read already calls —
 * this does not recompute them (one fact, one home). It only names them.
 */
export function fireReadTimeFindings(v: {
  unvaluedValue: string;
  unvaluedShare: number;
  heldNotValued: HeldNotValued[];
}): PfFinding[] {
  const out: PfFinding[] = [];
  const value = Number(v.unvaluedValue);
  if (!(v.unvaluedShare > 0) || !(value > 0)) return out;

  const n = v.heldNotValued.length;
  const reasons = [...new Set(v.heldNotValued.map((h) => h.unpricedReason))].filter((r): r is UnpricedReason => r != null);
  const clause = reasons.length === 1 ? REASON_CLAUSE[reasons[0]] : reasons.map((r) => REASON_CLAUSE[r]).join("; ");
  out.push({
    id: "PE6",
    family: "PE",
    label: "Capital we couldn't value",
    tone: "Caution",
    loud: true,
    doesntMean: READ_TIME_COPY.PE6.doesntMean,
    bind: {
      unvaluedValue: v.unvaluedValue,
      unvaluedShare: v.unvaluedShare,
      holdings: v.heldNotValued.map((h) => ({ symbol: h.symbol, quantity: h.quantity, unpricedReason: h.unpricedReason, brokerCurrentValue: h.brokerCurrentValue })),
    },
    read: `${inr(value)} of your book (${n} ${n === 1 ? "holding" : "holdings"}) has no price we can source — ${clause}. It is not reflected in Construction.`,
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PD FAMILY (doc 2 §10) — DISCLOSURES. Panel 6, reference-only, ALWAYS. Never a Caution about the
// user's book; every one is a fact about OUR DATA. See the header for why they live here.
//
// ⚠ REFERENCE-ONLY IS STRUCTURAL: no PD finding carries a `storyClause`, so none can be selected into
// the story (doc 2 §9.2). Asserted in verify-phs-pd-readtime.ts — the story composer (10b) reads
// `storyClause`, and a finding without one is not eligible by construction rather than by a filter
// somebody has to remember to write.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A PD finding is Neutral and quiet, always — the family's tone is not a per-finding judgment call. */
const pd = (id: string, label: string, bind: Record<string, unknown>, read: string): PfFinding => ({
  id,
  family: "PD",
  label,
  tone: "Neutral",
  loud: false,
  doesntMean: READ_TIME_COPY[id]!.doesntMean,
  bind,
  read,
});

/**
 * The catalog fields PD1 reports alongside the rating, with the attribute key that says WHY each is null.
 * Ordered as PD1 reads them.
 *
 * ★ MATURITY IS TWO FACTS, NOT ONE — and the first version of this list treated it as one (ruling ④).
 *
 *   maturityDate:  2 of 356 bonds.
 *   maturityYear: 124 of 356 — parsed off the instrument's own name ("VPT 12% 2028" → 2028).
 *   ⇒ 122 bonds where WE HAVE THE YEAR AND NOT THE DATE.
 *
 * PD1 said "the maturity date is not published by the source we read" and stopped. TRUE, and INCOMPLETE:
 * it tells a user we have nothing about when their bond matures while we know the year for a third of
 * them. That is ruling ③'s failure one level deeper — I bound `maturityDate` honestly and never asked
 * whether maturity was ONE fact. The catalog knew it was two; the finding flattened it.
 *
 * `maturityYear` carries no `*NullReason` of its own — it is derived from the name, so its absence is
 * explained by `maturityDateNullReason` (`unparseable_name` ⇒ we could not read either). It therefore
 * shares the reason key and is never given a fabricated one.
 */
const BOND_FIELDS = [
  { key: "issuer", reasonKey: "issuerNullReason", label: "the issuer" },
  { key: "coupon", reasonKey: "couponNullReason", label: "the coupon" },
  { key: "maturityYear", reasonKey: "maturityDateNullReason", label: "the maturity year" },
  { key: "maturityDate", reasonKey: "maturityDateNullReason", label: "the exact maturity date" },
] as const;

const has = (a: Record<string, unknown>, k: string) => a[k] != null;

/** What a set of held instruments carries, field by field, WITH the reason where it doesn't.
 *
 *  ★ THIS IS RULING ③ IN CODE. Doc 2's PD1 says "what we can tell you: the issuer, the coupon, and the
 *  maturity where published" — measured across the catalog, the issuer is null on 46% of bonds and the
 *  maturity date on 99.4% (we have it 2 times in 356). A sentence apologising for one gap while asserting
 *  three facts we mostly lack is a second gap wearing the apology's clothes. So nothing is asserted:
 *  every clause below is COUNTED over the bonds this user actually holds. */
function carriedReport(facts: HeldInstrumentFacts[]) {
  const n = facts.length;
  return BOND_FIELDS.map((f) => {
    const present = facts.filter((x) => has(x.attributes, f.key)).length;
    // The reasons actually stamped on the ones we lack — deduped, unknown reasons dropped (they are
    // OMITTED, never bucketed: null-reasons.ts).
    const reasons = [
      ...new Set(facts.filter((x) => !has(x.attributes, f.key)).map((x) => x.attributes[f.reasonKey])),
    ]
      .map((r) => ({ raw: r, d: describeNull(f.label, r) }))
      .filter((x): x is { raw: unknown; d: NonNullable<ReturnType<typeof describeNull>> } => x.d != null);
    return { field: f.key, label: f.label, present, absent: n - present, reasons };
  });
}

export interface DisclosureInput {
  /** Live, from `listPortfolioDisclosure` — never persisted (its own docstring says so). */
  heldNotValued: HeldNotValued[];
  staleAccounts: StaleAccount[];
  oldestSyncAgeDays: number | null;
  /** Catalog facts for the instruments this user holds — `read-time-catalog.ts`. */
  facts: HeldInstrumentFacts[];
  /** Folded analytics for the funds this user holds. Funds with no mf_analytics row are ABSENT.
   *  PD6 reads the history extent; the PI family reads the metrics — one row, one load. */
  history: HeldFundAnalytics[];
}

/**
 * PD1–PD7. Pure: every input is gathered by the controller and passed in.
 *
 * ⚠ SIX OF THESE SEVEN CANNOT FIRE AGAINST THE LIVE COHORT — it holds 18 stocks and 2 mutual funds:
 * zero bonds, zero gsecs, zero sgbs, zero reits/invits, zero stale accounts. Only PD5 has live
 * reachability. Every one has a synthetic fixture proving it fires (verify-phs-pd-readtime.ts); this
 * cohort has already produced six guards that read as coverage and could not fire.
 */
export function fireDisclosureFindings(v: DisclosureInput): PfFinding[] {
  const out: PfFinding[] = [];

  // ── PD1 · No credit ratings — MANDATORY. Fires on ANY held bond, with no threshold and no condition
  //    beyond "you hold one". Its non-suppressibility is the module, not a flag: see the header. ──────
  const bonds = v.facts.filter((f) => f.assetClass === "bond");
  if (bonds.length > 0) {
    const rated = bonds.filter((b) => has(b.attributes, "creditRating")).length;
    const ratingReasons = [...new Set(bonds.map((b) => b.attributes["creditRatingNullReason"]))]
      .map((r) => classifyNullReason(r))
      .filter((m): m is NonNullable<typeof m> => m != null);
    const carried = carriedReport(bonds);
    const hasParts = carried.filter((c) => c.present > 0).map((c) => `${c.label} on ${c.present === bonds.length ? (bonds.length === 1 ? "it" : `all ${bonds.length}`) : `${c.present} of ${bonds.length}`}`);
    const lacksParts = carried
      .filter((c) => c.present === 0 && c.reasons.length > 0)
      .map((c) => c.reasons.map((r) => r.d.sentence).join("; "));
    const clause = ratingReasons.length ? ratingReasons.map((r) => r.clause).join("; ") : "we have no source for it";
    out.push(
      pd(
        "PD1",
        "No credit ratings",
        {
          bondCount: bonds.length,
          ratedCount: rated, // the raw count. 0 in every book we have ever seen — but COUNTED, not assumed.
          ratingNullReasons: [...new Set(bonds.map((b) => b.attributes["creditRatingNullReason"] ?? null))],
          carried: carried.map((c) => ({
            field: c.field,
            present: c.present,
            absent: c.absent,
            reasons: c.reasons.map((r) => ({ reason: r.raw, cls: r.d.cls, sentence: r.d.sentence })),
          })),
          bonds: bonds.map((b) => ({
            isin: b.isin,
            name: b.name,
            creditRating: b.attributes["creditRating"] ?? null,
            creditRatingNullReason: b.attributes["creditRatingNullReason"] ?? null,
          })),
        },
        `We do not have a credit rating for ${plural(bonds.length, "corporate bond")} in your book — ${clause}. ` +
          `This is the single most decision-relevant fact about a bond, and the gap is ours.` +
          (hasParts.length ? ` What we do carry: ${hasParts.join(", ")}.` : "") +
          (lacksParts.length ? ` Beyond that, ${lacksParts.join("; ")}.` : ""),
      ),
    );
  }

  // ── PD2 · No yield-to-maturity. Bonds, G-Secs and SGBs alike — all 571 in the catalog are stamped
  //    `not_sourceable`, and none of them carries a YTM. ────────────────────────────────────────────
  const debt = v.facts.filter((f) => f.assetClass === "bond" || f.assetClass === "gsec" || f.assetClass === "sgb");
  if (debt.length > 0) {
    const withY = debt.filter((d) => has(d.attributes, "yieldToMaturity")).length;
    const reasons = [...new Set(debt.map((d) => d.attributes["yieldNullReason"]))]
      .map((r) => classifyNullReason(r))
      .filter((m): m is NonNullable<typeof m> => m != null);
    const clause = reasons.length ? reasons.map((r) => r.clause).join("; ") : "we do not compute it";
    out.push(
      pd(
        "PD2",
        "No yield-to-maturity",
        {
          debtCount: debt.length,
          withYieldCount: withY,
          yieldNullReasons: [...new Set(debt.map((d) => d.attributes["yieldNullReason"] ?? null))],
          holdings: debt.map((d) => ({ isin: d.isin, name: d.name, assetClass: d.assetClass, yieldToMaturity: d.attributes["yieldToMaturity"] ?? null, yieldNullReason: d.attributes["yieldNullReason"] ?? null })),
        },
        `We do not carry a yield to maturity for ${plural(debt.length, "debt holding")} in your book — ${clause}. ` +
          `We show what each is worth today, not what holding it to maturity would return.`,
      ),
    );
  }

  // ── PD3 · Coupon income not tracked. ★ REUSES the Step 20 disclosure (ruling ④): the trigger is
  //    `disclosuresFor(assetClass)`, the function /me/holdings already renders from. PD is a VIEW of
  //    that fact, not a second source of it — recomputing the asset-class set here would be two homes
  //    for one rule, and the second one drifts.
  //
  //    ⚠ EXCEPT for one thing `disclosuresFor` STRUCTURALLY CANNOT KNOW. It is derived from the asset
  //    class alone (by design — "a second copy of a fact is a second thing to keep in step"), so it
  //    cannot tell a coupon-paying G-Sec from a T-BILL, which is also `gsec` and PAYS NO COUPON: it is
  //    issued at a discount and redeems at par. 54 of our 170 gsecs are exactly that. Firing PD3 on one
  //    would tell a user we are not tracking income THAT DOES NOT EXIST — inventing a gap in our own
  //    data to apologise for, which is the `discount_instrument` disease the null-reason taxonomy was
  //    built to prevent.
  //
  //    ★ (T-1) `disclosuresFor` NOW READS `attributes` TOO, so the two surfaces finally agree AT THE
  //    SOURCE: a T-bill returns `discount_instrument_pays_at_par`, a coupon-payer returns
  //    `coupon_income_not_tracked`. PD3 partitions on exactly that — the blind spot it used to
  //    compensate for is gone, so it no longer re-derives the exclusion by hand; it reads the same
  //    corrected classifier `/me/holdings` reads. Still BINDS the excluded discount instruments. ─────
  const paysCoupon = v.facts.filter((f) => disclosuresFor(f.assetClass, f.attributes).includes(HoldingDisclosure.COUPON_INCOME_NOT_TRACKED));
  const discount = v.facts.filter((f) => disclosuresFor(f.assetClass, f.attributes).includes(HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR));
  if (paysCoupon.length > 0) {
    const withRate = paysCoupon.filter((f) => has(f.attributes, "coupon")).length;
    out.push(
      pd(
        "PD3",
        "Coupon income not tracked",
        {
          holdingCount: paysCoupon.length,
          withCouponRateCount: withRate, // we often HAVE the rate; the income leg is the gap. Two facts.
          excludedDiscountInstruments: discount.map((d) => ({ isin: d.isin, name: d.name, why: "discount_instrument" })),
          disclosureCode: HoldingDisclosure.COUPON_INCOME_NOT_TRACKED, // the code /me/holdings renders
          holdings: paysCoupon.map((f) => ({ isin: f.isin, name: f.name, assetClass: f.assetClass, coupon: f.attributes["coupon"] ?? null })),
        },
        `The value we show for ${plural(paysCoupon.length, "debt holding")} is price only — the interest it pays out is not counted in it. ` +
          `We hold no coupon schedule for Indian debt, so the gain shown is a price return rather than a total return.`,
      ),
    );
  }

  // ── PD4 · Unpriceable holding. Binds `unpricedReason` — the same live fact PE6 names.
  //
  //    ⚠ PD4 IS NOT PE6 AT A LOWER VOLUME, and the suppression model does not apply: they have DIFFERENT
  //    SUBJECTS, which is the same distinction that put this whole family in this file. PE6's subject is
  //    THE NUMBER ("₹270 of your book is not in Construction"); PD4's is OUR COVERAGE ("we could not
  //    price this instrument"). Different facts that agree → both fire (ODL cv2-s9-suppression-model),
  //    and they land in different panels anyway.
  //
  //    ★ AND PD4 COVERS A CASE PE6 STRUCTURALLY CANNOT SEE. PE6 needs a ₹ figure to talk about, so it
  //    gates on `unvaluedValue > 0` — and `unvaluedValue` sums the BROKER's number, which is null when
  //    the broker gave none. A holding we cannot price AND have no broker value for contributes ₹0,
  //    leaves `unvaluedShare` at 0, and PE6 stays silent. That is the LEAST known holding in the book,
  //    and PE6 is quiet about it precisely because it is the least known. PD4 counts holdings, not
  //    rupees, so it says so. ──────────────────────────────────────────────────────────────────────
  if (v.heldNotValued.length > 0) {
    const n = v.heldNotValued.length;
    const reasons = [...new Set(v.heldNotValued.map((h) => h.unpricedReason))].filter((r): r is UnpricedReason => r != null);
    const noBrokerValue = v.heldNotValued.filter((h) => h.brokerCurrentValue == null).length;
    out.push(
      pd(
        "PD4",
        "Unpriceable holding",
        {
          holdingCount: n,
          unpricedReasons: reasons,
          /** How many we have NO value for at all — the ones PE6 cannot name. */
          withoutAnyValueCount: noBrokerValue,
          holdings: v.heldNotValued.map((h) => ({ symbol: h.symbol, quantity: h.quantity, unpricedReason: h.unpricedReason, brokerCurrentValue: h.brokerCurrentValue })),
        },
        `We could not source a price for ${plural(n, "holding")} you own — ${reasons.map((r) => REASON_CLAUSE[r]).join("; ") || "we have no price for it"}. ` +
          `${n === 1 ? "It sits" : "They sit"} outside every number on this page rather than inside them at zero.`,
      ),
    );
  }

  // ── PD5 · No fund look-through. §14's honest home: the sector matcher was refused at 11.9% because
  //    thematic funds are NOT sectorable from their names — a DATA problem, and this is where the data
  //    problem is stated rather than worked around. Baskets only: a gold ETF has no look-through
  //    question (it holds gold), so `nature` decides, not `assetClass`. ────────────────────────────
  const baskets = v.facts.filter((f) => natureOf(f.assetClass, f.category) === "basket");
  if (baskets.length > 0) {
    out.push(
      pd(
        "PD5",
        "No fund look-through",
        {
          fundCount: baskets.length,
          funds: baskets.map((f) => ({ isin: f.isin, name: f.name, assetClass: f.assetClass, category: f.category })),
        },
        `We can't see inside ${plural(baskets.length, "fund")} you hold. We know what each fund IS — its category, its house, its plan — not what it holds. ` +
          `The sector and company figures on this page reflect your direct holdings only.`,
      ),
    );
  }

  // ── PD6 · Thin history. Binds `nav_points` + the window. See K.PD_THIN_HISTORY_POINTS for why the
  //    cut is the ladder's BOTTOM rung and not a number invented here. ─────────────────────────────
  const thin = v.history.filter((h) => h.navPoints < K.PD_THIN_HISTORY_POINTS);
  if (thin.length > 0) {
    out.push(
      pd(
        "PD6",
        "Thin history",
        {
          fundCount: thin.length,
          thresholdPoints: K.PD_THIN_HISTORY_POINTS,
          funds: thin.map((h) => ({ isin: h.isin, schemeCode: h.schemeCode, navPoints: h.navPoints, windowFrom: h.windowFrom, windowTo: h.windowTo })),
        },
        `Our NAV history for ${plural(thin.length, "fund")} you hold is under a year long` +
          (thin.length === 1 && thin[0]!.windowFrom ? ` — it starts at ${thin[0]!.windowFrom}` : "") +
          `. Any figure we show over that history covers the window we have, not the fund's whole life.`,
      ),
    );
  }

  // ── PD7 · Account not synced. ★ REUSES `staleAccounts`/`oldestSyncAgeDays` verbatim (ruling ④) —
  //    both already computed by `listPortfolioDisclosure`, whose own docstring rules the lifetime:
  //    "Never persisted: every field here is a LIVE fact." `ageDays` GROWS EVERY DAY, which is why a
  //    persisted PD7 could never be honest and why this family lives in this file. ─────────────────
  if (v.staleAccounts.length > 0) {
    const positions = v.staleAccounts.reduce((s, a) => s + a.positions, 0);
    const age = v.oldestSyncAgeDays;
    out.push(
      pd(
        "PD7",
        "Account not synced",
        {
          staleAccountCount: v.staleAccounts.length,
          oldestSyncAgeDays: age, // null ⇔ never synced — NOT zero. A different fact.
          stalePositionCount: positions,
          accounts: v.staleAccounts.map((a) => ({ accountId: a.accountId, accountName: a.accountName, broker: a.broker, lastSyncedAt: a.lastSyncedAt, ageDays: a.ageDays, positions: a.positions })),
        },
        `${plural(v.staleAccounts.length, "account")} stopped sending us data, and ${plural(positions, "position")} on this page ${positions === 1 ? "comes" : "come"} from ${v.staleAccounts.length === 1 ? "it" : "them"}. ` +
          (age == null
            ? `We never received a sync from ${v.staleAccounts.length === 1 ? "it" : "them"}, so we cannot say how old those quantities are.`
            : `The quantities are the last ${age === 1 ? "we were told, a day ago" : `we were told, ${age} days ago`}.`),
      ),
    );
  }

  // ── ★ PD8 · Prices and NAVs on different clocks. (Stage 10a batch 3) THE FINDING PI1's RE-GATE
  //    CREATED — and it is a PD, not a PI, because the subject test decides it and the answer is
  //    unambiguous: "our price feed and our NAV feed run on different schedules" is a fact about VYTAL.
  //
  //    ⚠ WITHOUT THIS, PI1's HONESTY IS A HOLE IN THE PAGE. PI1 declines to compare a Jul-13 price to a
  //    Jul-10 NAV — correct, and by itself indistinguishable from "we didn't look". The user holds an
  //    ETF, the premium question is the one question everybody has about an ETF, and the page says
  //    nothing. So the refusal names ITSELF here, and names its cause as ours.
  //
  //    MEASURED, AND THIS IS WHY IT IS NOT A CORNER CASE: of 328 ETFs carrying both a price and a NAV,
  //    326 have a price NEWER than their NAV (307 by 3 days, 19 by 1). TWO have a same-day pair — and
  //    both are dated Jul 10, the OLDEST price in the table, while the other 326 are at Jul 13. They
  //    match because their price STOPPED, not because our feeds agreed. Doc 2's gate selects for the
  //    stalest rows in the catalog and calls them the trustworthy ones (doc-2 drift #12).
  //
  //    Gated on `heldEtfs > 0 && sameDayPairs === 0` — the book-level fact. A user with one same-day
  //    pair gets a real PI1 answer for that ETF and does not need us apologising for the feed. ────────
  const heldEtfs = v.facts.filter((f) => f.assetClass === "etf");
  const pairs = heldEtfs.map((f) => ({ f, s: pairStateOf(f) }));
  const sameDay = pairs.filter((p) => p.s.kind === "same_day");
  if (heldEtfs.length > 0 && sameDay.length === 0) {
    const lagged = pairs.filter((p) => p.s.kind === "lagged");
    const lags = [...new Set(lagged.map((p) => (p.s as { lagDays: number }).lagDays))].sort((a, b) => a - b);
    out.push(
      pd(
        "PD8",
        "Prices and NAVs on different clocks",
        {
          etfCount: heldEtfs.length,
          sameDayPairCount: 0,
          laggedPairCount: lagged.length,
          /** How far apart the two feeds landed, per ETF. The EVIDENCE — not a summary of it. */
          lagDays: lags,
          noPairCount: pairs.filter((p) => p.s.kind === "no_pair").length,
          etfs: heldEtfs.map((f) => ({
            isin: f.isin, name: f.name,
            lastPrice: f.lastPrice, lastPriceDate: f.lastPriceDate,
            currentNav: f.currentNav, navDate: f.navDate,
          })),
        },
        `We fetch exchange prices and AMFI NAVs on different schedules, so for ${plural(heldEtfs.length, "ETF")} you hold ` +
          `we do not have a price and a NAV from the same trading day` +
          (lags.length ? ` — they land ${lags.length === 1 ? `${plural(lags[0]!, "day")}` : `${lags[0]}–${lags[lags.length - 1]!} days`} apart` : "") +
          `. We cannot tell you whether ${heldEtfs.length === 1 ? "it trades" : "they trade"} away from NAV, because the two numbers we would compare are not from the same day. That gap is ours.`,
      ),
    );
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PI FAMILY (doc 2 §9) — INSTRUMENT FACTS. Panel 5. ★ NONE OF THESE DEDUCTS FROM ANYTHING.
//
// ── WHY PI IS IN THIS FILE, AND WHICH DOOR IT CAME THROUGH ───────────────────────────────────────
//
// The header names TWO doors into this module. PD came through ② (SUBJECT: it describes Vytal). ★ PI
// COMES THROUGH ①, PE6's DOOR: PROVENANCE. A PI finding describes the user's INSTRUMENT — a subject the
// persisted set is exactly the right home for — but every input is a LIVE FACT:
//
//   PI1  `lastPrice`/`currentNav` move every trading day.
//   PI3  `isActive` flips the day AMFI stops publishing a scheme.
//   PI4/PI5/PI6  the nightly fold rewrites `mf_analytics` — and `fingerprintOf` has NO input from it,
//        so a persisted PI5 would never rewrite. It would serve a drawdown measured on a NAV series we
//        have since extended, forever, with nothing to correct it. STALE-BY-CONSTRUCTION, PD7's bug in
//        a different family.
//
// So PI is read-time for PE6's reason and NOT for PD's — which is why it is routed into a panel
// (FINDING_HOME.PI) while PD is served beside the snapshot. Same file, same lifetime, different subject,
// different home. ⚠ If you are here to "unify" PD and PI because they share a module: they share a
// LIFETIME. They do not share a subject, and the router is where that difference is spent.
//
// ── ★ AND THIS IS THE FAMILY §11.2 WROTE THE PROMINENCE RULE FOR ─────────────────────────────────
//
// "PI outranks by usefulness, not by tone." A 12% ETF premium deducts NOTHING and is still the most
// actionable fact on the page — it is allowed to sit above a Caution-tone PC finding. That separation is
// only safe because every sentence below is a statement of what IS, and every one carries a Doesn't-mean
// (copy.ts) whose job is `advice-block` — the first family where that is the PRIMARY job rather than a
// secondary one. Prominence is bought with those sentences. Do not spend it without them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A PI finding. Tone and loudness are PER-FINDING here (unlike PD, whose family tone is fixed) —
 *  doc 2 §9's table rules each one, and a dormant scheme is a Caution while a maturity profile is not.
 *
 *  ★ NO `storyClause` HERE, BY DEFAULT — and that is a per-finding editorial call, not an oversight.
 *  PI is movement-4-eligible (addendum §9.2: PC/PB/PI → 4), but only the HEADLINE PI facts carry a
 *  clause and can be selected into the story: PI1's evaluable premium and PI3's dormancy — the two Loud
 *  Cautions, and the exact one §8's fund-heavy example headlines. The quiet neutral facts (PI4 tracking,
 *  PI5 drawdown, PI7 yield, PI8 maturity) and every NOT-EVALUABLE state ("we can't tell you…") are
 *  reference texture, not a point — so they carry no clause and stay in the reference by construction.
 *  Those two headline findings add `storyClause` at their own push sites via `{ ...pi(...), storyClause }`. */
const pi = (
  id: string,
  label: string,
  tone: "Neutral" | "Caution",
  loud: boolean,
  bind: Record<string, unknown>,
  read: string,
  notEvaluable?: { reason: string; cls: NullReasonClass },
): PfFinding => ({
  id,
  family: "PI",
  label,
  tone,
  loud,
  doesntMean: READ_TIME_COPY[id]!.doesntMean,
  bind,
  read,
  ...(notEvaluable ? { notEvaluable } : {}),
});

/**
 * ★ THE PAIR STATE — PI1's re-gate, as a function, because THREE CALLERS MUST AGREE ON IT.
 *
 * PI1 fires on `same_day`, goes not-evaluable on `lagged`, and PD8 fires when no held ETF is `same_day`.
 * Three findings, one rule. Written twice it would drift, and the drift would be invisible: PD8 saying
 * "no same-day pair exists" while PI1 evaluates one is a contradiction ON THE SAME PAGE.
 */
type PairState =
  | { kind: "same_day"; date: string; price: number; nav: number; premium: number }
  | { kind: "lagged"; priceDate: string; navDate: string; lagDays: number }
  | { kind: "no_pair"; missing: string[] };

function pairStateOf(f: HeldInstrumentFacts): PairState {
  const missing: string[] = [];
  if (f.lastPrice == null) missing.push("lastPrice");
  if (f.currentNav == null) missing.push("currentNav");
  if (f.lastPriceDate == null) missing.push("lastPriceDate");
  if (f.navDate == null) missing.push("navDate");
  if (missing.length) return { kind: "no_pair", missing };

  const price = Number(f.lastPrice);
  const nav = Number(f.currentNav);
  // A NAV of 0 (or a negative one) is not a divisor. It is also not something we have ever seen — but a
  // premium of Infinity rendering as "Infinity% premium" is the failure this guard costs one line to
  // prevent, and `no_pair` is the honest state: we do not have two numbers we can compare.
  if (!(nav > 0) || !Number.isFinite(price)) return { kind: "no_pair", missing: ["currentNav>0"] };

  if (f.lastPriceDate !== f.navDate) {
    const lagDays = Math.round(
      Math.abs(Date.parse(f.lastPriceDate!) - Date.parse(f.navDate!)) / 86_400_000,
    );
    return { kind: "lagged", priceDate: f.lastPriceDate!, navDate: f.navDate!, lagDays };
  }
  return { kind: "same_day", date: f.navDate!, price, nav, premium: (price - nav) / nav };
}

/**
 * ★ PI5's LADDER — AND THE ONE RULE THAT MAKES IT HONEST: THE LADDER IS FOR ABSENCE, NOT FOR REFUSAL.
 *
 * The rungs are 5y → 3y → 1y, deepest first. Walking DOWN is what a young fund needs: it has no 5-year
 * drawdown because it has not lived five years, and the 1-year number is a true thing we can say instead.
 *
 * ── ⚠ WHY A REFUSAL MUST NOT WALK ────────────────────────────────────────────────────────────────
 *
 * `idcw_nav_not_total_return` is the fold saying: this plan's NAV FALLS ON EVERY PAYOUT, so a drawdown
 * measured on it is measuring dividends, not losses. That is true at EVERY horizon. A 1-year drawdown on
 * an IDCW NAV is exactly as much of a lie as a 5-year one — just a smaller number. Falling back to it
 * LAUNDERS A REFUSAL THROUGH A SHORTER WINDOW and ships the very number the fold declined to ship.
 *
 * ★ THE FOLD'S JUDGMENT IS UPSTREAM OF THE FINDING'S. `null-reasons.ts` already carries this ruling in
 * the taxonomy — `OMISSION_CLASS[IDCW_NAV_NOT_TOTAL_RETURN] = "refused"`, annotated "the refusal PI5 must
 * inherit rather than route around". So the code below does not re-decide it. It reads the CLASS:
 *
 *     cls === "refused"  → STOP. Not evaluable. No fallback, at any rung.
 *     otherwise (absence) → walk to the next rung.
 *
 * That is the whole ruling, and it is one comparison, because batch 2 put the judgment where it belongs.
 *
 * ── ★ AND THE NESTING RULE, WHICH THE 65 FORCED (batch 3, measured) ──────────────────────────────
 *
 * A longer window CONTAINS every shorter one. So a refusal at 3y contaminates 5y BY CONSTRUCTION: the 5y
 * number was folded from a stretch of NAV that includes the stretch the fold just called impossible.
 *
 * This is not theoretical. 65 live rows carry `max_drawdown_5y` WITH NO `max_drawdown_3y`, and every one
 * of them is a segregated (side-pocketed) credit portfolio — UTI Medium Term Fund (Segregated-17022020),
 * Nippon India Medium Duration Fund (Segregated Portfolio 1) — frozen since Jan 2022, whose `vol_1y`,
 * `vol_3y` and `ret_1y` are ALL `withheld_implausible` on that same 154-point series. Their
 * `max_drawdown_5y` is **exactly 0**.
 *
 * ⚠ WITHOUT THIS RULE, PI5 TELLS THE HOLDER OF A DEFAULTED-DEBT SIDE POCKET THAT THEIR FUND HAS NEVER
 * FALLEN. That is the single worst sentence this family could produce, and doc 2's trigger
 * ("`maxDrawdown` present") produces it.
 *
 * THE CAUSE IS IN THE FOLD, AND IT IS NOT OURS TO FIX HERE (reported — T-4). `mf-implausible.ts`'s y5
 * window passes `vol: null` to the guard (line 103: "vol_5y is computed for Sharpe but never stored"), so
 * THE 5-YEAR WINDOW IS NEVER VOLATILITY-TESTED. y1 and y3 tripped `VOL_MAX` and were cleared; y5 saw a
 * drawdown of 0, found it unremarkable, and shipped. The guard's own header states the principle it then
 * fails to apply across horizons: "a window's return, its volatility, its drawdown are all folded from
 * the SAME stretch of NAV — so if that stretch is not describing the fund, none of them is."
 *
 * Repairing the guard is fold work (it rewrites 14,041 rows and a findings batch does not re-fold —
 * doc 2 §13.2). Inheriting its refusal correctly is OURS, and costs the loop below.
 */
type Rung = { horizon: "5y" | "3y" | "1y"; years: number; col: string };
const DD_RUNGS: Rung[] = [
  { horizon: "5y", years: 5, col: "max_drawdown_5y" },
  { horizon: "3y", years: 3, col: "max_drawdown_3y" },
  { horizon: "1y", years: 1, col: "max_drawdown_1y" },
];
const ddValue = (a: HeldFundAnalytics, r: Rung) =>
  r.horizon === "5y" ? a.maxDrawdown5y : r.horizon === "3y" ? a.maxDrawdown3y : a.maxDrawdown1y;

type RungPick =
  | { kind: "value"; rung: Rung; value: number }
  | { kind: "refused"; reason: string; cls: NullReasonClass; at: string; contaminates?: string }
  | { kind: "absent"; reason: string | null; cls: NullReasonClass | null };

function pickDrawdownRung(a: HeldFundAnalytics): RungPick {
  let lastAbsence: { reason: string; cls: NullReasonClass } | null = null;
  for (let i = 0; i < DD_RUNGS.length; i++) {
    const r = DD_RUNGS[i]!;
    const om = omissionFor(a.omissions, r.col);
    // ① A REFUSAL AT THIS RUNG ENDS THE WALK. Not "try a shorter one" — the shorter one is the same
    //    series and the same refusal, one window in.
    if (om?.cls === "refused") return { kind: "refused", reason: om.code, cls: om.cls, at: r.col };

    const v = ddValue(a, r);
    if (v == null) {
      if (om) lastAbsence = { reason: om.code, cls: om.cls };
      continue; // ② absence → walk
    }
    // ③ NESTING: this rung's window CONTAINS every shorter rung's. If the fold refused any of them, the
    //    stretch behind THIS number includes a stretch it called impossible. Inherit the refusal.
    for (let j = i + 1; j < DD_RUNGS.length; j++) {
      const inner = DD_RUNGS[j]!;
      const iom = omissionFor(a.omissions, inner.col);
      if (iom?.cls === "refused") {
        return { kind: "refused", reason: iom.code, cls: iom.cls, at: inner.col, contaminates: r.col };
      }
    }
    return { kind: "value", rung: r, value: v };
  }
  return { kind: "absent", reason: lastAbsence?.reason ?? null, cls: lastAbsence?.cls ?? null };
}

/**
 * ★ THE ACTUAL SPAN A RUNG COVERS — measured, never assumed from the rung's name.
 *
 * ⚠ `max_drawdown_5y` IS NOT A FIVE-YEAR NUMBER, AND THE COLUMN NAME IS THE ONLY THING THAT SAYS IT IS.
 * It is "the deepest fall inside the last 5 years OF THE NAV WE HOLD" — and measured on the live fold:
 *
 *     5,070 of the 9,626 rows carrying `max_drawdown_5y` have a window SHORTER THAN 5 YEARS.
 *     3,321 of them are under 3 years. 1,613 are under ONE.
 *
 * The live proof is the fund this batch started from: Kotak Manufacture in India Fund's series runs
 * 2022-03-02 → 2026-07-10 — 4 years and 4 months — and its `max_drawdown_5y` is −22.75%, identical to its
 * `max_drawdown_3y` because there is no year 4-to-5 for the extra window to find anything in.
 *
 * So "over the 5 years we hold" would be FALSE on more than half the catalog, and "on record" — doc 2's
 * own label for PI5 — is worse: it claims a complete history for a fund whose file we opened in 2022.
 * The rung is BOUND (`rungHorizon`); the READ names the span that was actually measured.
 */
function spanOf(a: HeldFundAnalytics, rung: Rung): { from: string; to: string; days: number } | null {
  if (!a.windowFrom || !a.windowTo) return null;
  const anchor = a.asOfDate ?? a.windowTo;
  const rungStart = new Date(anchor);
  rungStart.setFullYear(rungStart.getFullYear() - rung.years);
  // The window is the INTERSECTION of the rung's horizon with the series we actually hold. Whichever
  // starts later is the truth: a 5y rung on a 4.4y series covers 4.4 years.
  const from = new Date(Math.max(Date.parse(a.windowFrom), rungStart.getTime()));
  const to = new Date(a.windowTo);
  return {
    from: from.toISOString().slice(0, 10),
    to: a.windowTo,
    days: Math.round((to.getTime() - from.getTime()) / 86_400_000),
  };
}

/** A day count → the span in the units a person uses. "4 years and 4 months", not "1591 days". */
function humanSpan(days: number): string {
  const months = Math.round(days / 30.44);
  if (months < 1) return plural(days, "day");
  if (months < 24) return plural(months, "month");
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m === 0 ? plural(y, "year") : `${plural(y, "year")} and ${plural(m, "month")}`;
}

const pct1 = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`;
/** 'YYYY-MM-DD' → "March 2022". A drawdown window is a season, not a settlement date. */
const monthYear = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** 'YYYY-MM-DD' → "13 July 2026". PI1's dates are the OPPOSITE case from a drawdown window: the whole
 *  finding turns on WHICH DAY each number is from, so the day is the load-bearing part and must be shown. */
const fullDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface InstrumentInput {
  /** Catalog facts for what this user holds — `read-time-catalog.ts`. */
  facts: HeldInstrumentFacts[];
  /** Folded analytics, per held fund. A fund with NO mf_analytics row is ABSENT, not zeroed. */
  analytics: HeldFundAnalytics[];
}

/**
 * PI1–PI8. Pure: every input is gathered by the controller and passed in.
 *
 * ⚠ THE LIVE COHORT HOLDS 18 STOCKS AND 2 MUTUAL FUNDS — 4 baskets at 0.2% of the book. PI5 has live
 * reachability (proven on 7985d813's Kotak Manufacture in India Fund: dd5 = −22.75%, benchmark honestly
 * silent at `thematic_no_clean_index`). The rest need synthetics, and `verify-phs-pi-readtime.ts` builds
 * a book for each. ★ PI1 FIRES ZERO TIMES AGAINST PRODUCTION and that is not a gap in the test — it is
 * the measured state of the feed (2 same-day pairs in 328 ETFs, both under the cut, both stale). PD8 is
 * what the live data actually produces.
 */
export function fireInstrumentFindings(v: InstrumentInput): PfFinding[] {
  const out: PfFinding[] = [];
  const byIsin = new Map(v.analytics.map((a) => [a.isin, a]));

  for (const f of v.facts) {
    const a = byIsin.get(f.isin) ?? null;
    firePi1(out, f);
    firePi2(out, f);
    firePi3(out, f);
    firePi4(out, f, a);
    firePi5(out, f, a);
    firePi6(out, f, a);
    firePi7(out, f);
  }
  firePi8(out, v.facts); // book-level: a maturity SPREAD is a fact about the set, not about one bond
  return out;
}

// ── PI1 · Trading away from NAV — Caution, LOUD. ────────────────────────────────────────────────
//
// ★ THE GATE IS A SAME-TRADING-DAY PAIR, AND IT IS RE-GATED FROM DOC 2 (drift #12). Doc 2 says fire when
// `lastPriceDate == navDate`. That gate is RIGHT IN PRINCIPLE and its live behaviour is the opposite of
// what it intends: 2 of 328 ETFs pass it, AND THEY PASS BECAUSE THEIR PRICE IS STALE — both sit at
// Jul 10 while the other 326 are at Jul 13. The gate selects for the rows where our price feed stopped.
// Both dates are OUR FRESHNESS, not the instrument's.
//
// ⚠ AND THE PREMIUM IT WOULD HAVE SHIPPED WITHOUT THE GATE IS THE REASON THE GATE IS MANDATORY. 18 of
// 328 ETFs exceed 2% on a lagged pair, and the top six — Nasdaq Q50 at 21.6%, Hang Seng TECH 19.9%,
// Nasdaq 100 19.7%, NYSE FANG+ 19.7%, S&P 500 Top 50 19.4% — are ALL international funds priced Jul 13
// against a Jul 10 NAV. Indian international ETFs GENUINELY ran 15–20% premiums when SEBI's overseas cap
// filled, so the artifact and the real thing are the same size. THAT is why a lagged pair is refused
// rather than discounted: we cannot tell them apart, and a 20% premium is too useful to guess at.
function firePi1(out: PfFinding[], f: HeldInstrumentFacts) {
  if (f.assetClass !== "etf") return;
  const s = pairStateOf(f);

  // A lagged pair is NOT-EVALUABLE, NEVER SILENT. The user holds an ETF; "is it trading away from NAV"
  // is the question an ETF holder has; and a quiet page answers it "no". We did not check. Say so.
  if (s.kind === "lagged") {
    out.push(
      pi("PI1", "Trading away from NAV", "Neutral", false,
        {
          isin: f.isin, name: f.name,
          lastPrice: f.lastPrice, lastPriceDate: s.priceDate,
          currentNav: f.currentNav, navDate: s.navDate,
          lagDays: s.lagDays,
          premium: null, // ★ NEVER computed on a lagged pair. Not null-because-missing — null BECAUSE
                         //   THE NUMBER WOULD BE WRONG, and a bind that carried it "for reference"
                         //   would be a 20% premium sitting in the payload waiting for a UI to render.
        },
        `We can't tell you whether this ETF is trading away from its NAV. Its last price is from ` +
          `${fullDate(s.priceDate)} and its last NAV is from ${fullDate(s.navDate)} — ` +
          `${plural(s.lagDays, "day")} apart. Comparing a price to a NAV from a different day produces a ` +
          `premium that isn't there.`,
        { reason: "price_nav_not_same_trading_day", cls: "our_gap" },
      ),
    );
    return;
  }
  if (s.kind === "no_pair") {
    out.push(
      pi("PI1", "Trading away from NAV", "Neutral", false,
        { isin: f.isin, name: f.name, missing: s.missing, premium: null,
          lastPrice: f.lastPrice, lastPriceDate: f.lastPriceDate, currentNav: f.currentNav, navDate: f.navDate },
        `We can't tell you whether this ETF is trading away from its NAV — we do not hold both a price and ` +
          `a NAV for it. The comparison needs both, from the same day.`,
        { reason: "no_price_nav_pair", cls: "our_gap" },
      ),
    );
    return;
  }

  // Same-day pair. NOW the comparison means something — and only now.
  if (Math.abs(s.premium) <= K.PI_PREMIUM_NOTABLE) return; // evaluable, and there is nothing to report
  const isPremium = s.premium > 0;
  out.push({
    ...pi("PI1", "Trading away from NAV", "Caution", true,
      {
        isin: f.isin, name: f.name,
        lastPrice: f.lastPrice, currentNav: f.currentNav,
        lastPriceDate: s.date, navDate: s.date, // ★ EQUAL, and bound separately anyway: the UI must be
                                                //   able to show the reader the dates matched.
        premium: s.premium,
        direction: isPremium ? "premium" : "discount",
        threshold: K.PI_PREMIUM_NOTABLE,
      },
      `This ETF last traded at ₹${s.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })} against a NAV of ` +
        `₹${s.nav.toLocaleString("en-IN", { maximumFractionDigits: 2 })} on the same day — a ${pct1(s.premium)} ` +
        `${isPremium ? "premium" : "discount"}. At that price you ${isPremium ? "pay" : "pay"} ` +
        `₹${(1 + s.premium).toFixed(2)} for ₹1.00 of the underlying assets.`,
    ),
    // ★ (Stage 10b) A HEADLINE PI FACT — it CAN carry the story (addendum §9.2: PC/PB/PI → movement 4).
    // Only the EVALUABLE, notable states get a clause: a lagged/no-pair PI1 is a disclosure, not a point,
    // and stays in the reference. See `pi()` for why the quiet PI facts carry none.
    storyClause: `one of your ETFs is trading at a ${pct1(s.premium)} ${isPremium ? "premium" : "discount"} to its NAV — ₹${s.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })} against ₹${s.nav.toLocaleString("en-IN", { maximumFractionDigits: 2 })} of assets on the same day`,
  });
}

// ── PI2 · Regular plan held — HONEST-NULL. ─────────────────────────────────────────────────────
//
// ★ THE FINDING IS TWO FACTS AND WE HAVE ONE. "You hold the Regular plan" is TRUE and we know it.
// "Its Direct twin exists" is the half that makes the first half worth saying — and we cannot resolve it:
// `resolveTwins` (mf-distributions.ts) crosses IDCW→Growth WITHIN a plan tier and never crosses
// Regular↔Direct. There is no Regular→Direct mapping in this system.
//
// ⚠ SO PI2 NEVER FIRES EVALUABLE, AND THE FIX IS NOT IN THIS BATCH. Building twin resolution here is new
// fold code in a findings batch (doc 2 §13.2 logs it as exactly that), and a findings batch that grows a
// resolver is how a resolver ends up with no owner. It goes not-evaluable and BINDS NO TWIN — asserted,
// because the failure mode of a half-known fact is inventing the other half.
//
// `plan_type` is NULL on 3,955 funds — Step 9 REFUSED to guess a plan, so PI2 cannot even reach the
// question for those. (Doc 2 says 5,051. Measured: 3,955 — drift #11.)
function firePi2(out: PfFinding[], f: HeldInstrumentFacts) {
  if (f.planType !== "regular") return; // NULL ⇒ Step 9 refused to guess ⇒ we do not guess either
  out.push(
    pi("PI2", "Regular plan held", "Neutral", false,
      {
        isin: f.isin, name: f.name, planType: f.planType,
        /** ★ ALWAYS null, and PRESENT so that "we did not resolve one" is a stated fact rather than an
         *  absent key a reader could take for an oversight. Asserted null in verify. */
        directTwin: null,
        twinResolution: "not_built",
      },
      `You hold the Regular plan of this fund. Regular plans carry a distributor commission inside the ` +
        `expense ratio and Direct plans don't. We can't tell you whether this fund's Direct twin exists — ` +
        `we don't hold a mapping between the two plans of the same fund.`,
      { reason: "direct_twin_resolution_not_built", cls: "our_gap" },
    ),
  );
}

// ── PI3 · Dormant scheme — Caution, LOUD. 5,934 of 17,567 funds; 2 of 337 ETFs. ────────────────
function firePi3(out: PfFinding[], f: HeldInstrumentFacts) {
  if (f.isActive) return;
  if (f.assetClass !== "mutual_fund" && f.assetClass !== "etf") return; // AMFI's file is the subject
  out.push({
    ...pi("PI3", "Dormant scheme", "Caution", true,
      { isin: f.isin, name: f.name, isActive: false, navDate: f.navDate, currentNav: f.currentNav, lastPrice: f.lastPrice },
      `This scheme is no longer in AMFI's daily NAV file` +
        (f.navDate ? `. The last NAV we hold for it is from ${monthYear(f.navDate)}` : "") +
        `. We cannot mark this position to a current price.`,
    ),
    // ★ (Stage 10b) A HEADLINE PI FACT — the addendum's own §8 fund-heavy example puts exactly this in
    // movement 4 ("one of your funds is dormant"). Dormancy is always evaluable, so it always headlines.
    storyClause: `one of your funds is dormant — it's no longer in AMFI's daily NAV file, so we can't mark it to a current price`,
  });
}

// ── PI4 · Tracking gap — Neutral, quiet. ───────────────────────────────────────────────────────
//
// ONLY for funds that CLAIM to track something: `benchmark_via = 'name'` means the fund's own NAME states
// its index. A Large Cap fund benchmarked to Nifty 100 `via='category'` never promised to track it, and
// its "tracking error" is just active management — the number is meaningless as a fidelity measure.
//
// ⚠ PI4 INHERITS A FOLD DEFECT AND THE BIND IS WHERE IT SHOWS (T-3, see K.PI_TE_NOTABLE). 13 funds named
// "BSE Sensex Next 30/50" carry `benchmarkIndex = 'Sensex'` — a substring match handed them the parent
// index — and their ~7.6% "tracking error" is the distance between two DIFFERENT indices. They are the
// p99 of this distribution. PI4 names the benchmark in the Read for exactly this reason: "this fund
// tracks Sensex" on a fund called "Sensex Next 50" is a sentence whose wrongness the reader can SEE.
// That is not a fix, and it is not offered as one — it is the least dishonest available rendering of a
// number we did not compute and must not silently launder.
function firePi4(out: PfFinding[], f: HeldInstrumentFacts, a: HeldFundAnalytics | null) {
  if (!a || a.benchmarkVia !== "name") return;
  const te = a.trackingError1y;
  if (te == null) {
    const om = omissionFor(a.omissions, "tracking_error_1y");
    if (!om) return; // no value, no reason — nothing honest to say. Degrade by omission.
    out.push(
      pi("PI4", "Tracking gap", "Neutral", false,
        { isin: f.isin, name: f.name, benchmarkIndex: a.benchmarkIndex, benchmarkVia: a.benchmarkVia, trackingError1y: null },
        om.cls === "refused"
          ? `This fund tracks ${a.benchmarkIndex}. We measured how closely it follows it and won't publish the number — it did not survive our own plausibility check.`
          : `This fund tracks ${a.benchmarkIndex}. We can't yet say how closely it follows it over the last year.`,
        { reason: om.code, cls: om.cls },
      ),
    );
    return;
  }
  if (!(te > K.PI_TE_NOTABLE)) return; // it tracks well — that is not a finding, it is the mandate met
  out.push(
    pi("PI4", "Tracking gap", "Neutral", false,
      {
        isin: f.isin, name: f.name,
        benchmarkIndex: a.benchmarkIndex, benchmarkVia: a.benchmarkVia,
        trackingError1y: te, threshold: K.PI_TE_NOTABLE,
      },
      `This fund tracks ${a.benchmarkIndex}. Its tracking error over the last year is ${pct1(te)} — it has ` +
        `not moved exactly with the index it follows.`,
    ),
  );
}

// ── PI5 · Deepest fall — Neutral, quiet. See `pickDrawdownRung` and `spanOf` for the two rulings. ──
function firePi5(out: PfFinding[], f: HeldInstrumentFacts, a: HeldFundAnalytics | null) {
  if (!a) return; // no mf_analytics row ⇒ the nightly job has not computed this scheme ⇒ we say nothing
  const p = pickDrawdownRung(a);

  if (p.kind === "refused") {
    out.push(
      pi("PI5", "Deepest fall on record", "Neutral", false,
        {
          isin: f.isin, name: f.name, schemeCode: a.schemeCode,
          maxDrawdown: null, rungHorizon: null,
          refusedAt: p.at,
          /** Set ⇔ a LONGER rung held a value we declined to use because THIS shorter one was refused.
           *  The 65 side-pocket rows. Bound so the inheritance is visible, not inferred. */
          contaminates: p.contaminates ?? null,
          seriesSchemeCode: a.seriesSchemeCode,
        },
        // ★ THE `refused` SENTENCE SHAPE — never the vocabulary of absence. Nothing is missing here: a
        // number exists, we are standing in front of it, and we are declining to hand it over. Rendering
        // that as "unavailable" would tell the user we lack data when what happened is that our quality
        // gate fired and caught something. (null-reasons.ts's fourth class, in a sentence.)
        //
        // ⚠ AND IT SAYS "we don't publish", NOT "we won't show". The advice-verb grep flagged `won't` as a
        // negative forecast and that looks like a false positive — the subject is US, not the fund. It is
        // not one, and batch 2 already had this exact argument with itself over `no_distributions_in_window`
        // ("…rather than one we are MISSING", caught on a word inside a clause DENYING missingness). The
        // ruling then was that the gate is the stronger half and the copy is the thing to fix, because a
        // gate loosened to accommodate one correct sentence stops catching the incorrect ones that share
        // its shape. `don't publish` says the same thing in the present tense and costs nothing.
        p.reason === "idcw_nav_not_total_return"
          ? `We don't publish a deepest-fall figure for this fund. It's an IDCW plan: its NAV drops on every ` +
            `payout, so a "fall" measured on it would be counting your own distributions as losses. The ` +
            `number is computable and it would be wrong — at every window, not only the long ones.`
          : `We don't publish a deepest-fall figure for this fund. We computed one and it did not survive our ` +
            `own plausibility check${p.contaminates ? ` at the shorter windows, and the longer one is folded from the same stretch of NAV` : ""} — ` +
            `rather than ship a number we can see is impossible, we hold it back.`,
        { reason: p.reason, cls: p.cls },
      ),
    );
    return;
  }

  if (p.kind === "absent") {
    if (!p.reason || !p.cls) return; // no drawdown and no explanation — nothing to say, and no lie told
    out.push(
      pi("PI5", "Deepest fall on record", "Neutral", false,
        { isin: f.isin, name: f.name, schemeCode: a.schemeCode, maxDrawdown: null, rungHorizon: null, navPoints: a.navPoints },
        `We don't have a deepest-fall figure for this fund yet — ` +
          (p.reason === "no_nav_in_window"
            ? `its NAV history stops before the windows we measure over.`
            : `we hold ${plural(a.navPoints, "day")} of NAV history for it, which is not enough to measure one.`),
        { reason: p.reason, cls: p.cls },
      ),
    );
    return;
  }

  const span = spanOf(a, p.rung);
  out.push(
    pi("PI5", "Deepest fall on record", "Neutral", false,
      {
        isin: f.isin, name: f.name, schemeCode: a.schemeCode,
        maxDrawdown: p.value,
        /** ★ THE RUNG — bound, so the reader of the payload knows WHICH column this came off. */
        rungHorizon: p.rung.horizon,
        rungColumn: p.rung.col,
        /** ★ AND THE SPAN IT ACTUALLY COVERS — which is NOT the rung's horizon on 5,070 live rows. */
        windowFrom: span?.from ?? null,
        windowTo: span?.to ?? null,
        windowDays: span?.days ?? null,
        seriesSchemeCode: a.seriesSchemeCode,
        navPoints: a.navPoints,
      },
      // ★ NEVER "on record" UNQUALIFIED — doc 2's own label for this finding claims a history we do not
      // have. The span is named because the span is what was measured.
      span
        ? `Over the ${humanSpan(span.days)} of NAV history we hold for this fund (${monthYear(span.from)} – ` +
          `${monthYear(span.to)}), its deepest peak-to-trough fall was ${pct1(p.value)}.`
        : `Over the window we hold, this fund's deepest peak-to-trough fall was ${pct1(p.value)}.`,
    ),
  );
}

// ── PI6 · Category standing — ⚠ DEFAULT OFF, PENDING HEAD-CHAT RATIFICATION (doc 2 §9). ─────────
//
// "Rank is the single most useful thing we could tell a fund holder, and it is one inch from 'sell this.'"
// The flag is the ruling. `verify-phs-pi-readtime.ts` §8 asserts the constant is literally `false` AND
// that a book built to fire PI6 emits nothing — the gate is proven to be a gate.
function firePi6(out: PfFinding[], f: HeldInstrumentFacts, a: HeldFundAnalytics | null) {
  if (!K.PI6_CATEGORY_RANK_ENABLED) return; // ★ THE GATE. Not a comment, not an env var — see constants.
  if (!a) return;
  // ★ RANK AND POOL ARE PAIRED 1:1 (schema): the pool is the TRUE denominator — how many funds the rank
  // was measured AGAINST — and `rankBucketSize` is how many exist in the category. Rendering "412 of 430"
  // from rank1y + bucketSize would mix "412th among funds we could measure" with "430 funds that exist".
  const rungs = [
    { h: "3y", rank: a.rank3y, pool: a.rankPool3y },
    { h: "1y", rank: a.rank1y, pool: a.rankPool1y },
    { h: "5y", rank: a.rank5y, pool: a.rankPool5y },
  ];
  const r = rungs.find((x) => x.rank != null && x.pool != null);
  if (!r) return;
  out.push(
    pi("PI6", "Category standing", "Neutral", false,
      { isin: f.isin, name: f.name, horizon: r.h, rank: r.rank, rankPool: r.pool, rankBucket: a.rankBucket, rankBucketSize: a.rankBucketSize },
      `Over ${r.h === "1y" ? "the last year" : `the last ${r.h.replace("y", "")} years`}, this fund ranks ` +
        `${r.rank} of ${r.pool} funds we could measure in its AMFI category.`,
    ),
  );
}

// ── PI7 · Distribution yield — Neutral, quiet. REIT/InvIT. ─────────────────────────────────────
//
// ★ THE TWO LEDGERS AGREE, AND KEEPING THEM AGREEING IS THE POINT. Measured: 5 of 6 REITs and 13 of 15
// InvITs carry a `distributionYield`. The missing 1 + 2 are EXACTLY batch 2's `no_distributions_in_window`
// rows (INE2OVN25015, INE2Q7823014, INE2PB023011) — newly-listed trusts that have not paid yet.
//
// ⚠ SO THE ABSENCE IS RENDERED AS ZERO OCCURRENCES, NOT AS A GAP. A trust that has paid nothing has no
// yield; that is an ANSWER, not a missing number. `describeNull` already owns that sentence (`not_a_gap`,
// with its `fact` field) and the absence-vocabulary gate in verify already guards it — this finding reuses
// both rather than writing a third version that could drift out of agreement with them.
function firePi7(out: PfFinding[], f: HeldInstrumentFacts) {
  if (f.assetClass !== "reit" && f.assetClass !== "invit") return;
  const kind = f.assetClass === "reit" ? "REIT" : "InvIT";
  const dy = f.attributes["distributionYield"];
  if (dy == null) {
    const d = describeNull("a distribution yield", f.attributes["distributionYieldNullReason"]);
    if (!d) return; // unknown reason ⇒ OMIT, never bucket (null-reasons.ts's law)
    out.push(
      pi("PI7", "Distribution yield", "Neutral", false,
        { isin: f.isin, name: f.name, assetClass: f.assetClass, distributionYield: null,
          distributionYieldNullReason: f.attributes["distributionYieldNullReason"] ?? null, reasonClass: d.cls },
        // ★ THE TAXONOMY'S SENTENCE, VERBATIM, WITH ONLY A SUBJECT IN FRONT OF IT. Not paraphrased and
        // not re-authored: `no_distributions_in_window` is `not_a_gap`, and its sentence was written to
        // pass the absence-vocabulary gate on the exact word ("missing") an earlier draft tripped on.
        // Writing a second version here would be a second home for the one sentence in this codebase
        // that has already been got wrong once — and this one would drift out of agreement with batch 2's
        // PD ledger, which reports the SAME three trusts.
        `${f.name ?? `This ${kind}`}: ${d.sentence}.`,
        { reason: String(f.attributes["distributionYieldNullReason"]), cls: d.cls },
      ),
    );
    return;
  }
  const y = Number(dy);
  if (!Number.isFinite(y)) return;
  out.push(
    pi("PI7", "Distribution yield", "Neutral", false,
      { isin: f.isin, name: f.name, assetClass: f.assetClass, distributionYield: y },
      `This ${kind} has distributed ${pct1(y / 100)} of its current price over the last twelve months.`,
    ),
  );
}

// ── PI8 · Maturity profile — Neutral, quiet. BOOK-LEVEL: a spread is a fact about the SET. ─────
//
// ★ PD1's TWO-RESOLUTION LESSON APPLIES, AND THIS IS THE FINDING IT WAS LEARNED FOR. Maturity is TWO
// facts: `maturityYear` (parsed off the instrument's own name) and `maturityDate` (published). Measured:
//
//     bond  124/356 have the YEAR ·   2/356 have the DATE
//     gsec  170/170 have the YEAR ·  54/170 have the DATE
//     sgb    45/45  have the YEAR ·   0/45  have the DATE
//
// "Your debt holdings mature in 2027, 2029, and 2034 — a spread of 7 years" is honest off the YEAR alone
// and needs no date. PD1's first draft flattened maturity into one fact and told users we had nothing
// while we held the year for a third of their bonds. This finding is built on the half we have.
function firePi8(out: PfFinding[], facts: HeldInstrumentFacts[]) {
  const debt = facts.filter((f) => f.assetClass === "bond" || f.assetClass === "gsec" || f.assetClass === "sgb");
  const withYear = debt
    .map((f) => ({ f, year: Number(f.attributes["maturityYear"]) }))
    .filter((x) => Number.isInteger(x.year) && x.year > 1900);
  if (!withYear.length) return;

  const years = [...new Set(withYear.map((x) => x.year))].sort((a, b) => a - b);
  const spread = years[years.length - 1]! - years[0]!;
  out.push(
    pi("PI8", "Maturity profile", "Neutral", false,
      {
        holdingCount: withYear.length,
        /** How many debt holdings we could NOT place — bound, because PI8 speaks for a SUBSET and a
         *  count of 3 next to a book of 5 bonds is the reader's only way to know that. */
        withoutYearCount: debt.length - withYear.length,
        years,
        spreadYears: spread,
        holdings: withYear.map((x) => ({ isin: x.f.isin, name: x.f.name, assetClass: x.f.assetClass, maturityYear: x.year })),
      },
      `Your debt ${withYear.length === 1 ? "holding matures" : "holdings mature"} in ` +
        `${years.length === 1 ? years[0] : `${years.slice(0, -1).join(", ")} and ${years[years.length - 1]}`}` +
        (spread > 0 ? ` — a spread of ${plural(spread, "year")}` : "") + `.` +
        (debt.length > withYear.length
          ? ` ${plural(debt.length - withYear.length, "other debt holding")} ${debt.length - withYear.length === 1 ? "is" : "are"} not included — we could not read a maturity year off ${debt.length - withYear.length === 1 ? "its" : "their"} name.`
          : ""),
    ),
  );
}
