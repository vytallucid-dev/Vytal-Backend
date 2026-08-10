// File: src/scoring/findings/evidence-render.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE, IN THE READER'S VOCABULARY — the server-side renderer for a finding's evidence bag.
//
// ── ★ WHY A SERVER-SIDE ONE EXISTS AT ALL ─────────────────────────────────────────────────────────
// catalogue/evidence-facts.ts classifies every evidence key as `reader` (with its authored label, unit
// and precision) or `internal` (with the reason it is withheld — threshold, study statistic, routing
// token, prose, structure, duplicate). Until now the only thing that CONSUMED that classification was
// the frontend's `evidencePips`, because the card was the only surface that rendered pips.
//
// The model is the second such surface. A model-facing string is copy: a chat reply quotes it to a
// reader verbatim, so "Thresholdpct: 50" reaching the model is the same defect as it reaching a card —
// it hands over our calibration, and it hands the reader a fact about the MODEL dressed as a fact
// about their company. `evidence-facts.ts`'s header says an internal classification is not a judgement
// that a value is unimportant; it is a judgement about WHOSE fact it is. That judgement is surface-
// independent, so the renderer is too.
//
// ── ⚠ WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
// NOT a second vocabulary. The labels, units, precisions and the reader/internal split are read from
// the catalogue — this module authors no copy of its own. What it adds is the FORMATTING, and that is
// deliberately transcribed from Vytal-Frontend/lib/findings/evidence-pips.ts `formatValue` so a pledge
// ratio the reader sees as "90.0%" on the card is "90.0%" in the assistant's mouth too. The two
// implementations exist because the two runtimes do; the FACTS behind them have one home.
//
// NOT a replacement for the verdict. `renderVerdict` is the sentence; these are the receipts under it.
// A surface renders both, and neither is derived from the other.
//
// ── THE THREE OUTCOMES FOR A KEY, AND WHY NONE OF THEM IS "HUMANISE IT" ──────────────────────────
//   reader        rendered, with its authored label
//   internal      withheld, silently — a decision already recorded in the catalogue
//   unclassified  withheld, and it is a GAP: a rule invented a key and nobody said what it means.
//                 scripts/verify-evidence-facts.ts walks the live corpus and fails on one, so the gap
//                 is reported there rather than papered over here. Rendering it as `humanizeKey(k)` is
//                 the original defect ("Pledgeratioq") and is not a fallback this module has.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { evidenceFact } from "../../catalogue/evidence-facts.js";
import { findingPrecision } from "../../catalogue/finding-facts.js";
import { PILLAR_LABEL } from "./verdicts.js";
import type { EvidenceBag } from "./evidence.js";

/** One rendered receipt: an authored label and a formatted value. Nothing else leaves this module. */
export interface EvidencePip {
  key: string;
  label: string;
  value: string;
}

/**
 * Format one value in its declared unit.
 *
 * ⚠ TRANSCRIBED FROM THE FRONTEND'S `formatValue`, INCLUDING THE PARTS THAT LOOK ARBITRARY.
 * `pp` and `%` are not interchangeable (a 90.0% pledge ratio is a proportion of the promoter holding;
 * a 0.4pp quarterly move is an absolute change), and `pts` prints BARE because the label beside a
 * pillar subtotal already says which pillar — " pts" would be noise on every divergence receipt.
 */
function formatValue(value: unknown, unit: string | null, decimals: number): string {
  if (typeof value === "string") {
    // A pillar CODE renders through the label map the finding renderers already own, so "market"
    // reads as "Market" without a second capitalisation convention living here.
    return PILLAR_LABEL[value] ?? value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  const n = value.toFixed(Math.max(0, decimals));
  switch (unit) {
    case "%":
      return `${n}%`;
    case "pp":
      return `${n}pp`;
    case "x":
      return `${n}×`;
    case "cr":
      return `₹${n}cr`;
    case "days":
      return `${n} days`;
    default:
      return n; // "pts" and unitless — see the note above
  }
}

/**
 * Resolve a finding's evidence bag to the receipts a reader may see.
 *
 * Ordered by the bag's own key order, which is the order the rule stamped them in — stable per rule,
 * and not a ranking this module is entitled to invent.
 *
 * ⚠ NO CAP, AND THAT IS A MEASURED DECISION. The bound here is the RULE's authored evidence bag, not
 * the data: the widest live row is R6's eleven reader keys, and the busiest stock in the book carries
 * twenty-five receipts across its whole fired set. A cap would have to drop a measurement by position
 * — and position is stamp order, so it would drop whichever fact the rule happened to write last.
 */
export function evidencePips(findingKey: string, evidence: EvidenceBag | unknown): EvidencePip[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const fallbackPrecision = findingPrecision(findingKey);
  const out: EvidencePip[] = [];

  for (const [key, value] of Object.entries(evidence as Record<string, unknown>)) {
    if (value == null) continue;
    // Objects and arrays are classified `structural` in the catalogue; this guard is belt-and-braces
    // for a shape the vocabulary has not seen, so a blob can never reach `formatValue`.
    if (typeof value === "object") continue;
    const fact = evidenceFact(key);
    if (!fact || fact.kind !== "reader") continue; // internal or unclassified — see the header
    out.push({ key, label: fact.label, value: formatValue(value, fact.unit, fact.precision ?? fallbackPrecision) });
  }
  return out;
}

/** The receipts as one line — "Promoter holding pledged 90.0% · Change this quarter 0.4pp". Empty
 *  string when nothing is reader-facing, so a caller can drop the line rather than print a label
 *  with nothing after it. */
export function evidenceLine(findingKey: string, evidence: EvidenceBag | unknown): string {
  return evidencePips(findingKey, evidence)
    .map((p) => `${p.label} ${p.value}`)
    .join(" · ");
}
