// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — ENTRY RESOLUTION (families UO + UH · §3.1 / §3.2), plus the negatives (§6.2) and the
// degradations (§6). Each builder is a pure function of (ReaderContext, ObjectState, mode) and returns a
// candidate ResolvedEntry or null; the assembler (arbitration.ts) reserves the floor and fills the rest
// by ladder rung. Claims are TONE-INVARIANT and rendered here (the AI reads the finished object, §6.2).
//
// BOUNDARY (Part IX), enforced at authoring time and re-scanned over the assembled output (copy.ts):
//   · no prediction, no advice, no modelled trade, no returns/basis, no reader ranking (§0.8)
//   · attention is a router, never content (§0.6) — UH6 states a binary ("first time"), never a count
//   · strength is stated and dated, never celebrated (§3.1 UO6)
//   · magnitude is never read (§0.7.1) — it is not carried into ObjectFinding
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { RUNG } from "./arbitration.js";
import {
  UH_LARGE_POSITION_PCT,
  UH_TOP_N,
  UH_SLIVER_PCT,
  UH_SLIVER_VALUE,
  UH_TYPICAL_MULT,
  UH_TYPICAL_MIN_HOLDINGS,
  UN_PG_NOTABLE_PCT,
  UN_PG_HEAVY_PCT,
  UN_SECTOR_NOTABLE_PCT,
  UN_POND_SHARED_MIN,
  UE_MIN_BOOK,
  UE_MIN_LIFT,
  UE_MIN_COUNT,
  UE_HIGH_BOOK_SHARE,
  UE_SHARE_MIN_COUNT,
  UE_ENVIRONMENTAL_BASE_RATE,
} from "./constants.js";
import { formatINR, pctStr, scoreStr, plural, ordinal, glossFor, bandLabel, monthYear } from "./copy.js";
import { describeDeclined, reasonPhrase } from "./coverage.js";
import { plainClaimFor } from "./plain-claims.js";
import { renderVerdict } from "../scoring/findings/verdicts.js";
import { rateFor, type BaseRateSnapshot } from "./base-rates.js";
// ★ WHICH POPULATION A KEY BELONGS TO (step 5) — projected from FILING_REGISTRY, so the echo's two
//   sides and the base rates cannot disagree about where a key's numbers are drawn from.
import { isFilingChannelKey } from "../filing/channel.js";
import type {
  ReaderContext,
  ObjectState,
  ObjectFinding,
  ReaderHolding,
  ResolvedEntry,
  NegativeFact,
  Degradation,
  ModeId,
} from "./types.js";
import type { ResolvedMode } from "./mode.js";

// ── Doesn't-mean strings (inherited per entry, §0.10 — the relational layer adds no verdict). ─────────
const DM = {
  UO1: "identity and grouping only; the peer group is the fair comparison set, not a quality tier.",
  UO2: "higher is not a better investment, not more upside, and not a prediction — it means sounder and calmer, and already priced.",
  UO3: "nothing flagged is not an endorsement; a flag is a place to look, not a verdict.",
  UO4: "absence of a connection is not a reason to acquire one — it is a statement about your current book, nothing more.",
  UO6: "already-strong is already priced — sound, and sound for a while, is not upside, not a forecast of continuation, and not a buy.",
  UH1: "a statement of exposure, not of whether the exposure is right — no implication about adding, trimming, or holding.",
  UH2: "account spread is bookkeeping, not diversification.",
  UH3: "naming a level we declared is not a judgement on your allocation and not a suggestion to change it.",
  UH4: "typical is descriptive, not a target.",
  UH10: "unscored is not a judgement on the stock — it is a statement about our coverage.",
  // §0.8 forbids inferring intent, and UW1 is the entry most likely to breach it — a watchlist reads as
  // a shortlist unless the boundary says otherwise. It names every inference it refuses, explicitly.
  UW1: "a watchlist is a record of what you asked us to keep an eye on — not a position, not an intention to buy, not evidence you are considering one, and not a judgement about the stock.",
  // ── UN (§3.3). Every one of these states EXISTING exposure and stops. None may hint at what the
  //    exposure would become if this stock were added — that models an unmade trade (§0.8). ──
  UN1: "exposure is a measurement of your book as it is, not a verdict on it — the names are listed, never ranked, and nothing here suggests changing any of them.",
  UN2: "this is a level we declared, not an external norm and not advice — it describes where your book already sits, and says nothing about what it should be.",
  UN3: "a watchlist is not a position and not an intention — these are names you asked us to watch, nothing more.",
  UN6: "peers face the same field, so shared conditions inside a peer group are common by construction — this is a count, not a signal, and not a prediction that these names move together.",
  UN7: "sector and peer group are different cuts of the same book; neither number corrects the other, and a wider sector figure is not a bigger problem than a narrower one.",
  UN8: "having no other holdings in a peer group is a statement about your current book — it is neither a gap to fill nor a reason to acquire one.",
  // ── UG (§3.6), the honesty family. Every one of these describes OUR coverage, never the stock. ──
  UG1: "not scoring a stock is a statement about our coverage, never about the company's quality — an unscored name is not a worse name.",
  UG5: "we cannot see inside funds yet, so this is a limit of our view and not a claim about what you hold — we are not estimating the indirect exposure.",
  UG7: "this describes what this card can and cannot tell you — it is not a prompt to do anything.",
  UG9: "a check that has not run is not a clean result and not a signal — it is a capability we cannot apply here yet, and no coverage is implied either way.",
  UD3: "a band change is a health-state change, not a price event and not a call — it says the reading moved, never what to do about it.",
  UG10: "data older than its cadence is our refresh gap, not a statement that nothing has happened.",
  // ── UE (§3.5). Co-occurrence describes the BOOK, never predicts, never judges the selection. ──
  UE1: "shared conditions across holdings describe your book, not a prediction that they resolve together and not a statement that any of them is wrong to hold — co-occurrence is not causation and not contagion.",
  UE5: "in line with the market is not a clean bill of health for the stock or the book, and a repeat's absence is not reassurance.",
  UE6: "a market-wide condition is an environmental fact, not a book trait, not a defect in any name that has it, and not a signal — your share of it measures exposure, never judges it.",
  ELEVATED: "a flag is a place to look, not a verdict; its meaning is owned by its own card lower on the page.",
} as const;

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The reader's aggregated position in THIS object — matched by constituent symbol against the entity
 *  ledger (the entity-aggregation law). null when the reader does not hold it (or the book is empty). */
export function matchHeldEntity(ctx: ReaderContext, obj: ObjectState): ReaderHolding | null {
  return ctx.book?.holdings.find((h) => h.symbols.includes(obj.symbol)) ?? null;
}

/** Whether any of the reader's holdings shares this object's sector (a superset-safe proxy for peer-group
 *  overlap: a peer group is within a sector, so no sector overlap ⇒ no PG overlap). */
function hasSectorOverlap(ctx: ReaderContext, obj: ObjectState): boolean {
  const sec = obj.sector?.displayName ?? obj.sector?.key ?? null;
  if (!sec || !ctx.book) return false;
  return ctx.book.holdings.some((h) => h.sector != null && (h.sector === sec || h.sector === obj.sector?.key));
}

// ── Self-dated duration from a Family N finding's own evidence (§3.1 duration-source precedence). Reads
//    the rule's OWN run length (`years` / `quarters`), which WINS over `standing_since` and needs no
//    snapshot-chain derivation — which is why UO6 is reachable this slice. ─────────────────────────────
function selfDatedRun(f: ObjectFinding): { label: string; count: number } | null {
  const years = asNum(f.evidence?.years);
  if (years && years >= 1) return { label: `for ${plural(years, "year")}`, count: years };
  const quarters = asNum(f.evidence?.quarters);
  if (quarters && quarters >= 1) return { label: `for ${plural(quarters, "quarter")}`, count: quarters };
  return null;
}

const OPAQUE = (entryId: string, ref: string): string => `${entryId}:${ref}`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UO — Orientation (§3.1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function buildUO1(obj: ObjectState, level: ReaderContext["identity"]["aiLevel"]): ResolvedEntry | null {
  // Always resolvable — identity, the stranger's floor. Honest-empty when no PG (sector alone).
  //
  // §1.5 — WHAT IT DOES, IN ITS OWN WORDS. Where the stock carries an editorial row, the lead sentence
  // of `coreBusiness` replaces the composed sector+classification descriptor: a reader learns more from
  // "India's largest private-sector bank, offering the full range of banking …" than from "Banks, a
  // cyclical name." The composed form remains the fallback for the 280-of-504 stocks with no editorial
  // row — it is honest and already correct, just thinner.
  const sec = obj.sector?.displayName ?? null;
  const secClass = obj.sector?.sectorClass ?? null;
  const descriptor = sec ? `${sec}${secClass ? `, a ${secClass.toLowerCase()} name` : ""}` : "a company we catalogue";
  // The PG label is already plural-shaped ("Large-Cap Private Banks"); render the count against it verbatim.
  // §Phase 5 anti-double-count: when the stock is UNSCORED, UG1 states the no-peer-group fact as the
  // REASON we don't score it — a fuller and more useful framing. UO1 repeating "Not yet placed in a
  // peer group." put the same fact on the card twice in different words. UO1 keeps the clause only
  // when it is NOT redundant: either the PG exists (a positive fact), or the stock is scored (so UG1
  // is silent and nobody else says it).
  const pgClause = obj.peerGroup
    ? `Sits in a peer group of ${obj.peerGroup.memberCount} ${obj.peerGroup.label}.`
    : obj.isScored
      ? "Not yet placed in a peer group."
      : ""; // UG1 owns this fact for an unscored stock
  // `.trim()` because pgClause is empty for an unscored stock (UG1 owns that fact) — without it the
  // claim would ship a trailing space.
  const claim = (obj.businessLead
    // The editorial lead is a complete sentence already — never re-punctuated, never re-worded (§0.10).
    ? `${obj.displayLabel} — ${obj.businessLead} ${pgClause}`
    : `${obj.displayLabel} — ${descriptor}. ${pgClause}`).trim();
  return {
    entryId: "UO1",
    family: "UO",
    claim,
    gloss: glossFor("peer group", level),
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.12 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UO1,
    sourceRef: OPAQUE("UO1", obj.stockId),
  };
}

function buildUO2(obj: ObjectState, level: ReaderContext["identity"]["aiLevel"]): ResolvedEntry | null {
  if (!obj.isScored || !obj.snapshot) return null; // not scored → UG1 carries it (out of slice) → absent
  return {
    entryId: "UO2",
    family: "UO",
    // The BAND LABEL, never the raw enum (§0.9). `below_par` rendered verbatim on a live card until this.
    claim: `Health is about ${scoreStr(obj.snapshot.composite)} — ${bandLabel(obj.snapshot.band)}.`,
    gloss: glossFor("health score", level),
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.11 },
    arithmetic: { composite: Math.round(obj.snapshot.composite), band: obj.snapshot.band },
    interpretationCeiling: null,
    doesntMean: DM.UO2,
    sourceRef: OPAQUE("UO2", obj.stockId),
  };
}

/** UO3 — flags state. Counted by CONCERN (a positive finding is not "a thing standing"). Uses the weaker
 *  copy variant only: evaluability is not served this slice (UG9 unreachable), so "nothing flagged"
 *  cannot be qualified by history depth — recorded as a degradation. */
