// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXECUTOR — runs a plan. §5.3's other half.
//
// ★ EVERY FIGURE IS PRODUCED HERE, NOT IN THE PLAN. The plan said "shareholding, then the ownership
//   pillar"; this resolves both and formats them. The model chose the shape; the numbers were never
//   near it.
//
// ⚠ A BLOCK THAT RESOLVES TO NOTHING IS DROPPED, WITH ITS LEAD. Admission checked the manifest, but
//   the manifest is a summary and a resolver can still come back empty. The §4.5 rule holds at
//   execution too: no empty cards, and no orphan sentence introducing a card that is not there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveCompanySnapshot } from "../resolve/company-snapshot.js";
import { resolvePillarDecomposition } from "../resolve/pillar-decomposition.js";
import { resolveStockCoverage } from "../resolve/stock-coverage.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { anchorSection, nextSection } from "../section/kinds/anchor.js";
import { metricTableSection, ownershipSection } from "../section/kinds/table.js";
import { readPledgeFromDerived } from "../resolve/pledge.js";
import { waterfallSection } from "../section/kinds/decomposition.js";
import { pillarSection, ownershipPillarExtras } from "../section/kinds/pillar.js";
import { calloutSection } from "../section/kinds/callout.js";
import { coverageSection } from "../section/kinds/coverage.js";
import type { AnySection, ComposedAnswer } from "../composition/contract.js";
import type { Plan } from "./plan.js";
import type { PillarKey } from "../resolve/pillar-decomposition.js";
import { stockCoverage } from "../resolve/contract.js";
import {
  priceBlock, quarterSeriesBlock, eventsBlock, ownershipEventsBlock,
  ownershipSeriesBlock, peersBlock, newsBlock,
} from "./blocks.js";

