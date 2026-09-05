// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · defined-term — a named thing, the parts it is made of, and the boundary on what it claims.
//
// ★★ THIS TAKES `RENDERERS.ANCHOR` TO 6 OF 6. With SERIES and DECOMPOSITION already there, every list
//    that can close is now closed — see the note in `section/contract.ts`.
//
// ── ★ ONE RENDERER, FIVE VOCABULARIES, AND THE NAMING TEST DECIDED IT ─────────────────────────────
// The brief asked for two things: a concept's constituent structure, and a pattern's claim with its
// limits — and asked whether they are one renderer or two. They are one. A concept's parts are its
// metrics and their weights; a pattern's "parts" are the conditions it observed; a metric gloss has no
// parts at all and that is a legitimate empty. All three are the same object: **a named thing, its
// parts, and the boundary on what it claims.**
//
// Splitting them would have produced two renderers with one payload shape, and forced the composer to
// know WHICH VOCABULARY ANSWERED before it could choose a renderer — a decision it should not have to
// make and, on a term that lives in two registries, cannot make correctly.
//
// ── ⚠ `doesntMean` IS A FIELD, NOT A FOOTER ───────────────────────────────────────────────────────
// The brief is explicit that this is the load-bearing half and must not read as a disclaimer at the
// bottom. The catalogue agrees with it structurally: `EntryBase` makes `doesntMean` the ONE universal
// requirement across all four registries — 132 of 132 entries carry it, while only 74 carry a
// description. The field that is never absent is the field the product is most careful about, and a
// component can hold a claim and its limit side by side in a way prose cannot.
//
// ── ★ WHY IT IS AN ANCHOR AND NOT A CALLOUT ───────────────────────────────────────────────────────
// ANCHOR carries the answer's HEADLINE OBJECT — `set-table`'s own note says a screen's headline object
// IS the match set. For "what does Foundation mean" the headline object is the definition; there is no
// company, no figure and no set for the other five to carry. CALLOUT is for things RAISED alongside an
// answer, and a definition is not raised — it is the answer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import type { DefinedTerm } from "../../resolve/concept.js";
import type { Resolved } from "../../resolve/contract.js";
import { reasonPhrase } from "../../relational/coverage.js";
import { digest, line, unchanged, withheld, type DigestGroup, type DigestLine, type Section } from "../contract.js";

export interface DefinedTermPart {
  readonly label: string;
  /** A published proportion, pre-formatted (N-1). `null` where the parts are not weighted. */
  readonly share: string | null;
  readonly note: string | null;
}

/** The worked example, on a real company. `null` when the term does not have one. */
export interface DefinedTermExample {
  readonly symbol: string;
  readonly lead: string;
  readonly rows: readonly { readonly label: string; readonly value: string; readonly note: string | null }[];
  readonly close: string | null;
}

export interface DefinedTermPayload {
  readonly name: string;
  /** What it is. */
  readonly description: string;
  /** ★ THE BOUNDARY. Rendered beside the claim, never under it — see the header. */
  readonly doesntMean: string;
  readonly parts: readonly DefinedTermPart[];
  /** The bigger whole this sits inside, in words. `null` at the top of a hierarchy. */
  readonly partOf: string | null;
  /** Which vocabulary answered, as a sentence. ⚠ Never the token — the reader has no use for it. */
  readonly sourceSentence: string;
  /**
   * ★ INSIDE THE COMPONENT, NOT UNDERNEATH IT. The brief is specific: the worked example on the
   *   reader's own stock is what makes a definition land, "and it belongs INSIDE the component".
   *   A definition card followed by a separate example card is two objects a reader has to join.
   */
  readonly example: DefinedTermExample | null;
  /** Terms a reader is likely to want next. Names only — a key never reaches a surface. */
  readonly seeAlso: readonly { readonly key: string; readonly name: string }[];
}

