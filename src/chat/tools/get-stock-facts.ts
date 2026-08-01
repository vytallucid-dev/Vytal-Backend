// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockFacts — the first tool. Fetch Vytal's computed health facts for ONE stock by ticker.
//
// LEAN BY DEFAULT. The full health fact block is ~7,000 tokens (ai/grounding.ts) and a conversation may
// fetch several stocks — three full blocks would be ~21,000 tokens of tool results carried on every later
// turn. So this projects the SAME read (`groundStockHealth`, reused unchanged) down to a compact summary:
// verdict + band + the four pillar subtotals + fired findings by name + peer standing. `full=true` returns
// the complete closed-world block for a genuine drill-down — the same two-scope shape as grounding's
// portfolio full/explain modes.
//
// CLOSED-WORLD DISCIPLINE CARRIES IN. Every number is labeled and a missing one renders "not available",
// never omitted (an omission reads as license to guess). The rounded/sayable forms reuse grounding's own
// scoreStr/pctStr, so a tool result and the page can never state one number two ways. The lean output does
// NOT re-embed CLOSED_WORLD_HEADER — it already leads message[0] and governs everything in history
// (compose.ts). `full=true` returns the canonical block, which self-heads (each fact block is its own
// closed world — that is not the double-header bug, which is header+header on ONE block).
//
// UNIVERSE BOUNDARY. `groundStockHealth` returns null for a symbol outside the covered universe (its own
// live findUnique) → the shared notInUniverse() message (a valid, honest ok-result, not an error). In the
// universe but unscored → inUniverseButUnscored(). Neither fabricates.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { groundStockHealth, scoreStr, pctStr, isNum, NA } from "../../ai/grounding.js";
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";
import { notInUniverse, inUniverseButUnscored } from "./boundary.js";
import type { ChatTool, ToolResult } from "./types.js";

interface GetStockFactsArgs {
  symbol?: unknown;
  full?: unknown;
}

// ── The description the MODEL sees. This is prompt engineering: it must (1) say WHEN to reach for the
//    tool, (2) that the current subject's facts are already in context so it should not re-fetch them,
//    (3) that output is lean by default with a `full` drill-down, and (4) that some symbols legitimately
//    return "not covered" — a boundary, not an error. Vague here means the model over- or under-calls.
const DESCRIPTION =
  "Fetch Vytal's computed health facts for ONE Indian stock by its NSE ticker: the 0–100 health score and " +
  "its four pillars (Foundation, Momentum, Market, Ownership), the band, any fired findings, and peer " +
  "standing. Call this whenever the reader asks about a specific stock that is NOT the subject this " +
  "conversation was opened on — the current subject's facts are already in your context, so do not call " +
  "the tool for it. Returns a LEAN summary by default; pass full=true ONLY when the reader drills into the " +
  "detailed pillar / metric / lens breakdown (it is large). Vytal covers a defined universe of Indian " +
  "stocks: a symbol outside it returns an honest 'not covered' result — a coverage boundary, not an error " +
  "— which you should relay plainly rather than guessing. One stock per call; call again for another stock.";

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: 'The NSE ticker symbol of the stock, e.g. "INFY", "TCS", "HDFCBANK".',
    },
    full: {
      type: "boolean",
      description:
        "Optional. false (default) returns a lean summary; true returns the complete pillar/metric/lens/finding breakdown for a deep drill-down.",
    },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

// ── Lean render helpers ──────────────────────────────────────────────────────────────────────────
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Percentile is already 0–100 — a whole-percent, sayable form (no ×100). */
const pctPoint = (x: number): string => `~${Math.round(x)}%`;
// ★ P1 — the CANONICAL name, from the catalogue. This read `evidence.name` (a fourth vocabulary that
// disagreed with the product on 16 of 34 keys, and was simply ABSENT for ownership_R1_pledge, which
// therefore reached the model as a raw key). Same resolver the stock page uses; a module import, no
// fetch. See the block comment in ai/grounding.ts for the full account.
import { findingName as catalogueFindingName } from "../../catalogue/index.js";

