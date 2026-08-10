// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PEER CROSS-SECTION — what is compared, how it is counted, and the words for it. PURE: no
// database, no I/O, no prisma.
//
// ── ★ WHY THIS IS SPLIT OUT OF peers.ts ──────────────────────────────────────────────────────────
// peers.ts imports the DB client, and two things now need this shape without one:
//   · anchors.ts, which reads the SAME cross-section to say where a figure sits among co-members —
//     one fetch, two consumers, and no second definition of "who counts as comparable";
//   · the build gate, which must assert the counting and the wording on synthetic rows. A gate that
//     needs a database is neither deterministic nor deployable (verify-build-gate-hygiene.ts).
// Same split, and the same reason, as margins.ts and types.ts.
//
// ── ★★ THE SET PER FAMILY, AND WHY EACH ONE EARNS ITS PLACE (2a) ─────────────────────────────────
// The rule is NOT "every ratio the family files". A peer group answers one question — is this figure
// ordinary for a company of this kind — and it only answers it for figures that are comparable
// between two companies in the same group. Three tests, and a metric must pass all three:
//
//   1 · IT IS NOT A SIZE. A money LEVEL ("revenue ₹15,548 crore") compared across a peer group ranks
//       companies by how big they are, which the reader can already see and which says nothing about
//       the quarter. Levels are ratios only; money appears here as GROWTH and nowhere else.
//   2 · IT MEANS THE SAME THING IN BOTH COMPANIES. Net margin folds in other income and the effective
//       tax rate — both company-specific — which is exactly why verdict.ts qualifies a non-financial
//       on OPERATING margin and not on net. The peer set makes the same distinction for the same
//       reason, so the two surfaces cannot disagree about which margin describes the trading business.
//   3 · A READER WOULD ASK IT. Bad loans, cost-to-income and NII growth are the three things anyone
//       comparing two banks asks. Core capital and return on assets are real and comparable, and are
//       deliberately NOT here: three comparisons is a paragraph, six is a table nobody reads.
//
// ── ⚠ TWO FAMILIES ARE DECLARED AND DORMANT, AND THAT IS STATED RATHER THAN HIDDEN ───────────────
// MEASURED over the live universe: 148 stocks sit in a peer group with quarters on file, and ZERO of
// them are life or general insurers — all 23 groups are non-financial, banking or NBFC. So the two
// insurance sets below can never fire today. They are declared anyway, because the alternative is to
// leave them out and have the next person conclude insurers were considered and rejected. They will
// start working the day an insurance peer group exists, with no code change.
//
// ── ⚠⚠ AND THE NOUN IS AUTHORED, NOT DERIVED FROM THE LABEL ──────────────────────────────────────
// The obvious form — `${above} reported a higher ${gloss.label.toLowerCase()}` — breaks on the labels
// that are CLAUSES rather than noun phrases, which is the same defect the annual gaps copy already
// carries a note about. "4 reported a higher policies still being paid after 1 year" is what the
// derived form actually produces for a life insurer. So the comparative noun is declared per metric,
// beside the metric, where it is impossible to add one without writing the other.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";
import type { Family } from "./manifest.js";

/** Fewer than this many co-members that actually filed, and there is no comparison to make. */
export const MIN_PEERS_FILED = 3;

/** One metric the cross-section compares.
 *  · `level`  — the reported figure, in DISPLAY units (fractions already multiplied).
 *  · `growth` — the year-on-year move, in percent, recomputed from the raw pair on BOTH sides. */
export interface PeerMetricSpec {
  key: MetricKey;
  kind: "level" | "growth";
  /** The comparative noun, for "N reported a higher <noun>". Authored — see the header. */
  noun: string;
  /** Why this metric is in the set. Read by the gate; kept beside the entry so it cannot drift. */
  why: string;
}