function buildUO3(obj: ObjectState): ResolvedEntry | null {
  if (!obj.isScored) return null;
  const concerns = obj.findings.filter((f) => f.polarity !== "positive").length;

  // ⚠ PHASE 2 — "Nothing flagged." is now QUALIFIED by what could actually be checked (§3.1 UO3's
  // second copy variant, previously unreachable). The three states are genuinely different claims:
  //   · declined === null → we do not know what ran. Use the WEAK variant, claim no completeness.
  //   · declined.length 0 → every registered rule was evaluable. Full-strength "Nothing flagged."
  //   · declined.length n → n checks could not run. Say so; silence about them would be misleading.
  // Only stated on the CLEAN branch: when something IS standing, the count is the fact and the
  // declined set is UG9's business, not a qualifier on a positive count.
  const declined = obj.notEvaluable;
  let claim: string;
  if (concerns > 0) {
    claim = `${plural(concerns, "thing")} standing.`;
  } else if (declined === null) {
    claim = "Nothing flagged.";
  } else if (declined.length === 0) {
    // ⚠ NARROWED (§Phase 8). This read "every check we run has run here", which over-claims on a bank:
    // R3/R5/P7/P8 are SCOPE-EXCLUDED for banking (they return `null`, a genuine not-fired, not a
    // decline), so they never appear in the declined set and the sentence implied they had run. The
    // honest claim is about what we COULD check here, which is exactly what an empty declined set means.
    claim = "Nothing flagged — and every check that applies to this company was able to run.";
  } else {
    claim = `Nothing flagged — though ${plural(declined.length, "check")} ${declined.length === 1 ? "needs" : "need"} more history than this stock has yet.`;
  }
  return {
    entryId: "UO3",
    family: "UO",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.1 },
    // `declinedCount: null` ⇒ unknown (not zero). The frontend must not render a "0 declined" badge
    // from an absent record — it is the same null/[] distinction the column preserves.
    arithmetic: { concernCount: concerns, declinedCount: declined === null ? null : declined.length },
    interpretationCeiling: null,
    doesntMean: DM.UO3,
    sourceRef: OPAQUE("UO3", obj.stockId),
  };
}

/** UO4 — connection to your book, the honest null. Fires only when a book exists, position is NEITHER,
 *  and NOTHING connects: no sector overlap, no peer-group holding, no watchlisted peer.
 *
 *  ⚠ §Phase 4 — the watchlist gate is now PRECISE. It used to block on `watchlist.count > 0`: any
 *  watchlist item at all, however unrelated, suppressed the entry, because without UN3 the layer could
 *  not tell a related pin from an unrelated one. UN3 now answers exactly that, so UO4 checks for a
 *  watchlisted PEER instead of a non-empty watchlist. A reader with 8 pins in other sectors now
 *  correctly gets "nothing connects" rather than silence. */
function buildUO4(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): ResolvedEntry | null {
  if (mode.positionAxis !== "NEITHER") return null;
  if (!ctx.book?.exists) return null; // no book → UG7 states the limit
  if (hasSectorOverlap(ctx, obj)) return null; // a connection exists — UN7 states it
  const n = ctx.neighbourhood;
  if (n && n.pgHeld.some((h) => !h.isThisObject)) return null; // a pond holding — UN1 states it
  if ((ctx.watchlist?.peersInPeerGroup.length ?? 0) > 0) return null; // a watchlisted peer — UN3 states it
  return {
    entryId: "UO4",
    family: "UO",
    claim: "Nothing in your portfolio or watchlist connects to this name or its sector.",
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.1 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UO4,
    sourceRef: OPAQUE("UO4", obj.stockId),
  };
}

/** UO6 — standing strength. Resolves on the BEST self-dating Family N finding (longest run), duration read
 *  from the rule's own evidence with `standing_since` ABSENT from the environment. Stated and dated, never
 *  celebrated (§3.1). Eligible in EVERY mode — the entry that stops an always-present card from becoming
 *  permanently scolding. Never manufactured from an absence of flags (that is UO3, a weaker claim). */
function buildUO6(obj: ObjectState): ResolvedEntry | null {
  if (!obj.isScored) return null;
  // Positive-polarity, self-dating findings only (Family N by the key namespace). Pick the longest run.
  const candidates = obj.findings
    .filter((f) => f.polarity === "positive")
    .map((f) => ({ f, run: selfDatedRun(f) }))
    .filter((x): x is { f: ObjectFinding; run: { label: string; count: number } } => x.run !== null)
    .sort((a, b) => b.run.count - a.run.count);
  // §Phase 8 — a positive finding WITHOUT a self-dated run is still the object's strength and still the
  // right host for a positive echo; it simply renders without a duration clause. Falling back to it
  // (rather than returning null) is what closed the DIXON orphan: `trajectory_D_recovery` is positive,
  // carries no years/quarters, and had no host in either ELEVATED (which skips positives) or UO6.
  // Duration remains the PREFERRED carrier — a dated run always wins the selection above.
  const undated = candidates.length === 0
    ? obj.findings.filter((f) => f.polarity === "positive")[0] ?? null
    : null;
  if (candidates.length === 0 && !undated) return null; // no positive finding at all → never faked
  const { f, run } = candidates.length > 0
    ? candidates[0]
    : { f: undated!, run: null as { label: string; count: number } | null };
  // Elevate by reference using the finding's OWN authored claim (clean + dated by Family N's register
  // discipline); fall back to a minimal composed claim if the rule carried no verdict string.
  const verdict = typeof f.evidence?.verdict === "string" ? (f.evidence.verdict as string) : null;
  const name = typeof f.evidence?.name === "string" ? (f.evidence.name as string) : "A standing strength";
  const claim = verdict ?? (run ? `${name} — ${run.label}.` : `${name}.`);
  return {
    entryId: "UO6",
    family: "UO",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    // Duration from the rule's own run length (NOT the absent standing_since); snapshotCount = the run.
    // null when the finding does not self-date — stated undated rather than not stated at all.
    standingSince: run ? { label: run.label, snapshotCount: run.count } : null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.RECOVERY_STRENGTH, relationalWeight: 0.4 },
    arithmetic: {
      durationLabel: run?.label ?? null,
      runLength: run?.count ?? null,
      source: run ? "rule_evidence" : null,
      // §Phase 7 host precedence — UO6 hosts the echo annotation for ITS key (ELEVATED skips positives).
      __hostKey: f.key,
    },
    interpretationCeiling: null,
    doesntMean: DM.UO6,
    sourceRef: OPAQUE("UO6", f.key),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UW — Watchlist membership. The floor fact for the WATCHED modes (M5–M8).
//
// ⚠ WHY THIS ENTRY EXISTS (§1.2). The watched cells used to fold to M9, so a stock the reader had
// explicitly put on their watchlist rendered "New to you." — while `negatives` carried
// `watchlisted_not_held` in the same payload. This entry states the real, DATED membership fact so the
// watched modes have something true to stand on.
//
// ABSENCE PRODUCES SILENCE (Standing Rule 7): the date comes from `watchlist.thisAddedAt`. When it is
// missing the entry states membership WITHOUT a date rather than inventing one, and when membership
// itself is absent the entry does not build at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function buildUW1(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const addedAt = ctx.watchlist?.thisAddedAt ?? null;
  // Not on the watchlist → nothing to state. (HELD dominates upstream, so a held+watched reader never
  // reaches the watched modes; this entry stays eligible as a minor note regardless.)
  if (!addedAt) return null;
  return {
    entryId: "UW1",
    // Its OWN namespace (§Phase 10). Not UH — UH's boundary language is exposure-based and a watchlist
    // is not exposure. Still a READER-side fact, so the frontend's reader/object marker split must
    // treat UW like UH (see the isReaderFact update in the frontend types note).
    family: "UW",
    claim: `On your watchlist since ${monthYear(addedAt)}.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POSITION_FACT, relationalWeight: 0.45 },
    arithmetic: { addedAt: addedAt.toISOString() },
    interpretationCeiling: null,
    doesntMean: DM.UW1,
    sourceRef: OPAQUE("UW1", obj.stockId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UH — Holding (§3.2). Join facts, authored here, available nowhere else.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** UH1 — the position floor, with UH2 (≤2 accounts) and UH9 (sliver) FOLDED in. Never renders a return,
 *  gain, loss, or basis (§0.8). Honest-empty when the value is not yet available (state accounts, never a
 *  fabricated value). */
function buildUH1(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (mode_isHeld(ctx) === false) return null;
  const accounts = held?.accountLabels ?? [];
  const nAcct = accounts.length;
  const value = held && held.value > 0 ? held.value : null;
  const weightPct = held && held.weightPct > 0 ? held.weightPct : null;
  const isSliver = weightPct != null && value != null && weightPct < UH_SLIVER_PCT && value < UH_SLIVER_VALUE;

  let claim: string;
  if (value == null) {
    // Honest-empty: value not resolvable yet (no snapshot / unpriceable) — state the position, never fake ₹.
    claim = nAcct >= 1 ? `You hold ${obj.displayLabel} across ${plural(nAcct, "account")}. Position value isn't available yet.` : `You hold ${obj.displayLabel}. Position value isn't available yet.`;
  } else if (isSliver) {
    claim = weightPct != null ? `${formatINR(value)}, under 1% of your book.` : `${formatINR(value)}.`;
  } else {
    const weightClause = weightPct != null ? ` About ${pctStr(weightPct)} of your book.` : "";
    if (nAcct >= 2 && nAcct <= 2) {
      claim = `${formatINR(value)} across ${plural(nAcct, "account")}.${weightClause}`;
    } else if (nAcct === 1) {
      claim = `${formatINR(value)} in ${accounts[0]}.${weightClause}`;
    } else if (nAcct >= 3) {
      // ≥3 accounts: UH1 states value + weight; UH2 (separate entry) names the accounts.
      claim = `${formatINR(value)} across ${plural(nAcct, "account")}.${weightClause}`;
    } else {
      claim = `${formatINR(value)}.${weightClause}`;
    }
  }

  const rel = value == null ? 0.5 : isSliver ? 0.05 : Math.max(0.5, (weightPct ?? 0) / 100);
  return {
    entryId: "UH1",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POSITION_FACT, relationalWeight: rel },
    arithmetic: { value: value ?? null, weightPct: weightPct != null ? Math.round(weightPct) : null, accountCount: nAcct, sliver: isSliver },
    interpretationCeiling: null,
    doesntMean: DM.UH1,
    sourceRef: OPAQUE("UH1", obj.stockId),
  };
}

/** UH2 — held across ≥3 accounts (≤2 is folded into UH1). Account labels are user-authored (never IDs). */
function buildUH2(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (!held || held.accountLabels.length < 3) return null;
  return {
    entryId: "UH2",
    family: "UH",
    claim: `Held in ${plural(held.accountLabels.length, "account")}: ${held.accountLabels.join(", ")}.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // Account spread is bookkeeping (§3.2) — a low-priority context facet, not the rung-5 position JOIN
    // fact (that is UH1). It fills a remaining slot, never crowds the object's standing findings.
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.3 },
    arithmetic: { accountCount: held.accountLabels.length },
    interpretationCeiling: null,
    doesntMean: DM.UH2,
    sourceRef: OPAQUE("UH2", obj.stockId),
  };
}

/** UH3 — position scale in your book: top-N by value, or above the declared heavy-name level. Thresholds
 *  are ATTRIBUTED to Vytal ("the level at which we mark…"), never phrased as an external norm (§3.2). */
