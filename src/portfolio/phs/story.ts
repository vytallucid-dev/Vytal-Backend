// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPOSER (Construction v2 Stage 10b) — the storyboard, composed DETERMINISTICALLY from the
// catalog 10a built. `ADDENDUM_storyboard_narrative_composition.md`.
//
// ── ★ ZERO HOMES, AND THAT IS THE WHOLE ARCHITECTURE ─────────────────────────────────────────────
//
//     A FACT WITH ZERO HOMES CANNOT DRIFT.
//
// The story stores NOTHING. It has no column, no JSONB, no fingerprint of its own
// (`cv2-s9-no-fired-set-hash`). It is a DERIVATION over things that already have homes — `band`,
// `state`, the fired set, the C-ledger — in exactly the way `band` is a derivation over `health` and
// nobody stores a "band history". Every input is already hashed by something else, so the story is
// correct by construction the instant its inputs are: there is no second copy to fall out of step and
// no backfill to run when a finding changes its mind.
//
// ⚠ IF YOU ARE HERE TO PERSIST IT — for a "story history", or to save recomputation — that is the
// move this comment exists to stop. A stored story is a claim about someone's money frozen at a
// moment, re-served forever, while every fact under it moves. It is PD7's bug (`oldestSyncAgeDays =
// f(now)` with no time in the fingerprint) applied to four paragraphs instead of one sentence.
//
// ── ★ DETERMINISTIC. THE GEMINI LAYER DOES NOT WRITE THIS. (§7 — ruled) ──────────────────────────
//
//   1. IDENTICAL BOOKS MUST PRODUCE IDENTICAL STORIES. The storyboard is a STATEMENT OF FACT about
//      someone's money. It cannot vary by sampling. `verify-phs-story.ts` asserts byte-for-byte
//      equality across runs — the property that separates a statement from a generation.
//   2. Free prose over financial data is exactly where "you should trim" leaks in. ★ EVERY
//      NON-NEGOTIABLE HERE — never advise, never predict, never juxtapose health against returns — IS
//      ENFORCEABLE IN A GRAMMAR AND UNENFORCEABLE IN A GENERATION. The advice-verb grep can prove a
//      composer cannot emit a sentence the guard rejects. It cannot prove that of a model.
//   3. The Portfolio Doctor is a different job: a CONVERSATION (asked, scoped, guarded). The
//      storyboard is a STATEMENT — unasked, and therefore held to a higher bar.
//
// Deterministic does not mean robotic. It means the connectives are chosen by LOGIC instead of by
// vibes, which is what makes the story honest.
//
// PURE. No DB, no I/O, no clock, no randomness — the caller passes everything in. (`Date.now()` and
// `Math.random()` would each break byte-for-byte determinism; there is no call for either here, and
// the verify asserts the output is stable across runs rather than trusting that.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { PfFinding, Tone } from "./patterns.js";
import type { EntityLedgerEntry, BasketEntry } from "./entity.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// MOVEMENT ELIGIBILITY (§9.2) — DECLARED, EXHAUSTIVE, NO CATCH-ALL.
//
// ⚠ THE SAME RULING AS `FINDING_HOME`, FOR THE SAME REASON, AND IT IS NOT A COINCIDENCE. That map
// used to be a Set plus a default, and the default silently filed facts about US as judgments about
// THEM for an entire stage. A default here is worse: it does not mis-file a finding into the wrong
// panel, it puts an unreviewed sentence in a STORY — the one artifact a user reads as our considered
// view of their money.
//
// So an unknown family THROWS. It is never data drift: the fired set is written by our own
// `firePortfolioFindings` and `fireInstrumentFindings`, so an unrouted family is always a developer
// who added one and did not come here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export type Movement = 1 | 2 | 3 | 4;
export type MovementHome = Movement | "reference";

const MOVEMENT_HOME: Record<string, MovementHome> = {
  /** 1 · What you hold — the book, before any judgment. */
  PA: 1,
  /** 2 · What we can judge — coverage, and why not the rest. */
  PV: 2,
  PE: 2,
  /** 3 · The two reads — do the numbers agree? PX6 is the hinge into 4 (§6). */
  PX: 3,
  /**
   * ⚠ PQ AND PS ARE NOT IN §9.2's LIST AT ALL — drift #14, caught by this map's throw on the FIRST
   * real book it ran against (`4c5ca537` fires PS5).
   *
   * The addendum's §9.2 enumerates "PA → 1. PV/PE → 2. PX → 3. PC/PB/PI → 4. PD → reference only" and
   * stops. `patterns.ts` emits PQ (quality composition — the health distribution across scored
   * holdings) and PS (signals — red flags) too, and both fire on live books. Composed against §9.2
   * verbatim, the composer throws on any book with a red-flag finding, which is most of them.
   *
   * ★ THEY BELONG TO MOVEMENT 3, AND THE MOVEMENT'S OWN QUESTION SETTLES IT: *"What do the numbers say,
   * and do they agree?"* PQ is the shape of the Quality pillar; PS is the Signals pillar. They ARE the
   * numbers movement 3 is about — PX is simply the family that speaks when they DISAGREE. Filing them
   * anywhere else would put a pillar's own finding outside the movement that reports the pillars.
   *
   * (Neither carries a `storyClause` today, so neither is selected into prose — they render in the
   * reference. That is a fact about their copy, not about their home, and the two must not be confused:
   * a family with no home is a build error the day someone writes it a clause.)
   */
  PQ: 3,
  PS: 3,
  /** 4 · The point — the one or two things that actually matter. */
  PC: 4,
  PB: 4,
  /** ★ PI joins movement 4 (addendum §9.2). A 12% ETF premium DEDUCTS NOTHING and is still the most
   *  actionable fact on the page — §11.2: "PI outranks by usefulness, not by tone." That is the point
   *  of separating prominence from arithmetic, and it is spent here. */
  PI: 4,
  /** ★ PD → REFERENCE ONLY, ALWAYS. A PD finding describes VYTAL, not the book
   *  (`cv2-s10a-pd-read-time`); a story about someone's money is not where our data gaps belong.
   *  Enforced TWICE, deliberately: by this declaration, and STRUCTURALLY by `storyClause` — no PD
   *  finding carries one, so none is eligible even if this line were wrong. */
  PD: "reference",
};

