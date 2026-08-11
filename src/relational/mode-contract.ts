// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — THE MODE CONTRACT.
//
// Mode used to pick only a header, a floor, and a cap; every other family was drawn from one global pool
// that did not know which mode it was in. This file makes mode govern the whole card: one declaration per
// mode, in one place, holding four things — header, floor, cap, and which entry families are ELIGIBLE AT
// ALL. Not a filter applied after assembly — a scope declared before it. `buildEntries` (entries.ts)
// consults `MODE_CONTRACTS[mode.mode].eligible` BEFORE calling any builder; a slot absent from that set
// never has its builder invoked for that mode. `arbitration.ts` never learns about modes any other way —
// it only ever sees `floorIds`/`cap`, already resolved, as plain data.
//
// The `eligible` sets are narrowed to the REAL per-mode table (not a behaviour-neutral superset) — see
// the per-base-set comments below for what each mode excludes and why. UO2 ("Health is about X — Band.")
// and UO3 ("N things standing.") are deleted outright, not merely made ineligible somewhere — see the
// EntrySlot comment. UN8/UG5/UE5/UO4 ("nothing connects" facts) are eligible as declared here but do not
// automatically win a slot — arbitration.ts's fill-if-room pass only lets them occupy room nothing else
// claimed (HONEST_NULL_SLOTS below).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ModeId, ReaderContext, ObjectState } from "./types.js";
import type { ResolvedMode } from "./mode.js";
import { ud7HeaderClaim } from "./entries.js";

/** Every builder invocation `buildEntries` can make, named once so the contract and the construction
 *  gate share one vocabulary. Not the same enum as `Family` (types.ts) — `family: "UO"` covers UO1/UO4/
 *  UO6, which need independent per-mode gating (a returning holder loses UO1 but keeps UO4/UO6), so the
 *  contract keys on slot, not family. `UD1`/`UD3` share one gate (`"UD"`) because both are already
 *  co-gated by the same `delta.evaluable`/held precondition; `buildEcho` (array) + `UE5` share `"UE"` for
 *  the same reason (`rates`/`echo` presence); `UH1`/`UH2`/`UH3`/`UH4`/`UH10` share `"heldPositionFamily"`
 *  because they are already co-gated by `mode_isHeld` today and the contract does not split them
 *  further; `buildElevated` (array, one candidate per finding) is `"elevated"`. */
// ⚠ UO2/UO3 DELETED. "Health is about X — Band." and "N things standing." were reader-invariant summary
// lines, redundant with the page's own health section and the findings ELEVATED/UD1 already list
// individually. No EntrySlot member exists for either — the type system enforces the deletion is total.
export type EntrySlot =
  | "UO1"
  | "UO4"
  | "UO6"
  | "UW1"
  | "UN1"
  | "UN2"
  | "UN3"
  | "UN6"
  | "UN7"
  | "UN8"
  | "UG1"
  | "UG5"
  | "UG7"
  | "UG9"
  | "UD"
  | "UE"
  | "heldPositionFamily"
  | "elevated";

/**
 * "Nothing connects" facts (§ eligibility, fill-if-room) — say the reader has no exposure/lift/coverage
 * of this kind, and nothing more. Eligible as usual under the contract, but arbitration.ts never lets
 * one of these WIN a contested slot over real content — it only fills a slot nothing else claimed.
 *
 * Exactly these four, deliberately not more. UG1/UG7/UG9 are a DIFFERENT kind of honesty statement — "we
 * could not check this" (coverage doctrine) rather than "nothing connects" (a reader-relative null) — and
 * coverage doctrine does not yield to a crowded card: a stock we don't score says so whether the card has
 * two entries or twelve. Confirmed with the user; not swept in by family resemblance.
 */
export const HONEST_NULL_SLOTS: ReadonlySet<EntrySlot> = new Set(["UO4", "UN8", "UG5", "UE5" as EntrySlot]);

export interface ModeContract {
  header: (mode: ResolvedMode, ctx: ReaderContext, obj: ObjectState) => { entryId: string; claim: string; gloss: string | null };
  /** Declared floor, IN ORDER — the mode's own statement of relevance for this reader state (§4.2 of the
   *  library: the floor is a rank statement, not an inclusion mechanic). May be conditionally shorter —
   *  see the M2/M4/M10-M12 entries below, where a genuinely empty delta narrows or clears it. */
  floorIds: (mode: ResolvedMode, ctx: ReaderContext, obj: ObjectState) => string[];
  cap: number;
  /** The complete, closed set of builder slots this mode will ever construct a candidate for. A slot
   *  absent here is never attempted for this mode — enforced in `buildEntries`, not filtered afterward. */
  eligible: ReadonlySet<EntrySlot>;
}