function buildUH3(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (!held || !ctx.book) return null;
  const values = ctx.book.holdings.map((h) => h.value).filter((v) => v > 0).sort((a, b) => b - a);
  const rank = held.value > 0 ? values.indexOf(held.value) + 1 : 0;
  const isTopN = rank >= 1 && rank <= UH_TOP_N;
  const isHeavy = held.weightPct >= UH_LARGE_POSITION_PCT;
  if (!isTopN && !isHeavy) return null;
  // §1.8 — VERIFIED, NO DEFECT PRESENT. `pctStr` appends its own "%", and this template does NOT add a
  // second one after it: the only literal "%" belongs to `${UH_LARGE_POSITION_PCT}%`, which interpolates
  // a BARE number (10) and correctly needs the suffix. Renders "About 12% of your book — above the 10%
  // level …". Left exactly as-is; recorded here so the check is not repeated.
  const claim = isTopN
    ? `Your ${ordinal(rank)}-largest position.`
    : `About ${pctStr(held.weightPct)} of your book — above the ${UH_LARGE_POSITION_PCT}% level at which we mark a single name as heavy.`;
  return {
    entryId: "UH3",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // §1.7 — UH3 VACATES RUNG 6. It previously sat at RUNG.POND_EXPOSURE (6), which the ladder reserves
    // for UN1/UN2 (peer-group exposure), built in Phase 4. UH3 is a POSITION FACT about the reader's own
    // single-name scale, which is what rung 5 is for — and it is where the RUNG table's own comment
    // already said UH3 belonged. Relational weight (a tiebreak only) is unchanged, so ordering WITHIN
    // rung 5 still places UH1's join fact ahead of it on weight.
    weight: { ladderRung: RUNG.POSITION_FACT, relationalWeight: Math.max(0.3, held.weightPct / 100) },
    arithmetic: { rank: isTopN ? rank : null, weightPct: Math.round(held.weightPct), heavyLevelPct: UH_LARGE_POSITION_PCT },
    interpretationCeiling: null,
    doesntMean: DM.UH3,
    sourceRef: OPAQUE("UH3", obj.stockId),
  };
}

/** UH4 — position scale vs your typical position. Needs enough scored holdings for a "typical" to mean
 *  something. Typical is descriptive, not a target (§3.2). */
function buildUH4(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  const book = ctx.book;
  if (!held || !book || book.typicalPositionValue == null) return null;
  if (book.scoredHoldingsCount < UH_TYPICAL_MIN_HOLDINGS) return null;
  if (held.value <= 0) return null;
  const typical = book.typicalPositionValue;
  const larger = held.value >= UH_TYPICAL_MULT * typical;
  const smaller = held.value <= typical / UH_TYPICAL_MULT;
  if (!larger && !smaller) return null;
  const claim = larger
    ? `Larger than your typical position (${formatINR(typical)}).`
    : `Smaller than your typical position (${formatINR(typical)}).`;
  return {
    entryId: "UH4",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // "Typical is descriptive, not a target" (§3.2) — a context facet (rung 15), below the object's
    // standing findings and orientation; it fills a remaining slot on a listy mode (M3), never crowds M1.
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.25 },
    arithmetic: { typicalValue: Math.round(typical), direction: larger ? "larger" : "smaller" },
    interpretationCeiling: null,
    doesntMean: DM.UH4,
    sourceRef: OPAQUE("UH4", obj.stockId),
  };
}

/** UH10 — held but not scored. UH1 still fires (position is knowable without a score); this pairs a
 *  coverage note. UG1 owns the full reason (out of slice) — here it states the honest gap in one line. */
function buildUH10(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  if (mode_isHeld(ctx) === false || obj.isScored) return null;
  // §Phase 3 — the reason now comes from the DERIVED coverage state, not the dead StockScoringState
  // column (which was null for every stock). `display_only` is a different fact from "not yet": the
  // stock has no peer group, so there is no comparison set and it is never scored by design.
  const claim =
    obj.coverage.state === "display_only"
      ? "We don't score this stock — it isn't placed in a peer group, so we have no comparison set for it."
      : "We don't score this stock yet.";
  return {
    entryId: "UH10",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.2 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UH10,
    sourceRef: OPAQUE("UH10", obj.stockId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UN — Neighbourhood (§3.3). The reader's peer-group and sector proximity: "is this pond already
// crowded in my book?" Built in Phase 4 — the family that makes the card reader-specific for someone
// who does NOT hold the stock, which was 23 of 40 cards in the census.
//
// ★ THE BOUNDARY, NON-NEGOTIABLE (§0.8). These entries state the reader's EXISTING exposure and OUR
// declared thresholds. They never state what the exposure WOULD BECOME if this stock were added. That
// sentence ("adding this would take you to 41%") will feel like the most useful line on the card; it
// models an unmade trade and it is the one that reclassifies Vytal as an advisor.
//
// ★ NAMES ARE LISTED, NEVER RANKED (§0.9). "3 companies: A, B, C" — never "your best holding in the pond".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Render a held-peer list as prose: "HDFC Bank", "HDFC Bank and ICICI Bank", "A, B and C" (cap 3 +
 *  "and N more"). Display names only — never a symbol, never an ISIN (§0.9). */
function nameList(names: string[], cap = 3): string {
  if (names.length === 0) return "";
  if (names.length <= cap) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, cap).join(", ")} and ${names.length - cap} more`;
}

/** UN1 — your weight in this pond. The join fact that exists nowhere else in the product. */
function buildUN1(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const n = ctx.neighbourhood;
  if (!n || !obj.peerGroup || n.pgWeightPct === null) return null;
  if (n.pgHeld.length === 0) return null; // no exposure → UN8 states that instead

  // ⚠ ABSENCE MUST NOT BECOME ASSERTION (Standing Rule 7). A zero-quantity or unpriced holding still
  // appears in the roster intersection but carries no weight, which produced the self-contradicting
  // live line: "Large-Cap Oil & Gas is about 0% of your book — 1 company: Reliance Industries Ltd."
  // A percentage and a named holding disagreeing is exactly the class of falsehood this build removes.
  // When the weight rounds away, state the MEMBERSHIP (which is true) and drop the number (which is not).
  const names = nameList(n.pgHeld.map((h) => h.name));
  const weightKnown = n.pgWeightPct >= 0.5; // below this, pctStr would render "<1%" or "0%"
  const claim = weightKnown
    ? `${obj.peerGroup.label} is about ${pctStr(n.pgWeightPct)} of your book — ${plural(n.pgHeld.length, "company", "companies")}: ${names}.`
    : `You hold ${plural(n.pgHeld.length, "company", "companies")} in ${obj.peerGroup.label}: ${names}.`;
  return {
    entryId: "UN1",
    family: "UN",
    claim,
    gloss: glossFor("peer group", ctx.identity.aiLevel),
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POND_EXPOSURE, relationalWeight: Math.max(0.35, n.pgWeightPct / 100) },
    arithmetic: { pgWeightPct: Math.round(n.pgWeightPct), heldCount: n.pgHeld.length, pgSize: n.pgSize },
    interpretationCeiling: null,
    doesntMean: DM.UN1,
    sourceRef: OPAQUE("UN1", obj.stockId),
  };
}

/** UN2 — pond concentration against OUR declared level. Attributed to Vytal, never an external norm. */
function buildUN2(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const n = ctx.neighbourhood;
  if (!n || !obj.peerGroup || n.pgWeightPct === null) return null;
  const heavy = n.pgWeightPct >= UN_PG_HEAVY_PCT;
  const notable = n.pgWeightPct >= UN_PG_NOTABLE_PCT;
  if (!notable) return null;
  const level = heavy ? UN_PG_HEAVY_PCT : UN_PG_NOTABLE_PCT;
  const word = heavy ? "heavy" : "notable";
  return {
    entryId: "UN2",
    family: "UN",
    // States OUR level and the reader's CURRENT weight. Never a post-trade figure (§0.8).
    // Self-contained: it names the weight rather than saying "that is above …", because UN1 may have
    // been cut by the cap or may have suppressed its own percentage (the zero-weight branch), and a
    // sentence that depends on a neighbour it cannot see is a sentence that will eventually lie.
    claim: `At about ${pctStr(n.pgWeightPct)} of your book, ${obj.peerGroup.label} is above the ${level}% level at which we mark a single peer group as ${word}.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POND_EXPOSURE, relationalWeight: Math.max(0.4, n.pgWeightPct / 100) },
    arithmetic: { pgWeightPct: Math.round(n.pgWeightPct), levelPct: level, tier: word },
    interpretationCeiling: null,
    doesntMean: DM.UN2,
    sourceRef: OPAQUE("UN2", obj.stockId),
  };
}

/** UN3 — peers on your WATCHLIST (not held). A watchlist is not exposure, so this is never summed with
 *  UN1 and never presented as a position (§0.8 no inference of intent). */
function buildUN3(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const peers = ctx.watchlist?.peersInPeerGroup ?? [];
  if (peers.length === 0 || !obj.peerGroup) return null;
  const names = nameList(peers.map((p) => p.name));
  return {
    entryId: "UN3",
    family: "UN",
    claim: `${plural(peers.length, "name")} in this peer group ${peers.length === 1 ? "is" : "are"} on your watchlist: ${names}.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POND_CONDITION, relationalWeight: 0.3 },
    arithmetic: { watchedPeerCount: peers.length },
    interpretationCeiling: null,
    doesntMean: DM.UN3,
    sourceRef: OPAQUE("UN3", obj.stockId),
  };
}

/**
 * UN6 — a finding this object shares with the reader's OTHER holdings IN THE SAME POND.
 *
 * ⚠ BUILT IN PHASE 6, on the substrate Phase 6 created: `ctx.echo.byPatternKey` (patternKey → holding
 * names) intersected with `ctx.neighbourhood.pgHeld` (the reader's names in this pond). No new query.
 *
 * ★ DIFFERENT CLAIM FROM UE (§3.3). UE is WHOLE-BOOK and carries lift arithmetic because a co-occurrence
 * across unrelated holdings needs normalising. UN6 is WITHIN-POND, where co-occurrence is EXPECTED by
 * construction — peers face the same field — so it needs no lift qualification and must never be
 * phrased as significant. It states a count and stops.
 *
 * CLOCK_EVENTs are excluded for the same reason as echo: a shared 90-day window is a fact about the
 * window, not about the pond.
 */
function buildUN6(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const n = ctx.neighbourhood;
  const echo = ctx.echo;
  if (!n || !echo || !obj.peerGroup) return null;

  const pondNames = new Set(n.pgHeld.filter((h) => !h.isThisObject).map((h) => h.name));
  if (pondNames.size === 0) return null;

  // The strongest shared finding: the one held by the most of the reader's pond names.
  let best: { finding: ObjectFinding; shared: string[] } | null = null;
  for (const f of obj.findings) {
    if (f.temporalClass === "CLOCK_EVENT") continue;
    if (f.polarity === "positive") continue; // strength is UO6's, not a shared-concern count
    const shared = (echo.byPatternKey.get(f.key) ?? []).filter((name) => pondNames.has(name));
    if (shared.length < UN_POND_SHARED_MIN - 1) continue; // -1: this object itself is the other member
    if (!best || shared.length > best.shared.length) best = { finding: f, shared };
  }
  if (!best) return null;

  // §4.5 — where UE and UN6 would speak to the SAME key, the whole-book echo wins (wider claim, carries
  // its arithmetic) and UN6 defers. Echo is now an annotation on the elevated entry, so a surviving UN6
  // on the same key would put that key on the card twice in two different framings.
  if ((ctx.echo?.byPatternKey.get(best.finding.key)?.length ?? 0) > 0 && ctx.echo) {
    const shareOfBook = (ctx.echo.byPatternKey.get(best.finding.key)?.length ?? 0) / Math.max(1, ctx.echo.scoredHoldingsCount);
    // Only defer when the echo would actually FIRE (it needs the book gate + a trigger path); a
    // co-occurrence too small for echo leaves UN6 as the only speaker, which is correct.
    if (ctx.echo.scoredHoldingsCount >= UE_MIN_BOOK && shareOfBook >= UE_HIGH_BOOK_SHARE) return null;
  }

  const verdict = typeof best.finding.evidence?.verdict === "string" ? (best.finding.evidence.verdict as string) : null;
  const lead = verdict ?? "The same finding";
  return {
    entryId: "UN6",
    family: "UN",
    // A COUNT and the names. No lift, no "notably", no significance — within-pond sharing is expected.
    claim: `${plural(best.shared.length, "other name")} you hold in this peer group ${best.shared.length === 1 ? "is" : "are"} showing the same thing: ${nameList(best.shared, 3)}. ${lead}`,
    gloss: null,
    temporalClass: best.finding.temporalClass,
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POND_CONDITION, relationalWeight: 0.3 },
    arithmetic: { sharedCount: best.shared.length, pondHeldCount: pondNames.size, patternKey: undefined },
    interpretationCeiling:
      "Within-pond co-occurrence is expected by construction — peers face the same field. State the count and stop; never call it significant and never imply the names will move together.",
    doesntMean: DM.UN6,
    sourceRef: OPAQUE("UN6", best.finding.key),
  };
}

// UN4 (this pond's own condition) is NOT BUILT — deliberately, and recorded as a degradation rather
// than stubbed:
//   · UN4 needs PG-native fired findings. There are none in the store today, and the library's own
//     fallback is a PGState-derived sentence — which is a paraphrase of two fields, i.e. exactly the
//     re-derivation §0.7 forbids the relational layer from performing. Deferred until PG findings exist.
//   · UN6 needs the FIRED SET for every one of the reader's holdings in the pond. `ReaderBook` carries
//     no per-holding findings, and loading them would be an N-query fan-out on the read-critical path
//     (§5.7). Phase 6's base-rate aggregate is the correct substrate for co-occurrence, and UE1/UE6
//     make the wider whole-book claim from it. Building a narrower, more expensive version first would
//     be the wrong order.
// A stub returning null would look like a built entry that never fires; a degradation says why.

/** UN7 — sector exposure. A DIFFERENT cut from the pond (a sector spans several peer groups); the two
 *  numbers are never presented as if one corrects the other (§3.3). */
function buildUN7(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  const n = ctx.neighbourhood;
  const sector = obj.sector?.displayName ?? null;
  if (!n || !sector || n.sectorWeightPct === null) return null;
  if (n.sectorWeightPct < UN_SECTOR_NOTABLE_PCT) return null;
  // Suppressed when it would merely restate the pond figure: same weight AND the pond is the whole
  // sector exposure. Two identical percentages side by side read as a contradiction, not a second cut.
  if (n.pgWeightPct !== null && Math.round(n.pgWeightPct) === Math.round(n.sectorWeightPct)) return null;
  return {
    entryId: "UN7",
    family: "UN",
    claim: `${sector} more broadly is about ${pctStr(n.sectorWeightPct)} of your book.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POND_EXPOSURE, relationalWeight: 0.32 },
    arithmetic: { sectorWeightPct: Math.round(n.sectorWeightPct), sectorHeldCount: n.sectorHeldCount },
    interpretationCeiling: null,
    doesntMean: DM.UN7,
    sourceRef: OPAQUE("UN7", obj.stockId),
  };
}