export function movementOf(f: PfFinding): MovementHome {
  const m = MOVEMENT_HOME[f.family];
  if (!m) {
    throw new Error(
      `composeStory: finding ${f.id} has family "${f.family}", which declares no movement. Add it to ` +
        `MOVEMENT_HOME — 1 (what you hold) · 2 (what we can judge) · 3 (the two reads) · 4 (the point) ` +
        `· "reference" (it describes OUR DATA, not the book). Do NOT add a default: an unreviewed ` +
        `sentence in a story is worse than a mis-filed card in a panel.`,
    );
  }
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE TOTAL ORDER — tone → weight-if-present → id ascending.
//
// ── WHY THE SPEC'S RULE IS NOT COMPUTABLE AS WRITTEN ────────────────────────────────────────────
//
// §5 rule 1: *"Ranked: Concern > Caution > Neutral, and within a tone, HIGHER CAPITAL WEIGHT FIRST."*
// Measured against the catalog that exists: **FIVE OF THE THIRTEEN movement-4 PC/PB findings carry no
// capital weight at all** — PC5, PB1, PB2, PB3 and PB7 bind `neff` / `holdingCount`, which are SHAPES
// of the book, not SHARES of it. The rule has nothing to compare them on.
//
// ⚠ AND A MISSING TIEBREAK IS NOT A COSMETIC GAP — IT BREAKS §7's RULE 1 SILENTLY. `Array.prototype.sort`
// is only stable with respect to the input order, and the input order is the order findings happened to
// fire. Two equally-ranked candidates would resolve by accident, and the accident is reproducible only
// until someone reorders a `push` in `patterns.ts`. "Identical books must produce identical stories"
// would then be false in a way no test catches, because a test on one machine on one day sees one order.
// **`id` ascending is the terminating key: it is total, stable, and carries no meaning — which is what a
// tiebreak should be.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Concern > Caution > Neutral > Constructive. §5 rule 1 names the first three; Constructive is last
 *  and still ELIGIBLE — §5 rule 2: "a Constructive finding can carry movement 4 alone." A well-built,
 *  fully-verified book's story is *"nothing here needs your attention"*, and that is a complete and
 *  valuable movement 4 rather than an empty one. */
const TONE_RANK: Record<Tone, number> = { Concern: 0, Caution: 1, Neutral: 2, Constructive: 3 };

/**
 * ★ THE CAPITAL WEIGHT — PER FINDING, WITH ITS SCALE. NOT `bind.weight ?? 0`.
 *
 * ── ⚠ TRAP ①: THE WEIGHT IS UNDER THREE DIFFERENT KEYS, AND TWO DIFFERENT SCALES ────────────────
 *
 *     PC1/PC2/PC3/PC4/PC8  `weight`         — a FRACTION  (1.0 = the whole book)
 *     PC6/PC7              `maxHousePct`    — a PERCENT   (60 = 60% of the book)   ← different scale
 *     PB6                  `combinedWeight` — a FRACTION
 *
 * A generic `bind.weight ?? bind.maxHousePct ?? 0` compares 60 against 1.0 and ranks a 60%-one-house
 * book ABOVE a 100%-single-position book — sorting a percent against a fraction, silently, in the
 * comparator that decides what a user reads first. Normalising per finding is the only way the axis
 * means one thing. (Measured off `patterns.ts`; `maxHousePct` is raw-uncapped by C5's own design.)
 *
 * ── ⚠ TRAP ②: `?? 0` IS NOT A NEUTRAL DEFAULT — IT IS A FALSE STATEMENT ─────────────────────────
 *
 * PC5's subject is `neff` over the whole name-risk sleeve. Defaulting its weight to 0 asserts THE
 * FINDING IS ABOUT 0% OF THE BOOK, when it is about ALL of it. The default is not merely arbitrary; it
 * is backwards — and it would rank a whole-book fact below every named position by pretending the
 * whole book is nothing.
 *
 * ★ SO THE HONEST ANSWER IS THAT THE AXIS DOES NOT APPLY. `null` means "this finding is not a share of
 * the book, and asking how big it is, is a category error." Unweighted findings are ordered among
 * themselves by `id` and placed after the weighted ones — we rank what we measured above what we did
 * not, and we do not fabricate a number to make the sort typecheck. (`?? 0` and this rule produce the
 * SAME ORDER today. The difference is that one of them is true, and stays true when someone adds a
 * finding whose weight is genuinely 0.)
 */
const CAPITAL_WEIGHT: Record<string, ((bind: Record<string, unknown>) => number) | null> = {
  // ── PC — a named subject and its share ──
  PC1: (b) => b.weight as number,
  PC2: (b) => b.weight as number,
  PC3: (b) => b.weight as number,
  PC4: (b) => b.weight as number,
  PC6: (b) => (b.maxHousePct as number) / 100, // ★ percent → fraction. See trap ①.
  PC7: (b) => (b.maxHousePct as number) / 100,
  PC8: (b) => b.weight as number,
  PB6: (b) => b.combinedWeight as number,
  // ── the five with NO capital weight. Book SHAPES, not book SHARES. See trap ②. ──
  PC5: null, // neff over the name-risk sleeve
  PB1: null, // neff + maxSectorWeight — a spread, not a share
  PB2: null, // holdingCount
  PB3: null, // holdingCount
  PB7: null, // neffUnit / neffSector — a ratio of two spreads
  // ── PI — instrument facts. ★ NONE carries a capital weight, and that is a FACT ABOUT THE FAMILY,
  //    not an oversight. A PI finding is fired from the CATALOG (`facts`/`analytics`), which holds no
  //    market value — `fireInstrumentFindings` never sees what a holding is worth. So PI cannot know
  //    whether its ETF is 0.2% of the book or 40%, and must not guess. They rank by tone, then id.
  //    ⚠ IF PI EVER NEEDS TO OUTRANK BY SIZE, the fix is to give the loader the weight — not to invent
  //    one here from a `premium` or a `maxDrawdown`, neither of which is a share of anything.
  PI1: null, PI2: null, PI3: null, PI4: null, PI5: null, PI6: null, PI7: null, PI8: null,
};

/** The capital weight, or null when the axis does not apply. Throws for an unknown movement-4 finding —
 *  same ruling as `movementOf`: a finding nobody ranked would sort by accident, and the accident would
 *  be invisible. */
export function capitalWeightOf(f: PfFinding): number | null {
  if (!(f.id in CAPITAL_WEIGHT)) {
    throw new Error(
      `composeStory: movement-4 finding ${f.id} declares no capital-weight rule. Add it to ` +
        `CAPITAL_WEIGHT — a function reading the bind key that carries its share of the book ` +
        `(NORMALISED to a fraction), or null if it is a shape of the book rather than a share of it. ` +
        `Do NOT default to 0: that asserts the finding is about 0% of the book.`,
    );
  }
  const get = CAPITAL_WEIGHT[f.id]!;
  if (get === null) return null;
  const w = get(f.bind);
  return Number.isFinite(w) ? w : null; // a malformed bind is "unweighted", never a fabricated 0
}

/**
 * ★ THE TOTAL ORDER. Deterministic, total, and stable under any input permutation — asserted by
 * shuffling the fired set in `verify-phs-story.ts` and requiring the same output.
 *
 * tone → (weighted before unweighted) → weight DESC → id ASC.
 */
export function compareFindings(a: PfFinding, b: PfFinding): number {
  const t = TONE_RANK[a.tone] - TONE_RANK[b.tone];
  if (t !== 0) return t;
  const wa = capitalWeightOf(a);
  const wb = capitalWeightOf(b);
  if (wa !== null && wb === null) return -1; // measured outranks not-applicable
  if (wa === null && wb !== null) return 1;
  if (wa !== null && wb !== null && wa !== wb) return wb - wa; // higher share first
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // the terminating key — total, stable, meaningless
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ CROSS-AXIS SELECTION — movement 4's two slots must describe DISTINCT SUBJECTS.
//
// ── THE LIVE CASE THAT PROVES THE RULE HAS TO EXIST: `4c5ca537` ─────────────────────────────────
//
// One holding. TCS, 100% of the book, sector `it_technology`. It fires:
//
//     PC2 · Concern · "Dominant single position"  — bind.symbol = TCS,             weight 1.0
//     PC4 · Concern · "Single-sector book"        — bind.sector = it_technology,   weight 1.0
//
// The total order alone takes BOTH (same tone, same weight, PC2 first by id) and movement 4 reads:
// *"TCS is 100% of your book. And IT is 100% of your book."* ★ THAT IS ONE HOLDING DESCRIBED TWICE.
// The entity ledger says so outright — TCS's `sector` IS `it_technology`, so the constituent set of
// the sector and the constituent set of the position are THE SAME SET: `{TCS}`.
//
// ⚠ AND NO EXISTING RULE CATCHES IT. §11.1's anti-double-count suppresses along ONE AXIS — PC2
// suppresses PC1 (same position, two intensities), PC4 suppresses PC3 (same sector, two intensities).
// Both did their job here: PC1 and PC3 are already gone. PC2 and PC4 survive because they are on
// DIFFERENT AXES — position vs sector — and the suppression model has no opinion about two axes that
// happen to resolve to the same holdings. **The redundancy is not in the findings. It is in the book.**
//
// ── ★ WHY THIS IS SELECTION AND NOT SUPPRESSION, AND THE DISTINCTION IS THE WHOLE RULE ──────────
//
// PC4 is TRUE. A single-sector book IS a fact, and on a 12-holding all-pharma book it is the ONLY way
// to say what is wrong — the position axis would be silent. It keeps firing, it keeps its tone, and it
// renders in the reference. **The story just doesn't say the same thing twice.** *"The story picks."*
//
// So: take the higher-ranked candidate and MOVE ON — the loser is not marked, not dropped, not
// suppressed. Nothing about the fired set changes. This is a property of one paragraph, not of the
// catalog, which is exactly why it lives in the composer and not in `patterns.ts`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** What the composer needs to trace a finding's subject back to the holdings it is about. All of it
 *  already has a home in `construction_data`; none of it is recomputed here. */
export interface SubjectContext {
  entityLedger: EntityLedgerEntry[];
  basketLedger: BasketEntry[];
  /** Every held symbol — the whole-book subject, for findings whose subject IS the book. */
  allSymbols: string[];
  /** The name-risk sleeve's symbols — the subject of every breadth finding (`neff` is measured over
   *  entities, and entities are the name-risk sleeve). NOT the whole book: a breadth finding on a book
   *  that is half gold is about the half that has companies in it. */
  nameRiskSymbols: string[];
}

/**
 * ★ A FINDING → THE SET OF HOLDINGS IT IS ACTUALLY ABOUT. The spec: *"Trace `firedSubject` to its
 * constituent set; if two candidates resolve to the same holdings, take the higher-ranked and move on."*
 *
 * ⚠ IT TRACES THROUGH THE LEDGER, NEVER THROUGH THE LABEL. Comparing `bind.sector` to `bind.symbol` as
 * strings answers "are these the same words" — the question is "are these the same MONEY". `it_technology`
 * and `TCS` share no characters and are the same holding. The entity ledger already carries the mapping
 * (`EntityLedgerEntry.sector`), so the trace reads it.
 *
 * Returns `null` ⇔ the subject is not traceable to a holding set. ★ NULL IS NEVER "no collision" — a
 * finding whose subject we cannot resolve is one we cannot prove is distinct, and `sameSubject` treats
 * it as colliding with nothing rather than with everything. The one caller that matters
 * (`selectMovement4`) therefore lets it through, which is the SAFE failure: an unresolvable subject is a
 * bug in this map, and the visible symptom (a story that says one thing twice) is exactly what the
 * verify asserts against.
 */
export function subjectSetOf(f: PfFinding, ctx: SubjectContext): Set<string> | null {
  const b = f.bind;
  switch (f.id) {
    // ── the position axis: a named entity → every instrument of that issuer ──
    // ★ THE ENTITY, NOT THE SYMBOL. `bind.symbol` is ONE instrument; the entity it belongs to may hold
    // several (NTPC shares + an NTPC bond). PC8's whole point is that those are one company, so a
    // position-axis subject that returned only `{NTPC}` (the stock) would read as distinct from PC8's
    // `{NTPC, NTPC-bond}` — and the story would say "your largest holding is NTPC" then "you hold two
    // instruments of NTPC" as though they were two subjects.
    case "PC1":
    case "PC2": {
      const sym = b.symbol as string;
      const e = ctx.entityLedger.find((x) => x.constituentInstruments.some((c) => c.symbol === sym));
      return e ? new Set(e.constituentInstruments.map((c) => c.symbol)) : new Set([sym]);
    }
    case "PC8": {
      const e = ctx.entityLedger.find((x) => x.entityKey === (b.entityKey as string));
      return e ? new Set(e.constituentInstruments.map((c) => c.symbol)) : null;
    }
    // ── the sector axis: a sector → every entity resolved to it → their instruments ──
    case "PC3":
    case "PC4": {
      const sector = b.sector as string;
      const syms = ctx.entityLedger
        .filter((e) => e.sector === sector)
        .flatMap((e) => e.constituentInstruments.map((c) => c.symbol));
      return syms.length ? new Set(syms) : null;
    }
    // ── the house axis: a fund house → its funds. `constituents` is bound; read it, don't re-filter. ──
    case "PC6":
    case "PC7":
    case "PB6": {
      const cons = (b.constituents ?? []) as Array<{ isin?: string; name?: string }>;
      const syms = cons.map((c) => c.isin).filter((x): x is string => !!x);
      return syms.length ? new Set(syms) : null;
    }
    // ── the breadth axis: the book's SHAPE. Its subject is the sleeve it was measured over. ──
    // ★ THIS IS WHY `4c5ca537`'s MOVEMENT 4 IS ONE SENTENCE AND NOT TWO. On a one-holding book the
    // name-risk sleeve IS {TCS}, so PC5's subject collides with PC2's too — and it should: "your book
    // behaves like 1.0 positions" and "TCS is 100% of your book" are the same sentence with different
    // arithmetic. There is only one thing to say about a book with one thing in it.
    case "PC5":
    case "PB1":
    case "PB3":
    case "PB7":
      return new Set(ctx.nameRiskSymbols);
    case "PB2":
      return new Set(ctx.allSymbols);
    // ── PI — one instrument, always. The isin IS the subject. ──
    case "PI1": case "PI2": case "PI3": case "PI4": case "PI5": case "PI6": case "PI7":
      return b.isin ? new Set([b.isin as string]) : null;
    // ★ PI8 IS BOOK-LEVEL AND ITS SUBJECT IS THE DEBT IT NAMED — not the whole book, and not one bond.
    // It binds the holdings it could place; the ones it excluded are not its subject (it says so).
    case "PI8": {
      const hs = (b.holdings ?? []) as Array<{ isin?: string }>;
      const syms = hs.map((h) => h.isin).filter((x): x is string => !!x);
      return syms.length ? new Set(syms) : null;
    }
    default:
      return null;
  }
}

/** Two subjects are the same when they are the same SET of holdings. Not "overlapping" — the same.
 *
 *  ⚠ OVERLAP WAS THE FIRST INSTINCT AND IT IS WRONG. A 40%-pharma book where one pharma name is 20%
 *  fires PC1 (`{SUNPHARMA}`) and PC3 (`{SUNPHARMA, CIPLA, DRREDDY}`). Those OVERLAP, and they are two
 *  genuinely different facts: "one name is heavy" and "the sector is heavy" are different sentences
 *  with different remedies, and a story that told only the first would be hiding the second. Collapsing
 *  on overlap silences the sector fact on every book where a sector has a big name in it — which is
 *  most of them. **Identity is the test; the sets must be EQUAL.** */
export function sameSubject(a: Set<string> | null, b: Set<string> | null): boolean {
  if (!a || !b) return false; // unresolvable ⇒ cannot prove identical ⇒ not the same
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * ★ MOVEMENT 4 — AT MOST TWO, DISTINCT SUBJECTS. §5 rule 1.
 *
 * *"A third thing is a list, and a list is a form."* And: **A SHORT STORY IS A VALID STORY.** Padding it
 * is how we'd become every other tracker — so this returns 0, 1 or 2 and never reaches for a filler.
 *
 * Everything not selected is NOT suppressed: it fires, it keeps its tone, it renders in the reference,
 * ranked. `selectMovement4` returns what the story SPENDS; `reference` below returns everything.
 */
export function selectMovement4(candidates: PfFinding[], ctx: SubjectContext): PfFinding[] {
  const ranked = [...candidates].sort(compareFindings);
  const picked: PfFinding[] = [];
  const subjects: Array<Set<string> | null> = [];
  for (const f of ranked) {
    if (picked.length >= 2) break; // at most two. The rest wait in the reference.
    if (!f.storyClause) continue; // ★ no clause ⇒ not story-eligible BY CONSTRUCTION (see §4/PD).
    const s = subjectSetOf(f, ctx);
    if (subjects.some((prev) => sameSubject(prev, s))) continue; // same holdings, already said. Move on.
    picked.push(f);
    subjects.push(s);
  }
  return picked;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE LIMITATION RULE (§5 rule 3) — the one that fixes the Nifty Bank ETF mistake.
//
//     A LIMITATION ENTERS THE STORY ONLY WHEN IT CHANGES HOW TO READ A NUMBER THAT IS ALREADY IN THE
//     STORY. OTHERWISE IT IS REFERENCE.
//
// The addendum's §1 is blunt about what went wrong: a panel titled "The facts nobody gives you" that
// contained *"your Nifty Bank ETF gives you banking exposure our sector reading can't see."* ★ THAT IS
// OUR LIMITATION, DRESSED AS A GIFT. Nobody else tells the user that because it is not worth telling
// them. It is a disclosure. Presenting it as value is the self-flattery this platform exists not to do.
//
// ── ★ THE PREDICATE IS `sectors.sectoredShare` — AN EXISTING MEASUREMENT, NOT A NEW JUDGMENT ────────
//
// `sectoredShare` = Σ weight over holdings whose sector RESOLVED, over the whole book (`entity.ts`).
// It is already computed, already persisted, already what C3/C4 scale their charge by. So the rule is
// arithmetic over a number that has a home, not a fresh opinion:
//
//     baskets 12% → sectoredShare ~88% → the sector figure covers most of the book → REFERENCE.
//                   "we can't see into your Nifty Bank ETF" changes nothing about how to read it.
//     baskets 60% → sectoredShare ~40% → the sector figure covers almost none of it → STORY.
//                   "the sector number above reflects 40% of your money" changes how to read a number
//                   the user is looking at RIGHT NOW.
//
// ⚠ AND IT IS CONDITIONED ON THE NUMBER BEING IN THE STORY — that is the whole rule, not a detail. A
// book with sectoredShare 40% and NO sector finding in movement 4 has no sector number on screen for
// the limitation to qualify. Firing it anyway is the Nifty Bank mistake again: a disclosure with
// nothing to disclose about, promoted to prose.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Below this, the sector figure describes a minority of the book and a sector claim needs its scope
 *  said out loud. ★ NOT A NEW THRESHOLD — it is `C5_HOUSE_UNKNOWN_KILL`'s sibling reasoning at the
 *  same 50% line the codebase already uses for "we can see less than half of this, so the reading is
 *  about a corner rather than the whole". The addendum's own two examples (88% → reference, 40% →
 *  story) sit either side of it and neither is near it, so the cut is not what decides them. */
const SECTOR_SCOPE_LIMIT = 0.50;

/** Does a sector claim in movement 4 need its scope named? Pure arithmetic over a persisted fact. */
export function sectorLimitationApplies(sectoredShare: number, movement4: PfFinding[]): boolean {
  const hasSectorClaim = movement4.some((f) => f.id === "PC3" || f.id === "PC4" || f.id === "PB7");
  return hasSectorClaim && sectoredShare < SECTOR_SCOPE_LIMIT;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STITCHING (§6) — the connective is chosen by THE RELATIONSHIP BETWEEN THE TWO FACTS, not by a shuffle.
//
//   agreement   → "and", "which is why"
//   tension     → "but", "though"
//   explanation → "— not because…, but because…"
//   scope       → "of that", "that slice"
//
// ★ PX6 IS THE TENSION HINGE, and it is not a stylistic preference — it is what the finding IS FOR.
// "Your money is spread across what you hold at 51. One specific thing moved it to 21." The gross/net
// gap exists precisely to say *your spread is fine, BUT one specific thing moved the number* — so when
// it fires it is almost always the hinge between movement 3 and movement 4. `4c5ca537`'s gap is 30.00
// and, before 10a, nothing said so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface StoryInput {
  /** Everything that fired — persisted set + read-time (PE6/PI). PD included; it is filtered to the
   *  reference here rather than by the caller, so no caller can forget. */
  findings: PfFinding[];
  /** The Health read. `null` ⇔ no scored holdings (coverage 0) — a fact, not a gap. */
  health: number | null;
  band: string | null;
  /** Σ scored value ÷ total. Movement 2's subject. */
  coverage: number;
  /** The displayed Construction (C1–C6 Net) and its gross. Movement 3's subject. */
  constructionNet: number;
  /** Σ weight over sector-RESOLVED holdings, whole-book denominator. The limitation predicate. */
  sectoredShare: number;
  /** The ledgers — for the subject trace. Already in `construction_data`; nothing is recomputed. */
  entityLedger: EntityLedgerEntry[];
  basketLedger: BasketEntry[];
  allSymbols: string[];
  nameRiskSymbols: string[];
}

export interface StoryMovement {
  movement: Movement;
  text: string;
  /** The finding ids this movement SPENT. Everything else is in `reference` — nothing is dropped. */
  used: string[];
}

export interface Storyboard {
  movements: StoryMovement[];
  /** The whole story, stitched. ★ THE BYTE-FOR-BYTE DETERMINISM SUBJECT (§7 rule 1). */
  text: string;
  used: string[];
  /** ★ EVERY fired finding, ranked. NOTHING IS SUPPRESSED; things are just ranked (§9.3). The story
   *  picks; the reference keeps. A finding the story spent is STILL HERE — the reference is the
   *  catalog, and a catalog with holes is not a catalog. */
  reference: PfFinding[];
}

const one = (fs: PfFinding[], id: string) => fs.find((f) => f.id === id);

/**
 * ★ THE PERSISTED MOVEMENT-4 FAMILIES — the ones whose EVERY member carries a `storyClause` in Stage
 * 10b (asserted, `verify-phs-story.ts` §7). A member of one of these WITHOUT a clause can therefore only
 * be a finding persisted BEFORE 10b existed. PI is the OTHER movement-4 family, and it is deliberately
 * NOT here: PI is read-time (always re-fired fresh, so never stale) and only its headline members carry
 * clauses — a clause-less PI finding is texture, not a stale row. See `isPreStoryboardSnapshot`.
 */
const STORY_CLAUSE_REQUIRED_FAMILIES = new Set(["PC", "PB"]);

/**
 * ★★ THE PRE-10b DETECTOR — the difference between a genuine all-clear and a stale snapshot.
 *
 * ── WHY THIS EXISTS (the failure it prevents) ────────────────────────────────────────────────────
 *
 * `storyClause` rides on the PERSISTED finding. A snapshot fired before Stage 10b carries PC/PB findings
 * with NO clause, so `selectMovement4` skips every one and movement 4 comes up empty — on a book that may
 * be **100% in one stock**. The story then renders movements 1–3 and STOPS, and if PX6 fired, movement 3
 * dangles: *"on that alone you'd read 51"* with no payoff. A reader sees a setup with no point and
 * concludes there is none. That is the ONE failure mode no later finding corrects
 * (`cv2-s9-constructive-most-conditioned`): **the user stops reading.** Every other tone survives being
 * wrong; a false "nothing to see here" does not.
 *
 * ── WHY IT IS DISTINGUISHABLE, AND NOT A GUESS ──────────────────────────────────────────────────
 *
 * A genuine quiet book has NO movement-4 candidate that was dropped for a missing clause — either it has
 * no PC/PB candidates at all (nothing notable), or its PB1 all-clear fired WITH a clause and was selected.
 * A pre-10b book has PC/PB candidates that exist and were skipped SOLELY because their clause is absent.
 * "candidates skipped for a missing clause" ≠ "no candidates" ≠ "an all-clear was selected" — three
 * structurally different states, and only the first is a stale snapshot. Because every fresh PC/PB finding
 * carries a clause, a clause-less one is unambiguous: it predates 10b.
 *
 * ── WHY null, NOT A PARTIAL STORY ────────────────────────────────────────────────────────────────
 *
 * The honest degrade is the SAME as a pre-Stage-9 row (no basket ledger): serve no story, let the
 * snapshot's next recompute populate it, and leave the two panel reads and the reference — which surface
 * the concentration directly — untouched. A narrative missing its climax should not ship.
 */
export function isPreStoryboardSnapshot(findings: PfFinding[]): boolean {
  return findings.some((f) => STORY_CLAUSE_REQUIRED_FAMILIES.has(f.family) && f.storyClause == null);
}

/**
 * ★ THE COMPOSER. Four movements, stitched, deterministic. Returns null when no coherent story can be
 * told — a pre-10b snapshot (`isPreStoryboardSnapshot`), degrading exactly as a pre-Stage-9 row does.
 *
 * Movements 1–3 set up; **movement 4 pays off** (§3). The ORDER is fixed; the EMPHASIS is not — a
 * fund-led book spends its words in movement 2 because SCOPE IS THE STORY; a concentrated stock book
 * spends them in movement 4 because the concentration is. That dynamism is not a knob: it falls out of
 * which findings fired, which is why the composer has no "style" parameter to get wrong.
 */
export function composeStory(v: StoryInput): Storyboard | null {
  // ★ REFUSE TO TELL A STORY WE KNOW IS MISSING ITS POINT. A pre-10b snapshot's PC/PB findings have no
  // clause, so movement 4 would be silently empty — a false all-clear on a possibly-concentrated book.
  if (isPreStoryboardSnapshot(v.findings)) return null;
  const ctx: SubjectContext = {
    entityLedger: v.entityLedger,
    basketLedger: v.basketLedger,
    allSymbols: v.allSymbols,
    nameRiskSymbols: v.nameRiskSymbols,
  };
  // ★ PD IS PARTITIONED OUT HERE, BY DECLARATION, BEFORE ANY MOVEMENT SEES IT — and again by
  // `storyClause` inside `selectMovement4`. Two locks: this one is legible, that one is structural.
  const story = v.findings.filter((f) => movementOf(f) !== "reference");
  const movements: StoryMovement[] = [];

  // ── MOVEMENT 1 · What you hold. PA1 is unconditional — the book, before any judgment. ──
  const pa1 = one(story, "PA1");
  if (pa1?.read) movements.push({ movement: 1, text: pa1.read, used: ["PA1"] });

  // ── MOVEMENT 2 · What we can judge — and why not the rest. ──
  //
  // ⚠ PV3 IS RETIRED AND THE ADDENDUM CITES IT (drift #13). §3's feeder column reads "coverage, PV6,
  // PV2/PV3" — but PV3 ("Confidence-limited read") died in spec 1.2 Change 3 when the coverage ceiling
  // was retired: `patterns.ts` says so at its site. Composing against the addendum verbatim would feed
  // this movement from a finding that cannot fire. PV2 is the live one.
  const m2: string[] = [];
  const used2: string[] = [];
  const pct0 = (x: number) => `${Math.round(x * 100)}%`;
  if (v.health != null && v.coverage > 0) {
    // ★ THE "scope" CONNECTIVE (§6) — "that slice". Movement 2's job on a fund-led book is to say the
    // health number is about a CORNER, and the connective is what carries that rather than a caveat.
    m2.push(
      v.coverage >= 0.999
        ? `We can read the health of all of it, and it scores ${v.health} — ${(v.band ?? "").toLowerCase()}.`
        : `We can read the health of about ${pct0(v.coverage)} of it. That slice scores ${v.health} — ${(v.band ?? "").toLowerCase()}.`,
    );
  }
  const pv6 = one(story, "PV6");
  if (pv6?.read) { m2.push(pv6.read); used2.push("PV6"); }
  const pv2 = one(story, "PV2");
  if (pv2 && v.coverage > 0 && v.coverage < 0.999) used2.push("PV2"); // its fact is already in the sentence above
  if (m2.length) movements.push({ movement: 2, text: m2.join(" "), used: used2 });

  // ── MOVEMENT 3 · The two reads. Construction, and PX6 as the hinge into 4. ──
  const m4 = selectMovement4(story.filter((f) => movementOf(f) === 4), ctx);
  const px6 = one(story, "PX6");
  const m3: string[] = [];
  const used3: string[] = [];
  m3.push(`Construction covers the whole book, and it reads ${Math.round(v.constructionNet)}.`);
  if (px6) {
    // ★ THE HINGE, IN §8's OWN SHAPE: *"Your money is spread reasonably across the six things you hold
    // — ON THAT ALONE YOU'D READ 89."* The counterfactual is the whole trick. It states the gross as
    // the number the book WOULD have read on spread alone, which leaves the gap standing in the
    // reader's mind unresolved — and movement 4 resolves it. A flat "your spread is 51 and your score
    // is 21" states both numbers and connects nothing; this states one number and OWES an explanation.
    //
    // ⚠ THE ORDER IS LOAD-BEARING AND THE FIRST DRAFT HAD IT BACKWARDS ("reads 21. Spread at 51.").
    // That sequence answers before it asks. Net first (the number they came for), then the
    // counterfactual (the tension), then movement 4 (the resolution) — set-up, tension, pay-off, which
    // is what makes this a story rather than two facts sharing a paragraph.
    const gross = px6.bind.constructionGross as number;
    m3.push(`Your money is spread across what you hold — on that alone you'd read ${Math.round(gross)}.`);
    used3.push("PX6");
  }
  if (m3.length) movements.push({ movement: 3, text: m3.join(" "), used: used3 });

  // ── MOVEMENT 4 · The point. At most two, distinct subjects. ★ A SHORT STORY IS A VALID STORY. ──
  if (m4.length) {
    const clauses = m4.map((f) => f.storyClause!);
    // The SECOND clause is joined by "and" — AGREEMENT (§6): two distinct subjects that are both true
    // of this book. It is not "but": they do not contradict, they accumulate.
    const body = clauses.length === 1 ? `${clauses[0]}.` : `${clauses[0]}. And ${clauses[1]}.`;

    // ★ §5 RULE 2 — A CONSTRUCTIVE MOVEMENT 4 IS FRAMED AS AN ALL-CLEAR, NOT AS A WARNING.
    //
    // ⚠ THE FIRST DRAFT PUT "One thing is worth your attention:" IN FRONT OF EVERY MOVEMENT 4, AND ON A
    // WELL-BUILT BOOK IT PRODUCED: *"One thing is worth your attention: your money is spread across 9.0
    // effective positions with no sector above 22% — nothing here concentrates."* That sentence summons
    // a problem and then reports its absence — it makes a user look for something that is not there, in
    // the one paragraph whose job was to tell them they can stop looking. It is the inverse of PB1's own
    // failure mode (a false all-clear) and just as bad: a false alarm attached to a true all-clear.
    //
    // §5 rule 2 is explicit — *"the story says so and stops"* — so the frame follows the TONE, and the
    // connective follows the RELATIONSHIP (§6): an all-clear AGREES with a sound Construction ("and"),
    // where a defect is in TENSION with it ("but").
    const allConstructive = m4.every((f) => f.tone === "Constructive");
    const hinge = allConstructive
      ? "Nothing here needs your attention:"
      : px6
        ? "But one specific thing moved the number:"
        : "One thing is worth your attention:";
    let text = `${hinge} ${body}`;

    // ★ THE LIMITATION, only if it changes how to read a number that is ON SCREEN (§5 rule 3).
    if (sectorLimitationApplies(v.sectoredShare, m4)) {
      text += ` We can resolve a sector for ${pct0(v.sectoredShare)} of your book, so that sector figure ` +
        `reflects that slice rather than the whole.`;
    }
    movements.push({ movement: 4, text, used: m4.map((f) => f.id) });
  }
  // ⚠ NO ELSE. If nothing earned movement 4 — no point AND no all-clear — THE STORY SIMPLY STOPS. There
  // is no filler sentence, no "otherwise your book looks fine" invented to round the paragraph out, and
  // deliberately no fallback branch here that a future reader could fill in. A SHORT STORY IS A VALID
  // STORY; padding it is how we'd become every other tracker.

  const used = movements.flatMap((m) => m.used);
  return {
    movements,
    text: movements.map((m) => m.text).join(" "),
    used,
    // Ranked, complete, nothing suppressed — INCLUDING what the story spent. PD is here and only here.
    reference: [...v.findings].sort(referenceOrder),
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The reference's order. ★ NOT `compareFindings` — that one throws on any family it has no
 *  capital-weight rule for, because IT ranks movement-4 candidates and an unranked candidate there is a
 *  bug. The reference ranks EVERYTHING, including PD and PE and PA, for which "capital weight" is
 *  meaningless. Tone, then id: total, deterministic, and it makes no claim it cannot support. */
function referenceOrder(a: PfFinding, b: PfFinding): number {
  const t = TONE_RANK[a.tone] - TONE_RANK[b.tone];
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
