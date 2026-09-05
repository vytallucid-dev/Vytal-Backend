// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TWO PONDS, SIDE BY SIDE — N-1.
//
// ── ⚠ THE BRIEF SAID "REUSE THE SERVICE"; THERE WAS NO SERVICE ────────────────────────────────────
// `compare-route.ts` records it in its own header: "GET /api/compare?a=SYMBOL1&b=SYMBOL2 — the
// stock-vs-stock ComparisonView … PG-vs-PG is a separate later engine — NOT MOUNTED HERE."
// `buildComparisonView` is stock-keyed throughout (`fetchEntity(symbol)`, `a.family === b.family`).
// So the comparison tool does NOT support group-vs-group and never did.
//
// ⚠⚠ AND WE HAVE BEEN TELLING READERS IT DOES. `ai/context-layer.ts` is part of the SYSTEM PROMPT and
//    says COMPARISON is "two stocks, OR TWO PEER GROUPS, side by side". `ai/tone.ts` says that page
//    inventory is the thing that stops the model confabulating features — so an inventory entry with
//    no engine behind it is a confabulation SOURCE. This file is what makes that line true.
//
// ── ★ WHAT IS ACTUALLY REUSED, AND IT IS THE BETTER SUBSTRATE ─────────────────────────────────────
//   · `buildPeerGroupHealthView(id)` — called once per side. It already carries `aggregate.scoredCount`
//     (the denominator Phase 1 · Batch 2 requires on screen), `pillarMedians`, `dispersion`, `range`,
//     `bandDistribution`, AND the two absence states kept apart: `notAtCurrentPeriod` (a member whose
//     reading is a quarter old — excluded from the aggregate) versus `rosterNotScored` (no reading at
//     all). Nothing here recomputes any of that.
//   · `matchPondName` — the pond matcher, PER SIDE. It is documented as refusing rather than guessing
//     ("a near-miss … answers a question about six companies with a different six"), so it is run
//     twice on the two halves of the sentence rather than replaced by a two-pond scorer of my own.
//
// ── ★ COMPARABILITY IS A DIFFERENT QUESTION FOR PONDS, WHICH IS THE §4.1 ANSWER ───────────────────
// The stock comparison's verdict asks "can these two fairly be compared" — same family, same peer
// group. For two ponds that is MEANINGLESS: they are different sets of companies by construction, so
// the answer is always "different" and tells the reader nothing. The pond question is whether EACH
// SIDE HAS A READABLE MEDIAN and whether the two membership counts are close enough that the medians
// mean comparable things. Different question ⇒ different answer ⇒ it is not Comparison's.
//
// ── ⚠ MEASURED BEFORE DESIGNING, AND ONE RESULT CHANGED THE SHAPE ─────────────────────────────────
//   23 peer groups · 13 with ≥2 scored members · **0 with exactly 1** · 10 with none.
// The ponds are cleanly BIMODAL: every scored pond is 100% scored (10/10, 9/9, 8/8 …) and the rest are
// 0/N. So the one-scored-one-not problem does NOT arise inside a pond — there is no partial-median
// denominator case to handle. It arises only at POND level, where one side is readable and the other
// is not, and that is handled the way C handles it for companies: the side is OMITTED WHOLE and named,
// never drawn as an empty half.
//
// Readable for 78 of 253 possible pairs (31%). The answer says which slice it covers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildPeerGroupList } from "../scoring/read/peer-group-view.service.js";
import { buildPeerGroupHealthView } from "../scoring/read/peer-group-view.service.js";
import { matchPondName } from "./peer-group.js";
import { absent, resolved, type Coverage, type DroppedFilter, type Resolved, type Source } from "./contract.js";
import type { PeerGroupAggregate } from "../scoring/read/peer-group-view.types.js";

/** One pond, as this answer needs it. `aggregate === null` ⇒ nothing scored, so no median exists. */
export interface VersusSide {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly aggregate: PeerGroupAggregate | null;
  /** Members carrying an OLDER reading, excluded from the aggregate by the read model. */
  readonly staleMembers: readonly { symbol: string; latestPeriod: string }[];
  /** Members with no reading in any period. */
  readonly unscoredMembers: readonly string[];
}

export interface PeerGroupVersusRead {
  readonly a: VersusSide;
  readonly b: VersusSide;
  /** Both sides have a median that can be read. When false the answer compares nothing. */
  readonly bothReadable: boolean;
  /** How many ponds in total, and how many are readable — so the answer can name its own slice. */
  readonly universe: { readonly ponds: number; readonly readable: number };
}

/**
 * ★ THE TWO HALVES OF THE SENTENCE, SPLIT ON A CONNECTIVE — and then the EXISTING matcher on each.
 *
 * ⚠ NOT A TWO-POND SCORER. `matchPondName` takes a whole sentence and returns its single best match;
 *   pointing it at "compare pharma and FMCG" returns one pond and drops the other silently. Splitting
 *   first and running the conservative matcher twice keeps its refusal behaviour intact on both sides
 *   — which is the whole reason it exists — instead of introducing a second ranking that could
 *   disagree with it.
 */
const CONNECTIVES = /\s+(?:versus|vs\.?|against|compared\s+with|compared\s+to|and|with)\s+/i;

