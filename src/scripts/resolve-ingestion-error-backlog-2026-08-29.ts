// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CLOSE THE 832-ROW INGESTION-ERROR BACKLOG — one class at a time, each with its evidence.
//
// Every row closed here was ADJUDICATED, not swept. For each class the question was the same one
// this table exists to ask: is this a FAULT, or is it a guard that is wrong about the world? The
// answer differed, and so does the disposition — which is why this is a script with citations and
// not an UPDATE statement.
//
// ⚠ WHAT IS DELIBERATELY LEFT OPEN, because it is real:
//     · 13 discovery faults — stocks NEITHER exchange has ever filed for (recent IPOs and
//       demergers: SHIPROCKET, MILKYMIST, MOLBIO, TECHNOCRAF …). Nothing to fix; the guard is
//       right and the row is the retry counter.
//     · every YoY continuity flag on a base ≥ ₹10 Cr — the real filer mis-scales (SRF Q4 FY24
//       stored at ₹37.78 Cr against a true ₹3,778 Cr; PAYTM Q3 FY24 at 10× too small). Those are
//       genuine bad numbers in the database and they must stay in front of a human.
//
//   npx tsx src/scripts/resolve-ingestion-error-backlog-2026-08-29.ts [--apply]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { YOY_BASE_MIN_CR } from "../ingestions/quaterly-results/fundamentals-guards.js";

const APPLY = process.argv.includes("--apply");
const BY = "backlog-2026-08-29";

let totalClosed = 0;
async function close(label: string, ids: string[], note: string, citation?: string) {
  console.log(`\n── ${label}`);
  console.log(`   rows: ${ids.length}`);
  console.log(`   ${note.replace(/\s+/g, " ").slice(0, 300)}`);
  if (!ids.length) return;
  if (!APPLY) return;
  const { count } = await prisma.ingestionError.updateMany({
    where: { id: { in: ids }, status: "open" },
    data: {
      status: "resolved",
      resolvedBy: BY,
      resolvedAt: new Date(),
      resolutionNote: note,
      ...(citation ? { resolutionCitation: citation } : {}),
    },
  });
  totalClosed += count;
  console.log(`   ✅ closed ${count}`);
}

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

// ── 1. EMPTY DISCOVERY — healed by the BSE fallback in the same run that flagged them. ────────
const discovery = await prisma.$queryRaw<{ id: string; symbol: string; held: number }[]>`
  SELECT e.id, e.target_entity AS symbol, (
    SELECT count(*)::int FROM (
      SELECT 1 FROM quarterly_results                    WHERE stock_id = s.id
      UNION ALL SELECT 1 FROM banking_quarterly_results  WHERE stock_id = s.id
      UNION ALL SELECT 1 FROM nbfc_quarterly_results     WHERE stock_id = s.id
      UNION ALL SELECT 1 FROM life_insurance_quarterly_results    WHERE stock_id = s.id
      UNION ALL SELECT 1 FROM general_insurance_quarterly_results WHERE stock_id = s.id
    ) t) AS held
  FROM ingestion_errors e JOIN stocks s ON s.symbol = e.target_entity
  WHERE e.status = 'open' AND e.guard_type = 'count' AND e.target_field = 'discovery'`;
const discoveryHealed = discovery.filter((d) => d.held > 0);
const discoveryReal = discovery.filter((d) => d.held === 0);
await close(
  "EMPTY DISCOVERY — healed, and the guard fired too early",
  idsOf(discoveryHealed),
  "FALSE AS WRITTEN THE MOMENT IT WAS WRITTEN. The guard ran on NSE's answer and reported '0 filings, " +
    "and 0 result rows held in any result table'; the BSE fallback then ran — LATER IN THE SAME " +
    "scanSymbol call — and gave the stock its results. Every one of these rows now holds result data, " +
    "so the evidence line on each was untrue within seconds of being recorded, and nothing in the " +
    "lifecycle could ever re-check it. FIXED IN SOURCE (scan.ts): the fault is now judged by " +
    "judgeEmptyDiscovery AFTER both exchanges have answered, and resolveHealedDiscovery closes an open " +
    "row the moment a symbol starts filing again. The 13 stocks NEITHER exchange has anything for stay " +
    "open — those are real.",
  "scan.ts judgeEmptyDiscovery / resolveHealedDiscovery; verified per-symbol against all five result tables",
);
console.log(`   (left open: ${discoveryReal.length} genuinely-empty stocks — ${discoveryReal.map((d) => d.symbol).join(", ")})`);

