// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL SEPARATION — which findings belong to which tool. ONE mechanism, keyed on FAMILY.
//
// ── ★ BOTH SPECS STATE THE BOUNDARY, IN THE SAME WORDS, FROM OPPOSITE SIDES ───────────────────────
//   Divergence spec:  "Single-pillar readings … belong to the Trajectory tool and are deliberately
//                      absent here."
//   Trajectory spec:  "Two-pillar readings … belong to the Divergence tool and are deliberately
//                      absent here."
// So the separation is not a display preference — it is what each tool IS. A T pattern on the
// divergence tool would be a single-pillar reading presented as a disagreement between two pillars.
//
// ── ★ BY FAMILY, NEVER BY A HAND-MAINTAINED KEY LIST ─────────────────────────────────────────────
// A key list would have to be edited every time a pattern is added, and the failure mode of
// forgetting is SILENT: the pattern simply never appears on its tool, and nothing errors. Family is
// already carried by every catalogue entry and is already derivable from key shape (familyOf), so a
// new pattern lands on the right tool by virtue of being named correctly — which the catalogue
// totality check already enforces.
//
//   divergence tool   family C   — D1–D7, S2, and the synthesised consolidated row
//   trajectory tool   family B   — the deteriorations (T2 · T3 · T6 · T9)
//                     family D   — the recoveries    (T1 · T4 · T5 · T7 · T8)
//
// Families A (red flags), E (P-patterns), F (composition), G, H (ownership events), I and N belong to
// NEITHER tool — they are stock-page/Hub findings. A family reaching neither tool is the default and
// is correct; only C/B/D are tool-facing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { familyOf } from "./stock-findings.js";
import { isRetiredFinding } from "./retired-findings.js";
import type { FindingFamily } from "./types.js";

export type ToolId = "divergence" | "trajectory";

/** The families each tool renders. The ONLY place this mapping exists. */
export const TOOL_FAMILIES: Readonly<Record<ToolId, readonly FindingFamily[]>> = {
  divergence: ["C"],
  trajectory: ["B", "D"],
};

/**
 * Does this finding key belong on this tool?
 *
 * ⚠ Retired keys are excluded here as well as at the read boundaries. Belt and braces on purpose:
 * the tools are the one surface whose whole point is "these are the patterns", so a retired key
 * slipping through would be maximally visible.
 */
export function belongsToTool(key: string, tool: ToolId): boolean {
  if (isRetiredFinding(key)) return false;
  return (TOOL_FAMILIES[tool] as readonly string[]).includes(familyOf(key));
}

/** Partition a fired set for one tool. Generic over the caller's row shape. */
export function forTool<T>(rows: readonly T[], tool: ToolId, keyOf: (r: T) => string): T[] {
  return rows.filter((r) => belongsToTool(keyOf(r), tool));
}

/** Which tool (if any) owns this key — for cross-linking a finding to its tool page. */
export function toolForKey(key: string): ToolId | null {
  if (belongsToTool(key, "divergence")) return "divergence";
  if (belongsToTool(key, "trajectory")) return "trajectory";
  return null;
}
