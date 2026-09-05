// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CAPABILITY MANIFEST — what the planner is allowed to know before it plans.
//
// ★ AVAILABILITY, NEVER VALUES. Every field here answers "do we hold this?" and none answers "what is
//   it?". That is the line N-1 draws, moved one layer up: a planner that could see the figures could
//   plan a sentence around one, and then the figure is in the model's context and the guarantee is
//   gone. It sees that a pillar scored, not what it scored.
//
// ★ IT IS ALSO WHY THE TOKEN COST STAYS SMALL. A manifest is a few dozen booleans and counts — the
//   §0.2 claim survives the model getting a bigger job, because the job got bigger and the CONTEXT
//   did not.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { resolveStockCoverage } from "../resolve/stock-coverage.js";
import { resolveCompanySnapshot } from "../resolve/company-snapshot.js";
import { resolvePillarDecomposition } from "../resolve/pillar-decomposition.js";
import { readFindingsForSymbols } from "../scoring/read/symbol-findings.service.js";
import { stockCoverage } from "../resolve/contract.js";
import { readPledgeFromDerived } from "../resolve/pledge.js";

export interface CapabilityManifest {
  readonly symbol: string;
  readonly name: string;
  readonly tier: 0 | 1 | 2;
  readonly quartersHeld: number;
  readonly scoredPeriods: number | null;
  readonly asOf: string | null;

  readonly has: {
    readonly businessProfile: boolean;
    readonly latestQuarter: boolean;
    readonly quarterHistory: boolean;
    readonly annualAccounts: boolean;
    readonly marketValue: boolean;
    readonly shareholding: boolean;
    readonly shareholdingPrior: boolean;
    /**
     * ★★ WHETHER A PLEDGE IS ON FILE — AND IT IS NOW THE RULING'S ANSWER, NOT THE COLUMN'S.
     *
     * ⚠ THIS READ `d?.shareholding?.pledgedPctOfPromoter != null` AND WAS THEREFORE TRUE FOR NEARLY
     *   THE WHOLE UNIVERSE, because the field is zero rather than null on 87.2% of the 25,168 filings
     *   we hold (zero NULLs, and 1,555 rows contradicting themselves). A manifest flag is a promise to
     *   the planner that a block has something to say; this one promised a pledge figure on every
     *   stock with a filing, and the planner then planned a shareholding block whose own menu text
     *   said it carried "pledging".
     *
     * ★ It now goes through `resolve/pledge.ts`, so it is true only where a pledge is genuinely on
     *   file. On the derived value alone that reading is deliberately conservative — see
     *   `readPledgeFromDerived` — which means this flag is `false` more often than the data's
     *   optimistic reading would suggest. That is the correct direction for a capability claim.
     */
    readonly pledging: boolean;
    readonly pillarBreakdown: boolean;
    readonly findings: boolean;
    // ── ★ THE SEVEN STAGE-7 BLOCKS. Availability only, still — every one is "do we hold this?" and
    //    none is "what is it?". The §0.2 claim survives the menu doubling because seven booleans is
    //    seven booleans: the planner's job got bigger and its context did not.
    readonly priceSeries: boolean;
    readonly quarterSeries: boolean;
    readonly corporateEvents: boolean;
    readonly ownershipEvents: boolean;
    readonly ownershipSeries: boolean;
    readonly peerGroup: boolean;
    readonly news: boolean;
  };
  /** Which pillars actually scored — a planner asked about ownership needs to know if THAT one did. */
  readonly pillarsScored: readonly string[];
  /** Finding NAMES only. The planner may mention that something fired; the figures behind it are the
   *  executor's to fetch and format. */
  readonly findingNames: readonly string[];
  /** Classes the latest filing did not disclose — so a plan can name the gap instead of drawing it. */
  readonly undisclosed: readonly string[];
}