// ── 2. NON-POSITIVE REVENUE — the guard was wrong about the world. ────────────────────────────
const revenueRows = await prisma.ingestionError.findMany({
  where: { status: "open", guardType: "range", targetField: "revenue", targetTable: { in: ["QuarterlyResult", "Fundamental"] } },
  select: { id: true },
});
await close(
  "RANGE / revenue ≤ 0 — a guard grounded on 500 large caps, applied to 2,291 names",
  idsOf(revenueRows),
  "THE PREDICATE WAS `revenue <= 0`, AND IT WAS WRONG. Measured across these rows: 225 are a company " +
    "that genuinely earned nothing FROM OPERATIONS and says so with a real P&L beside it (RPOWER " +
    "standalone: ₹0 revenue, ₹7.41 Cr profit — a holding company living on other income; DCMFINSERV; " +
    "OLAELEC standalone; every dormant shell on the exchange). 20 are NEGATIVE and arithmetically " +
    "PROVEN correct — revenue + other income − expenses reproduces the filed PBT to the paisa on " +
    "HINDOILEXP, 21STCENMGM, DHRUV, WEALTH and LASA, because a Q4 derived as (full year − 9M) goes " +
    "negative when the year is revised down. Each of those was pointed at an admin_fill button asking " +
    "a human to type in a figure that was already right. The remaining 19 WERE real — a zero-filled " +
    "P&L column — and they are repaired: repair-zeroed-pnl-rows.ts nulled them after re-fetching and " +
    "re-judging each filing. FIXED IN SOURCE: the predicate is now checkZeroedPnlBlock (every line " +
    "exactly 0, which no trading company reports), and zero-block-guard.ts RULE 4 refuses the block at " +
    "parse time so it is written NULL, never 0.",
  "fundamentals-guards.ts checkZeroedPnlBlock; zero-block-guard.ts RULE 4 verified against 10 real filings",
);

// ── 3. CONTINUITY / YoY — split on the base the percentage was computed from. ─────────────────
type Cont = { id: string; base: number | null };
const contQuarterly = await prisma.$queryRaw<Cont[]>`
  SELECT e.id, prev.revenue::float8 AS base
  FROM ingestion_errors e
  JOIN quarterly_results cur ON cur.stock_id = split_part(e.target_entity,'@',1)
   AND cur.result_type = split_part(e.target_entity,'@',3)
   AND cur.quarter = split_part(split_part(e.target_entity,'@',2),'-',1)
   AND cur.fiscal_year = split_part(split_part(e.target_entity,'@',2),'-',2)
  LEFT JOIN quarterly_results prev ON prev.stock_id = cur.stock_id AND prev.quarter = cur.quarter
   AND prev.result_type = cur.result_type
   AND prev.fiscal_year = 'FY' || lpad(((substring(cur.fiscal_year from 3)::int)-1)::text,2,'0')
  WHERE e.status='open' AND e.guard_type='continuity' AND e.target_table='QuarterlyResult'`;
const contAnnual = await prisma.$queryRaw<Cont[]>`
  SELECT e.id, prev.revenue::float8 AS base
  FROM ingestion_errors e
  JOIN fundamentals cur ON cur.stock_id = split_part(e.target_entity,'@',1)
   AND cur.result_type = split_part(e.target_entity,'@',3)
   AND cur.fiscal_year = split_part(e.target_entity,'@',2)
  LEFT JOIN fundamentals prev ON prev.stock_id = cur.stock_id AND prev.result_type = cur.result_type
   AND prev.fiscal_year = 'FY' || lpad(((substring(cur.fiscal_year from 3)::int)-1)::text,2,'0')
  WHERE e.status='open' AND e.guard_type='continuity' AND e.target_table='Fundamental'`;
const contNbfcQ = await prisma.$queryRaw<Cont[]>`
  SELECT e.id, prev.revenue::float8 AS base
  FROM ingestion_errors e
  JOIN nbfc_quarterly_results cur ON cur.stock_id = split_part(e.target_entity,'@',1)
   AND cur.result_type = split_part(e.target_entity,'@',3)
   AND cur.quarter = split_part(split_part(e.target_entity,'@',2),'-',1)
   AND cur.fiscal_year = split_part(split_part(e.target_entity,'@',2),'-',2)
  LEFT JOIN nbfc_quarterly_results prev ON prev.stock_id = cur.stock_id AND prev.quarter = cur.quarter
   AND prev.result_type = cur.result_type
   AND prev.fiscal_year = 'FY' || lpad(((substring(cur.fiscal_year from 3)::int)-1)::text,2,'0')
  WHERE e.status='open' AND e.guard_type='continuity' AND e.target_table='NbfcQuarterlyResult'`;
