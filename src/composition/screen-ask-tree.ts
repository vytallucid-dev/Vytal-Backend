// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FALLBACK TREE — the AND-only extractor's reading, in the grammar the evaluator runs.
//
// ★★ THE POINT IS THAT THERE IS NO SECOND EXECUTION PATH. When the model's reading is refused — a
//    field it invented, a magnitude we will not guess at, a quota denial, no provider at all — the
//    regex extractor's conditions are folded into an `and` tree and run through the same evaluator,
//    the same restatement and the same card as a parsed one.
//
// ⚠ THE ALTERNATIVE WAS TWO ANSWER SHAPES, and the fallback would have been the one nobody looks at —
//   which is the one that runs when something has already gone wrong. One shape means the degraded
//   path is exercised by every offline gate in the suite, because offline there is no model and this
//   is the only path there is.
//
// ★ AND IT IS A STRICTLY NARROWER READING, WHICH THE ANSWER SAYS. `and` is all the extractor can
//   express; a reader who typed "or" is told their question was read as "and".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { ScreenAsk } from "./screen-ask.js";
import type { CmpNode, ScreenNode } from "./screen-grammar.js";

/**
 * Fold a `ScreenAsk` into an `and` tree. `null` when it carries nothing executable — which cannot
 * happen for an ask that `screenAsk` returned, and is handled rather than asserted.
 */
export function askToTree(ask: ScreenAsk): ScreenNode | null {
  const nodes: ScreenNode[] = [];

  // ⚠ THE EXTRACTOR'S BOUNDS ARE ALREADY IN THE COLUMN'S UNIT — it scaled them when it read the
  //   sentence. The grammar's `magnitude` is what the MODEL reports so code can scale; replaying a
  //   scale here would apply it twice. `none` says "this number is already the stored one".
  for (const c of ask.conditions) {
    const cmp: CmpNode = c.min !== undefined
      ? { op: "cmp", field: c.field, comparator: "gte", value: c.min, magnitude: "none" }
      : { op: "cmp", field: c.field, comparator: "lte", value: c.max as number, magnitude: "none" };
    nodes.push(cmp);
  }
  for (const li of ask.lineItems) {
    const cmp: CmpNode = li.min !== undefined
      ? { op: "cmp", field: li.field.key, comparator: "gte", value: li.min, magnitude: "none", grain: li.grain }
      : { op: "cmp", field: li.field.key, comparator: "lte", value: li.max as number, magnitude: "none", grain: li.grain };
    nodes.push(cmp);
  }
  if (ask.band) nodes.push({ op: "band", band: ask.band });
  if (ask.finding) {
    nodes.push({ op: "finding", rule: ask.finding.ruleKey, kind: ask.finding.kind });
  }

  if (nodes.length === 0) return null;
  return nodes.length === 1 ? nodes[0]! : { op: "and", nodes };
}
