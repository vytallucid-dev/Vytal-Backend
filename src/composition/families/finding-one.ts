// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PT · ONE FINDING, EXPLAINED — `patterns.finding`, N-3.
//
// "Why was TCS flagged for Sticky Divergence." The census answers the PLURAL question — everything
// firing, with its witness — and there was no singular one. A reader who has just been shown four
// findings and wants to understand ONE of them had to read the whole list again.
//
// ── ★ WHAT IT REUSES, AND IT IS ALMOST ALL OF IT ──────────────────────────────────────────────────
//   · `resolveDefinition(raw, symbol)` — ALREADY searches `STOCK_FINDINGS` by NAME and already returns
//     `doesntMean`. Nothing here re-identifies a finding from a sentence; `searchVocabularies` does it,
//     longest-name-wins, so "Sticky Divergence" beats "Divergence" where both are registered.
//   · `readFindingsForSymbols` — the same service the census and orientation's divergence callout use.
//     It renders each row's OWN verdict ("what happened at THIS company, from renderVerdict"), so the
//     measurement arrives already in the house's words and this file computes no figure at all (N-1).
//
// ⚠ WHY `resolveDefinition` IS NOT EXTENDED IN PLACE. Its `example` is built from `CONCEPTS[key]`, so
//   a FINDING with a subject returns a definition and no company evidence — that gap is exactly what
//   this answer fills. Widening `workedExample` to cover findings would have been fewer lines, but
//   `resolveDefinition` is what Meta serves live, and a change there reaches every definition answer
//   in the product. The example is assembled HERE instead: arrangement is the composition's job.
//
// ── ★★ D-2 HOLDS, AND THE THREE PARTS ARE THE WHOLE DESIGN ────────────────────────────────────────
//   what it MEASURED    → the row's own rendered verdict
//   what it MEANS       → the catalogue description
//   what it does NOT claim → `doesntMean`, the one field all 132 catalogue entries share
//
// ⚠ AND NEVER THE CUT IT CLEARED. `ServedPatternFacts` is `Pick<…, "pillarPair" | "basis" |
//   "displayPrecision">` — no threshold leaves the system, enforced at type level, re-verified at
//   runtime last batch. This answer states the distance from a perfect reading in words and stops.
//
// ── ★ §4.1: THIS IS PT'S SINGULAR, NOT META'S DEFINITION ──────────────────────────────────────────
// Meta answers "what does Sticky Divergence mean" — subjectless, `subject: "none"`, no company in it.
// This answers "why was TCS flagged for it" — the same definition PLUS one company's own evidence, and
// it REQUIRES a subject. The two predicates cannot collide: Meta's `mentionsAreTheTerm` test already
// declines a sentence whose mention is a company rather than the term.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnySection } from "../contract.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { definedTermSection } from "../../section/kinds/defined-term.js";
import { chipSection } from "../../section/kinds/anchor.js";
import { resolveDefinition } from "../../resolve/concept.js";
import { readFindingsForSymbols } from "../../scoring/read/symbol-findings.service.js";
import type { MarketTurnResult } from "./market.js";

/**
 * ★ IS THE READER ASKING WHY ONE NAMED FINDING FIRED? Word membership, never a `\b` regex — the
 *   inherited scar this codebase has now hit six times.
 */
const ASK = ["why", "flagged", "flag", "fired", "firing", "triggered", "raised", "means", "about"];

export function findingAsked(raw: string): boolean {
  const w = new Set(raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));
  return ASK.some((x) => w.has(x));
}

export async function composeOneFinding(raw: string, symbol: string): Promise<MarketTurnResult | null> {
  if (!findingAsked(raw)) return null;

  // ⚠ THE TERM MUST BE A FINDING. `resolveDefinition` also answers for concepts, lens faces,
  //   guardrails and metric glosses; those are Meta's, and answering them here would put a company's
  //   evidence under a definition of the scoring system.
  const term = await resolveDefinition(raw, symbol);
  if (!term.ok || term.data.vocabulary !== "finding") return null;
  const t = term.data;

  // ⚠ `read_failed` IS NOT AN ABSENCE, and this is not the twentieth swallowed-absence site: a read
  //   that threw means we return null and the census answers instead — never "it did not fire".
  let read = true;
  const found = await readFindingsForSymbols([symbol]).catch(() => { read = false; return null; });
  if (!read) return null;

  const rows = found?.rows?.[0];
  const all = [...(rows?.findings?.shown ?? []), ...(rows?.filing?.fired ?? [])] as { name?: string; verdict?: string; subForms?: string[] }[];
  const mine = all.find((f) => String(f.name ?? "") === t.name) ?? null;

  const sections: AnySection[] = [
    coverageSection(term.coverage, `${symbol} — ${t.name}`) as AnySection,
  ];

  // ★ THE COMPANY'S OWN EVIDENCE AS THE `example`, which is the shape `defined-term` already carries:
  //   `{ symbol, lead, rows, close }`. No new renderer, and ANCHOR stays at its six.
  const example = mine
    ? {
        symbol,
        lead: `What it measured at ${symbol}`,
        rows: [
          { label: "What fired", value: String(mine.verdict ?? t.name), note: null },
          ...(mine.subForms && mine.subForms.length > 0
            // ★ A CONSOLIDATED DIVERGENCE NAMES ITS SUB-FORMS — the service's own field, and the only
            //   place a reader can see that one row stands for several.
            ? [{ label: "The forms that fired", value: mine.subForms.join(" · "), note: null }]
            : []),
        ],
        close: null,
      }
    : null;

  // ⚠ THE SECTION TAKES THE WHOLE `Resolved` ENVELOPE, not the data — so the coverage and provenance
  //   travel with it rather than being re-stated here. Only `example` differs from what the resolver
  //   returned: it builds one from `CONCEPTS[key]`, which holds no finding, so for a finding it is
  //   always null and this is an addition rather than an overwrite of something authored.
  sections.push(definedTermSection(
    { ...term, data: { ...t, example: example ?? t.example } },
    raw,
  ) as AnySection);

  const opening: string[] = [];
  if (mine) {
    opening.push(`${symbol} is flagged for ${t.name} because ${String(mine.verdict ?? "").replace(/^[A-Z]/, (c) => c.toLowerCase())}`);
  } else {
    // ⚠ NAMED, NOT SILENT. A finding the reader asked about that is NOT firing is a real answer, and
    //   it is a different one from a finding we cannot check (§3.1, N-4).
    opening.push(
      `${t.name} is not firing on ${symbol} right now. It is a check we run, and on this company at ` +
      `this reading it did not fire — which is not the same as it having been ruled out for good.`,
    );
  }
  opening.push(t.description);
  // ★★ THE PART D-2 EXISTS FOR, AND IT IS NEVER OPTIONAL.
  opening.push(`What it does not mean: ${t.doesntMean}`);

  sections.push(chipSection([
    { label: "Everything flagged", question: `what has been flagged on ${symbol}`, surface: "Patterns" },
    { label: `What ${t.name} means`, question: `what does ${t.name} mean`, surface: "Concepts" },
  ]) as AnySection);

  return {
    kind: "composed",
    compositionId: "patterns.finding",
    sections,
    prose: {
      opening,
      leads: {},
      after: {},
      // ⚠ THE LIMIT, STATED. D-2 declines the condition ladder as a reader surface; the answer says so
      //   in its own words rather than leaving a reader to derive a cut-off from what is shown.
      close:
        `Each check is scored against a band we hold for this company's industry and size. What is above ` +
        `is what it found and what it means, not the cut-off it was measured against.`,
    },
    missLogged: false,
  };
}
