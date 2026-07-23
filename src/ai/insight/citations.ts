// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CITATION VALIDATION — the closed-world guarantee made CHECKABLE for structured output.
//
// A structured insight separates MODEL-AUTHORED text (the sentences, guardrail-scanned) from PASSTHROUGH
// values (the numbers/labels the model claims each sentence rests on). CLOSED_WORLD_HEADER forbids the
// model to introduce a number that is not in the fact block; this module ENFORCES it by construction:
// every `Citation{label,value}` the model returns must be locatable, verbatim, in the block it was given.
//
// PURE + DETERMINISTIC + FREE. No AI, no DB, no I/O — like the guardrail, which is why it can run on
// every payload. It does one thing: given the exact fact block the model saw, decide whether a cited
// (label, value) pair actually appears there.
//
// ── ★ ECHO-AND-ASSERT, LINE-SCOPED ──────────────────────────────────────────────────────────────────
// A citation is located iff SOME line of the block contains the `label` (case-insensitive) AND, on THAT
// SAME line, the `value` appears as a delimited token. Line-scoping is the point: a value that happens
// to appear elsewhere in the block must never rescue a citation whose own label-line does not carry it.
// "Composite health score: 71" cannot satisfy a claimed {label:"Composite health score", value:"99"}
// just because some unrelated percentile reads 99 twenty lines down.
//
// ── NORMALISATION MIRRORS `factsKeyOf` ──────────────────────────────────────────────────────────────
// Each line has its `(raw …)` provenance tail stripped before matching — the SAME strip `factsKeyOf`
// applies — so a cited SPOKEN value ("79") matches the line "subtotal=79 (raw 79.2)". The model is told
// to cite the spoken figure, never the raw; this is what makes that instruction verifiable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface Citation {
  label: string;
  value: string;
}

/** The `(raw …)` strip — byte-identical to `factsKeyOf`'s, so the value the model is PERMITTED to speak
 *  matches the line even when the block carries full-precision provenance beside it. */
const stripRaw = (s: string): string => s.replace(/\s*\(raw[^)]*\)/g, "");

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The value must appear as a DELIMITED token on the label's line — not glued inside a longer number,
 *  so a cited "71" cannot spuriously satisfy itself against "710" or "0.712". Word/decimal boundaries
 *  guard both ends; the value's own punctuation (₹, %, ~, −, .) is matched literally. */
const valueRegex = (value: string): RegExp => new RegExp(`(?<![\\w.])${escapeRegex(value)}(?![\\w.])`);

/**
 * Is this one citation locatable in `factBlock`? Some line must contain the label (case-insensitive)
 * AND carry the value as a delimited token, after the raw-strip. Empty label/value ⇒ not locatable
 * (an empty citation cites nothing).
 */
export function locateCitation(factBlock: string, c: Citation): boolean {
  const label = c.label.trim().toLowerCase();
  const value = c.value.trim();
  if (!label || !value) return false;

  let re: RegExp;
  try {
    re = valueRegex(value);
  } catch {
    // A value that cannot compile even after escaping is not a value the block could contain.
    return false;
  }

  for (const rawLine of factBlock.split("\n")) {
    const line = stripRaw(rawLine);
    if (!line.toLowerCase().includes(label)) continue;
    if (re.test(line)) return true;
  }
  return false;
}

/** Validate a flat list of citations against the block; returns the ones that could NOT be located
 *  (empty ⇒ all citations are grounded). The caller treats a non-empty result as a validation failure. */
export function findUnlocatableCitations(factBlock: string, cites: Citation[]): Citation[] {
  return cites.filter((c) => !locateCitation(factBlock, c));
}