/** UN8 — no pond connection. The honest null for a HELD/WATCHED reader (UO4 covers the stranger modes).
 *  Absence of a connection is a statement about the book, never a reason to acquire one. */
function buildUN8(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): ResolvedEntry | null {
  const n = ctx.neighbourhood;
  if (!n || !obj.peerGroup) return null;
  if (mode.positionAxis === "NEITHER") return null; // UO4 owns the stranger framing
  if (n.pgHeld.some((h) => !h.isThisObject)) return null; // there IS a connection → UN1 states it
  if ((ctx.watchlist?.peersInPeerGroup.length ?? 0) > 0) return null; // UN3 states it
  return {
    entryId: "UN8",
    family: "UN",
    claim: "No other holdings in this peer group.",
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.15 },
    arithmetic: { pgSize: n.pgSize },
    interpretationCeiling: null,
    doesntMean: DM.UN8,
    sourceRef: OPAQUE("UN8", obj.stockId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UD — Delta (§3.4). What changed since the reader last looked.
//
// ★ NOVELTY IS AN ANNOTATION, NEVER A GATE (§0.5). Nothing is removed from the card because it was
// seen. `lastViewedAt` exists ONLY to compute the marker. Slate-cleaning is prohibited outright, and
// the per-user "surfaced ledger" is explicitly killed — do not build one.
//
// ★ ABSENCE PRODUCES SILENCE (UD8 / Standing Rule 7). Without a last look the family is NOT EVALUABLE
// and renders nothing. It must never degrade to "nothing new since …", which would assert a comparison
// never made — the M1 first-view falsehood in a different entry.
//
// ★ ATTENTION IS A ROUTER, NEVER CONTENT (§0.6 / Part IX·5). These entries state what changed about
// the OBJECT. They never state how often, how recently, or how much the reader looked.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * UD1 — a finding that is newly standing since the reader last looked.
 *
 * ⚠ SUPERSEDES ELEVATED FOR THE SAME KEY. A newly-standing finding must render ONCE — here, with the
 * novelty marker, at UD's rung. The ELEVATED candidate for that key is suppressed entirely (see
 * `buildElevated`). Same principle as the echo merge: one claim, one owner.
 *
 * Uses the finding's OWN claim verbatim (§0.10) — the relational layer adds novelty, never interpretation.
 */
function buildUD1(ctx: ReaderContext, obj: ObjectState, held: boolean): ResolvedEntry[] {
  const d = ctx.delta;
  if (!d?.evaluable || d.newlyStandingKeys.length === 0) return [];
  const newKeys = new Set(d.newlyStandingKeys);
  const out: ResolvedEntry[] = [];
  for (const f of obj.findings) {
    if (!newKeys.has(f.key)) continue;
    if (f.polarity === "positive") continue; // constructive news is UO6's, with its own boundary
    const sev = (f.severity ?? "").toLowerCase();
    const critical = f.kind === "red_flag" || sev === "critical";
    out.push({
      entryId: `UD1:${f.key}`,
      family: "UD",
      claim: findingClaim(f), // §Phase 8.2
      gloss: null,
      temporalClass: f.temporalClass,
      standingSince: null,
      // THE novelty marker — an annotation, never a reordering (§4.4).
      isNewSinceLastLook: true,
      weight: {
        // Delta before state (§4.1): rung 2 when held, rung 4 otherwise. A CRITICAL finding still
        // outranks delta — risk before everything (rungs 1/3).
        ladderRung: critical ? (held ? RUNG.CRITICAL_HELD : RUNG.CRITICAL_UNPOSITIONED) : (held ? RUNG.DELTA_HELD : RUNG.DELTA_ANY),
        relationalWeight: 0.5 + (held ? 0.1 : 0),
      },
      arithmetic: { severity: f.severity, __echoKey: f.key, isNew: true },
      interpretationCeiling: null,
      doesntMean: DM.ELEVATED, // inherits the finding's own boundary (§0.10) — the layer adds none
      sourceRef: OPAQUE("UD1", f.key),
    });
  }
  return out;
}

/**
 * UD3 — the health band crossed since the reader last looked.
 *
 * A band change is a HEALTH-STATE change, never a price event and never a call. Fires only when the
 * band actually differs from the one in force at the last look — an unknown prior band yields silence.
 */
function buildUD3(ctx: ReaderContext, obj: ObjectState, held: boolean): ResolvedEntry | null {
  const d = ctx.delta;
  if (!d?.evaluable || !d.lastSeenBand || !obj.snapshot) return null;
  if (d.lastSeenBand === obj.snapshot.band) return null;
  const from = bandLabel(d.lastSeenBand);
  const to = bandLabel(obj.snapshot.band);
  return {
    entryId: "UD3",
    family: "UD",
    claim: `Health has moved from ${from} to ${to} since you last looked.`,
    gloss: null,
    temporalClass: "TRANSITION",
    standingSince: null,
    isNewSinceLastLook: true,
    // ⚠ RUNG FROM POSITION (§4.1). Rung 2 is delta on a HELD object, rung 4 delta on anything else —
    // "self before other". Hardcoding rung 4 was latent: a held delta would have lost to a critical
    // finding on an unpositioned stock at rung 3, inverting the principle.
    weight: { ladderRung: held ? RUNG.DELTA_HELD : RUNG.DELTA_ANY, relationalWeight: held ? 0.55 : 0.45 },
    arithmetic: { fromBand: d.lastSeenBand, toBand: obj.snapshot.band },
    interpretationCeiling: null,
    doesntMean: DM.UD3,
    sourceRef: OPAQUE("UD3", obj.stockId),
  };
}

/**
 * UD7 — the honest "nothing new" header state.
 *
 * ⚠ ONLY when the delta is EVALUABLE and genuinely empty. A not-evaluable delta renders nothing at
 * all: "nothing new since July" asserted without a comparison basis is the falsehood this family is
 * most prone to. Returned as a header claim rather than a slot entry (§2.3).
 */
function ud7HeaderClaim(ctx: ReaderContext): string | null {
  const d = ctx.delta;
  if (!d?.evaluable || !d.sinceLabel) return null;

  // ⚠ "NOTHING NEW" REQUIRES A COMPARISON BASIS, NOT MERELY A LAST-LOOK TIMESTAMP (Standing Rule 7).
  //
  // Caught live: RELIANCE for U1 resolved `evaluable: true` (a lastViewedAt exists) with
  // `lastSeenGeneration: null` (the beacon never stamped a generation, or it predates the stamp), and
  // rendered "Nothing new since July 2026." We do not know WHICH snapshot the reader saw, so we cannot
  // know whether anything changed — that sentence was an assertion from a missing input.
  //
  // The basis is the STAMPED GENERATION. Without it, UD7 stays silent and the mode falls back to its
  // standing-framed header, which claims nothing about change.
  if (!d.lastSeenGeneration) return null;

  // A changed generation whose prior snapshot we could not read (pruned/unreadable) leaves both key
  // sets empty — which is indistinguishable from "genuinely nothing changed" unless we check the
  // generation too. `newSnapshotSinceLastLook` catches exactly that case.
  const nothingChanged = d.newlyStandingKeys.length === 0 && d.clearedKeys.length === 0 && !d.newSnapshotSinceLastLook;
  if (!nothingChanged) return null;
  return `Nothing new since ${d.sinceLabel}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UE — Echo (§3.5). Pattern co-occurrence between THIS object and the reader's book.
//
// ★ THE TWO-AXIS LAW (§3.5.1). Concentration ("how much of my book is in this") and distinctiveness
// ("is my book unusual versus the market") are DIFFERENT questions and are never collapsed into one
// number. Either axis alone is sufficient to fire:
//     share path — observedShare ≥ 0.50 AND firedInBook ≥ 3   (half the book is inside it)
//     lift path  — lift ≥ 2.0        AND firedInBook ≥ 2      (markedly more common here)
//   universal gate — scoredHoldingsCount ≥ 4 (below this neither can be stated honestly)
//
// ★ BASE RATE IS A FRAMING SWITCH, NEVER A KILL SWITCH (§3.5.2). expectedShare selects WHICH of two
// true sentences is rendered — it never suppresses the echo:
//     expectedShare <  0.30 → UE1  distinctive concentration ("a trait of your book")
//     expectedShare ≥  0.30 → UE6  environmental exposure    ("market-wide, and your share of it")
// The high-base-rate/high-share cell is FIRST-CLASS, not a consolation prize: "this is market-wide and
// three-quarters of your book is inside it" is among the most useful sentences the card can produce,
// and the original error was suppressing it.
//
// ★ BOTH NUMBERS RENDER, ALWAYS (§3.5.3). Every echo claim carries the book count AND the universe
// count with its as-of date. That is what makes the family honest by construction rather than by our
// judgement — the reader sees the comparison and can dismiss it themselves.
//
// ★ NEVER STATE SIGNIFICANCE. State the numbers and stop. No "notably", "unusually", "concerning".
// ★ POSITIVE ECHO NEVER JUDGES THE SELECTION (§3.5.4). It states counts exactly as negative echo does;
//   it never implies skill, validation, or a repeatable edge.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Which echo entry a co-occurrence resolves to, with the arithmetic behind it. */
interface EchoResolution {
  entryId: "UE1" | "UE6";
  firedInBook: number;
  observedShare: number;
  lift: number | null;
  names: string[];
  /** ★ THE BOOK DENOMINATOR THIS RESOLUTION USED (step 5). Carried out rather than re-derived by the
   *  builder: a score key's is the reader's scored holdings, a filing key's is the holdings that
   *  rule EVALUATED on, and the claim has to render the one the share was actually computed against. */
  bookDenominator: number;
}

function resolveEcho(
  ctx: ReaderContext,
  finding: ObjectFinding,
  rates: BaseRateSnapshot,
): EchoResolution | null {
  const echo = ctx.echo;
  if (!echo) return null;

  // ★ ONE POPULATION PER KEY, ON BOTH SIDES OF THE RATIO (step 5).
  //
  // `lift` is observedShare / expectedShare. The base rates now draw a FILING key's expectedShare from
  // the population its RULE evaluated in — not from the 95 we score — so the book share has to come
  // from the matching population, or the multiple divides a share of one set by a share of another.
  //
  // The book denominator is per KEY, for the same reason it is per key on the universe side: a holding
  // whose rule DECLINED is not a clean observation of that holding. A book of ten where R3 could only
  // be evaluated on two is a book of TWO for R3, and rendering "1 of your 10" would count eight
  // holdings we never checked as eight that came back clean.
  const isFiling = isFilingChannelKey(finding.key);
  const bookDenominator = isFiling
    ? echo.filing.evaluatedByRuleKey.get(finding.key) ?? 0
    : echo.scoredHoldingsCount;

  // The universal gate, applied to the denominator the share is ACTUALLY computed against rather than
  // to the scored count for both. A filing key on a book of three scored and eleven unscored holdings
  // is stateable; a score key on the same book is not, and only a per-key basis can say both.
  if (bookDenominator < UE_MIN_BOOK) return null;

  // ⚠ POSITIVE ECHO DOES NOT FIRE (§3.5.4 · Part IX·18 — a BOUNDARY decision, not a mechanic).
  //
  // The library permits positive echo on identical gates, and each half is individually legal: UO6's
  // strength claim is legal, and a bare co-occurrence count is legal. THE MERGE IS NOT. Read aloud:
  //
  //   "Clears every bar it's measured against — has for six quarters. It's showing in 5 of your 10
  //    scored holdings — 14 of the 95 we score show it too."
  //
  // That reads as *your book is full of good ones* — a verdict on the reader's SELECTION, which
  // Part IX·18 prohibits outright ("never implies skill, validation, or a repeatable edge") and §3.5.4
  // names as the family's specific trap. The linking construction is what does it: strength + "in 5 of
  // YOUR holdings" is praise however neutrally each half is phrased.
  //
  // A bare-counts variant with no linking phrase was the alternative. It does not survive reading
  // aloud either — the adjacency alone carries the implication, and the register guard cannot detect a
  // verdict that lives in juxtaposition rather than vocabulary.
  //
  // Negative and neutral echo are unaffected: "this condition is in 5 of your holdings" describes
  // exposure, and exposure is legal to state. Only the constructive direction implies a compliment.
  if (finding.polarity === "positive") return null;

  // ⚠ CLOCK-EVENTS ARE EXCLUDED FROM ECHO (§0.5 × §3.5 — the library defines the gates without ever
  // referencing temporal class, which is the gap this closes).
  //
  // A CONDITION co-occurring describes the reader's BOOK COMPOSITION. A CLOCK_EVENT co-occurring
  // describes a TIME WINDOW. Live example that forced this: "Ownership event — 2 block/bulk deals …
  // It's showing in 5 of your 10 scored holdings — 13 of the 95 stocks we score show it too." Every
  // number true, base rate genuinely low, all gates passed — and the sentence means nothing, because a
  // 90-day window catches whatever the market happened to do. That is the horoscope failure mode
  // wearing a low base rate, and NO base-rate gate can detect it; only the class can.
  if (finding.temporalClass === "CLOCK_EVENT") return null;

  const names = (isFiling ? echo.filing.byRuleKey.get(finding.key) : echo.byPatternKey.get(finding.key)) ?? [];
  const firedInBook = names.length;
  if (firedInBook === 0) return null;

  const observedShare = firedInBook / bookDenominator;
  const rate = rateFor(rates, finding.key);
  // lift is undefined when the universe rate is zero — the key fires in this book and nowhere else we
  // score. Treated as null (not Infinity): the SHARE path can still carry it, and a null lift renders
  // no lift clause rather than a fabricated multiple.
  const lift = rate.expectedShare > 0 ? observedShare / rate.expectedShare : null;

  const sharePath = observedShare >= UE_HIGH_BOOK_SHARE && firedInBook >= UE_SHARE_MIN_COUNT;
  const liftPath = lift !== null && lift >= UE_MIN_LIFT && firedInBook >= UE_MIN_COUNT;
  if (!sharePath && !liftPath) return null; // → UE5 states the unremarkable case

  // The framing switch. NEVER a kill switch: both branches render.
  const entryId = rate.expectedShare >= UE_ENVIRONMENTAL_BASE_RATE ? "UE6" : "UE1";
  return { entryId, firedInBook, observedShare, lift, names, bookDenominator };
}

/** The echo entries for this object's findings. At most ONE per finding; UE1 and UE6 are mutually
 *  exclusive by construction (the base-rate switch), so they can never co-fire for the same key. */
function buildEcho(ctx: ReaderContext, obj: ObjectState, rates: BaseRateSnapshot | null): ResolvedEntry[] {
  if (!rates || !ctx.echo) return []; // no aggregate ⇒ family dropped + degradation (§5.7)
  const out: ResolvedEntry[] = [];
  const asOf = rates.asOfDate ? ` as of ${monthYear(rates.asOfDate)}` : "";

  for (const f of obj.findings) {
    const res = resolveEcho(ctx, f, rates);
    if (!res) continue;
    const rate = rateFor(rates, f.key);
    const claimLead = findingLead(f);

    // BOTH NUMBERS, ALWAYS — the reader's count and the universe's, each with its denominator.
    //
    // ⚠ THE NUMBERS ARE NOW PER-POPULATION; THE WORDS AROUND THEM ARE NOT, AND THAT IS A KNOWN,
    //   DELIBERATE GAP. `bookDenominator` and `rate.universeCount` are whichever population this key
    //   belongs to — that is arithmetic and it had to move with the split, because printing a
    //   denominator the share was not divided by is simply a wrong number.
    //
    //   The PROSE has not moved with it. "your N scored holdings" and "the N stocks we score" are both
    //   false for a filing key: its denominators are the holdings and the stocks in which that RULE
    //   EVALUATED, which includes stocks we do not score and excludes stocks we do. Both strings are
    //   listed in the step-5 copy report. Rewriting them is the copy pass's job, not this one's —
    //   inventing replacement prose here would put an unreviewed sentence on a live reader surface.
    const bookClause = `It's showing in ${res.firedInBook} of your ${res.bookDenominator} scored holdings`;
    const universeClause = `${rate.firedInUniverse} of the ${rate.universeCount} stocks we score${asOf}`;

    // ⚠ THE CLAIM IS OWNED ONCE (§4.5, extended — the library covers UE against PHS and against
    // dampening, but never against ELEVATED for the SAME KEY).
    //
    // A UE entry carries the finding's own claim plus the echo arithmetic. If that same patternKey is
    // ALSO elevated in a slot above it, the reader sees the identical sentence twice on one card. Both
    // shapes are pre-rendered here; `dropDuplicateEchoClaims` (called after assembly, when slot
    // membership is finally known) swaps in the arithmetic-only form where the key is already shown.
    const fullClaim =
      res.entryId === "UE6"
        ? `${claimLead} This is showing across much of the market right now — ${universeClause}. ${bookClause}.`
        : `${claimLead} ${bookClause} — ${universeClause} show it too.`;
    // Arithmetic only — used when the claim is already on the card. Still carries BOTH numbers (§3.5.3).
    const arithmeticOnlyClaim =
      res.entryId === "UE6"
        ? `Showing across much of the market right now — ${universeClause}. ${bookClause}.`
        : `${bookClause}; ${universeClause} show it too.`;
    const claim = fullClaim;

    out.push({
      entryId: res.entryId,
      family: "UE",
      claim,
      gloss: null,
      temporalClass: "CONDITION",
      standingSince: null,
      isNewSinceLastLook: false,
      weight: {
        // UE6 outranks UE1 (§4.1): exposure ranks above texture, the same reason UN1/UN2 sit at rung 6.
        ladderRung: res.entryId === "UE6" ? RUNG.ENVIRONMENTAL : RUNG.ECHO,
        // Within the echo rungs, SHARE dominates lift — concentration is the more material fact.
        relationalWeight: Math.max(0.3, res.observedShare),
      },
      arithmetic: {
        firedInBook: res.firedInBook,
        // ★ THE DENOMINATOR THE SHARE WAS COMPUTED AGAINST, and the population it came from. Both are
        //   structured numbers a caller may render or check; `population` is what makes the pair
        //   self-describing rather than requiring the reader to know which channel a key belongs to.
        scoredHoldingsCount: res.bookDenominator,
        population: rate.population,
        observedShare: Math.round(res.observedShare * 100) / 100,
        firedInUniverse: rate.firedInUniverse,
        universeCount: rate.universeCount,
        expectedShare: Math.round(rate.expectedShare * 100) / 100,
        lift: res.lift === null ? null : Math.round(res.lift * 100) / 100,
        asOfDate: (rate.population === "filing" ? rate.asOfDate : rates.asOfDate)?.toISOString() ?? null,
        // Internal, for `dropDuplicateEchoClaims` — the key this echo is about, and the arithmetic-only
        // form to swap in when that key's claim is already rendered by an ELEVATED slot above.
        __echoKey: f.key,
        __arithmeticOnlyClaim: arithmeticOnlyClaim,
      },
      interpretationCeiling:
        "State the two counts and stop. Never call the co-occurrence significant, never imply the holdings will move together, and never evaluate the reader's selection.",
      doesntMean: res.entryId === "UE6" ? DM.UE6 : DM.UE1,
      sourceRef: OPAQUE(res.entryId, f.key),
    });
  }
  return out;
}