export const PEER_METRICS = {
  non_financial: [
    { key: "revenue", kind: "growth", noun: "rise in revenue",
      why: "The top line, and the one comparison a reader makes unprompted. Recomputed from the raw pair — never revenue_yoy." },
    { key: "operatingMargin", kind: "level", noun: "operating margin",
      why: "The share of sales the TRADING business keeps. Net margin is excluded deliberately: it folds in other income and the tax rate, which are company-specific — the same distinction verdict.ts makes when it qualifies a non-financial on operating margin." },
  ],
  banking: [
    { key: "netInterestIncome", kind: "growth", noun: "rise in net interest income",
      why: "The family's top line. ★ THE COLUMN nii_yoy IS 0% POPULATED FOR FY26 Q2 AND Q3 — this is recomputed from the raw pair, which is the whole reason peers.ts does not reuse buildPeers." },
    { key: "grossNpaRatio", kind: "level", noun: "bad-loan share",
      why: "The state of the loan book, and the single figure that separates two banks. A bank's margin is this quarter's earnings; its loan book is next year's." },
    { key: "costToIncomeRatio", kind: "level", noun: "cost-to-income ratio",
      why: "What it costs the bank to earn a rupee. Comparable between banks in a way net margin is not, because it is measured before provisions and tax." },
  ],
  nbfc: [
    { key: "revenue", kind: "growth", noun: "rise in revenue", why: "The family's top line." },
    { key: "netMargin", kind: "level", noun: "net margin",
      why: "⚠ THE ONLY COMPARABLE RATIO THIS FAMILY FILES. The NBFC manifest carries no asset-quality ratio at all — impairment is a money line and its decomposition closes on 70% of rows (manifest note C17), so credit cost cannot be compared here. Stated as the limit it is." },
  ],
  life_insurance: [
    { key: "netPremiumIncome", kind: "growth", noun: "rise in premiums kept", why: "The family's top line." },
    { key: "persistencyRatio13Month", kind: "level", noun: "share of policies still being paid after a year",
      why: "Whether last year's customers stayed — the one thing a life insurer's quarter says that its premium line does not." },
    { key: "solvencyRatio", kind: "level", noun: "solvency ratio",
      why: "Capital against the regulator's floor. A MULTIPLE, not a percentage — format.ts renders it with the × glyph." },
  ],
  general_insurance: [
    { key: "grossPremiumsWritten", kind: "growth", noun: "rise in premiums sold", why: "The family's top line." },
    { key: "combinedRatio", kind: "level", noun: "combined ratio",
      why: "Whether the insurance book itself made money. 31 of 31 quarters in the universe are underwriting losses, so the LEVEL is where the difference between two insurers actually shows." },
    { key: "solvencyRatio", kind: "level", noun: "solvency ratio", why: "As for life insurance." },
  ],
} as const satisfies Record<Family, readonly PeerMetricSpec[]>;

export const peerMetricsFor = (family: Family): readonly PeerMetricSpec[] =>
  PEER_METRICS[family] as readonly PeerMetricSpec[];

/**
 * The comparable co-member figures for one (peer group, family, period), per metric key.
 *
 * ⚠ "COMPARABLE" IS NARROWER THAN "FILED", AND THE DIFFERENCE IS COUNTED. A co-member that filed the
 * quarter but did not report this metric — or reported one outside its manifest bounds — is in
 * `filed` and NOT in `values`. peers.ts's original note is the rule: saying "of the 6 that filed, 4
 * reported a higher share" when only 5 had a figure quietly attributes the sixth to the majority.
 */
export interface PeerCrossSection {
  peerGroupName: string;
  /** Same-family co-members that filed this exact period. */
  filed: number;
  /** metric key → comparable co-member figures. DISPLAY units for `level`, percent for `growth`. */
  values: Record<string, number[]>;
}

/** ONE metric's peer comparison, as a count. Never a ranking — see the note below. */
export interface PeerComparison {
  key: string;
  label: string;
  /** Co-members with a comparable figure. At or above MIN_PEERS_FILED by construction. */
  n: number;
  /** How many sat above / below the subject. `n − above − below` is how many matched it exactly. */
  above: number;
  below: number;
  display: string;
}

