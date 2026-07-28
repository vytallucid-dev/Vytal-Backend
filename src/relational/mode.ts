// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — MODE RESOLUTION (§2.1 / §2.2 / §2.3).
//
// Two axes → the twelve-cell grid → the header-fallback chain → a BUILT mode. The watchlist cells are
// now built (M5–M8); the delta-dependent HELD cells still fold, and the NEITHER tail folds to M9:
//   HELD    · FIRST→M1 · RETURNING→M2→M3 · RECURRING→M3 · DORMANT→M4→M3
//   WATCHED · FIRST→M5 · RETURNING→M6 · RECURRING→M7 · DORMANT→M8   (built — see §1.2 below)
//   NEITHER · FIRST→M9 · RETURNING→M10→M9 · RECURRING→M11→M9 · DORMANT→M12→M9
//
// ⚠ WATCHED NO LONGER FOLDS TO M9. Folding it produced a live falsehood: a watchlisted-not-held stock
// rendered the stranger header "New to you." while `negatives` simultaneously carried
// `watchlisted_not_held` — the system holding the contradicting fact while asserting the opposite. The
// watched modes now resolve as themselves and state the real, dated membership fact instead.
//
// Anonymous is forced to M9 upstream (UG8). Attention is a ROUTER here (§0.6) — it selects the cell and
// never becomes content.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { DORMANT_GAP_DAYS, RECURRING_MIN_VIEWS_30D } from "./constants.js";
import type { ReaderContext, ModeId, PositionAxis, AttentionAxis } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedMode {
  mode: ModeId; // the BUILT mode actually rendered (M1 | M3 | M5 | M6 | M7 | M8 | M9)
  rawMode: ModeId; // the twelve-grid cell before fallback (for telemetry / negatives)
  positionAxis: PositionAxis;
  attentionAxis: AttentionAxis;
}

/** Position axis (§2.1). HELD dominates: held-and-watchlisted resolves HELD, and watchlist becomes a
 *  minor note. Peer holdings never touch this axis (that is Neighbourhood, out of slice). */
function resolvePosition(ctx: ReaderContext): PositionAxis {
  if (ctx.heldThisObject) return "HELD";
  if (ctx.watchlist?.thisAddedAt) return "WATCHED";
  return "NEITHER";
}

/** Attention axis (§2.1). FIRST is exclusive; DORMANT ≻ RECURRING ≻ RETURNING otherwise. A stranger with
 *  no attention (anonymous, or never viewed) is FIRST by construction — there is no "last time". */
function resolveAttention(ctx: ReaderContext, now: number): AttentionAxis {
  const a = ctx.attention;
  if (!a || a.viewCount === 0 || !a.hasHistory) return "FIRST";
  if (a.lastViewedAt && now - a.lastViewedAt.getTime() >= DORMANT_GAP_DAYS * DAY_MS) return "DORMANT";
  if (a.viewCountTrailing30d >= RECURRING_MIN_VIEWS_30D) return "RECURRING";
  return "RETURNING";
}

/** The raw twelve-grid cell (§2.2). */
function gridCell(position: PositionAxis, attention: AttentionAxis): ModeId {
  const grid: Record<PositionAxis, Record<AttentionAxis, ModeId>> = {
    HELD: { FIRST: "M1", RETURNING: "M2", RECURRING: "M3", DORMANT: "M4" },
    WATCHED: { FIRST: "M5", RETURNING: "M6", RECURRING: "M7", DORMANT: "M8" },
    NEITHER: { FIRST: "M9", RETURNING: "M10", RECURRING: "M11", DORMANT: "M12" },
  };
  return grid[position][attention];
}

/** Fold a raw cell to a BUILT mode via the header-fallback chain (§2.3). Every non-built cell falls to a
 *  mode of the SAME position axis — never across axes, because crossing axes is what produced the
 *  "New to you." falsehood on a watchlisted stock. Never an empty header. */
function foldToSlice(raw: ModeId): ModeId {
  switch (raw) {
    // ── HELD ──
    case "M1":
      return "M1";
    // ⚠ M2 AND M4 ARE NOW UNFOLDED (§Phase 7). Phase 1.2 unfolded only the WATCHED cells, so these two
    // still collapsed to M3 — which meant a delta header could never render and UD7's "nothing new
    // since …" would have become M3's permanent header, asserted even where no delta was evaluable.
    // Each now resolves as itself and falls back to M3's SHAPE when no delta resolves (headerAndFloor).
    case "M2":
      return "M2";
    case "M3":
      return "M3";
    case "M4":
      return "M4";
    // ── WATCHED — built (§1.2). Each resolves as itself; none crosses to the stranger floor. ──
    case "M5":
      return "M5";
    case "M6":
      return "M6";
    case "M7":
      return "M7";
    case "M8":
      return "M8";
    // ── NEITHER (§Phase 8, unfolded) ─────────────────────────────────────────────────────────────
    // ⚠ M10/M11/M12 NO LONGER FOLD TO M9. Folding them produced the last surviving header falsehood:
    // a reader who has opened a stock nine times and does not own it was told "New to you." Same class
    // as the watchlist "New to you." fixed in Phase 1.2 — novelty asserted from a mode fold rather than
    // from evidence. M9 means STRANGER-AND-FIRST-VISIT; it cannot represent a returning reader.
    case "M10":
      return "M10";
    case "M11":
      return "M11";
    case "M12":
      return "M12";
    case "M9":
    default:
      return "M9";
  }
}

export function resolveMode(ctx: ReaderContext, now: Date = new Date()): ResolvedMode {
  // Anonymous is forced to M9 (UG8) regardless of any (absent) reader facts.
  if (!ctx.identity.isAuthenticated) {
    return { mode: "M9", rawMode: "M9", positionAxis: "NEITHER", attentionAxis: "FIRST" };
  }
  const positionAxis = resolvePosition(ctx);
  const attentionAxis = resolveAttention(ctx, now.getTime());
  const rawMode = gridCell(positionAxis, attentionAxis);
  return { mode: foldToSlice(rawMode), rawMode, positionAxis, attentionAxis };
}