export function definedTermSection(
  r: Resolved<DefinedTerm>,
  /** What the reader asked, so the absent state can name it back rather than saying "not found". */
  asked: string,
): Section<"ANCHOR", DefinedTermPayload | null> {
  if (!r.ok) {
    // ⚠ AN UNKNOWN TERM IS A SENTENCE ABOUT OUR VOCABULARY, NOT A 404. The reader used a word; we do
    //   not hold it. Saying "no results" invites them to rephrase the same question forever.
    return {
      kind: "ANCHOR",
      renderer: "defined-term",
      payload: null,
      digest: digest("What that term means", [{
        label: "Definition",
        lines: [withheld("Term", reasonPhrase(r.absent.reason))],
      }]),
      coverage: r.coverage,
      interactions: [],
    };
  }

  const d = r.data;
  const payload: DefinedTermPayload = {
    name: d.name,
    description: d.description,
    doesntMean: d.doesntMean,
    parts: d.parts.map((p) => ({ label: p.label, share: p.share, note: p.note })),
    partOf: d.partOf,
    sourceSentence: d.sourceSentence,
    example: d.example,
    seeAlso: d.seeAlso,
  };

  const lines: DigestLine[] = [
    line(d.name, d.description),
    // ★ THE BOUNDARY REACHES THE MODEL TOO, AND AS A `present` LINE RATHER THAN A `withheld` ONE. It
    //   is not an absence — it is a positive statement about the limit of a claim, and marking it
    //   absent would invite the model to paraphrase around it as if something were missing.
    //
    // ⚠ AND THE LABEL IS TRUE OF BOTH REGISTERS. "Does not mean" inverts the stock register — see the
    //   note at the foot of this file. "How to read it, and what it does not claim" is accurate
    //   whether the stored string negates or states a scope.
    line("How to read it, and what it does not claim", d.doesntMean),
  ];
  if (d.partOf) lines.push(line("Part of", d.partOf));

  const groups: DigestGroup[] = [{ label: "The term", lines }];

  if (d.parts.length) {
    groups.push({
      label: "What it is made of",
      lines: d.parts.map((p) =>
        line(p.label, [p.share, p.note].filter(Boolean).join(" — ") || "a constituent part"),
      ),
    });
  } else {
    // ★ RULE 3 — an atomic term says so rather than simply having no group. A missing section reads to
    //   the model as missing data, and it will write around a gap that is really a simple thing.
    groups.push({
      label: "What it is made of",
      lines: [unchanged("Parts", "this one has no constituent parts — it is a single measure or idea")],
    });
  }

  if (d.example) {
    groups.push({
      label: `Worked on ${d.example.symbol}`,
      lines: [
        line("Reading this against", d.example.lead),
        ...d.example.rows.map((row) => line(row.label, [row.value, row.note].filter(Boolean).join(" — "))),
        ...(d.example.close ? [line("Which gives", d.example.close)] : []),
      ],
    });
  }

  return {
    kind: "ANCHOR",
    renderer: "defined-term",
    payload,
    digest: digest(`What "${asked.trim().slice(0, 60)}" means`, groups),
    coverage: r.coverage,
    interactions: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE BOUNDARY IS NOT ALWAYS A NEGATION, AND LABELLING IT AS ONE INVERTS THE COPY.
//
// The first draft of this batch put every `doesntMean` under the words "does not mean". Read against
// the STOCK register that produces the opposite of the sentence:
//
//   stored     "a hard risk/quality warning to investigate — not a prediction the stock will fall."
//   rendered   "Does not mean: a hard risk/quality warning to investigate…"   ← says it is NOT a warning
//
// The frontend already solved this. `lib/findings/boundary.ts` splits the corpus into two shapes with
// two labels — `negations` ("Doesn't mean") for the "≠ x ≠ y" portfolio register, and `scope` ("How to
// read it") for the stock register that states the scope positively and then negates. Its own header
// says collapsing the two voices would be a copy decision made in the wrong layer, and it is right.
//
// ★ SO THE BACKEND DOES NOT LABEL IT AT ALL. The payload carries the string verbatim and `BoundaryLine`
//   picks the label from the shape, in the one place that already knows how. A second copy of that
//   rule here would be N-5 exactly, and would drift the day the corpus gains a third register. The
//   DIGEST — which has no component to defer to — uses a label true of both shapes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