/**
 * ⚠ ECHO IS AN ANNOTATION, NOT A SLOT (§3.5 × §4.5, Phase 6 correction).
 *
 * THE STRUCTURAL PROBLEM. UE can only fire when its own competition is guaranteed present: UE1 requires
 * a pattern firing on THIS object that also fires across the book — so whenever echo is eligible, an
 * ELEVATED entry for that same key is eligible too, at a higher rung. Echo is structurally dominated by
 * its own precondition. Measured live before this change: **25 resolved, 1 slot won.** That is not a
 * ladder artefact to tune; it is the shape of the family.
 *
 * THE FIX. When the echoing key is rendered as an ELEVATED slot, the echo's arithmetic ATTACHES to that
 * entry instead of competing with it:
 *
 *     Sliding from a high base — composite crossed down out of Pristine (74.1 → 63.6). It's showing in
 *     8 of your 10 scored holdings — 38 of the 95 we score as of July 2026.
 *
 * One slot, two facts, no duplication, no competition. Echo then delivers EVERY time it fires.
 *
 * When the key is NOT on the card, the echo does not render at all: the finding itself lost its slot,
 * and its echo is strictly less important than the finding it annotates. It goes to overflow with it.
 *
 * NOT A NEW CONCEPT — UN5 (pond weather) is already specified as a modifier on price-linked entries
 * rather than a slot-consuming one. Same mechanism.
 *
 * SCOPE. Key-tied echoes only (UE1/UE5/UE6). A family-level echo (UE3, unbuilt) makes a claim tied to
 * no single key and would keep its own rung. Where UE and UN6 would annotate the same key, UE wins and
 * UN6 drops to overflow (§4.5).
 *
 * Runs AFTER assembly, because host membership is not known until slots are decided. Mutates nothing.
 */
