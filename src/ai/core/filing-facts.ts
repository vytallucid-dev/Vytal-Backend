// File: src/ai/filing-facts.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING CHANNEL, AS THE MODEL RECEIVES IT — one renderer, every model-facing surface.
//
// ── ★ THE DEFECT THIS CLOSES ──────────────────────────────────────────────────────────────────────
// `readFilingFindings` has been attaching a populated filing section to every stock Vytal knows —
// scored or not — since step 3. Three model-facing sites read the score channel beside it and told the
// model the opposite of what they were holding:
//
//   ai/grounding.ts        "No composite, pillars, findings, trajectory, or peer standing exist for
//                          it" — on the unscored branch, into EVERY turn's background context.
//   chat/tools/boundary.ts "no composite, pillars, or findings exist for it at this time."
//   get-findings-for-symbols.ts  "there are no findings to report."
//
// Asked live for the notable findings on 360ONE, the assistant answered "tracked rather than scored
// yet, so there are no findings or red flags to report." That company has 90% of its promoter holding
// pledged, standing as a critical red flag off its FY27Q1 shareholding filing, and the tool that
// answered had the row in hand. And the gap is not only an unscored-stock one: grounding's SCORED
// branch iterates the score-channel arrays only, so a scored company's filing findings never reached
// the model either.
//
// ── ★ WHY ONE RENDERER AND NOT THREE ──────────────────────────────────────────────────────────────
// Exactly the reasoning chat/tools/boundary.ts's own header gives for the coverage boundary: the CHECK
// is per-surface, the WORDING is one. Three sites composing their own version of "here is what the
// filings say" is three vocabularies for one channel, and the first divergence would be invisible —
// the assistant would describe the same company two ways in one session and every test would pass.
//
// ── ★ THREE STATES REACH THE MODEL, NOT TWO ───────────────────────────────────────────────────────
//   something fired            the rows, each with its own verdict and its own receipts
//   checked and nothing fired  `coverage.quietNote`, VERBATIM
//   could not check            also `coverage.quietNote`, verbatim — it is the same field, and it
//                              already distinguishes the two silences (filing/read.ts `quietLine`)
//
// ⚠ THE QUIET SENTENCE IS NOT RE-COMPOSED HERE. It is authored once, in filing/read.ts, and every
// surface says the same thing about the same silence. What this module adds is the COVERAGE COUNTS as
// labelled facts — which is the coverage block being carried, not a rival sentence — and those are
// emitted whether or not anything fired, because a company with one finding and twelve checks that
// never ran is not a company with one finding.
//
// ── ★ WHAT NEVER REACHES THE MODEL ────────────────────────────────────────────────────────────────
// The raw evidence bag. `evidencePips` (scoring/findings/evidence-render.ts) resolves it through the
// catalogue's reader/internal classification, so the model gets "Promoter holding pledged 90.0%" and
// never `pledgeRatioQ`, `thresholdPct: 50`, or a pattern's back-test population. A model-facing string
// is copy — it is quoted to a reader verbatim — so it is held to the reader's standard.
//
// ⚠ AND NOT `standing`. Every fired row in the live table reads `newly_standing`, because the backfill
// has run one period per grain and `resolveStanding` calls a first observation "newly standing" for
// want of a prior row (filing/read.ts `readNewlyStandingFilingKeys` refuses the same field for the
// same reason). Handing it to the model would have it announce 481 findings as having just appeared.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { evidenceLine } from "../../scoring/findings/evidence-render.js";
import type { FilingFindingsSection, FilingFindingView } from "../../filing/read.types.js";

/**
 * The one paragraph that says what this channel IS. Emitted at the head of every rendered block, for
 * the same reason CLOSED_WORLD_HEADER is: the contract must be structural, not remembered.
 *
 * The two things it has to prevent are the two mistakes the shape invites — reading a filing finding
 * as part of the health score, and adding the two channels' counts together. A filing finding is drawn
 * from 504 stocks and a score finding from the 95 that are scored; one number over both would have two
 * denominators inside it.
 */