/** Canonical display name for a finding key. Never null, never a raw key. */
function findingName(key: string): string {
  return catalogueFindingName(key);
}

/** Project the full health view down to the lean, closed-world summary. */
function renderLean(v: HealthSnapshotView): string {
  const id = v.identity;
  const L: string[] = [];
  L.push(`=== VYTAL HEALTH (lean): ${id.symbol}${id.name ? ` (${id.name})` : ""} — as read by Vytal ===`);
  L.push(`Sector: ${id.sector ? id.sector.displayName : NA} · Coverage: ${id.coverageState ?? NA} · As-of ${id.asOfDate} (${id.periodKey})`);

  const vd = v.verdict;
  if (vd) {
    const traj = vd.trajectoryMarker
      ? `${vd.trajectoryMarker}${isNum(vd.trajectoryDelta) ? ` (${vd.trajectoryDelta >= 0 ? "+" : ""}${scoreStr(vd.trajectoryDelta)} pts)` : ""}`
      : NA;
    L.push(`Composite health: ${scoreStr(vd.composite)} — band ${vd.label.band} (${vd.label.label}). Trajectory: ${traj}. Divergence: ${vd.divergence.flag ?? NA}.`);
  } else {
    L.push(`Composite health: ${NA}.`);
  }

  L.push("Pillars (each its own 0–100 subtotal; the four combine with Vytal's proprietary internal weights, which are NOT disclosed):");
  for (const p of v.pillars) {
    L.push(`  · ${cap(p.pillar)}: ${isNum(p.subtotal) ? scoreStr(p.subtotal) : NA} (state: ${p.state})`);
  }

  const rf = v.findings?.redFlags ?? [];
  const pt = v.findings?.patterns ?? [];
  if (!rf.length && !pt.length) {
    L.push("Findings: none fired.");
  } else {
    const items: string[] = [];
    for (const r of rf) items.push(`"${findingName(r.flagKey)}" (RedFlag${r.severity ? `, ${r.severity}` : ""})`);
    for (const p of pt) items.push(`"${findingName(p.patternKey)}" (Pattern${p.direction ? `, ${p.direction}` : ""}${p.severity ? `, ${p.severity}` : ""})`);
    L.push(`Findings: ${items.length} fired — ${items.join("; ")}.`);
  }

  const ps = v.peerStanding;
  L.push(
    ps
      ? `Peer standing: rank ${ps.rank} of ${ps.memberCount}${isNum(ps.percentile) ? ` (percentile ${pctPoint(ps.percentile)})` : ""}.`
      : `Peer standing: ${NA}.`,
  );

  L.push("(Lean read — call getStockFacts again with full=true for the complete pillar / metric / lens / finding breakdown.)");
  return L.join("\n");
}

export const getStockFactsTool: ChatTool<GetStockFactsArgs> = {
  name: "getStockFacts",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) {
      return { ok: false, error: "getStockFacts requires a non-empty 'symbol' string (an NSE ticker such as INFY)." };
    }
    const full = args.full === true;

    let grounding;
    try {
      // Memoised per turn: groundStockHealth is the heaviest read in the fleet (~15 queries) and
      // getStockRelationship needs the same view, so one turn pays for it once.
      grounding = await ctx.once(`stockHealth:${symbol}`, () => groundStockHealth(symbol));
    } catch (e) {
      // Fail-soft: hand the model an honest error, never throw the turn.
      return { ok: false, error: `Could not read health facts for ${symbol}: ${(e as Error).message}` };
    }

    if (!grounding) return { ok: true, content: notInUniverse(symbol) }; // null ⇒ outside the universe
    if (!grounding.data.scored) return { ok: true, content: inUniverseButUnscored(symbol, grounding.data.identity.name) };
    if (full) return { ok: true, content: grounding.factBlock }; // drill-down: the canonical closed-world block
    return { ok: true, content: renderLean(grounding.data) };
  },
};