export function attachEchoAnnotations(slots: ResolvedEntry[], overflow: ResolvedEntry[]): {
  slots: ResolvedEntry[];
  overflow: ResolvedEntry[];
} {
  // ⚠ HOST PRECEDENCE: UD1 → UO6 → ELEVATED (§Phase 7). Whichever entry RENDERS the key hosts its echo
  // annotation — never two. UD1 leads because a newly-standing finding supersedes its ELEVATED twin
  // outright; UO6 hosts positive findings, which ELEVATED deliberately skips.
  const hostKeyOf = (e: ResolvedEntry): string | null => {
    if (e.entryId.startsWith("UD1:")) return e.entryId.slice("UD1:".length);
    if (e.entryId === "UO6") {
      const k = e.arithmetic?.__hostKey;
      return typeof k === "string" ? k : null;
    }
    if (e.family === "ELEVATED") return e.entryId.slice("ELEVATED:".length);
    return null;
  };

  const echoKeyOf = (e: ResolvedEntry): string | null => {
    const k = e.arithmetic?.__echoKey;
    return e.family === "UE" && typeof k === "string" ? k : null;
  };
  const annotationOf = (e: ResolvedEntry): string | null => {
    const a = e.arithmetic?.__arithmeticOnlyClaim;
    return typeof a === "string" ? a : null;
  };

  // One echo per key — the first wins if a key somehow produced two (it cannot today: UE1 and UE6 are
  // mutually exclusive by the base-rate switch, and UE5 only fires when no echo did).
  const echoesByKey = new Map<string, ResolvedEntry>();
  for (const e of [...slots, ...overflow]) {
    const k = echoKeyOf(e);
    if (k && !echoesByKey.has(k)) echoesByKey.set(k, e);
  }
  if (echoesByKey.size === 0) return { slots, overflow };

  const merged = new Set<string>(); // echo entryIds absorbed into a host
  const mergeInto = (host: ResolvedEntry): ResolvedEntry => {
    const key = hostKeyOf(host);
    if (key === null) return host;
    const echo = echoesByKey.get(key);
    if (!echo) return host;
    const annotation = annotationOf(echo);
    if (!annotation) return host;
    merged.add(echo.entryId + "::" + key);
    return {
      ...host,
      // The finding's own claim, then the echo's arithmetic. The finding's words are untouched (§0.10);
      // the echo contributes only its two counts, which is all it ever contributed.
      claim: `${host.claim} ${annotation}`,
      arithmetic: { ...(host.arithmetic ?? {}), ...(echo.arithmetic ?? {}) },
      // The host keeps its own rung, boundary and sourceRef — it is still the entry that owns the claim.
    };
  };

  const slotsMerged = slots.map(mergeInto);

  // Drop every key-tied echo that was absorbed, AND every key-tied echo whose host is not in slots —
  // an echo without its finding on the card is an orphan annotation, not a standalone claim.
  const hostKeysInSlots = new Set(slots.map(hostKeyOf).filter((k): k is string => k !== null));
  const isOrphanedEcho = (e: ResolvedEntry): boolean => {
    const k = echoKeyOf(e);
    return k !== null && !hostKeysInSlots.has(k);
  };
  const wasMerged = (e: ResolvedEntry): boolean => {
    const k = echoKeyOf(e);
    return k !== null && merged.has(e.entryId + "::" + k);
  };

  return {
    slots: slotsMerged.filter((e) => !wasMerged(e) && !isOrphanedEcho(e)),
    // Orphaned echoes travel to overflow WITH their finding, where the reader can see both on expand.
    overflow: overflow.filter((e) => !wasMerged(e)),
  };
}

/**
 * ⚠ THE CARD PREFERS THE PLAIN CLAIM (§Phase 8.2). The finding's own `verdict` is written for the
 * health tab, in analyst register ("peer μ 37.16, N=6", "sustained 2 snapshots"). `plainClaimFor`
 * returns a hand-authored restatement carrying the SAME facts and figures in plainer words; when none
 * is authored, or its figures are absent, the analyst verdict is the honest fallback.
 *
 * Never a transformation of the verdict at render time — that would re-author its meaning (§0.10).
 *
 * ── ★ THE FALLBACK GOES THROUGH renderVerdict, NOT STRAIGHT AT evidence.verdict ────────────────────
 * It used to read `f.evidence.verdict` directly. That made this the LAST place in the product where a
 * finding's sentence was authored outside the catalogue: the engine's own assembled string won here,
 * while the File-1 authored renderer won on the stock page, the chat, and the grounding block. Same
 * fired finding, two sentences, and the one this card showed was the one nobody had edited.
 *
 * `renderVerdict` is a strict SUPERSET of what this line did — its own precedence is
 * authored-renderer → evidence.verbatim → evidence.verdict → generic — so nothing that resolved before
 * stops resolving. It only adds the tier that should always have been in front.
 *
 * ⚠ THE PLAIN-CLAIM LAYER ABOVE IS NOT TOUCHED, and must not be. It exists because the File-1 verdicts
 * read as analyst register on an ORIENTATION card, which is a relational decision (§0.10 / §0.11), not
 * a copy-freshness one. Repointing the fallback does not make the plain claims redundant; it makes the
 * sentence they fall back to the same one every other surface shows.
 *
 * ⚠ THE lens_* PATH IS UNCHANGED BY CONSTRUCTION. Composed keys (`lens_lm3_<metric>`) have no entry in
 * the renderer catalog and cannot — the suffix is one key per metric that has ever fired. renderVerdict
 * therefore falls through to `evidence.verbatim || evidence.verdict` for them, which is exactly the
 * line this replaced. evidence.verdict remains the only authority for that family.
 */
export function findingClaim(f: ObjectFinding): string {
  const plain = plainClaimFor(f.key, f.evidence);
  if (plain) return plain;
  const rendered = renderVerdict(f.key, f.evidence).trim();
  if (rendered) return rendered;
  // Unreachable in practice — renderVerdict has its own generic and never returns empty. Kept so this
  // function is total on its own terms rather than on another module's promise.
  return f.kind === "red_flag" ? "A red flag is standing on this stock." : "A finding is standing on this stock.";
}

/** The echo's lead — the same preferred-claim resolution. */
function findingLead(f: ObjectFinding): string {
  return findingClaim(f);
}

/** UE5 — "in line with the market". The legitimate resolution of the ORDINARY case, not an absence.
 *  Fires only when a book is big enough to say it and nothing better competes (rung 15). */
function buildUE5(ctx: ReaderContext, obj: ObjectState, rates: BaseRateSnapshot | null): ResolvedEntry | null {
  const echo = ctx.echo;
  if (!rates || !echo) return null;
  if (echo.scoredHoldingsCount < UE_MIN_BOOK) return null;
  // Only when NO echo fired — otherwise the specific claim is the better one.
  const anyEcho = obj.findings.some((f) => resolveEcho(ctx, f, rates) !== null);
  if (anyEcho) return null;
  // Does anything standing on this object repeat anywhere in the book at all?
  // ★ BOTH CENSUSES (step 5). Filing keys left `byPatternKey` when the populations split, so a
  //   single-census count here would have quietly stopped seeing them — and UE5's two branches are
  //   "N other holdings show it" versus "nothing repeats", which is exactly the sentence that must not
  //   silently become the second one because the key moved table.
  const repeats = obj.findings.filter(
    (f) => ((isFilingChannelKey(f.key) ? echo.filing.byRuleKey.get(f.key) : echo.byPatternKey.get(f.key))?.length ?? 0) > 0,
  ).length;
  const claim =
    repeats > 0
      ? `Also showing in ${plural(repeats, "other holding")} of yours — about what the rest of the market would suggest.`
      : "Nothing standing on this stock repeats elsewhere in your book.";
  return {
    entryId: "UE5",
    family: "UE",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.12 },
    arithmetic: { repeats, scoredHoldingsCount: echo.scoredHoldingsCount },
    interpretationCeiling: null,
    doesntMean: DM.UE5,
    sourceRef: OPAQUE("UE5", obj.stockId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UG — Gap (§3.6). The honesty family: honest-empty as a first-class citizen with its own entries,
// not an edge case handled inside every other entry.
//
// ★ EVERY UG ENTRY DESCRIBES OUR COVERAGE, NEVER THE STOCK. "We don't score this yet" is a fact about
// us. Phrasing any of them as a property of the company would invert the whole family's purpose.
// ★ NO CALLS TO ACTION (§3.6 UG7). The moment one of these acquires a button or a prompt it stops
// being an honesty surface and becomes a growth surface.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** UG1 — not scored, with the reason AND what we do have. An honest gap names what remains (§3.6). */
function buildUG1(obj: ObjectState, held: boolean): ResolvedEntry | null {
  if (obj.isScored) return null;
  // ANTI-DOUBLE-COUNT (§4.5): when the reader HOLDS the stock, UH10 already pairs the coverage note to
  // the position and is the more relevant framing. UG1 is the orientation-mode entry; the two must
  // never both render, or the card says "we don't score this" twice in different words.
  if (held) return null;
  // `display_only` is a DIFFERENT fact from "not yet" — no peer group means no comparison set, so it is
  // never scored by design rather than pending. UH10 states the held-side pairing; this is the general
  // orientation-mode entry.
  const why =
    obj.coverage.state === "display_only"
      ? "it isn't placed in a peer group, so we have no comparison set to score it against"
      : "we don't have enough history for it yet";
  // What we DO have — named from what actually resolved, never a boilerplate list (§3.6 rule).
  const have: string[] = [];
  if (obj.sector) have.push("its sector and classification");
  if (obj.businessLead) have.push("what the company does");
  if (obj.peerGroup) have.push("its peer group");
  const haveClause = have.length > 0 ? ` What we do have: ${nameList(have, 3)}.` : "";
  return {
    entryId: "UG1",
    family: "UG",
    claim: `We don't score this stock yet — ${why}.${haveClause}`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.25 },
    arithmetic: { coverageState: obj.coverage.state },
    interpretationCeiling: null,
    doesntMean: DM.UG1,
    sourceRef: OPAQUE("UG1", obj.stockId),
  };
}

/** UG5 — the reader holds funds we cannot see inside. States OUR limit; never estimates the exposure. */
function buildUG5(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  if (!ctx.book?.hasFundHoldings) return null;
  if (ctx.book.lookThroughAvailable) return null; // permanently false today; correct when it changes
  return {
    entryId: "UG5",
    family: "UG",
    // "may hold" — our uncertainty, never an assertion about the reader's position (§3.6 UG4/UG5).
    claim: "You may hold this indirectly through your funds — we can't see inside them yet.",
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.18 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UG5,
    sourceRef: OPAQUE("UG5", obj.stockId),
  };
}

/** UG7 — authenticated, no portfolio connected. ONE sentence, NO call to action (§3.6). */
function buildUG7(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  if (!ctx.identity.isAuthenticated) return null; // anonymous is UG8's business — never mention accounts
  if (ctx.book?.exists) return null;
  return {
    entryId: "UG7",
    family: "UG",
    // ⚠ §3.6 — states the LIMIT, names no action. The earlier wording ("You haven't connected a
    // portfolio…") described the state accurately but still named the action, which is one edit away
    // from a prompt. This version says only what the card can and cannot do, which is the entry's
    // entire purpose. One sentence. No verb the reader could be expected to perform.
    claim: "We don't have a portfolio for you, so this card can only tell you about the stock itself.",
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.22 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UG7,
    sourceRef: OPAQUE("UG7", obj.stockId),
  };
}

/**
 * UG9 — a check that could not run. ⚠ Keyed on the Phase 2 EVALUABILITY output, never on
 * `displayState` (which has zero producers and would make this entry dead).
 *
 * Fires ONLY on a genuinely declined set. `coverage.notEvaluable === null` means we do not know what
 * declined — silence, not a claim (Standing Rule 7). Names the CAPABILITY, never the rule ref.
 */
function buildUG9(obj: ObjectState): ResolvedEntry | null {
  if (!obj.isScored) return null; // an unscored stock's gap is UG1's, not a per-check one
  const declined = obj.notEvaluable;
  if (declined === null || declined.length === 0) return null;
  const caps = describeDeclined(declined);
  if (caps.length === 0) return null; // every declined rule was unmapped ⇒ silence, never a raw ref

  const lead = caps[0];
  const claim =
    caps.length === 1
      ? `We can't yet check ${lead.capability} on this stock — it needs ${reasonPhrase(lead.reason)}.`
      : `We can't yet check ${nameList(caps.map((c) => c.capability), 3)} on this stock — ${plural(caps.length, "check")} ${caps.length === 1 ? "needs" : "need"} ${reasonPhrase(lead.reason)}.`;
  return {
    entryId: "UG9",
    family: "UG",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.2 },
    arithmetic: { declinedCount: declined.length, capabilities: caps.map((c) => c.capability) },
    interpretationCeiling: null,
    doesntMean: DM.UG9,
    sourceRef: OPAQUE("UG9", obj.stockId),
  };
}