const contNbfcA = await prisma.$queryRaw<Cont[]>`
  SELECT e.id, prev.revenue::float8 AS base
  FROM ingestion_errors e
  JOIN nbfc_fundamentals cur ON cur.stock_id = split_part(e.target_entity,'@',1)
   AND cur.result_type = split_part(e.target_entity,'@',3)
   AND cur.fiscal_year = split_part(e.target_entity,'@',2)
  LEFT JOIN nbfc_fundamentals prev ON prev.stock_id = cur.stock_id AND prev.result_type = cur.result_type
   AND prev.fiscal_year = 'FY' || lpad(((substring(cur.fiscal_year from 3)::int)-1)::text,2,'0')
  WHERE e.status='open' AND e.guard_type='continuity' AND e.target_table='NbfcFundamental'`;

const allCont = [...contQuarterly, ...contAnnual, ...contNbfcQ, ...contNbfcA];
const immaterial = allCont.filter((c) => c.base != null && Math.abs(c.base) < YOY_BASE_MIN_CR);
const material = allCont.filter((c) => !(c.base != null && Math.abs(c.base) < YOY_BASE_MIN_CR));
await close(
  `CONTINUITY / YoY — computed off a base under ₹${YOY_BASE_MIN_CR} Cr`,
  idsOf(immaterial),
  `A PERCENTAGE OFF A TINY BASE IS ARITHMETIC, NOT EVIDENCE. The 300% band was grounded when this ` +
    `database held 500 large caps ("max real 238%"); the universe is now 2,291 names, most of them ` +
    `small. MEASURED over all 13,088 quarterly YoY pairs with a positive base, the share breaching ` +
    `300% falls monotonically and has a clear knee: 22.29% below ₹1 Cr, 12.06% at ₹1–5 Cr, 8.14% at ` +
    `₹5–10 Cr — then 3.37% at ₹10–25 Cr and 0.18% above ₹500 Cr. Below ₹10 Cr the guard fires on one ` +
    `row in eight; that is not a detector. The 5,524 annual pairs have the same shape. FIXED IN ` +
    `SOURCE: checkRevenueYoyAnomaly now takes the prior-period base and applies YOY_BASE_MIN_CR, wired ` +
    `through all ten Ind-AS and financial ingesters. A base we cannot SEE (null) still flags — an ` +
    `unseen base is not a small one.`,
  "fundamentals-guards.ts YOY_BASE_MIN_CR — distribution measured over 13,088 quarterly + 5,524 annual pairs",
);
console.log(`   (left open: ${material.length} flags on a base ≥ ₹${YOY_BASE_MIN_CR} Cr — the real filer mis-scales, e.g. SRF Q4 FY24)`);

// ── 4. BALANCE-SHEET IMBALANCE — the identity was incomplete, not the balance sheets. ─────────
const bsRows = await prisma.ingestionError.findMany({
  where: { status: "open", guardType: "range", targetField: "balanceSheet", targetTable: "Fundamental" },
  select: { id: true },
});
await close(
  "RANGE / balanceSheet — 48 of 48 balance once the filing's own Liabilities total is used",
  idsOf(bsRows),
  "NOT ONE OF THESE BALANCE SHEETS WAS EVER OUT OF BALANCE. Ind-AS says Assets = Equity + " +
    "Liabilities. `Liabilities` is a subtotal the filer TAGS, and the guard could not read it — no " +
    "column held it — so it reconstructed the right-hand side as equity + current + non-current. " +
    "That is short by every bucket which is neither: a company with a disposal group tags " +
    "LiabilitiesDirectlyAssociatedWithAssetsInDisposalGroupClassifiedAsHeldForSale as a third one. " +
    "RAYMOND FY25's ₹1,350.41 Cr 'imbalance' IS that bucket, to the paisa; UPL FY24's ₹3,665.00 Cr " +
    "likewise. VERIFIED by re-fetching all 48 filings: 48 of 48 close on the filing's own total, none " +
    "left over. FIXED IN SOURCE: fundamentals.total_liabilities added (migration " +
    "20260829120000), parsed by the annual ingester, preferred by checkBsImbalance, and backfilled " +
    "on every affected row.",
  "checkBsImbalance + migration 20260829120000_fundamental_total_liabilities; 48/48 re-fetched and re-checked",
);