export const FILING_CHANNEL_NOTE =
  "FILING FINDINGS — a SEPARATE channel from the health score. These are read straight off this " +
  "company's own filings (shareholding pattern, annual accounts, quarterly results, insider and block " +
  "deals), so they exist whether or not Vytal has scored it: an unscored company can be firing one of " +
  "these right now. Report them as findings on the company — they are. Never merge them into the " +
  "score, never add the two channels' counts together, and never present one channel's silence as the " +
  "other's.";

/**
 * The same statement, projected for the LEAN scope. Authored here beside the long form rather than
 * inlined at the one call site that needs it, so the two cannot drift into two claims about the
 * channel — which is the whole reason this module exists.
 */
export const FILING_CHANNEL_NOTE_SHORT =
  "(read off the company's own filings — a SEPARATE channel from the score, present whether or not it " +
  "is scored; never merged with the score findings above.)";

/** "FY27Q1 shareholding filing (period ended 2026-06-30)", or the window form for the rolling grain. */
function whenFrom(f: FilingFindingView): string {
  // ⚠ GRAIN W IS NOT A FILING. P6 and H read dated event streams over a window that ends at the
  //   evaluation date, so they get told what the SPAN is; naming a filing period for them would date
  //   the statement to a filing that was never read (filing/read.ts GRAIN_LABEL).
  return f.grain === "W"
    ? `over the ${f.grainLabel} to ${f.periodEnd}`
    : `from its ${f.period} ${f.grainLabel} (period ended ${f.periodEnd})`;
}

/** The grains this stock's checks actually read, so a surface can date the statement even when
 *  nothing fired. Omitted entirely when no grain resolved — an empty list would read as a claim. */
function readFromLine(section: FilingFindingsSection): string | null {
  const GRAIN_WORD: Record<string, string> = {
    A: "annual accounts",
    Q: "quarterly results",
    S: "shareholding filing",
    W: "trailing 90-day window",
  };
  const parts = (Object.entries(section.periods) as [string, { period: string; periodEnd: string } | null][])
    .filter((e): e is [string, { period: string; periodEnd: string }] => e[1] !== null)
    // ⚠ THE W PERIOD LABEL IS DROPPED, DELIBERATELY. Grain W carries a quarter label ("FY27Q2") because
    //   the period-key convention needs one, but the window is not that quarter — it is 90 days ending
    //   at the evaluation date. Printing it would invite "over FY27Q2", which is a date we never read.
    .map(([grain, p]) => (grain === "W" ? `${GRAIN_WORD.W} (to ${p.periodEnd})` : `${GRAIN_WORD[grain] ?? grain} ${p.period} (to ${p.periodEnd})`));
  return parts.length ? `Read from: ${parts.join(" · ")}` : null;
}

/**
 * Render the filing channel for ONE company, as lines.
 *
 * `subject` names the company in the per-row verdict attribution — the same discipline
 * getFindingsForSymbols already applies, because a verdict describes what happened at THAT company and
 * a batch payload puts several of them in a row.
 *
 * `indent` prefixes every line, for the batch tool where each company's block sits under its own row.
 *
 * `note: false` drops {@link FILING_CHANNEL_NOTE} from the head of the block — for a MULTI-COMPANY
 * payload, which emits it once for the whole call. The note is rule-level copy ("what this channel
 * is"), identical for every company, and getFindingsForSymbols already holds that discipline for
 * finding descriptions: repeating a paragraph twenty times says the same sentence twenty times.
 *
 * `scope: "lean"` is the projection for getStockFacts' lean read — findings NAMED, with their kind and
 * severity, and no verdict or receipt. That is not a token-saving compromise, it is the SAME rule the
 * lean read already applies to the score channel one line above ("Sticky Divergence" (Pattern, low)),
 * and a payload that carried full verdicts for one channel and names for the other would be claiming
 * the two are different kinds of thing. The full block is what `full=true` and the batch tool serve.
 *
 * ⚠ IT IS A FILTER, NOT A FORK — the same discipline as grounding's portfolio full/explain scopes. One
 * function, one set of facts; a separate "lean renderer" would be a second truth about the same
 * company, and the first divergence would be invisible.
 *
 * A `null` section is NOT silence: outside the covered universe there are no filings either (and the
 * caller says so in its own boundary message), but a null that reaches here on a covered company is a
 * read that failed, and a failed read must never render as a clean one.
 */