// UG2 (provisional), UG3 (stale prices), UG4 (unresolved holdings), UG10 (data older than cadence) are
// NOT BUILT — each lacks its input, and a stub that never fires reads as a built entry:
//   · UG2 needs `coverage.provisional`. The derived coverage has no provisional state, because the
//     column it would come from (StockScoringState) had zero rows and no writer, and the table was
//     dropped outright on 2026-08-09.
//   · UG3 needs `priceFreshness`, which ObjectState does not carry — adding a price read to the
//     read-critical path is out of this build's scope.
//   · UG4 needs `book.unresolvedHoldingsCount` AND a plausible match between an unmatched broker row
//     and THIS object. ReaderBook carries no unresolved-row detail.
//   · UG10 needs an expected-cadence definition per snapshot type; none is published.
// Each is recorded as a degradation below.

// ── ELEVATED — the object's own standing findings, elevated by reference (§0.10). Uses the finding's OWN
//    claim; the relational layer never re-interprets it. Rung by SEVERITY (never polarity, never
//    magnitude). Positive findings are NOT elevated here — they feed UO6. ──────────────────────────────
function buildElevated(ctx: ReaderContext, obj: ObjectState): ResolvedEntry[] {
  const held = ctx.heldThisObject;
  const out: ResolvedEntry[] = [];
  // ⚠ UD1 SUPERSEDES ELEVATED FOR THE SAME KEY (§Phase 7). A newly-standing finding renders ONCE, in
  // its UD1 form with the novelty marker at UD's rung. Emitting both would put the identical claim on
  // the card twice — the same defect the echo merge fixed, in a different pair.
  const supersededByUD1 = new Set(
    ctx.delta?.evaluable ? ctx.delta.newlyStandingKeys : [],
  );
  for (const f of obj.findings) {
    if (f.polarity === "positive") continue; // strength is UO6's job, not an elevated concern
    if (supersededByUD1.has(f.key)) continue; // UD1 owns this claim
    const sev = (f.severity ?? "").toLowerCase();
    let rung: number;
    if (f.kind === "red_flag" || sev === "critical") rung = held ? RUNG.CRITICAL_HELD : RUNG.CRITICAL_UNPOSITIONED;
    else if (sev === "high") rung = RUNG.HIGH_SEVERITY;
    else if (sev === "recovery") rung = RUNG.RECOVERY_STRENGTH;
    else if (sev === "medium") rung = RUNG.MEDIUM_SEVERITY;
    else rung = RUNG.CONTEXT;
    const claim = findingClaim(f); // §Phase 8.2 — plain claim preferred, analyst verdict as fallback
    out.push({
      entryId: `ELEVATED:${f.key}`,
      family: "ELEVATED",
      claim,
      gloss: null,
      temporalClass: f.temporalClass,
      standingSince: null, // standing_since is absent this slice (degradation) — duration suppressed
      isNewSinceLastLook: false,
      weight: { ladderRung: rung, relationalWeight: 0.3 + (held ? 0.1 : 0) },
      arithmetic: { severity: f.severity },
      interpretationCeiling: null,
      doesntMean: DM.ELEVATED,
      sourceRef: OPAQUE("ELEVATED", f.key),
    });
  }
  return out;
}