// ── Shared building blocks so the table below states only what differs per mode. ──────────────────────
//
// STAGE 4 — eligibility narrowed to the real per-mode table. Three declared exclusions, each named in
// the requirements this change implements:
//
//   · UD excluded from FIRST-attention modes (M1, M5, M9 — verified from mode.ts's grid: HELD×FIRST,
//     WATCHED×FIRST, NEITHER×FIRST). A first-time visitor has no delta. Today UD1/UD3 already self-null
//     whenever delta.evaluable is false, which is definitionally true for FIRST attention (no
//     lastViewedAt exists to diff against) — so this declares what was already true, incidentally, and
//     changes zero live behaviour for those readers.
//
//   · UO1 excluded from the returning-holder modes (M2, M3, M4 — HELD × RETURNING/RECURRING/DORMANT).
//     UO1 is orientation: identity, what the company does. A returning holder does not need identity
//     re-explained; it is noise on the fourth visit. M1 (the true first view) keeps it. UO1 was never in
//     any HELD mode's floor (floor is ["UH1"] in all four), so this only removes it from the rung-14
//     contested pool on M2/M3/M4 — a real, observable content change, reported in the entry-count diff.
//
//   · UW1 excluded from every mode where the position axis cannot be WATCHED (M1-M4 = HELD, M9-M12 =
//     NEITHER). `resolvePosition` (mode.ts) checks watchlist membership BEFORE falling to NEITHER, so
//     `ctx.watchlist?.thisAddedAt` is definitionally unset whenever position is NEITHER or HELD —
//     `buildUW1` can never construct a non-null result in those modes. Excluding it is the literal
//     enforcement of "a builder that can provably never fire for a mode must not run for that mode",
//     not a behaviour change (UW1 always self-nulled there already).
//
// heldPositionFamily is eligible in exactly the HELD modes (M1-M4) and nowhere else — this already
// matched today's `if (mode_isHeld(ctx))` wrapper exactly; declaring it is formalisation, not a change,
// and it is the one gate `buildEntries` also defensively asserts against `ctx.heldThisObject` at runtime
// (assert-and-throw on drift — see entries.ts).

/** HELD modes: M1 (FIRST), M2 (RETURNING), M3 (RECURRING), M4 (DORMANT).
 *
 * ⚠ UW1 IS ELIGIBLE HERE TOO — caught via live-data verification (Vytal-Frontend's "360ONE" named
 * render case, which specifically checks a held-and-watchlisted reader). §2.1 of the library: "if held
 * AND watchlisted, position is HELD and watchlist membership becomes a minor note, NEVER A MODE
 * DRIVER" — that is a statement about the POSITION AXIS/mode selection, not about UW1's eligibility.
 * buildUW1's own comment is explicit: "HELD dominates upstream, so a held+watched reader never reaches
 * the watched modes; this entry stays eligible as a minor note REGARDLESS." Excluding it from HELD_BASE
 * was a real bug, not a formalisation of anything — UW1 self-gates on `ctx.watchlist?.thisAddedAt`
 * (null on a held-not-watched reader), so declaring it eligible here is harmless where it can't fire and
 * correct where it can. */
const HELD_BASE: ReadonlySet<EntrySlot> = new Set<EntrySlot>([
  "UO4", "UO6",
  "UW1",
  "UN1", "UN2", "UN3", "UN6", "UN7", "UN8",
  "UG1", "UG5", "UG7", "UG9",
  "UE",
  "heldPositionFamily",
  "elevated",
]);

/** WATCHED modes: M5 (FIRST), M6 (RETURNING), M7 (RECURRING), M8 (DORMANT). */
const WATCHED_BASE: ReadonlySet<EntrySlot> = new Set<EntrySlot>([
  "UO1", "UO4", "UO6",
  "UW1",
  "UN1", "UN2", "UN3", "UN6", "UN7", "UN8",
  "UG1", "UG5", "UG7", "UG9",
  "UE",
  "elevated",
]);

/** NEITHER modes: M9 (FIRST), M10 (RETURNING), M11 (RECURRING), M12 (DORMANT). */
const NEITHER_BASE: ReadonlySet<EntrySlot> = new Set<EntrySlot>([
  "UO1", "UO4", "UO6",
  "UN1", "UN2", "UN3", "UN6", "UN7", "UN8",
  "UG1", "UG5", "UG7", "UG9",
  "UE",
  "elevated",
]);

