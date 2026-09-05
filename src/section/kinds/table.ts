// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · statement-trend — the metric table. What moved, and against what.
// DECOMPOSITION · ownership-split — who owns it, as parts of one whole.
//
// ★ A CHANGE COLUMN IS A COMPARISON AND MUST NAME ITS BASE. "+13.9%" is meaningless without "against
//   the same quarter last year". Both columns are labelled in the header and repeated in the digest,
//   because the model cannot see the header.
//
// ⚠ A NULL CHANGE IS NOT A ZERO CHANGE. The comparison period may not be held — a company with four
//   quarters has no year-ago quarter — and rendering that as 0.0% states the figure did not move.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { CompanySnapshot, MetricRow } from "../../resolve/company-snapshot.js";
import type { Coverage } from "../../resolve/contract.js";
import type { PledgeReading } from "../../resolve/pledge.js";
import { digest, line, unchanged, withheld, type DigestGroup, type Section } from "../contract.js";

/**
 * What the register renderer needs. Deliberately NOT `ShareholdingSplit` — see `ownershipSection`.
 * A caller assembles this, which is one line at each of the two call sites and forces each of them to
 * have gone through `resolve/pledge.ts` to get a reading at all.
 */
export interface RegisterInput {
  readonly periodKey: string;
  readonly parts: readonly { key: string; label: string; pct: number }[];
  readonly promoterPct: number | null;
  readonly promoterDeltaPp: number | null;
  readonly instDeltaPp: number | null;
  readonly undisclosed: readonly string[];
  readonly pledge: PledgeReading;
}

export interface TablePayload {
  readonly periodKey: string | null;
  readonly quarterRows: readonly MetricRow[];
  readonly annualFy: string | null;
  readonly annualRows: readonly MetricRow[];
}

const fmt = (v: number | null, unit: MetricRow["unit"]): string =>
  v === null ? "not reported"
  : unit === "cr" ? (v >= 100000 ? "₹" + (v / 100000).toFixed(2) + " lakh Cr" : "₹" + Math.round(v).toLocaleString("en-IN") + " Cr")
  : unit === "pct" ? v.toFixed(2) + "%" : v.toFixed(2) + "×";
const chg = (v: number | null, u: MetricRow["changeUnit"]): string =>
  v === null ? "no comparison held" : (v > 0 ? "+" : "") + v.toFixed(u === "pp" ? 2 : 1) + (u === "pp" ? "pp" : "%");

export function metricTableSection(d: CompanySnapshot, coverage: Coverage): Section<"SERIES", TablePayload> {
  const groups: DigestGroup[] = [];
  if (d.metrics.length) {
    groups.push({
      label: "The quarter just reported, against the one before and the year before",
      lines: d.metrics.map((m) =>
        m.value === null
          ? withheld(m.label, "not reported this quarter")
          : Math.abs(m.yoyPct ?? 0) < 0.05 && m.yoyPct !== null
            ? unchanged(m.label, fmt(m.value, m.unit) + " — flat against last year")
            : line(m.label, fmt(m.value, m.unit) + ", " + chg(m.qoqPct, m.changeUnit) + " on the previous quarter and " + chg(m.yoyPct, m.changeUnit) + " on the same quarter last year"),
      ),
    });
  }
  if (d.annualRows.length) {
    groups.push({
      label: "The full year, against the year before",
      lines: d.annualRows.map((m) =>
        m.value === null ? withheld(m.label, "not computed for this year")
        : line(m.label, fmt(m.value, m.unit) + ", " + chg(m.yoyPct, m.changeUnit) + " on the prior year"),
      ),
    });
  }
  if (!groups.length) groups.push({ label: "Figures", lines: [withheld("Metrics", "no quarterly or annual figures held")] });

  return {
    kind: "SERIES", renderer: "statement-trend",
    payload: {
      periodKey: d.latest?.periodKey ?? null,
      quarterRows: d.metrics,
      annualFy: d.annual?.fiscalYear ?? null,
      annualRows: d.annualRows,
    },
    digest: digest("What moved, and against what", groups),
    coverage, interactions: [{ id: "toggle-basis", kind: "toggle", label: "Quarter / full year" }],
  };
}