// ── 5. AMFI header breaks — the pipelines were dead; they are running again. ──────────────────
const amfi = await prisma.ingestionError.findMany({
  where: { status: "open", guardType: "shape", cron: { in: ["daily_amfi_nav", "daily_etf_nav", "mf_analytics_daily"] } },
  select: { id: true, cron: true, occurrences: true },
});
await close(
  "SHAPE / AMFI column headers — three dead pipelines, restarted",
  idsOf(amfi),
  "THE GUARDS WERE RIGHT TO REFUSE AND WRONG TO REFUSE FOREVER. AMFI reshaped both feeds: NAVAll.txt " +
    "gained Plan and Option columns on 2026-08-19, and the NAV-history endpoint renamed Scheme Name → " +
    "NAV Name, inserted Plan/Option, dropped Repurchase/Sale and MOVED NET ASSET VALUE FROM COLUMN 4 " +
    "TO COLUMN 6 on 2026-07-28. Both guards compared the header to one frozen string, so an ADDITIVE " +
    "change read as a total break: 18,040 fund NAVs froze at 2026-08-17 for eleven days, and the " +
    "analytics fold did not run for thirty-two. FIXED IN SOURCE: columns are now resolved BY NAME and " +
    "the shape guard asserts MEMBERSHIP of the columns we actually read — the prices-guards.ts ruling " +
    "for the NSE bhavcopy, applied to AMFI. VERIFIED BY RUNNING THEM: the MF pass ingested 17,678 " +
    "candidates to a 2026-08-30 NAV, the ETF pass 356, and the analytics fold folded 9,268,909 rows " +
    "across 21 windows with 0 faults.",
  "amfi-parse.ts resolveAmfiColumns / amfi-history-parse.ts resolveHistoryColumns; all three crons re-run green",
);