export async function buildManifest(symbol: string): Promise<CapabilityManifest | null> {
  const sym = symbol.trim().toUpperCase();
  // ⚠ GUARDED, THOUGH THE CALLER NOW CHECKS COVERAGE FIRST. `null` here means "no such stock" and the
  //   composer treats it as "fall through to the generic path", whose close is *"That is everything we
  //   hold on X today."* — so an unguarded throw was not the only hazard: a swallowed one would have
  //   produced that sentence over a read that never ran. `composeTurnBody` returns `read_failed.stock`
  //   before reaching here, and this stays defensive because `buildManifest` is exported and the next
  //   caller will not know that.
  const stock = await prisma.stock.findUnique({
    where: { symbol: sym }, select: { id: true, name: true },
  }).catch(() => null);
  if (!stock) return null;

  // ⚠ THE SEVEN NEW FLAGS ARE COUNTS, NOT RESOLVES. Calling each block's resolver here to find out
  //   whether it has anything would pay for every block on every turn — the exact cost the manifest
  //   exists to avoid. One extra round trip of cheap existence checks answers all seven.
  const [cov, snap, dec, find, avail] = await Promise.all([
    resolveStockCoverage(sym),
    resolveCompanySnapshot(sym),
    resolvePillarDecomposition(sym),
    readFindingsForSymbols([stock.id]).catch(() => null),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         (SELECT COUNT(*) FROM daily_prices WHERE stock_id = $1)                              AS prices,
         (SELECT COUNT(*) FROM corporate_events WHERE stock_id = $1)                          AS events,
         (SELECT COUNT(*) FROM insider_trades WHERE stock_id = $1)                            AS insider,
         (SELECT COUNT(*) FROM block_deals WHERE stock_id = $1)                               AS deals,
         (SELECT COUNT(*) FROM shareholding_patterns WHERE stock_id = $1)                     AS filings,
         (SELECT COUNT(*) FROM stock_news WHERE stock_id = $1
            AND published_at > now() - interval '30 days')                                    AS news,
         (SELECT COUNT(*) > 0 FROM stock_peer_groups WHERE stock_id = $1)                     AS peers`,
      stock.id,
    ).catch(() => [] as Array<Record<string, unknown>>),
  ]);
  const a = avail[0] ?? {};
  const n = (k: string): number => Number(a[k] ?? 0);

  const d = snap.ok ? snap.data : null;
  const p = dec.ok ? dec.data : null;
  const rows = (find as { rows?: { name?: string; ruleKey?: string }[] } | null)?.rows ?? [];

  return {
    symbol: sym,
    name: stock.name,
    tier: stockCoverage(cov.coverage)?.tier ?? 0,
    quartersHeld: stockCoverage(cov.coverage)?.depth.quarters ?? 0,
    scoredPeriods: stockCoverage(cov.coverage)?.depth.snapshots ?? null,
    asOf: stockCoverage(cov.coverage)?.asOf ?? null,
    has: {
      businessProfile: !!d?.coreBusiness,
      latestQuarter: !!d?.latest,
      quarterHistory: (d?.metrics.length ?? 0) > 0,
      annualAccounts: !!d?.annual,
      marketValue: d?.marketCapCr != null,
      shareholding: !!d?.shareholding,
      shareholdingPrior: d?.shareholding?.promoterDeltaPp != null,
      pledging: d?.shareholding
        ? readPledgeFromDerived(d.shareholding.pledgedPctOfPromoter, d.shareholding.promoterPct).state === "disclosed_unquantified"
        : false,
      pillarBreakdown: !!p,
      findings: rows.length > 0,
      priceSeries: n("prices") > 0,
      // Two, not one: a single quarter is a figure, not a series, and a step chart of one point is
      // a dot with an axis around it.
      quarterSeries: (stockCoverage(cov.coverage)?.depth.quarters ?? 0) >= 2,
      corporateEvents: n("events") > 0,
      ownershipEvents: n("insider") + n("deals") > 0,
      ownershipSeries: n("filings") >= 2,
      peerGroup: a.peers === true,
      news: n("news") > 0,
    },
    pillarsScored: p ? p.parts.filter((x) => x.state === "scored").map((x) => x.pillar) : [],
    findingNames: rows.map((r) => String(r.name ?? r.ruleKey ?? "")).filter(Boolean).slice(0, 8),
    undisclosed: d?.shareholding?.undisclosed ?? [],
  };
}
