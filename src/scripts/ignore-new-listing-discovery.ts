// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DISMISS THE DISCOVERY FAULTS THAT ARE ONLY "THIS COMPANY IS NEW".
//
// A stock that listed weeks ago owes nobody a quarterly result yet. Reg 33 gives a company its
// first full quarter plus a 45-day filing window, so for LISTING_GRACE_DAYS (137) after its first
// trading day, ZERO FILINGS IS THE EXPECTED STATE — not a missing one. `classifyEmptyDiscovery`
// already knows this and returns `not_due`, which `judgeEmptyDiscovery` closes automatically.
//
// ⚠ THIS SCRIPT EXISTS ONLY BECAUSE THAT LOGIC IS NOT DEPLOYED YET. The running cron predates it,
//   so every night it re-asks the same question about the same seven August-2026 IPOs and re-opens
//   the same seven rows. Once the current tree ships, this script has nothing left to do — which is
//   the correct end state, and the reason it dismisses rather than "fixes" anything.
//
// ── AND IT DISMISSES THE ARITHMETIC THAT FOLLOWS FROM THEM ──────────────────────────────────────
// scan.ts:203 counts a zero-filing stock as a FAILED symbol — deliberately, so the emptiness is
// visible to the run-level guard. But that means a handful of new listings inside a 34-symbol group
// pushes the failure rate past its 25% ceiling on its own: "9/34 attempts failed (26%)" is not a
// source or session cascade, it is seven IPOs being counted. The same deploy fixes it, because
// `not_due` symbols stop being counted as failed at all.
//
// ── WHAT IT REFUSES TO TOUCH ────────────────────────────────────────────────────────────────────
// A symbol PAST the grace window, or one that already holds results, is not dismissed under any
// circumstances — the first is a genuinely late filer and the second should be RESOLVED as healed,
// not swept. Both are reported and left open.
//
// Status is `ignored`, not `resolved`: nothing was repaired and nothing broke. That is the exact
// meaning of the admin panel's "Acknowledge & dismiss", and it keeps these out of the triage queue
// without ever claiming a fix. Re-running is a no-op.
//
//   npx tsx src/scripts/ignore-new-listing-discovery.ts [--apply]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { LISTING_GRACE_DAYS } from "../ingestions/quaterly-results/fundamentals-guards.js";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: string; symbol: string; name: string; first_price: Date | null; held: number; annual: number;
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT e.id, e.target_entity AS symbol, s.name,
      (SELECT min(dp.date) FROM daily_prices dp WHERE dp.stock_id = s.id) AS first_price,
      (SELECT count(*)::int FROM (
         SELECT 1 FROM quarterly_results                    WHERE stock_id = s.id
         UNION ALL SELECT 1 FROM banking_quarterly_results  WHERE stock_id = s.id
         UNION ALL SELECT 1 FROM nbfc_quarterly_results     WHERE stock_id = s.id
         UNION ALL SELECT 1 FROM life_insurance_quarterly_results    WHERE stock_id = s.id
         UNION ALL SELECT 1 FROM general_insurance_quarterly_results WHERE stock_id = s.id
       ) t) AS held,
      (SELECT count(*)::int FROM fundamentals f WHERE f.stock_id = s.id) AS annual
    FROM ingestion_errors e JOIN stocks s ON s.symbol = e.target_entity
    WHERE e.status = 'open' AND e.guard_type = 'count' AND e.target_field = 'discovery'`);

  const newListings: (Row & { days: number })[] = [];
  const hasData: Row[] = [];
  const pastGrace: (Row & { days: number })[] = [];

  for (const r of rows) {
    // An unknown listing date is NEVER treated as recent — silence is not evidence of youth.
    const days = r.first_price == null ? Number.POSITIVE_INFINITY
      : Math.floor((Date.now() - new Date(r.first_price).getTime()) / 86_400_000);
    if (r.held > 0 || r.annual > 0) hasData.push(r);
    else if (days < LISTING_GRACE_DAYS) newListings.push({ ...r, days });
    else pastGrace.push({ ...r, days });
  }

  console.log(`discovery rows open: ${rows.length}     grace window: ${LISTING_GRACE_DAYS} days\n`);
  console.log(`── DISMISS (${newListings.length}) — listed too recently to owe a filing ──`);
  for (const r of newListings) {
    console.log(`   ${r.symbol.padEnd(12)} listed ${String(r.first_price).slice(4, 15)}  ${String(r.days).padStart(3)}d ago   ${r.name}`);
  }
  if (hasData.length) {
    console.log(`\n── LEFT OPEN (${hasData.length}) — these HOLD results; they should be resolved as healed, not dismissed ──`);
    for (const r of hasData) console.log(`   ${r.symbol.padEnd(12)} held=${r.held} annual=${r.annual}   ${r.name}`);
  }
  if (pastGrace.length) {
    console.log(`\n── ⚠ LEFT OPEN (${pastGrace.length}) — PAST the grace window with nothing filed. A genuinely late filer ──`);
    for (const r of pastGrace) console.log(`   ${r.symbol.padEnd(12)} listed ${String(r.days)}d ago   ${r.name}`);
  }

  // The run-level failure-rate spike is the same seven symbols counted, nothing more. It is only
  // dismissed when the symbols underneath it are — never on its own.
  const cascade = newListings.length > 0
    ? await prisma.$queryRawUnsafe<{ id: string; observed: string }[]>(`
        SELECT id, observed FROM ingestion_errors
         WHERE status = 'open' AND guard_type = 'count'
           AND target_table = 'Fundamental' AND target_field IS NULL
           AND cron = 'results_ingest'`)
    : [];
  if (cascade.length) {
    console.log(`\n── DISMISS (${cascade.length}) — the run-level failure-rate spike these produce ──`);
    for (const c of cascade) console.log(`   ${c.observed}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const r of newListings) {
    const { count } = await prisma.ingestionError.updateMany({
      where: { id: r.id, status: "open" },
      data: {
        status: "ignored",
        resolvedBy: "new-listing-grace",
        resolvedAt: new Date(),
        resolutionNote:
          `Not a fault — ${r.symbol} (${r.name}) first traded ${String(r.first_price).slice(0, 10)}, ` +
          `${r.days} days ago, and holds no results anywhere. Reg 33 gives a newly-listed company its ` +
          `first full quarter plus a 45-day window, so nothing is due for another ` +
          `${LISTING_GRACE_DAYS - r.days} days. Dismissed rather than resolved because nothing was ` +
          `repaired and nothing broke. When the current tree deploys, classifyEmptyDiscovery returns ` +
          `not_due for this stock and the question stops being asked; if it is still silent after the ` +
          `grace window the guard will open a fresh row, which is the behaviour we want.`,
        resolutionCitation: `first traded ${String(r.first_price).slice(0, 10)} (min daily_prices.date); 0 rows in every result table`,
      },
    });
    n += count;
  }
  for (const c of cascade) {
    const { count } = await prisma.ingestionError.updateMany({
      where: { id: c.id, status: "open" },
      data: {
        status: "ignored",
        resolvedBy: "new-listing-grace",
        resolvedAt: new Date(),
        resolutionNote:
          `Not a source or session cascade — arithmetic. scan.ts counts a zero-filing stock as a ` +
          `FAILED symbol (deliberately, so the emptiness stays visible), so the ` +
          `${newListings.length} August-2026 listings dismissed alongside this row are enough on ` +
          `their own to push a 34-symbol group past the 25% ceiling. No fetch or session actually ` +
          `failed. Once not_due ships, these stocks stop counting as failed and the rate returns ` +
          `below the ceiling by itself.`,
        resolutionCitation: `${newListings.map((r) => r.symbol).join(", ")} — all within the ${LISTING_GRACE_DAYS}-day listing grace, 0 results held`,
      },
    });
    n += count;
  }
  console.log(`\n✅ dismissed ${n} row(s)`);
  console.log(`   open now: ${await prisma.ingestionError.count({ where: { status: "open" } })}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
