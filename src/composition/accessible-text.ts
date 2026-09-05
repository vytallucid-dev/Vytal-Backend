// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ACCESSIBLE FORM — one composed answer, rendered as plain text.
//
// ── ★ IT HAS THREE CONSUMERS AND THAT IS DELIBERATE ───────────────────────────────────────────────
//   1. `chat_messages.content` — the copyable, searchable, screen-readable answer. §0.1 says structure
//      IS the answer; it does not say a reader who cannot see a chart is owed nothing.
//   2. The three re-pointed gates (§9.3). They used to scan live chat-tool output; the tools die, and
//      THIS is the surface that replaced them — the 2–4-sentence prose plus every figure we state.
//   3. Anything that needs to diff two answers, because text diffs and section trees do not.
//
// **One renderer for all three, and that is the point.** A gate scanning a different string from the
// one the reader gets is a gate testing something nobody reads — which is how `verify-number-grounding`
// could have gone green over an empty corpus while the product shipped ungrounded numbers.
//
// ── ★ EVERY FIGURE COMES FROM THE DIGEST, NEVER THE PAYLOAD ───────────────────────────────────────
// The digest's leaves are already strings, formatted once by the section that owns them (N-1). Reading
// the payload here would format them a second time, in a second place, and the two would drift — the
// exact N-5 failure the digest exists to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnySection, AnswerProse } from "./contract.js";

/**
 * Render a composed answer as text.
 *
 * ⚠ ABSENT LINES ARE INCLUDED, NOT SKIPPED. "Period range: no quarterly results held" is the sentence
 * N-4 exists for; dropping it because it has no value would leave the text form saying less than the
 * rendered one, and a reader on a screen reader would get the silently-shortened answer the whole
 * contract is written against.
 */
export function accessibleText(sections: readonly AnySection[], prose: AnswerProse): string {
  const out: string[] = [];

  for (const p of prose.opening) if (p.trim()) out.push(p.trim());

  for (const [i, s] of sections.entries()) {
    // ★ MOST-SPECIFIC KEY WINS — `KIND:renderer#i`, then `KIND:renderer`, then `KIND`. The SAME
    //   ladder the browser renderer walks, and it has to be, or the two would describe one answer
    //   differently.
    //
    // ⚠ THE INDEXED FORM WAS MISSING HERE while the renderer already had it, which is a bug waiting
    //   for its trigger: the moment the planned path started writing indexed keys, this reader would
    //   have silently dropped every lead sentence from the accessible transcript — the composition
    //   would look thinner to assistive tech than it does on screen, for no visible reason.
    const k = `${s.kind}:${s.renderer}`;
    const lead = prose.leads[`${k}#${i}`] ?? prose.leads[k] ?? prose.leads[s.kind];
    if (lead?.trim()) out.push("", lead.trim());

    // ⚠ THE EPILOGUE IS PART OF THE ARGUMENT AND WAS NOT HERE AT ALL. §4.3 as amended says prose
    //   carries the reasoning BEFORE its evidence and the conclusion AFTER it; this reader printed
    //   the lead and the digest and stopped, so the accessible transcript ended every section one
    //   sentence short of the point — exactly the half of the amendment that says what the figures
    //   MEANT. Same key ladder as the lead, for the same reason.
    const epilogue = prose.after?.[`${k}#${i}`] ?? prose.after?.[k] ?? prose.after?.[s.kind];

    const d = s.digest;
    if (!d) {
      if (epilogue?.trim()) out.push("", epilogue.trim());
      continue;
    }
    out.push("", d.heading);
    for (const g of d.groups) {
      if (g.label && g.label !== d.heading) out.push(`  ${g.label}`);
      for (const l of g.lines) {
        // The state is not printed as a tag — it is already in the wording of an absent phrase, and a
        // reader does not need "[absent]" after a sentence that says what is missing.
        out.push(`    ${l.label}: ${l.value}`);
      }
    }
    if (epilogue?.trim()) out.push("", epilogue.trim());
  }

  if (prose.close?.trim()) out.push("", prose.close.trim());
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The PROSE ONLY — no figures at all.
 *
 * ★ THIS IS WHAT THE GUARDRAIL AND EVALUATIVE-TIER GATES SCAN. Those two ask "did the model write
 * something advisory or evaluative", and the answer must be about the MODEL'S sentences. Handing them
 * the full text would have them scanning code-rendered figures for model misbehaviour — every
 * "Fragile" band label in a digest would read as an evaluative claim the model never made.
 */
export function proseOnly(prose: AnswerProse): string {
  return [...prose.opening, ...Object.values(prose.leads), prose.close]
    .map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}

/**
 * Every FIGURE the answer states, as strings.
 *
 * ★ THIS IS THE NUMBER-GROUNDING GATE'S HAYSTACK. The question it asks is "does every number in the
 * reader-facing text appear in what we resolved", and under this architecture the answer is true by
 * construction — code writes every figure and the model writes none. The gate is now proving that
 * construction rather than checking a model's arithmetic, which is a stronger claim and a cheaper one.
 */
export function statedFigures(sections: readonly AnySection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    for (const g of s.digest?.groups ?? []) {
      for (const l of g.lines) if (l.state === "present" || l.state === "unchanged") out.push(l.value);
    }
  }
  return out;
}