export function renderFilingFacts(
  section: FilingFindingsSection | null,
  opts: { subject?: string; indent?: string; note?: boolean; scope?: "full" | "lean" } = {},
): string[] {
  const pad = opts.indent ?? "";
  const who = opts.subject ? ` on ${opts.subject}` : "";
  const lean = opts.scope === "lean";
  if (!section) {
    return [
      `${pad}FILING FINDINGS: could not be read just now. That is a gap on Vytal's side, NOT a clean ` +
        `result — do not report it as "nothing flagged".`,
    ];
  }

  const c = section.coverage;
  const total = c.evaluated + c.notRun;

  if (lean) {
    const L: string[] = [];
    // ★ THE QUALIFICATION SURVIVES THE PROJECTION, AND IT GOES FIRST.
    //
    //   Live, twice: with the limitation placed AFTER the findings line, the assistant opened "Kotak
    //   Mahindra Bank has no red flags firing in Vytal's checks" and never reached it — twelve of that
    //   bank's twenty-two checks do not apply to a lender. The lean scope is the DEFAULT read, so a
    //   qualification it buries is a qualification missing from most answers. Position is the fix that
    //   worked; the full block already gets it early, ahead of its own finding rows.
    const gap = c.notEvaluable + c.notRun;
    if (gap > 0) {
      // ★ THE REASON TRAVELS WITH THE CAPABILITY, GROUPED. The first lean draft named the capabilities
      //   and dropped their phrases, and the assistant supplied its own: "could not be fully assessed
      //   due to incomplete data for this period" — about a BANK, seven of whose eight declines are
      //   `industry_not_applicable`. relational/coverage.ts spells out why that is the one reason that
      //   must never read as a data gap: the check does not apply to how a lender is financed, and we
      //   are not waiting on a filing. A withheld reason is not a neutral omission; it is an invitation.
      //
      //   Grouped by phrase rather than one line per capability, because on this company that is eight
      //   lines carrying two distinct facts.
      const byPhrase = new Map<string, string[]>();
      for (const d of section.declined) byPhrase.set(d.phrase, [...(byPhrase.get(d.phrase) ?? []), d.capability]);
      const groups = [...byPhrase.entries()].map(([phrase, caps]) => `${caps.join(", ")} — ${phrase}`).join("; ");
      L.push(
        `⚠ Filing check-list INCOMPLETE for this company: ${gap} of ${total} checks produced no result` +
          `${groups ? `, across these capabilities: ${groups}` : ""}. If the reader asks whether anything is ` +
          `flagged, wrong, or a red flag, you MUST say what could not be checked in the SAME answer, and say WHY ` +
          `using the reason given here rather than one of your own. "No red flags" on its own is a claim this ` +
          `data does not support.`,
      );
    }
    const named = section.fired
      .map((f) => `"${f.name}" (${f.kind === "red_flag" ? "RedFlag" : "Pattern"}${f.severity ? `, ${f.severity}` : ""})`)
      .join("; ");
    // ⚠ NO BARE "none fired" WHEN NOTHING FIRED. That phrase IS the all-clear, and the assistant echoed
    //   it back as one. `quietNote` is the authored sentence for this exact silence and it already
    //   carries its own scope ("Nothing flagged in what we could check…"), so it is the whole statement
    //   here rather than a qualifier hung off one — which also keeps this scope from composing a second
    //   version of a sentence that has a home.
    L.push(
      section.fired.length
        ? `Filing findings: ${section.fired.length} fired — ${named}. ${FILING_CHANNEL_NOTE_SHORT}`
        : `Filing findings: ${c.quietNote ?? "no result available."} ${FILING_CHANNEL_NOTE_SHORT}`,
    );
    return L.map((l) => `${pad}${l}`);
  }
  const L: string[] = opts.note === false ? [] : [`${pad}${FILING_CHANNEL_NOTE}`];
  // The coverage block as LABELLED FACTS, always — including when something fired, which is the case
  // `quietNote` deliberately does not cover (it is null the moment anything fires) and the case where
  // a partial check-list is easiest to mistake for a complete one.
  L.push(
    `${pad}Filing checks: ${total} in total — ${c.fired} flagged, ${c.notFired} ran clean, ` +
      `${c.notEvaluable} could not be assessed for this company, ${c.notRun} had no filing to run against.`,
  );
  // ★ THE QUALIFICATION IS AN INSTRUCTION, NOT A FACT TO BE NOTICED — because a fact was not enough.
  //
  //   Live, on KOTAKBANK: the block carried the count, the quiet note ("Nothing flagged in what we
  //   could check. 10 checks ran clean; we could not assess …") and all eight capabilities by name,
  //   and the assistant still opened "Kotak Mahindra Bank carries no red flags right now." Twelve of
  //   its twenty-two checks do not apply to a bank; that reply is an all-clear over a half-run
  //   check-list. Stating the shortfall as data left it as one detail among many, and the model
  //   summarised it away.
  //
  // So when the check-list is incomplete, the payload says what the answer must CONTAIN. It is scoped
  // to the incomplete case deliberately: COLPAL is the one company in the book where all 22 ran, and
  // an unqualified answer is exactly what it has earned. A qualifier attached to every company would
  // make the honest all-clear unsayable, which is the same defect facing the other way.
  const unresolved = c.notEvaluable + c.notRun;
  if (unresolved > 0) {
    L.push(
      `${pad}⚠ THE CHECK-LIST IS INCOMPLETE FOR THIS COMPANY: ${unresolved} of the ${total} checks produced no ` +
        `result. If the reader asks whether anything is flagged, wrong, or a red flag, you MUST say what could ` +
        `not be checked in the SAME answer — "nothing flagged in what we could check, and here is what we could ` +
        `not check" is the honest shape. "No red flags" on its own is a claim this data does not support.`,
    );
  }
  // ★ VERBATIM, NEVER RE-COMPOSED. Null whenever something fired; the rows speak for themselves then.
  if (c.quietNote) L.push(`${pad}${c.quietNote}`);
  const readFrom = readFromLine(section);
  if (readFrom) L.push(`${pad}${readFrom}`);

  for (const f of section.fired) {
    L.push(`${pad}- FILED FINDING "${f.name}" (${f.kind === "red_flag" ? "red flag" : "pattern"}${f.severity ? `, ${f.severity}` : ""}) — ${whenFrom(f)}`);
    // The row's SERVER-RENDERED verdict — the same sentence the stock page and the watchlist show.
    L.push(`${pad}    Vytal's read${who}: ${f.verdict}`);
    // The receipts, through the catalogue's reader vocabulary. No key, no threshold, no study figure.
    const ev = evidenceLine(f.key, f.evidence);
    if (ev) L.push(`${pad}    Measured: ${ev}`);
  }

  // ⚠ THE INSTRUCTION IS EMITTED ONCE, NOT PER LINE. KOTAKBANK declines eight capabilities; the same
  //   sentence eight times is the payload saying one thing eight ways, and a repeated instruction reads
  //   as emphasis on the last item rather than as a rule about the list.
  if (section.declined.length) {
    L.push(`${pad}Not assessable on this company — say we could not check these; never that they came back clean:`);
    for (const d of section.declined) {
      L.push(`${pad}- COULD NOT ASSESS ${d.capability} — ${d.phrase}.`);
    }
  }

  return L;
}

/** The block as one string, for a caller that already holds a paragraph rather than a line list. */
export const filingFactsText = (
  section: FilingFindingsSection | null,
  opts: { subject?: string; indent?: string } = {},
): string => renderFilingFacts(section, opts).join("\n");