export async function executePlan(symbol: string, plan: Plan): Promise<ComposedAnswer> {
  const [cov, snap, dec] = await Promise.all([
    resolveStockCoverage(symbol),
    resolveCompanySnapshot(symbol),
    resolvePillarDecomposition(symbol),
  ]);
  const d = snap.ok ? snap.data : null;
  const p = dec.ok ? dec.data : null;

  const sections: AnySection[] = [coverageSection(cov.coverage) as AnySection];
  const leads: Record<string, string> = {};
  // §4.3 as amended — what each block SHOWED, said after it. See composition/contract.ts.
  const after: Record<string, string> = {};
  const push = (sec: AnySection | null, lead: string, epilogue?: string) => {
    if (!sec) return;
    /**
     * ★ THE KEY IS INDEXED, AND THE UNINDEXED FORM WAS SILENTLY WRONG WHENEVER A PLAN ASKED FOR TWO
     *   OF ANYTHING.
     *
     * ⚠ "why is INFY scored the way it is" PLANNED TWO `pillar` BLOCKS — foundation and momentum —
     *   and both produce `DECOMPOSITION:pillar-bars`. On the plain key the second write overwrote
     *   the first, so the FOUNDATION card was introduced by the MOMENTUM sentence ("The momentum
     *   pillar tracks the trajectory of recent performance…") and concluded by the momentum epilogue,
     *   and the momentum card carried the identical pair underneath it. Four sentences on screen,
     *   two of them attached to the wrong component, and each one individually well written — which
     *   is why it reads as a model repeating itself rather than as a keying bug.
     *
     *   `AnswerProse.leads` documented this exact collision and the indexed form that fixes it, and
     *   `families/market.ts` already writes indexed keys for its two `opposed-bars`. This path — the
     *   PLANNED one, which is most answers — never did.
     *
     * ★ `sections.length` BEFORE THE PUSH *IS* THE SECTION'S INDEX, which is the same index the
     *   renderer counts with. Only the indexed key is written: the renderer resolves
     *   `KIND:renderer#i` → `KIND:renderer` → `KIND`, so answers stored before this still replay on
     *   the fallback exactly as they did.
     */
    const key = `${sec.kind}:${sec.renderer}#${sections.length}`;
    leads[key] = lead;
    // ⚠ ONLY WHEN THE BLOCK ACTUALLY RENDERED. A plan may carry an `after` for a block whose data
    //   turned out to be absent; storing it anyway would leave a sentence describing a component
    //   that is not on the page — a caption for a vanished chart, which is worse than either.
    if (epilogue && epilogue.trim()) after[key] = epilogue.trim();
    sections.push(sec);
  };

  for (const b of plan.blocks) {
    switch (b.id) {
      case "business":
        push(d ? (anchorSection(snap) as AnySection) : null, b.lead, b.after); break;
      case "metrics":
        push(d && (d.metrics.length || d.annualRows.length) ? (metricTableSection(d, cov.coverage) as AnySection) : null, b.lead, b.after); break;
      case "shareholding":
        // ★ THE PLEDGE RULING APPLIES ON THE PLANNED PATH TOO, AND THAT IS THE WHOLE VALUE OF HAVING
        //   ONE HOME FOR IT. `CompanySnapshot` carries only the DERIVED pledge value, which cannot
        //   reach the positive state on its own (both raw columns are needed to cross-check), so this
        //   path gets the conservative reading — see resolve/pledge.ts#readPledgeFromDerived.
        push(d?.shareholding ? (ownershipSection({
          periodKey: d.shareholding.periodKey,
          parts: d.shareholding.parts,
          promoterPct: d.shareholding.promoterPct,
          promoterDeltaPp: d.shareholding.promoterDeltaPp,
          instDeltaPp: d.shareholding.instDeltaPp,
          undisclosed: d.shareholding.undisclosed,
          pledge: readPledgeFromDerived(d.shareholding.pledgedPctOfPromoter, d.shareholding.promoterPct),
        }, cov.coverage) as AnySection) : null, b.lead, b.after); break;
      case "score":
        push(p ? (waterfallSection(dec) as AnySection) : null, b.lead, b.after); break;
      case "pillar": {
        if (!p) break;
        const which = (b.pillar ?? "ownership") as PillarKey;
        const extras = which === "ownership"
          ? ownershipPillarExtras((await buildOwnershipView(symbol, 8).catch(() => null) as { current?: unknown } | null)?.current ?? null)
          : { parts: [], baseline: null, baselineReason: null };
        push(pillarSection(p, which, extras, cov.coverage) as AnySection, b.lead, b.after);
        break;
      }
      case "findings":
        push(calloutSection(`${symbol} for anything that needed raising`, [], cov.coverage, "findings") as AnySection, b.lead, b.after); break;

      // ── ★ THE SEVEN STAGE-7 BLOCKS. Each resolves ON DEMAND, inside its own case, and never at the
      //    top of the function: a plan that did not ask for the price series must not pay for it.
      case "price":           push(await priceBlock(symbol), b.lead, b.after); break;
      case "quarterSeries":   push(await quarterSeriesBlock(symbol), b.lead, b.after); break;
      case "events":          push(await eventsBlock(symbol), b.lead, b.after); break;
      case "ownershipEvents": push(await ownershipEventsBlock(symbol), b.lead, b.after); break;
      case "ownershipSeries": push(await ownershipSeriesBlock(symbol), b.lead, b.after); break;
      case "peers":           push(await peersBlock(symbol), b.lead, b.after); break;
      case "news":            push(await newsBlock(symbol), b.lead, b.after); break;
    }
  }

  const sh = d?.shareholding;
  const margin = d?.metrics.find((m) => m.label === "Operating margin");
  const next = nextSection(symbol, {
    scored: (stockCoverage(cov.coverage)?.tier ?? 0) === 2,
    findings: [],
    pledged: (sh?.pledgedPctOfPromoter ?? 0) > 0,
    instSold: (sh?.instDeltaPp ?? 0) < -0.25,
    thin: (stockCoverage(cov.coverage)?.depth.quarters ?? 0) < 8,
    marginFell: (margin?.qoqPct ?? 0) < -2,
  }) as AnySection;
  // ★ THE MODEL'S FOLLOW-UPS WIN WHEN IT WROTE ANY — that was one of the jobs it was given. The
  //   signal-driven chips remain the floor, so an answer always offers somewhere to go.
  if (plan.followUps.length) {
    (next as { payload: { chips: unknown } }).payload = {
      chips: plan.followUps.map((f) => ({ label: f.surface, question: f.question, surface: f.surface })),
    };
  }
  sections.push(next);
  leads.NEXT = "If any of that raised a question, these follow it.";

  return { sections, prose: { opening: plan.opening, leads, after, close: plan.close } };
}
