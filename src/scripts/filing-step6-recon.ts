// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 6 · RECON (read-only). Everything the prompt says to report BEFORE building.
//
//   §1  H's WINDOW against the 38-stock discrepancy — the thing that must be right before any trigger
//       design matters. Also P6, which anchors the same way.
//   §2  the two known gaps: 360ONE's missing fundamentals, and the 24 no-annual / 16 no-quarterly —
//       ingestion failure or genuine absence, decided per stock against listing date and peers
//   §3  feed recency: how far behind the shareholding anchor the daily feeds actually run
//
//   npx tsx src/scripts/filing-step6-recon.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { BLOCK_WINDOW_DAYS, H_MIN_DEAL_CR } from "../scoring/findings/rules/h-ownership-events.js";

const pad = (s: string, n: number) => s.padEnd(n);
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const DAY = 86400_000;

async function main() {
  console.log("════════ STEP 6 · RECON ════════\n");
  const today = new Date();

  // ═══════════════ §1 · H's window ═══════════════
  console.log("── §1 · H — block deals vs the window the rule actually evaluates ──");
  console.log(`   rule: deals with value ≥ ₹${H_MIN_DEAL_CR}Cr, dealDate in (anchor − ${BLOCK_WINDOW_DAYS}d, anchor]`);
  console.log(`   anchor: the LATEST SHAREHOLDING FILING's as-on date (h-ownership-events.ts:20)\n`);

  const stocks = await prisma.stock.findMany({ where: { isActive: true }, select: { id: true, symbol: true } });
  const byId = new Map(stocks.map((s) => [s.id, s.symbol]));

  const deals = await prisma.blockDeal.findMany({
    where: { stockId: { in: stocks.map((s) => s.id) } },
    select: { stockId: true, dealDate: true, valueCr: true },
  });
  const shLatest = await prisma.shareholdingPattern.groupBy({ by: ["stockId"], _max: { asOnDate: true } });
  const anchorBy = new Map(shLatest.map((r) => [r.stockId, r._max.asOnDate]));

  const dealsBy = new Map<string, { date: Date; cr: number }[]>();
  for (const d of deals) {
    const cr = d.valueCr == null ? 0 : Number(d.valueCr);
    const a = dealsBy.get(d.stockId) ?? [];
    a.push({ date: d.dealDate, cr });
    dealsBy.set(d.stockId, a);
  }

  let withDeals = 0, firesNow = 0, wouldFireOnToday = 0, blockedByAnchor = 0;
  const examples: string[] = [];
  let maxLagDays = 0;
  for (const [stockId, ds] of dealsBy) {
    withDeals++;
    const anchor = anchorBy.get(stockId) ?? null;
    const material = ds.filter((d) => d.cr >= H_MIN_DEAL_CR);
    const latestDeal = ds.reduce((m, d) => (d.date > m ? d.date : m), ds[0].date);
    if (!anchor) continue;
    const lag = Math.round((latestDeal.getTime() - anchor.getTime()) / DAY);
    if (lag > maxLagDays) maxLagDays = lag;

    const inAnchorWin = material.filter((d) => d.date.getTime() > anchor.getTime() - BLOCK_WINDOW_DAYS * DAY && d.date.getTime() <= anchor.getTime());
    const inTodayWin = material.filter((d) => d.date.getTime() > today.getTime() - BLOCK_WINDOW_DAYS * DAY && d.date.getTime() <= today.getTime());
    if (inAnchorWin.length) firesNow++;
    if (inTodayWin.length) wouldFireOnToday++;
    if (!inAnchorWin.length && inTodayWin.length) {
      blockedByAnchor++;
      if (examples.length < 12) {
        examples.push(`  ${pad(byId.get(stockId) ?? "?", 12)} anchor ${ymd(anchor)}  latest deal ${ymd(latestDeal)} (+${lag}d)  ` +
          `in-anchor-window ${inAnchorWin.length}  in-today-window ${inTodayWin.length}`);
      }
    }
  }
  console.log(`  active stocks with ANY block deal on file: ${withDeals}`);
  console.log(`  H fires under the SHAREHOLDING anchor  : ${firesNow}`);
  console.log(`  H would fire under a TODAY anchor      : ${wouldFireOnToday}`);
  console.log(`  stocks whose deals are invisible ONLY because the anchor trails: ${blockedByAnchor}`);
  console.log(`  greatest lag between latest deal and shareholding anchor: ${maxLagDays} days\n`);
  examples.forEach((e) => console.log(e));

  // Where the two feeds actually stand vs the shareholding calendar.
  const maxDeal = await prisma.blockDeal.aggregate({ _max: { dealDate: true } });
  const maxIns = await prisma.insiderTrade.aggregate({ _max: { tradeDate: true } });
  const maxSh = await prisma.shareholdingPattern.aggregate({ _max: { asOnDate: true } });
  console.log(`\n  newest block deal        ${ymd(maxDeal._max.dealDate)}`);
  console.log(`  newest insider trade     ${ymd(maxIns._max.tradeDate)}`);
  console.log(`  newest shareholding as-on ${ymd(maxSh._max.asOnDate)}   ← the anchor both feed rules use`);

  // Step 2 flagged the DISPLAY-ONLY cohort specifically (no peer group) — same measurement, that cut.
  const pgIds = new Set((await prisma.stockPeerGroup.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));
  let doWithDeals = 0, doFires = 0, doWouldFire = 0;
  for (const [stockId, ds] of dealsBy) {
    if (pgIds.has(stockId)) continue;
    const anchor = anchorBy.get(stockId); if (!anchor) continue;
    doWithDeals++;
    const material = ds.filter((d) => d.cr >= H_MIN_DEAL_CR);
    if (material.some((d) => d.date.getTime() > anchor.getTime() - BLOCK_WINDOW_DAYS * DAY && d.date.getTime() <= anchor.getTime())) doFires++;
    if (material.some((d) => d.date.getTime() > today.getTime() - BLOCK_WINDOW_DAYS * DAY && d.date.getTime() <= today.getTime())) doWouldFire++;
  }
  console.log(`\n  ★ THE STEP-2 FLAG, RE-MEASURED ON ITS OWN COHORT (display-only, no peer group):`);
  console.log(`    display-only stocks with block deals: ${doWithDeals}   H fires: ${doFires}   would fire on a today anchor: ${doWouldFire}`);

  // ═══════════════ §2 · the two known gaps ═══════════════
  console.log("\n── §2 · the coverage gaps: ingestion failure or genuine absence? ──");
  console.log("  ⚠ COUNTED PER INDUSTRY, NOT OFF `fundamentals` ALONE. Step 1 dispatches the accounts read");
  console.log("    across five table pairs; querying only the non-financial pair would count every bank as");
  console.log("    'no annual filing', which is a different (and false) statement.\n");

  const detail = await prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true, industryType: true },
    orderBy: { symbol: "asc" },
  });
  const industryOf = new Map(detail.map((d) => [d.id, d.industryType]));

  const countBy = async (rows: { stockId: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.stockId, (m.get(r.stockId) ?? 0) + 1);
    return m;
  };
  const [nfA, nfQ, bkA, bkQ, nbA, nbQ, liA, liQ, giA, giQ, shAll] = await Promise.all([
    prisma.fundamental.findMany({ select: { stockId: true } }),
    prisma.quarterlyResult.findMany({ select: { stockId: true } }),
    prisma.bankingFundamental.findMany({ select: { stockId: true } }),
    prisma.bankingQuarterlyResult.findMany({ select: { stockId: true } }),
    prisma.nbfcFundamental.findMany({ select: { stockId: true } }),
    prisma.nbfcQuarterlyResult.findMany({ select: { stockId: true } }),
    prisma.lifeInsuranceFundamental.findMany({ select: { stockId: true } }),
    prisma.lifeInsuranceQuarterlyResult.findMany({ select: { stockId: true } }),
    prisma.generalInsuranceFundamental.findMany({ select: { stockId: true } }),
    prisma.generalInsuranceQuarterlyResult.findMany({ select: { stockId: true } }),
    prisma.shareholdingPattern.findMany({ select: { stockId: true } }),
  ]);
  const A = { non_financial: await countBy(nfA), banking: await countBy(bkA), nbfc: await countBy(nbA), life_insurance: await countBy(liA), general_insurance: await countBy(giA) } as Record<string, Map<string, number>>;
  const Q = { non_financial: await countBy(nfQ), banking: await countBy(bkQ), nbfc: await countBy(nbQ), life_insurance: await countBy(liQ), general_insurance: await countBy(giQ) } as Record<string, Map<string, number>>;
  const SH = await countBy(shAll);

  const noAnnual = detail.filter((d) => !(A[industryOf.get(d.id)!]?.get(d.id) ?? 0));
  const noQuarter = detail.filter((d) => !(Q[industryOf.get(d.id)!]?.get(d.id) ?? 0));
  const noEither = detail.filter((d) => !(A[industryOf.get(d.id)!]?.get(d.id) ?? 0) && !(Q[industryOf.get(d.id)!]?.get(d.id) ?? 0));
  console.log(`  no ANNUAL accounts in their own industry's table   : ${noAnnual.length}`);
  console.log(`  no QUARTERLY results in their own industry's table : ${noQuarter.length}`);
  console.log(`  NEITHER (the 360ONE shape)                        : ${noEither.length}`);

  const affected = [...new Set([...noAnnual, ...noQuarter].map((d) => d.id))];
  const logRows = await prisma.resultFetchLog.findMany({
    where: { stockId: { in: affected } },
    select: { stockId: true, status: true, fetchedAt: true, error: true },
    orderBy: { fetchedAt: "desc" },
  });
  const lastLog = new Map<string, { status: string; at: Date; error: string | null; n: number }>();
  for (const r of logRows) {
    const e = lastLog.get(r.stockId);
    if (!e) lastLog.set(r.stockId, { status: r.status, at: r.fetchedAt, error: r.error, n: 1 });
    else e.n++;
  }

  console.log(`\n  ${pad("symbol", 14)}${pad("industry", 18)}${"ann".padStart(4)}${"qtr".padStart(5)}${"shp".padStart(5)}   last result_fetch_log`);
  for (const d of [...noAnnual, ...noQuarter].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i).sort((x, y) => x.symbol.localeCompare(y.symbol))) {
    const ind = industryOf.get(d.id)!;
    const l = lastLog.get(d.id);
    console.log(`  ${pad(d.symbol, 14)}${pad(ind, 18)}${String(A[ind]?.get(d.id) ?? 0).padStart(4)}${String(Q[ind]?.get(d.id) ?? 0).padStart(5)}${String(SH.get(d.id) ?? 0).padStart(5)}   ` +
      (l ? `${l.status} @ ${ymd(l.at)} (${l.n} attempts)${l.error ? ` — "${l.error.slice(0, 50)}"` : ""}` : "NEVER ATTEMPTED"));
  }
  const never = affected.filter((id) => !lastLog.has(id)).length;
  console.log(`\n  of the ${affected.length} affected stocks, ${never} have NO result_fetch_log row at all (the scanner never tried)`);
  console.log(`  and ${affected.length - never} DO have one (the scanner tried and came back with nothing to store)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