// ── tiny helper: is the reader holding THIS object (union-aware). ─────────────────────────────────────
function mode_isHeld(ctx: ReaderContext): boolean {
  return ctx.heldThisObject;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BUILDER — assemble every candidate + the negatives + the degradations + the mode header.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface BuiltEntries {
  candidates: ResolvedEntry[];
  floorIds: string[];
  cap: number;
  header: { entryId: string; claim: string; gloss: string | null };
  negatives: NegativeFact[];
  degradations: Degradation[];
}

/** The degradations that are TRUE OF THIS SLICE regardless of the reader — coverage facts stated once
 *  (§6). None is fabricated; each names an absent prerequisite and its defined effect. */
export const SLICE_DEGRADATIONS: Degradation[] = [
  { prerequisite: "standing_since", effect: "duration labels suppressed on point-in-time findings; UO6 uses the rule's own evidence run length instead" },
  // ⚠ RESOLVED IN PHASE 2 — no longer a degradation. The live scoring path calls runFindingsDetailed,
  // the declined set persists on the snapshot, and UO3 qualifies its clean claim. It remains listed
  // with its RESIDUAL effect only: snapshots written before the column carry null, and for those the
  // weak variant is still correct (we genuinely do not know what ran).
  { prerequisite: "evaluability_backfill", effect: "snapshots predating the evaluability column carry null — UO3 uses its unqualified variant and UG9 stays silent for those, until a rescore repopulates them" },
  { prerequisite: "polarity", effect: "polarity is published on Family N only — UO6 selects N findings, echo would cover negatives only" },
  // ⚠ RETIRED IN PHASE 6 — the aggregate exists (relational/base-rates.ts, warmed nightly, computed on
  // cold start). Replaced by a RUNTIME degradation appended below only when the aggregate actually
  // fails to resolve, which is a different and much narrower claim.
  // §Phase 4 — the two UN entries deliberately NOT built, each with the reason it was deferred.
  { prerequisite: "pg_native_findings", effect: "no peer-group-level fired findings exist — UN4 cannot elevate one, and the PGState-derived fallback would be a re-derivation the layer must not perform" },
  // ⚠ RETIRED IN PHASE 6 — `per_holding_fired_sets` no longer applies: ctx.echo.byPatternKey IS the
  // per-holding fired set, resolved in one query, and UN6 is built on it.
  { prerequisite: "pond_mask", effect: "mask heat is a pure computation over cleaned price closes, not a read — UN5's pond-weather caveat cannot resolve on the read path" },
  { prerequisite: "unified_events_and_staleness", effect: "no unified event/staleness feed — UD5/UD6 unreachable (out of slice)" },
  // §Phase 5 — still a real degradation (look-through genuinely does not exist), but UG5 is now BUILT,
  // so the effect is no longer "UH5 silently absent" — the gap is stated on the card.
  { prerequisite: "fund_look_through", effect: "look-through is unavailable — UH5 can never fire; UG5 now states the limit on the card rather than leaving it silent" },
  // §Phase 5 — the four UG entries whose INPUT does not exist. Each names the missing input, not a
  // vague deferral, so the next builder knows exactly what unblocks it.
  { prerequisite: "provisional_coverage_flag", effect: "no provisional column exists (score_stock_states was dropped 2026-08-09; it never held a row) — UG2 cannot fire" },
  { prerequisite: "price_freshness", effect: "ObjectState carries no priceFreshness — UG3 (stale prices) cannot fire" },
  { prerequisite: "unresolved_holdings_detail", effect: "ReaderBook carries no unresolved-broker-row detail — UG4 cannot claim 'you may hold more than we can see'" },
  { prerequisite: "refresh_cadence", effect: "no expected-cadence definition is published per snapshot type — UG10 cannot judge staleness" },
  // ⚠ position_delta remains: UH7/UH8 (added/reduced since last look) need the TRANSACTION-delta path,
  // which is distinct from the snapshot-delta UD1/UD3 now use. Narrowed, not retired.
  { prerequisite: "position_delta", effect: "no transaction-delta path — UH7/UH8 (you added/reduced since last look) cannot resolve; the snapshot-delta family (UD1/UD3) is built and unaffected" },
  // ⚠ RESOLVED IN PHASE 1.2 — M5–M8 are built and a watchlisted-not-held reader no longer resolves to
  // the stranger floor. Removed from the degradation list rather than left as a stale declaration: a
  // degradation that no longer applies is itself a false statement about our coverage.
  // ⚠ RETIRED IN PHASE 7 — the UD engine exists. M2/M4 are unfolded, UD1/UD3 build, and UD7 renders as
  // an honest header only when the delta is evaluable and empty.
];

export function buildEntries(
  ctx: ReaderContext,
  obj: ObjectState,
  mode: ResolvedMode,
  /** §Phase 6 — the universe base-rate snapshot. `null` ⇒ the aggregate could not resolve, so the UE
   *  family is DROPPED WHOLE and a degradation is recorded. Never a partial echo (§5.7). */
  rates: BaseRateSnapshot | null = null,
): BuiltEntries {
  const level = ctx.identity.aiLevel;
  const held = matchHeldEntity(ctx, obj);

  const candidates: ResolvedEntry[] = [];
  const push = (e: ResolvedEntry | null) => {
    if (e) candidates.push(e);
  };

  // Orientation (eligible in the stranger modes; UO6 eligible everywhere).
  push(buildUO1(obj, level));
  push(buildUO2(obj, level));
  push(buildUO3(obj));
  push(buildUO4(ctx, obj, mode));
  push(buildUO6(obj));

  // Watchlist membership — the WATCHED floor fact, and a minor note in any other mode where it holds.
  push(buildUW1(ctx, obj));

  // Neighbourhood (§3.3) — the reader's pond + sector exposure. Eligible in EVERY mode: it is the
  // family that gives a non-holder something reader-specific, which is the census's main gap.
  push(buildUN1(ctx, obj));
  push(buildUN2(ctx, obj));
  push(buildUN3(ctx, obj));
  push(buildUN6(ctx, obj));
  push(buildUN7(ctx, obj));
  push(buildUN8(ctx, obj, mode));

  // Gap (§3.6) — the honesty family. Eligible in every mode; UG7 self-gates on authentication so an
  // anonymous reader is never told about an account they do not have (UG8).
  push(buildUG1(obj, mode_isHeld(ctx)));
  push(buildUG5(ctx, obj));
  push(buildUG7(ctx, obj));
  push(buildUG9(obj));

  // Delta (§3.4) — what changed since the last look. Silent when not evaluable (UD8).
  for (const e of buildUD1(ctx, obj, mode_isHeld(ctx))) candidates.push(e);
  push(buildUD3(ctx, obj, mode_isHeld(ctx)));

  // Echo (§3.5) — book-wide co-occurrence. Requires NO pond or sector overlap, so it reaches readers
  // the UN family cannot. Dropped whole when the base-rate aggregate is unavailable.
  for (const e of buildEcho(ctx, obj, rates)) candidates.push(e);
  push(buildUE5(ctx, obj, rates));

  // Holding (only when held).
  if (mode_isHeld(ctx)) {
    push(buildUH1(ctx, obj, held));
    push(buildUH2(ctx, obj, held));
    push(buildUH3(ctx, obj, held));
    push(buildUH4(ctx, obj, held));
    push(buildUH10(ctx, obj));
  }

  // Elevated standing findings (the object's own concerns, by reference) — feed M1/M3's standing list.
  for (const e of buildElevated(ctx, obj)) candidates.push(e);

  // ── Header + floor + cap per mode (§2.3). The floor always resolves (guaranteed-resolve, §0.4). ──
  const { header, floorIds, cap } = headerAndFloor(mode.mode, ctx, obj);

  return {
    candidates,
    floorIds,
    cap,
    header,
    negatives: buildNegatives(ctx, obj, mode),
    // §Phase 6 — the echo degradations are RUNTIME, not slice constants: each is declared only when
    // that substrate genuinely failed for THIS request, and only for a reader who has a book to echo
    // against. Declaring either unconditionally would be a false statement about our coverage.
    //
    // ⚠ UE STANDS ON TWO SUBSTRATES, AND BOTH MUST BE ABLE TO SAY SO. This used to test `rates` only,
    //   which left the OTHER half — ctx.echo, the reader's own book census — able to fail while the
    //   card reported full coverage: buildEcho/buildUE5/UN6 all return empty on a null census, so the
    //   family vanished and the degradation list still read clean. That is what made the 2026-08-02
    //   reader-context.ts census failure invisible for seven days rather than merely broken. A
    //   dropped family must always be able to name the thing that dropped it.
    degradations: [
      ...SLICE_DEGRADATIONS,
      ...(ctx.book?.exists && rates === null
        ? [{ prerequisite: "universe_base_rates", effect: "the base-rate aggregate did not resolve for this request — the UE echo family was dropped whole rather than rendered with a missing number" }]
        : []),
      ...(ctx.book?.exists && ctx.echo === null
        ? [{ prerequisite: "book_finding_census", effect: "the reader's book-wide fired-finding census did not resolve for this request — the UE echo family and UN6 (shared with your pond) were dropped whole rather than rendered against an incomplete book" }]
        : []),
    ],
  };
}

/** The mode's header state + reserved floor + cap (§2.3). Every header resolves (never empty). */
function headerAndFloor(
  mode: ModeId,
  ctx: ReaderContext,
  obj: ObjectState,
): { header: BuiltEntries["header"]; floorIds: string[]; cap: number } {
  switch (mode) {
    case "M1":
      // ⚠ NO NOVELTY ASSERTION IN A HEADER (§1.1). This header used to read "You own this — first time
      // you're reading it." M1 is selected purely by the ABSENCE of a BehaviorRollup row (mode.ts), and
      // the attention beacon is lossy by design — it discards its whole buffer when no token is present
      // and its failures are unobservable server-side. So a holder who has read the stock ten times could
      // be told it was their first. The reader is the one party who can disprove a claim from memory,
      // which made it the most damaging line on the card.
      //
      // M1 KEEPS ITS ROUTING ROLE (orientation-weighted shape, cap 3) and loses the assertion. The new
      // header is true whether or not the rollup exists. Novelty may still be ANNOTATED per entry where
      // lastViewedAt is actually known — it may never be asserted from a missing row.
      return {
        header: { entryId: "UH6", claim: "You own this — here's what's standing on it.", gloss: null },
        floorIds: ["UH1"],
        cap: 3,
      };
    case "M3":
      // The standing-framed header. With UD built, UD7's "nothing new since …" is available — but only
      // when the delta is EVALUABLE and genuinely empty, which M2 handles. M3 (recurring) keeps the
      // standing framing: a reader who checks often does not need a novelty verdict every visit.
      return {
        header: { entryId: "UH1-standing", claim: "Your position, and what's standing on it.", gloss: null },
        floorIds: ["UH1"],
        cap: 4,
      };

    // ── M2 · HOLDING DELTA (§Phase 7, unfolded) ──────────────────────────────────────────────────
    // The reader holds this and has returned. UD7 is the honest header when the delta is evaluable and
    // empty; otherwise the delta entries carry the news and the header frames them. Falls back to M3's
    // shape (same floor, same cap) when nothing changed — a fallback, never a fabricated delta claim.
    case "M2": {
      const ud7 = ud7HeaderClaim(ctx);
      return {
        header: ud7
          ? { entryId: "UD7", claim: ud7, gloss: null }
          : { entryId: "UH1-standing", claim: "Your position, and what's changed on it.", gloss: null },
        floorIds: ["UH1"],
        cap: 4,
      };
    }

    // ── M4 · HOLDING DORMANT-RETURN (§Phase 7, unfolded) ─────────────────────────────────────────
    // A long gap since the last look. The header states the RETURN, never the gap length as a fact
    // about the reader (§0.6 — attention is a router, and "you haven't looked since March" is
    // behaviour-mirroring). Falls back to M3's shape when no delta resolves.
    case "M4": {
      const ud7 = ud7HeaderClaim(ctx);
      return {
        header: ud7
          ? { entryId: "UD7", claim: ud7, gloss: null }
          : { entryId: "UH1-standing", claim: "Your position, and where it stands now.", gloss: null },
        floorIds: ["UH1"],
        cap: 4,
      };
    }

    // ── WATCHED (§1.2) — built. Floor = UO1 + the dated membership fact (UW1), which always resolves in
    //    these modes because the position axis only reaches WATCHED via a real watchlist row. UO2 joins
    //    the floor when scored. NEVER the stranger header: that was the falsehood. ──
    case "M5":
    case "M6":
    case "M7":
    case "M8": {
      const floorIds = ["UW1", "UO1"];
      if (obj.isScored && obj.snapshot) floorIds.push("UO2");
      // A single neutral header across the watched cells. The per-cell delta framings (M6/M7 "since you
      // last looked", M8 "you haven't looked since …") belong to the UD family and are NOT asserted here
      // — an un-verifiable delta claim is exactly the class of error §1.1 exists to prevent.
      return {
        header: { entryId: "UW-watching", claim: "You're watching this — here's where it stands.", gloss: null },
        floorIds,
        cap: 4,
      };
    }

    // ── M10 / M11 / M12 · NEITHER, with prior contact (§Phase 8, unfolded) ───────────────────────
    // The reader does not hold or watch this, but HAS looked before. M9's "New to you." would be a
    // falsehood here — the last one of its class in the build.
    //
    // The header states no novelty and no visit count: attention is a ROUTER, never content (§0.6 /
    // Part IX·5), so "you've looked 9 times" and "you haven't been here since March" are both
    // prohibited. UD7 supplies a dated frame ONLY when a real comparison basis exists; otherwise the
    // header is neutral and claims nothing about time at all.
    case "M10":
    case "M11":
    case "M12": {
      const ud7 = ud7HeaderClaim(ctx);
      const floorIds = ["UO1"];
      if (obj.isScored && obj.snapshot) floorIds.push("UO2");
      return {
        header: ud7
          ? { entryId: "UD7", claim: ud7, gloss: null }
          : { entryId: "UG-whereItStands", claim: "Where this stands.", gloss: null },
        floorIds,
        cap: 4,
      };
    }

    case "M9":
    default: {
      // Floor = UO1 + (UO2 when scored) + (UO4 when it honestly resolves). UO1 always resolves, so the
      // floor is guaranteed. Anonymous gets the SAME orientation floor with no signed-in mention (UG8).
      // ⚠ UO4 IS NOT FLOOR (§2.3 M9 floor fix). It used to be reserved here, which made M9's floor
      // UO1 + UO2 + UO4 against a cap of 4 — three guaranteed entries leaving ONE contested slot,
      // which ELEVATED always won at rungs 3–9. Nothing at rung 10+ could ever appear on an M9 card:
      // echo resolved 25 times and won a single slot across the whole live matrix.
      //
      // The cause was the floor, not the ladder. UO4 says "nothing in your portfolio or watchlist
      // connects to this name or its sector" — a NULL reader fact whose entire purpose is to fill
      // space when nothing better exists. Guaranteeing it regardless of what else is true is exactly
      // backwards. Its low rung (14) already produces the intended behaviour: it appears when the card
      // has nothing reader-relative to say, and yields the moment it does.
      //
      // Floor is now UO1 + UO2 — two guaranteed, two contested. No rung and no cap was changed.
      const floorIds = ["UO1"];
      if (obj.isScored && obj.snapshot) floorIds.push("UO2");
      return { header: { entryId: "UG-newToYou", claim: "New to you.", gloss: null }, floorIds, cap: 4 };
    }
  }
}

/** The negatives for the AI layer (§6.2) — everything that did NOT resolve, because absence is as useful
 *  in a conversation as presence. */
function buildNegatives(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): NegativeFact[] {
  const out: NegativeFact[] = [];
  if (!ctx.identity.isAuthenticated) out.push({ fact: "anonymous", detail: null });
  if (mode.positionAxis !== "HELD") out.push({ fact: "not_held", detail: null });
  if (mode.positionAxis === "WATCHED") out.push({ fact: "watchlisted_not_held", detail: null });
  if (mode.attentionAxis === "FIRST" && ctx.identity.isAuthenticated) out.push({ fact: "first_visit", detail: null });
  if (ctx.identity.isAuthenticated && !ctx.book?.exists) out.push({ fact: "no_portfolio_connected", detail: null });
  // §Phase 4 — now sourced from the REAL peer-group intersection, not a sector-overlap proxy.
  const nb = ctx.neighbourhood;
  if (ctx.book?.exists && nb && nb.pgHeld.filter((h) => !h.isThisObject).length === 0) {
    out.push({ fact: "no_pg_exposure", detail: { peerGroupLabel: obj.peerGroup?.label ?? null, pgSize: nb.pgSize } });
  }
  if (nb && nb.pgWeightPct !== null && nb.pgHeld.length > 0) {
    out.push({ fact: "pg_exposure", detail: { peerGroupLabel: obj.peerGroup?.label ?? null, weightPct: Math.round(nb.pgWeightPct), heldCount: nb.pgHeld.length } });
  }
  if (ctx.book?.hasFundHoldings) {
    out.push({ fact: "lookthrough_unavailable", detail: { note: "reader holds fund/basket products we cannot see through" } });
  }
  // Echo is out of slice: it is never evaluated. Recorded as a negative so the AI never infers a book
  // trait from silence (§3.5.3 / §6.2).
  out.push({
    fact: "echo_not_evaluable",
    detail: { reason: ctx.book?.exists ? "out_of_slice_no_base_rates" : "no_book" },
  });
  return out;
}
