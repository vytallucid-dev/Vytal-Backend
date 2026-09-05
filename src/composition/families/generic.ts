// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GENERIC COMPOSITION — §6.4. The extensibility mechanism, not a fallback.
//
// A subject resolved with no family matched STILL HAS DATA. The composer picks what fits the lens,
// renders standard sections, and says plainly that this is assembled from what we hold rather than a
// purpose-built view. The reader gets a real answer either way; the system gets a miss-log row.
//
// §6.4's worked case: "How much does TCS spend on R&D?" — no family, subject resolves, lens maps to a
// cost line we do not hold. The honest output NAMES the missing line, shows the cost structure we do
// hold, and chips toward the nearest real composition. Silence would be the failure.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { resolvePillarDecomposition } from "../../resolve/pillar-decomposition.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { waterfallSection } from "../../section/kinds/decomposition.js";
import { calloutSection } from "../../section/kinds/callout.js";
import { recordMiss } from "../miss-log.js";
import type { AnySection, ComposeContext } from "../contract.js";
import type { LensSlot } from "../../router/contract.js";
import { stockCoverage } from "../../resolve/contract.js";

/** Lines a lens asks for that this system does not hold, named so the absent state can say WHICH. */
const NOT_HELD: Partial<Record<LensSlot, readonly string[]>> = {
  fundamentals: ["research and development spend", "segment-level cost lines", "employee headcount"],
  valuation: ["forward multiples", "analyst estimates"],
  events: ["management guidance"],
};

function missingFor(raw: string, lens: LensSlot | null): string[] {
  const pool = lens ? (NOT_HELD[lens] ?? []) : [];
  const t = raw.toLowerCase();
  const named = pool.filter((p) => p.split(" ").some((w) => w.length > 3 && t.includes(w.slice(0, 5))));
  // ★ /r&d/ is checked explicitly because the phrase a reader types ("R&D") shares no long token with
  //   the line's name ("research and development spend") — the generic matcher below cannot see it.
  if (/\br ?& ?d\b|research and development/i.test(raw) && !named.includes("research and development spend")) {
    named.push("research and development spend");
  }
  return named;
}

export async function composeGeneric(ctx: ComposeContext): Promise<readonly AnySection[]> {
  const { turn } = ctx;
  const symbol = ctx.symbol;
  const missing = missingFor(turn.raw, turn.router.lens);
  const sections: AnySection[] = [];

  if (!symbol) {
    // No subject and no family. There is nothing to assemble — but the STOP is still a rendered
    // section carrying why, not an empty response.
    const empty = { subject: null, query: null };
    sections.push(calloutSection("your question against the families we hold", [], empty, "findings") as AnySection);
    recordMiss({ branch: "generic", raw: turn.raw, slots: turn.router, resolvedSymbols: [], sectionsChosen: ["CALLOUT"], missingData: missing, userId: ctx.reader?.userId ?? null });
    return sections;
  }

  const cov = await resolveStockCoverage(symbol);
  sections.push(coverageSection(cov.coverage) as AnySection);

  // What we DO hold for this subject, chosen by tier rather than by family.
  const tier = cov.ok ? stockCoverage(cov.coverage)?.tier ?? 0 : stockCoverage(cov.coverage)?.tier ?? 0;
  if (tier === 2) {
    sections.push(waterfallSection(await resolvePillarDecomposition(symbol)) as AnySection);
  }

  // ★ THE NAMED ABSENCE. "We do not hold R&D spend for this company" is a better answer than a
  //   generic apology, and it is the row that tells the operator which family to build next.
  sections.push(
    calloutSection(
      missing.length
        ? `whether we hold ${missing.join(", ")} for ${symbol}`
        : `${symbol} against the families we hold`,
      missing.map((m) => ({
        label: m.replace(/^\w/, (c) => c.toUpperCase()),
        detail: `Not held for ${symbol}. This view is assembled from what we do hold, not built for this question.`,
        severity: "low" as const,
      })),
      cov.coverage,
      // ★ THE ONE CALL SITE THAT CAN PASS A NON-EMPTY LIST, and therefore the only producer of
      //   `CALLOUT : divergence` in the system. Named explicitly now — it used to arrive by
      //   default, which is why a verification pass read the pair as dead.
      "divergence",
    ) as AnySection,
  );

  recordMiss({
    branch: "generic",
    raw: turn.raw,
    slots: turn.router,
    resolvedSymbols: [symbol],
    sectionsChosen: sections.map((s) => `${s.kind}:${s.renderer}`),
    missingData: missing,
    // From the REQUEST's session, never the payload — the same rule every `me` route holds to.
    userId: ctx.reader?.userId ?? null,
  });
  return sections;
}