// ── 6. The singles, each adjudicated on its own evidence. ────────────────────────────────────
const singles: Array<[string, object, string]> = [
  ["VALIDITY / ISIN type \"23\" — an InvIT, not an unknown", { cron: "corporate_bonds_daily", guardType: "validity", targetField: "asset_class" },
    "A FALSE REFUSAL, FIRED NIGHTLY FOR THIRTEEN NIGHTS. NXT-INFRA TRUST (INE0SF023016) is an " +
    "Infrastructure Investment Trust that this catalogue ALREADY HOLDS as asset_class='invit'; the bond " +
    "lane met it on the BL block-deal board, did not recognise security-type \"23\", and asked an " +
    "operator to decide whether it was debt. GROUNDED, not guessed: all 17 InvITs held carry type " +
    "\"23\" and all 6 REITs carry \"25\", measured. FIXED IN SOURCE: both are now NAMED REFUSALS in " +
    "isin-class.ts, so the bond lane counts them as a known exclusion. A genuinely unknown code still " +
    "faults — which is how the municipal green bonds (\"24\") were caught rather than dropped."],
  ["VALIDITY / AMFI shipped a truncated ISIN", { cron: "daily_etf_nav", guardType: "validity", targetField: "isin" },
    "AMFI FIXED IT. Scheme 154491 (Kotak Nifty Private Bank ETF) shipped \"INF174KA1A9\" — eleven " +
    "characters — on 2026-07-21, and the guard correctly refused to key a catalogue row on it. Today's " +
    "file ships INF174KA1A94, and the instrument is catalogued with a live NAV. The refusal was right " +
    "and the condition has lifted."],
  ["NULL_RATE / insider trade value — the wrong denominator", { cron: "insider_pit", guardType: "null_rate", targetField: "tradeValueCr" },
    "AN HONEST EMPTY COUNTED AS A PARSE BREAK. An inter-se transfer between promoters is a TRANSFER: " +
    "SEBI's PIT disclosure has no price field to fill, so trade_price is null and trade_value_cr with " +
    "it. MEASURED over all 5,849 trades held — inter_se_transfer 36/100 null, off_market 52/367, other " +
    "112/1871, against market 12/2433 (0.49%), esos 0/1049 and preferential_allotment 0/28. The " +
    "priceable modes run at 0.34%. This fault was a manual backfill of 201 records whose mix happened " +
    "to be 10.9% transfers. FIXED IN SOURCE: the rate is now measured over priceable trades only " +
    "(UNPRICED_ACQUISITION_MODES / isPriceableTrade)."],
  ["COUNT / Yahoo returned 0 rows for GAJA", { cron: "yahoo_price_backfill", guardType: "count" },
    "THE SYMBOL IS NO LONGER IN THE UNIVERSE. GAJA has no row in `stocks` — it was removed after this " +
    "fault was raised, so there is nothing left to backfill prices for and nothing to fix. A fault " +
    "against a symbol we no longer track cannot reproduce."],
  ["CONTINUITY / NEXTMEDIA 20% day move", { cron: "daily_eod_prices", guardType: "continuity", targetField: "close" },
    "A REAL MOVE, EYEBALLED AS THE GUARD ASKS. NEXTMEDIA closed 3.85 → 4.62 on 2026-08-27 (+20.0%) on " +
    "308,631 shares against a 21,424-share prior day — a ₹4 small-cap locked at its upper circuit, " +
    "with coherent OHLC (open 4.59, high 4.62, low 3.85, close 4.62). Not a split, not a parse error: " +
    "a circuit. The guard's band exists to make a human look, and the human looked."],
  ["RANGE / JKTYRE dividend read as ₹0", { cron: "events_ingest", guardType: "range", targetField: "dividendAmount" },
    "A REAL PARSE BUG, AND THE GUARD FOUND IT. NSE ships the subject as \" Dividend - Rs 0 .70 Per " +
    "Share\" — a space between the integer and the decimal point. Against `\\d+(?:\\.\\d+)?` that " +
    "matches \"0\", stops at the space, and stored ₹0.00 for a real ₹0.70 dividend: not an absence, " +
    "which would be honest, but a wrong number. FIXED IN SOURCE (events.ts): whitespace is now " +
    "tolerated between the digits and the point, and nowhere else. The stored row is corrected to " +
    "₹0.70. It is the only occurrence in all 5,833 dividend events."],
  ["CONTINUITY / promoter stake moves", { cron: "shareholding_ingest", guardType: "continuity", targetField: "promoterPct" },
    "BOTH ARE REAL CORPORATE ACTIONS, AND EACH FILING PROVES ITSELF. ASTERDM 40.39% → 53.72%: total " +
    "shares 518,121,029 → 871,672,439 and promoter shares 209,283,923 → 468,236,497, both percentages " +
    "arithmetically exact against their own share counts — the Quality Care merger issuance. " +
    "SAMMAANCAP 0% → 28.34%: promoter shares 0 → 330,040,111 of 1,161,543,631, a professionally-managed " +
    "company acquiring a promoter group. Neither is a parse miss; the guard asked for an eyeball and " +
    "got one."],
  ["SHAPE / annual P&L absent (HINDPETRO, CONCOR, MFSL)", { guardType: "shape", targetTable: { in: ["Fundamental", "NbfcFundamental"] }, cron: "results_ingest" },
    "CORRECT REFUSALS OF DOCUMENTS THAT HAVE NO ANNUAL BLOCK — and for two of the three, of a filing " +
    "that does not exist. VERIFIED against NSE's own legacy filing list: neither HINDPETRO nor CONCOR " +
    "filed a CONSOLIDATED annual result for FY19 (year ended 31-Mar-2019) — both consolidated series " +
    "start at FY20. MFSL's FY19 yearly filing carries no readable FourD block. Nothing was written in " +
    "any of the three cases, the standalone rows for the same periods are present and healthy, and the " +
    "outcome is an honest gap. The diagnostic said \"likely an XBRL tag rename\", which sent the " +
    "investigation after a parser bug that was not there; the wording now names both causes."],
];
for (const [label, where, note] of singles) {
  const rows = await prisma.ingestionError.findMany({ where: { status: "open", ...where }, select: { id: true } });
  await close(label, idsOf(rows), note);
}

console.log(`\n${"═".repeat(70)}`);
const remaining = await prisma.ingestionError.count({ where: { status: "open" } });
console.log(APPLY ? `✅ closed ${totalClosed} row(s). OPEN REMAINING: ${remaining}` : `(dry run — pass --apply to write). currently open: ${remaining}`);
await prisma.$disconnect();