const withUD = (base: ReadonlySet<EntrySlot>): ReadonlySet<EntrySlot> => new Set([...base, "UD" as EntrySlot]);

/**
 * The floor-reservation rule for every UD7-firing mode (M2/M3/M4/M10/M11/M12).
 *
 * UD7 ("Nothing new since {date}.") ships with its mode's normal floor in EVERY case but one: a RECURRING
 * reader (≥4 views in 30 days — mode.ts's own threshold, an axis already resolved and previously spent
 * only on routing) who finds a genuinely empty delta does not need the floor RESERVED for them — they
 * already know what's standing, having checked this often. Every other UD7 case (RETURNING, DORMANT, or
 * any NEITHER-with-history reader) still gets "nothing changed" PLUS the short floor: honest and useful.
 *
 * ⚠ THIS DOES NOT PRODUCE AN EMPTY CARD, AND IS NOT DESIGNED TO. Clearing the floor removes the
 * RESERVATION, not the underlying content's eligibility — the ladder still fills freed room from whatever
 * else is genuinely eligible for the mode (confirmed empirically: on M3 this is led by UH1, the position
 * fact itself; on M11 it is UO1/UG7-class content). For a real reader on a real scored stock, something
 * is essentially always eligible, so under realistic inputs this rule never yields to a literal empty
 * `slots` array on any mode — the outcome is uniformly "UD7 header, short slot list led by real content,"
 * never "header and nothing else." Chasing a guaranteed-zero outcome would mean dynamically shrinking a
 * mode's ELIGIBILITY at runtime based on this same condition — rejected: it breaks the one property the
 * whole contract exists to provide, that eligibility is static and readable per mode from the table alone.
 *
 * `nonEmptyFloor` is the mode's normal floor (evaluated when UD7 doesn't fire, OR when it fires but the
 * reader isn't RECURRING). Returns `[]` only when both conditions hold — `service.ts` uses this as an
 * INTERNAL signal only (never a claim about the rendered slot count): `header.entryId === "UD7"`
 * distinguishes an intentionally-cleared floor from a floor that genuinely failed to resolve, which
 * remains a bug. Those are different events; only one is a defect.
 */
function ud7AwareFloor(
  mode: ResolvedMode,
  ctx: ReaderContext,
  nonEmptyFloor: () => string[],
): string[] {
  const ud7 = ud7HeaderClaim(ctx);
  if (ud7 && mode.attentionAxis === "RECURRING") return [];
  return nonEmptyFloor();
}

// ── The twelve-mode table. ───────────────────────────────────────────────────────────────────────────