/** How this quarter sat against same-family peers that filed the same period. */
export interface PeerContextFact {
  peerGroupName: string;
  filed: number;
  /** One per metric that cleared the gate. Never empty — a fact with no comparisons is null instead. */
  comparisons: PeerComparison[];
}

const companies = (n: number): string => `${n} ${n === 1 ? "company" : "companies"}`;

/** ⚠ "none", NEVER "0". A count sentence reaching zero on one side is the COMMON case when the subject
 *  sits at an end of the group — and "0 a lower one" reads as a rendering fault rather than as a fact. */
const count = (n: number): string => (n === 0 ? "none" : String(n));

/**
 * ★ THE COUNT, AND IT STAYS A COUNT (2d).
 *
 * "Outperformed most peers" is a verdict — it implies a judgement about which companies are worth
 * beating and grants Vytal an opinion it does not have. Every sentence this function produces is
 * checkable against the same tables and none of them says anyone won.
 *
 * ⚠ EXACT MATCHES ARE NAMED, NOT ROUNDED INTO A SIDE. Two banks reporting the same bad-loan share to
 * the stored precision is rare (MEASURED: 1% of positions) and it is real. Folding the match into
 * "higher" or "lower" would be a false statement about a specific company, which is the one error a
 * count is supposed to be incapable of.
 */
export function buildPeerComparisons(
  family: Family,
  cs: PeerCrossSection,
  own: Record<string, number | null>,
): PeerContextFact | null {
  const comparisons: PeerComparison[] = [];

  for (const spec of peerMetricsFor(family)) {
    const mine = own[spec.key];
    if (mine === null || mine === undefined || !Number.isFinite(mine)) continue;

    const theirs = cs.values[spec.key] ?? [];
    if (theirs.length < MIN_PEERS_FILED) continue;

    const above = theirs.filter((v) => v > mine).length;
    const below = theirs.filter((v) => v < mine).length;
    const same = theirs.length - above - below;

    // ⚠ DEGENERATE · EVERY CO-MEMBER REPORTED EXACTLY THIS FIGURE. Nothing sits either side, so the
    // sentence would be "0 higher and 0 lower" — a comparison that compares nothing. Renders as absent.
    if (above === 0 && below === 0) continue;

    const label = metricGloss(spec.key).label;
    const tail = same > 0 ? `, and ${same} reported the same` : "";
    // ── 2a · WAS FRONT-LOADED ON EVERY PEER SENTENCE ON EVERY CARD. "Of the 3 companies in its peer
    // group that have filed this quarter, none had a smaller rise in revenue and 3 a larger one."
    // The reader holds an eleven-word qualifier before the first count arrives, and the second half
    // is elliptical ("3 a larger one" — the verb is three clauses back). The population is a fact of
    // its own and goes first as its own sentence; the counts then both carry their verb.
    const population = `${companies(theirs.length)} in its peer group have filed this quarter.`;
    // ⚠ `count` RETURNS "none", AND IT NOW OPENS A SENTENCE. Splitting the old single sentence put a
    // lowercase "none had a smaller rise in revenue" straight after a full stop — caught on IDEA's
    // first re-render. A count of zero is the COMMON case whenever the subject sits at an end of its
    // group, so this is not an edge.
    const cap = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
    const display =
      spec.kind === "growth"
        ? `${population} ${cap(count(below))} had a smaller ${spec.noun}, and ` +
          `${count(above)} had a larger one${tail}.`
        : `${population} ${cap(count(above))} reported a higher ${spec.noun}, and ` +
          `${count(below)} reported a lower one${tail}.`;

    comparisons.push({ key: spec.key, label, n: theirs.length, above, below, display });
  }

  return comparisons.length > 0 ? { peerGroupName: cs.peerGroupName, filed: cs.filed, comparisons } : null;
}
