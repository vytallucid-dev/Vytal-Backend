// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PG · THE POND ITSELF — "how is the large-cap pharma peer group doing", with no company named.
//
// ── ★★ THE ONE GENUINE SECOND SHAPE IN THIS FAMILY, AND IT IS SUBJECTLESS ────────────────────────
// `families/peer-group.ts` argues that PG's four candidate splits collapse into ONE composition,
// because they read one source and want one sequence. This is the exception, and it earns the split
// on the same test the others failed:
//
//   · different COVERAGE half — no subject at all, so no tier, no depth, no `StockCoverage`
//   · different SEQUENCE — no "where the subject sits" section, because there is no subject
//   · different SENTENCE — the answer is about a set as a whole rather than a company inside it
//
// ⚠ AND UNTIL THIS BATCH IT WAS ANSWERED WITH THE WHOLE MARKET. Measured on the live model: it
//   classifies `screen · no subject`, `extractConditions` finds nothing, and `compose.ts` step 3g
//   fell through to `composeUniverseAnswer()` — so a question about a six-member pond returned the
//   band distribution of all 95 scored companies. That is §6.2's confident-wrong-artifact in its
//   quietest form: every number correct, none of them about what was asked.
//
// ── ★ IT IS NOT A COMPOSITION IN THE REGISTRY, AND THAT IS DELIBERATE ────────────────────────────
// `Predicate.subject: "none"` exists (Batch 1, for `ownership.movers`) and would express this — but
// the registry loop at step 4 is only reached AFTER step 3g, and step 3g owns every subjectless
// `screen` turn. Registering it would produce a composition that can never match, which is precisely
// the stage-5b defect this build has now hit twice. So it is called from step 3g directly, in the
// order that puts the most specific reading first, exactly as the market families are.
//
// ⚠ IT REFUSES RATHER THAN GUESSES. `matchPondName` requires EVERY distinguishing token of a pond's
//   name to be present, so "banks" alone matches neither Private nor PSU and returns null — and the
//   universe fallback then answers, honestly labelled. A near-miss would answer a question about six
//   companies with a different six, and every figure in it would be real.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolvePeerGroupByName, type PeerGroupRead } from "../../resolve/peer-group.js";
import { setTableSection, type SetTableColumn, type SetTableRow } from "../../section/kinds/set-table.js";
import { relativeSection } from "../../section/kinds/relative.js";
import { calloutSection, type CalloutItem } from "../../section/kinds/callout.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { chipSection, type Chip } from "../../section/kinds/anchor.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import type { AnySection } from "../contract.js";
import type { MarketTurnResult } from "./market.js";

const one = (v: number) => v.toFixed(1);
const pts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;

/** Same column parameter as the subject-relative answer — an unscored pond carries no score column. */
function columnsFor(d: PeerGroupRead): SetTableColumn[] {
  return d.pondScored
    ? [
        // ⚠ NO BAND COLUMN — it is derived from the composite beside it, so it restates rather than
        //   adds. It survives as the row `tag` (the dot) and in the digest. See families/peer-group.ts.
        { key: "score", label: "Health score", align: "number", primary: true },
        { key: "move", label: "Move", align: "number" },
      ]
    : [{ key: "filed", label: "Filed findings", align: "text", primary: true }];
}

function rowsFor(d: PeerGroupRead): SetTableRow[] {
  return d.rows.map((r): SetTableRow => ({
    key: r.symbol,
    title: r.name || r.symbol,
    symbol: r.symbol,
    tag: r.composite === null ? "not scored" : r.band,
    cells: d.pondScored
      ? {
          score: { display: r.composite === null ? "not scored" : one(r.composite), sort: r.composite },
          move: { display: r.delta === null ? "no prior reading" : pts(r.delta), sort: r.delta },
        }
      : {
          filed: {
            // ⚠ THREE SHORT STATES, AND THE MIDDLE ONE IS THE IMPORTANT ONE. "none raised" is a
            //   RESULT — the filing checks ran and came back clean — and "not filed" is a coverage
            //   fact about us. Collapsing them into a dash would be the §3.1 conflation in a cell.
            display: r.filingFired === null
              ? "not filed with us"
              : r.filingFired === 0 ? "none raised" : `${r.filingFired} raised`,
            sort: r.filingFired,
          },
        },
  }));
}

/**
 * Answer about a pond the sentence named. `null` when it named none — the caller then falls back to
 * the universe cross-section, which is a true answer to a different and broader question.
 */
