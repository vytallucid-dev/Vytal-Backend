// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · pillar-bars — ONE pillar opened up.
//
// ★ THE BLOCK THE PLANNER ASKS FOR WHEN A QUESTION IS ABOUT A PILLAR'S SUBJECT. "Who owns TCS" is an
//   ownership question, so the ownership pillar's own reading belongs in the answer — not the whole
//   four-pillar waterfall, which answers a question nobody asked.
//
// ⚠ WHAT IS SHOWN AND WHAT IS NOT. The pillar's reading and what it contributed are facts about the
//   company. Its WEIGHT is calibration and stays out (§4.5). The parts below are named states, not
//   scores against a bar — "neutral, within ₹1 crore" is what the engine concluded, and the bar it
//   concluded it against is ours, not the company's.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import type { PillarDecomposition, PillarKey } from "../../resolve/pillar-decomposition.js";
import { digest, line, unchanged, withheld, type DigestLine, type Section } from "../contract.js";

export interface PillarPart { readonly label: string; readonly state: string; readonly note: string | null }
export interface PillarPayload {
  readonly pillar: PillarKey;
  readonly label: string;
  readonly subtotal: number | null;
  readonly contribution: number | null;
  readonly composite: number;
  readonly parts: readonly PillarPart[];
  readonly baseline: number | null;
  readonly baselineReason: string | null;
}

const LABEL: Record<PillarKey, string> = {
  foundation: "Foundation", momentum: "Momentum", market: "Market", ownership: "Ownership",
};
/** Engine category codes → the reader's words. Authored here once; never a raw code on a surface. */
const CATEGORY_LABEL: Record<string, string> = {
  A_promoter: "Promoter activity", B_institutional: "Institutional flows",
  C_insider: "Insider dealing", D_block: "Block deals",
};
const STATE_WORD: Record<string, string> = {
  neutral_within_1cr: "nothing material either way",
  neutral_within_0p1pct: "nothing material either way",
  scored: "measured, no adjustment",
};

export function pillarSection(
  d: PillarDecomposition,
  pillar: PillarKey,
  extras: { parts: PillarPart[]; baseline: number | null; baselineReason: string | null },
  coverage: Coverage,
): Section<"DECOMPOSITION", PillarPayload> {
  const p = d.parts.find((x) => x.pillar === pillar);
  const payload: PillarPayload = {
    pillar, label: LABEL[pillar],
    subtotal: p?.subtotal ?? null,
    contribution: p?.contribution ?? null,
    composite: Math.round(d.composite * 100) / 100,
    parts: extras.parts,
    baseline: extras.baseline,
    baselineReason: extras.baselineReason,
  };

  const lines: DigestLine[] = [
    p?.subtotal != null
      ? line(`${LABEL[pillar]} reading`, `${p.subtotal.toFixed(1)} out of 100`)
      : withheld(`${LABEL[pillar]} reading`, "this pillar could not be scored this period"),
    p?.contribution != null
      ? line("What it contributed", `${p.contribution.toFixed(1)} of the ${payload.composite.toFixed(1)} total`)
      : withheld("What it contributed", "not measured, so its weight was carried by the other pillars"),
  ];
  if (extras.baseline != null) {
    lines.push(unchanged("Starting point", `${extras.baseline.toFixed(0)} out of 100, before anything moved it`));
  }
  for (const part of extras.parts) {
    lines.push(part.note ? line(part.label, part.note) : unchanged(part.label, "nothing material either way"));
  }

  return {
    kind: "DECOMPOSITION", renderer: "pillar-bars", payload,
    digest: digest(`The ${LABEL[pillar].toLowerCase()} pillar, opened up`, [
      { label: `What ${LABEL[pillar].toLowerCase()} reads, and what moved it`, lines },
    ]),
    coverage, interactions: [],
  };
}

/** Ownership's own parts, from the ownership read. Other pillars fall back to no parts — the section
 *  still renders its reading and contribution, which is honest rather than empty. */
export function ownershipPillarExtras(current: unknown): { parts: PillarPart[]; baseline: number | null; baselineReason: string | null } {
  const c = current as {
    baseline?: number; baselineReason?: string; pledgingAdjustment?: number;
    flowCategories?: { category: string; categoryState: string; bandLanded: string | null }[];
  } | null;
  if (!c) return { parts: [], baseline: null, baselineReason: null };
  const parts: PillarPart[] = (c.flowCategories ?? []).map((f) => ({
    label: CATEGORY_LABEL[f.category] ?? f.category,
    state: f.categoryState,
    note: f.bandLanded ? (STATE_WORD[f.bandLanded] ?? f.bandLanded.replace(/_/g, " ")) : null,
  }));
  if (c.pledgingAdjustment != null) {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════════════
     * ★★ THE PLEDGE RULING REACHES HERE TOO — AND THIS LINE WAS ASSERTING THE THING IT FORBIDS.
     *
     * ⚠ IT READ `pledgingAdjustment === 0 ? "no adjustment — nothing pledged"`. The adjustment is zero
     *   for nearly every scored stock, because it is computed from `pledged_shares` — and 87.2% of the
     *   25,168 filings we hold carry that column as 0 with **zero** NULLs, which is a column where
     *   "not disclosed" was written as a zero (1,555 rows contradict themselves outright). So this
     *   note was telling the reader that nothing is pledged, on the same non-evidence the register
     *   card was corrected for. Found by reading the live pillar payload after `pillar-bars` was
     *   swapped into the ownership family, not by review.
     *
     * ★ WHAT THE ZERO HONESTLY MEANS IS "THE SCORE WAS NOT MOVED BY PLEDGING", which is a fact about
     *   the ENGINE and is true whatever the filing said. That is what it now says. The non-zero arm
     *   is untouched: an adjustment that actually fired is a real, engine-computed fact.
     *
     * ⚠ AND IT DELIBERATELY DOES NOT REPEAT THE FULL RULING SENTENCE. `resolve/pledge.ts` owns the
     *   reader-facing explanation and the register card carries it; saying it twice in one answer is
     *   two homes for one statement (N-5).
     * ═══════════════════════════════════════════════════════════════════════════════════════════════
     */
    parts.push({
      label: "Pledging",
      state: "scored",
      note: c.pledgingAdjustment === 0
        ? "did not move the reading either way"
        : `adjusted the reading by ${c.pledgingAdjustment}`,
    });
  }
  return { parts, baseline: c.baseline ?? null, baselineReason: c.baselineReason ?? null };
}
