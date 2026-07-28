// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — MODE RESOLUTION (§2.1 / §2.2 / §2.3).
//
// Two axes → the twelve-cell grid → the header-fallback chain → an IN-SLICE mode (M1 / M3 / M9). This
// slice builds three cells; every other cell resolves to one of them via the specified fallbacks, so the
// day UD / UN / the watchlist modes land they slot in without re-plumbing the axis logic:
//   HELD    · FIRST→M1 · RETURNING→M2→M3 · RECURRING→M3 · DORMANT→M4→M3
//   WATCHED · any → M5–M8 (not in slice) → M9   (the card simply doesn't state the watchlist fact yet)
//   NEITHER · FIRST→M9 · RETURNING→M10→M9 · RECURRING→M11 (not in slice)→M9 · DORMANT→M12→M9
//
// Anonymous is forced to M9 upstream (UG8). Attention is a ROUTER here (§0.6) — it selects the cell and
// never becomes content.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { DORMANT_GAP_DAYS, RECURRING_MIN_VIEWS_30D } from "./constants.js";
import type { ReaderContext, ModeId, PositionAxis, AttentionAxis } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedMode {
  mode: ModeId; // the IN-SLICE mode actually rendered (M1 | M3 | M9)
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

/** Fold a raw cell to the in-slice mode via the header-fallback chain (§2.3). Every non-built cell falls
 *  to M3 (held) or M9 (everything else) — never an empty header. */
function foldToSlice(raw: ModeId): ModeId {
  switch (raw) {
    case "M1":
      return "M1";
    case "M2": // holding delta — no UD this slice → M3 shape
    case "M3":
    case "M4": // dormant-return holding → M3
      return "M3";
    // Watchlist cells (M5–M8) and every NEITHER cell (M9–M12) resolve to the stranger floor this slice.
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