export const MODE_CONTRACTS: Record<ModeId, ModeContract> = {
  M1: {
    header: () => ({ entryId: "UH6", claim: "You own this — here's what's standing on it.", gloss: null }),
    floorIds: () => ["UH1"],
    cap: 3,
    // FIRST attention: UD excluded (no delta possible). UO1 KEPT — M1 is the true first view, the one
    // case identity genuinely still needs stating.
    eligible: new Set([...HELD_BASE, "UO1" as EntrySlot]),
  },
  M2: {
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UH1-standing", claim: "Your position, and what's changed on it.", gloss: null };
    },
    // Empty-card rule (ud7AwareFloor): the bare header only fires for a RECURRING reader. M2 is
    // RETURNING by construction (mode.ts's grid), so this gate never actually clears the floor here —
    // written as the same shared function as M3/M4/M10-M12 anyway, not a special case, so the rule stays
    // correct if the grid ever changes. M2 always keeps its short floor: "nothing new" plus "here's
    // where it stands", never a bare header.
    floorIds: (mode, ctx) => ud7AwareFloor(mode, ctx, () => ["UH1"]),
    cap: 4,
    // RETURNING: UD eligible. UO1 excluded — a returning holder does not need identity re-explained.
    eligible: withUD(HELD_BASE),
  },
  M3: {
    // ⚠ CONDITIONAL, not the old unconditional "standing" header. M3 is HELD × RECURRING — the one mode
    // where a holder checks often enough to make the empty-card case real. UD7 fires ONLY when the delta
    // is genuinely empty (nothing new, nothing cleared, no new snapshot) — every other visit, this reads
    // exactly as before. The old reasoning ("a reader who checks often does not need a novelty verdict
    // every visit") is the argument FOR this, not against it: they don't need "here's what's standing"
    // restated either, once nothing has changed. This is an ADDED case, not a replacement of the
    // standing framing — the non-empty branch is byte-identical to what M3 always said.
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UH1-standing", claim: "Your position, and what's standing on it.", gloss: null };
    },
    // Same gate as M2/M4/M10-M12 — not a shortcut. M3 is always RECURRING by construction (mode.ts's
    // grid), so the RECURRING half of ud7AwareFloor's condition is structurally guaranteed here, but it
    // is written as the same function, not hardcoded to "M3 always clears on UD7" — if the grid ever
    // changes, one rule survives it.
    floorIds: (mode, ctx) => ud7AwareFloor(mode, ctx, () => ["UH1"]),
    cap: 4,
    // RECURRING: UD eligible. UO1 excluded (returning holder).
    eligible: withUD(HELD_BASE),
  },
  M4: {
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UH1-standing", claim: "Your position, and where it stands now.", gloss: null };
    },
    // Empty-card rule — see M2's comment. M4 is DORMANT (not RECURRING), so in practice this mode never
    // actually produces a bare floor: ud7AwareFloor only clears it for attentionAxis === "RECURRING",
    // and mode.ts's grid means a DORMANT reader can never simultaneously be RECURRING. Kept for symmetry
    // and correctness rather than special-cased away — the function is the single source of truth for
    // the rule, not "every mode except the ones where it's currently a no-op".
    floorIds: (mode, ctx) => ud7AwareFloor(mode, ctx, () => ["UH1"]),
    cap: 4,
    // DORMANT: UD eligible. UO1 excluded (returning holder).
    eligible: withUD(HELD_BASE),
  },
  M5: {
    header: () => ({ entryId: "UW-watching", claim: "You're watching this — here's where it stands.", gloss: null }),
    floorIds: (_m, _ctx, obj) => ["UW1", "UO1"],
    cap: 4,
    // FIRST attention: UD excluded. UO1 kept — a watcher's first visit still needs identity stated.
    eligible: WATCHED_BASE,
  },
  M6: {
    header: () => ({ entryId: "UW-watching", claim: "You're watching this — here's where it stands.", gloss: null }),
    floorIds: (_m, _ctx, obj) => ["UW1", "UO1"],
    cap: 4,
    eligible: withUD(WATCHED_BASE),
  },
  M7: {
    header: () => ({ entryId: "UW-watching", claim: "You're watching this — here's where it stands.", gloss: null }),
    floorIds: (_m, _ctx, obj) => ["UW1", "UO1"],
    cap: 4,
    eligible: withUD(WATCHED_BASE),
  },
  M8: {
    header: () => ({ entryId: "UW-watching", claim: "You're watching this — here's where it stands.", gloss: null }),
    floorIds: (_m, _ctx, obj) => ["UW1", "UO1"],
    cap: 4,
    eligible: withUD(WATCHED_BASE),
  },
  M9: {
    header: () => ({ entryId: "UG-newToYou", claim: "New to you.", gloss: null }),
    floorIds: (_m, _ctx, obj) => ["UO1"],
    cap: 4,
    // FIRST attention: UD excluded. UW1 excluded — position axis cannot be WATCHED here by construction.
    eligible: NEITHER_BASE,
  },
  M10: {
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UG-whereItStands", claim: "Where this stands.", gloss: null };
    },
    floorIds: (_m, _ctx, obj) => ["UO1"],
    cap: 4,
    eligible: withUD(NEITHER_BASE),
  },
  M11: {
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UG-whereItStands", claim: "Where this stands.", gloss: null };
    },
    floorIds: (_m, _ctx, obj) => ["UO1"],
    cap: 4,
    eligible: withUD(NEITHER_BASE),
  },
  M12: {
    header: (_m, ctx) => {
      const ud7 = ud7HeaderClaim(ctx);
      return ud7
        ? { entryId: "UD7", claim: ud7, gloss: null }
        : { entryId: "UG-whereItStands", claim: "Where this stands.", gloss: null };
    },
    floorIds: (_m, _ctx, obj) => ["UO1"],
    cap: 4,
    eligible: withUD(NEITHER_BASE),
  },
};

/** Thin resolver so `buildEntries` has one call site, matching the shape of the `headerAndFloor` call it
 *  replaces. Kept here, next to the table, rather than in entries.ts, so the (eventual) empty-card logic
 *  stays colocated with the data it reads. */
export function resolveHeaderAndFloor(
  mode: ResolvedMode,
  ctx: ReaderContext,
  obj: ObjectState,
): { header: { entryId: string; claim: string; gloss: string | null }; floorIds: string[]; cap: number } {
  const contract = MODE_CONTRACTS[mode.mode];
  return {
    header: contract.header(mode, ctx, obj),
    floorIds: contract.floorIds(mode, ctx, obj),
    cap: contract.cap,
  };
}