export async function composePondAnswer(raw: string): Promise<MarketTurnResult | null> {
  const r = await resolvePeerGroupByName(raw);
  if (!r || !r.ok) return null;
  const d = r.data;

  const sections: AnySection[] = [
    coverageSection(r.coverage, `${d.groupName} — ${d.memberCount} companies on the roster`) as AnySection,
  ];
  const leads: Record<string, string> = {};
  const after: Record<string, string> = {};

  const roster = setTableSection({
    heading: `Everyone in ${d.groupName}`,
    columns: columnsFor(d),
    rows: rowsFor(d),
    totalAvailable: null,
    totals: [
      { label: "On the roster", value: String(d.memberCount) },
      // ⚠ BOTH DENOMINATORS. A median over a set whose size is not on screen has no bound.
      { label: "Of those, scored", value: d.pondScored ? String(d.scoredCount) : "none" },
      ...(d.pondScored && d.median !== null ? [{ label: "Group median", value: one(d.median) }] : []),
    ],
    emptyPhrase: blockCopy("peers_none"),
  }, r.coverage) as AnySection;
  sections.push(roster);
  leads[`ANCHOR:set-table#${sections.length - 1}`] = d.pondScored
    ? "Every company in the pond, best health score first."
    : "Every company in the pond. There are no scores to sort on, so this is what each of them has filed.";
  if (d.notAtCurrentPeriod.length > 0) {
    after[`ANCHOR:set-table#${sections.length - 1}`] =
      `${d.notAtCurrentPeriod.map((x) => `${x.symbol} is still at ${x.latestPeriod}`).join(", ")} — ` +
      `held out of the median rather than folded in, because a cross-section spanning two quarters ` +
      `would be comparing two different things.`;
  }

  // ═══ THE SPREAD ═══════════════════════════════════════════════════════════════════════════════
  //
  // ★ `distribution-strip` IS THE RENDERER FOR "WHAT SHAPE IS THIS SET", and its own guard exempts it
  //   from the two-member reference rule because its reference IS the band histogram. On a pond that
  //   is the honest picture: six companies spread across five bands is a different fact from a median.
  if (d.pondScored && d.bands.some((b) => b.count > 0)) {
    const spread = relativeSection({
      renderer: "distribution-strip",
      heading: `How ${d.groupName} is spread`,
      unit: "score",
      marks: [],
      bands: d.bands.filter((b) => b.count > 0).map((b) => ({ label: b.label.replace(/_/g, " "), count: b.count })),
      referenceLabel: `${d.groupName}, ${d.scoredCount} scored members`,
      referenceCount: d.scoredCount,
      windowLabel: d.periodKey,
    }, r.coverage) as AnySection;
    sections.push(spread);
    leads[`RELATIVE:distribution-strip#${sections.length - 1}`] =
      "The same members by band, which is the shape a median cannot show.";
  }

  // ═══ WHAT MOVED ═══════════════════════════════════════════════════════════════════════════════
  if (d.pondScored) {
    const items: CalloutItem[] = [
      ...d.movers.risers.slice(0, 2).map((m) => ({
        label: `${m.symbol} rose`, detail: `${pts(m.delta)} on its own previous reading`, severity: "low" as const,
      })),
      ...d.movers.slippers.slice(0, 2).map((m) => ({
        label: `${m.symbol} slipped`, detail: `${pts(m.delta)} on its own previous reading`, severity: "low" as const,
      })),
    ];
    const mv = calloutSection(
      `${d.groupName} for the largest moves between readings`, items, r.coverage, "largest-movers",
    ) as AnySection;
    sections.push(mv);
    leads[`${mv.kind}:${mv.renderer}#${sections.length - 1}`] =
      "And what moved inside the group between the last two readings.";
    if (items.length > 0) {
      after[`${mv.kind}:${mv.renderer}#${sections.length - 1}`] =
        "Each is measured against its OWN previous score rather than against the group, so the pond " +
        "can slip while every member holds — or hold while members move in opposite directions.";
    }
  }

  // ═══ CHIPS from what is actually in the pond ═══════════════════════════════════════════════════
  const chips: Chip[] = [];
  for (const m of d.rows.slice(0, 2)) {
    chips.push({ label: m.symbol, question: `How is ${m.symbol} doing?`, surface: "Overview" });
  }
  if (d.rows.length >= 2) {
    chips.push({ label: "Head to head", question: `Compare ${d.rows[0]!.symbol} and ${d.rows[1]!.symbol}`, surface: "Comparison" });
  }
  chips.push({ label: "Peer groups", question: "Which peer groups do you build?", surface: "Peer groups" });
  sections.push(chipSection(chips.slice(0, 5)) as AnySection);
  leads.NEXT = "If the pond raised a question, these follow it.";

  const opening: string[] = [
    d.pondScored
      ? `${d.groupName} reads ${d.descriptor ? `${d.descriptor} — ` : ""}a median health score of ${one(d.median!)} ` +
        `across the ${d.scoredCount} member${d.scoredCount === 1 ? "" : "s"} we score, of ${d.memberCount} on the roster` +
        (d.medianDrift !== null && Math.abs(d.medianDrift) >= 0.05
          ? `, ${d.medianDrift > 0 ? "up" : "down"} ${Math.abs(d.medianDrift).toFixed(1)} points on ${d.priorPeriodKey ?? "the previous reading"}.`
          : ".")
      : `${d.groupName} holds ${d.memberCount} companies and we score none of them, so there is no group median and no ranking inside it.`,
    // ★★ HOW THE GROUP IS BUILT, IN THE OPENING. It bounds every membership claim under it.
    d.membershipBasis.sentence,
  ];
  if (d.redFlagMembers !== null && d.redFlagMembers > 0) {
    opening.push(
      `${d.redFlagMembers} of the ${d.scoredCount} scored members is currently firing at least one red flag` +
      `${d.redFlagMembers === 1 ? "" : ""}. That is a count of checks that fired, not a ranking of trouble.`,
    );
  }

  return {
    kind: "composed",
    compositionId: "peers.pond",
    sections,
    prose: {
      opening,
      leads,
      after,
      close: d.pondScored
        ? `A peer group is a reference set we chose rather than one the market publishes. Everything above ` +
          `describes these ${d.memberCount} companies and says nothing about the wider market.`
        : `The roster and what each company filed is what we can stand behind here. A group reading would ` +
          `need scores we do not compute for any of these companies.`,
    },
    missLogged: false,
  };
}