export function splitTwoPonds(raw: string): [string, string] | null {
  // Strip a leading verb so "compare pharma and FMCG" does not put "compare pharma" on the left.
  const body = raw.replace(/^\s*(?:compare|contrast|show\s+me|how\s+do(?:es)?)\s+/i, "").trim();
  const parts = body.split(CONNECTIVES);
  if (parts.length !== 2) return null;
  const [l, r] = [parts[0]!.trim(), parts[1]!.trim()];
  return l && r ? [l, r] : null;
}

export async function resolvePeerGroupVersus(raw: string): Promise<Resolved<PeerGroupVersusRead> | null> {
  const halves = splitTwoPonds(raw);
  if (!halves) return null;

  // ⚠ `read_failed`, NOT an absence — `verify-swallowed-absence.ts` counts nineteen sites that turn a
  //   read failure into a claim about the record, and this is not the twentieth.
  let listRead = true;
  const list = await buildPeerGroupList().catch(() => { listRead = false; return null; });
  if (!listRead) return absent<PeerGroupVersusRead>("read_failed", NO_COVERAGE);
  if (!list || list.length === 0) return null;

  const ponds = list.map((g) => ({ id: g.id, displayName: g.displayName, name: g.name }));
  const mA = matchPondName(halves[0], ponds);
  const mB = matchPondName(halves[1], ponds);
  // Either side unmatched, or both naming the SAME pond, is not a two-pond question. Refusing hands
  // the turn back to the single-pond answer, which is at least about a pond the reader did name.
  if (!mA || !mB || mA.id === mB.id) return null;

  let viewsRead = true;
  const [va, vb] = await Promise.all([
    buildPeerGroupHealthView(mA.id).catch(() => { viewsRead = false; return null; }),
    buildPeerGroupHealthView(mB.id).catch(() => { viewsRead = false; return null; }),
  ]);
  if (!viewsRead) return absent<PeerGroupVersusRead>("read_failed", NO_COVERAGE);
  if (!va || !vb) return null;

  const side = (id: string, name: string, v: NonNullable<typeof va>): VersusSide => ({
    id, name,
    memberCount: v.members.length + v.notAtCurrentPeriod.length + v.rosterNotScored.length,
    aggregate: v.aggregate,
    staleMembers: v.notAtCurrentPeriod.map((m) => ({ symbol: m.symbol, latestPeriod: m.latestPeriod })),
    unscoredMembers: v.rosterNotScored.map((m) => m.symbol),
  });

  const a = side(mA.id, mA.displayName, va);
  const b = side(mB.id, mB.displayName, vb);

  // How much of the pond universe this answer is even available for — so it can say so.
  //
  // ⚠ THE FIRST DRAFT WROTE `g.scoredCount ?? 0 >= 2`, WHICH IS `g.scoredCount ?? (0 >= 2)`. `??`
  //   binds looser than `>=`, so it evaluated to the count itself when present and to `false` when
  //   absent — counting every pond with any scored member and none of the rest. It typechecked and it
  //   would have put a wrong denominator in a sentence about denominators. Parenthesised, and
  //   `PeerGroupListItem.scoredCount` is a declared `number`, so the cast is gone too.
  const readable = list.filter((g) => (g.scoredCount ?? 0) >= 2).length;

  return resolved<PeerGroupVersusRead>(
    { a, b, bothReadable: a.aggregate !== null && b.aggregate !== null,
      universe: { ponds: list.length, readable } },
    coverageOf(a, b),
    ["stocks", "score_snapshots"] satisfies Source[],
  );
}

const NO_COVERAGE: Coverage = { subject: null, query: null };

/**
 * ★ THE ENVELOPE IS `QueryCoverage`'S OWN SHAPE, NOT ONE INVENTED FOR THIS ANSWER.
 *
 * ⚠ THE FIRST DRAFT RETURNED `{ kind, label, counted }` AND CAST IT `as unknown as Coverage`. Those
 *   fields do not exist on `QueryCoverage`; the cast silenced the compiler and would have handed the
 *   renderer and the harness a coverage block with none of the four fields they read — the count
 *   would have vanished from the very answer whose rule is that the count stays on screen.
 *
 * ★ `universeSearched` IS THE TWO ROSTERS, and members the aggregate could not fold in are `dropped`
 *   with their reason NAMED, which is what that field is for: "a silent filter makes a shortened set
 *   read as a complete one."
 */
function coverageOf(a: VersusSide, b: VersusSide): Coverage {
  const dropped: DroppedFilter[] = [];
  const stale = a.staleMembers.length + b.staleMembers.length;
  const unscored = a.unscoredMembers.length + b.unscoredMembers.length;
  if (stale > 0) dropped.push({
    filter: "scored at the current period",
    dropped: stale,
    why: "their latest reading is of an earlier quarter, so folding them in would compare two periods",
  });
  if (unscored > 0) dropped.push({
    filter: "has a reading at all",
    dropped: unscored,
    why: "no snapshot in any period — a different state from being a quarter behind",
  });
  return {
    subject: null,
    query: {
      universeSearched: a.memberCount + b.memberCount,
      depthFloor: null,
      excludedForDepth: 0,
      dropped,
    },
  };
}