export interface OwnershipPayload {
  readonly periodKey: string;
  readonly parts: readonly { key: string; label: string; pct: number }[];
  readonly promoterDeltaPp: number | null;
  readonly instDeltaPp: number | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ THIS FIELD WAS `pledgedPctOfPromoter: number | null` AND IT IS NOW A RULING, NOT A FIGURE.
   *
   * ⚠ THE OLD FIELD PRODUCED A FALSE STATEMENT ON MOST OF THE UNIVERSE, and both the backend and the
   *   frontend rendered it. `ownership-split.tsx` read: `=== 0 ? "None of the promoter holding is
   *   pledged."` — and 87.2% of the 25,168 filings we hold carry `pledged_shares = 0` with **zero**
   *   NULLs, which is a field where "not disclosed" was written as a zero. 1,555 of those rows report
   *   a positive pledge percentage against those zero shares, so the filing itself contradicts them.
   *
   * ⚠ AND WHERE A PLEDGE DOES EXIST, THE TWO COLUMNS DISAGREE ON ITS SIZE: of 3,205 rows where both
   *   are positive, 891 agree within half a point and 2,007 are more than five points apart (worst
   *   gap 183 points). ASHOKLEY, measured: 51.37% by share count against 59.03% by the pct column.
   *
   * ★ A NUMBER CANNOT BE PRINTED HERE, SO THE TYPE NO LONGER CARRIES ONE. `PledgeReading` is a state
   *   plus the one authored sentence a surface may show — the same mechanism as `DigestFragment`'s
   *   all-string leaves: the violation stops typechecking rather than being remembered. The ruling
   *   itself lives in `resolve/pledge.ts`, which is the only place that can produce one.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly pledge: PledgeReading;
  readonly undisclosed: readonly string[];
}

const pp = (v: number | null): string =>
  v === null ? "not comparable — a class was undisclosed in one of the two filings"
  : Math.abs(v) < 0.005 ? "unchanged" : (v > 0 ? "+" : "") + v.toFixed(2) + "pp";

/**
 * The register, as parts of one whole.
 *
 * ⚠ THE INPUT IS NO LONGER `ShareholdingSplit`, AND THE CHANGE IS THE PLEDGE RULING. That type
 *   carries `pledgedPctOfPromoter: number | null`, so accepting it would keep a pledge figure on the
 *   path into this renderer even if nothing printed it today. Two callers pass their own object:
 *   `families/ownership.ts` (from `resolveOwnership`, which reads the raw columns and rules on them)
 *   and `families/orientation.ts` (from `resolveCompanySnapshot`, which has only the derived value
 *   and therefore gets the conservative reading — see `readPledgeFromDerived`).
 */
export function ownershipSection(
  s: RegisterInput,
  coverage: Coverage,
): Section<"DECOMPOSITION", OwnershipPayload> {
  const lines = [
    ...s.parts.map((p) => line(p.label, p.pct.toFixed(2) + "% of equity")),
    s.promoterDeltaPp === null
      ? withheld("Promoter change", "no prior filing to compare against")
      : Math.abs(s.promoterDeltaPp) < 0.005
        ? unchanged("Promoter change", "unchanged on the previous filing")
        : line("Promoter change", pp(s.promoterDeltaPp) + " on the previous filing"),
    s.instDeltaPp === null
      ? withheld("Institutional change", "a class was undisclosed in one of the two filings, so the move cannot be read")
      : Math.abs(s.instDeltaPp) < 0.005
        ? unchanged("Institutional change", "unchanged on the previous filing")
        : line("Institutional change", pp(s.instDeltaPp) + " on the previous filing"),
    // ★ ONE LINE, ONE HOME, NO FIGURE. `withheld` for the two states we cannot speak to and `line` for
    //   the one we can — and even that one carries a sentence rather than a proportion. Rule 3 keeps
    //   it present in every case: a pledging line omitted reads to the model as a company with no
    //   pledge question, and it will write "nothing is pledged" into the gap.
    s.pledge.state === "disclosed_unquantified"
      ? line("Pledging", s.pledge.phrase)
      : withheld("Pledging", s.pledge.phrase),
  ];
  return {
    kind: "DECOMPOSITION", renderer: "ownership-split",
    payload: {
      periodKey: s.periodKey, parts: s.parts,
      promoterDeltaPp: s.promoterDeltaPp, instDeltaPp: s.instDeltaPp,
      pledge: s.pledge, undisclosed: s.undisclosed,
    },
    digest: digest("Who owns it", [{ label: "The register, as filed", lines }]),
    coverage, interactions: [],
  };
}
