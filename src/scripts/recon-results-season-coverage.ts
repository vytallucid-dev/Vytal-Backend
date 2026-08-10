// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WHY DOES A GIVEN SCORED STOCK SHOW NO BANNER? — and how much of the scored universe has any
// earnings-calendar coverage at all.
//
// Read-only. Every silence the resolver can produce is a legitimate answer; this says WHICH one, per
// stock, so a correct silence can be told apart from an ingest gap.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { resolveResultsSeasonBanner } from "../results-season/service.js";
import { periodEndFor } from "../results-season/window.js";

const j = (label: string, v: unknown) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2));
};

/** Every earnings row we hold for a stock, whatever the date — the check that separates "outside the
 *  window" from "we have no calendar row for this company at all". */
async function earningsHistory(stockId: string) {
  return prisma.$queryRaw<{ event_date: Date; days_out: number; description: string | null }[]>`
    SELECT event_date, (event_date::date - CURRENT_DATE) AS days_out, description
    FROM corporate_events WHERE stock_id = ${stockId} AND event_type = 'earnings'
    ORDER BY event_date DESC LIMIT 8
  `;
}

/** Did the company actually report for the period the window would have covered? If it did and we
 *  hold no calendar row, that is an INGEST GAP rather than correct silence. */
async function filingsNear(stockId: string) {
  return prisma.$queryRaw<{ src: string; report_date: Date; filing_date: Date; created_at: Date }[]>`
    SELECT 'quarterly' AS src, report_date, filing_date, created_at FROM quarterly_results WHERE stock_id = ${stockId}
    UNION ALL SELECT 'banking', report_date, filing_date, created_at FROM banking_quarterly_results WHERE stock_id = ${stockId}
    UNION ALL SELECT 'nbfc', report_date, filing_date, created_at FROM nbfc_quarterly_results WHERE stock_id = ${stockId}
    UNION ALL SELECT 'life_ins', report_date, filing_date, created_at FROM life_insurance_quarterly_results WHERE stock_id = ${stockId}
    UNION ALL SELECT 'gen_ins', report_date, filing_date, created_at FROM general_insurance_quarterly_results WHERE stock_id = ${stockId}
    ORDER BY report_date DESC LIMIT 4
  `;
}

async function diagnose(symbol: string) {
  console.log("\n" + "═".repeat(100));
  console.log(`DIAGNOSIS — ${symbol}`);
  console.log("═".repeat(100));

  const stock = await prisma.stock.findFirst({
    where: { symbol },
    select: { id: true, symbol: true, name: true, isActive: true },
  });
  if (!stock) return console.log("  no such stock");

  const head = await prisma.scoreSnapshot.findFirst({
    where: { stockId: stock.id },
    orderBy: [{ periodKey: "desc" }, { version: "desc" }],
    select: { createdAt: true, periodKey: true, composite: true, labelBand: true },
  });
  const inPg = await prisma.stockPeerGroup.count({ where: { stockId: stock.id } });

  console.log(`  ${stock.name}  ·  active=${stock.isActive}  ·  peer groups=${inPg}`);
  console.log(
    `  in-force snapshot: ${head ? `${head.createdAt.toISOString().slice(0, 16)} (${head.periodKey}, ${head.labelBand} ${head.composite})` : "NONE (unscored)"}`,
  );

  const events = await earningsHistory(stock.id);
  console.log(`\n  earnings rows in corporate_events: ${events.length === 0 ? "NONE AT ALL" : events.length}`);
  for (const e of events) {
    const d = e.days_out;
    const inWindow = d >= -7 && d <= 7;
    console.log(
      `    ${e.event_date.toISOString().slice(0, 10)}  T${d >= 0 ? "+" : ""}${d}  ${inWindow ? "← INSIDE the window" : "outside"}`,
    );
  }

  const filings = await filingsNear(stock.id);
  console.log(`\n  most recent filings held:`);
  for (const f of filings) {
    console.log(
      `    ${f.src.padEnd(10)} period end ${f.report_date.toISOString().slice(0, 10)}  filed ${f.filing_date.toISOString().slice(0, 10)}  ingested ${f.created_at.toISOString().slice(0, 16)}`,
    );
  }

  const r = await resolveResultsSeasonBanner(null, stock.id);
  console.log(`\n  RESOLVER SAYS: ${r.banner ? `BANNER (${r.banner.phase}/${r.banner.copySet})` : `silence — ${r.silence}`}`);

  // Attribute the silence to a cause a human can act on.
  if (!r.banner) {
    const inWindow = events.filter((e) => e.days_out >= -7 && e.days_out <= 7);
    if (events.length === 0) {
      console.log("  CAUSE: no earnings row for this stock AT ALL — a calendar ingest gap if it reported.");
    } else if (inWindow.length === 0) {
      console.log(`  CAUSE: the nearest earnings row is T${events[0].days_out >= 0 ? "+" : ""}${events[0].days_out} — outside T-7…T+7. Correct silence.`);
    } else {
      const ev = inWindow[0];
      const pe = periodEndFor(ev.event_date);
      const match = filings.find((f) => f.report_date.toISOString().slice(0, 10) === pe.toISOString().slice(0, 10));
      console.log(`  the in-window meeting is ${ev.event_date.toISOString().slice(0, 10)} (period end ${pe.toISOString().slice(0, 10)})`);
      if (!match) {
        console.log("  CAUSE: in-window, no filing for the period — so this should have fired. Investigate.");
      } else if (head && head.createdAt >= match.created_at) {
        console.log(
          `  CAUSE: GATE 4 — the filing was ingested ${match.created_at.toISOString().slice(0, 16)} and the in-force ` +
            `snapshot was written ${head.createdAt.toISOString().slice(0, 16)}, i.e. AFTER it. The score already reads ` +
            `the new quarter, so "still built on the previous quarter" would be false. Correct silence.`,
        );
      } else {
        console.log("  CAUSE: in-window with a filing, snapshot older — should have fired. Investigate.");
      }
    }
  }
}

async function main() {
  for (const s of ["GODREJCP", "HINDALCO"]) await diagnose(s);

  // ── Calendar coverage across the SCORED universe ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(100));
  console.log("CALENDAR COVERAGE ACROSS THE SCORED UNIVERSE");
  console.log("═".repeat(100));

  j(
    "scored stocks — earnings-calendar coverage",
    await prisma.$queryRawUnsafe(`
      WITH scored AS (
        SELECT DISTINCT s.id, s.symbol FROM stocks s
        WHERE s.is_active AND EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id)
      )
      SELECT count(*)::int AS scored_stocks,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = scored.id AND ce.event_type='earnings'
             ))::int AS have_any_earnings_row_ever,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = scored.id AND ce.event_type='earnings'
                 AND ce.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
             ))::int AS have_one_in_next_30d,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = scored.id AND ce.event_type='earnings'
                 AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
             ))::int AS have_one_in_the_window,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = scored.id AND ce.event_type='earnings'
             ))::int AS have_none_at_all
      FROM scored
    `),
  );

  // The same cut for the WHOLE active universe, so the scored figure has something to sit against.
  j(
    "the whole active universe, for comparison",
    await prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS active_stocks,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = s.id AND ce.event_type='earnings'
             ))::int AS have_any_earnings_row_ever,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = s.id AND ce.event_type='earnings'
                 AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
             ))::int AS have_one_in_the_window
      FROM stocks s WHERE s.is_active
    `),
  );

  // ★ THE ONE THAT SEPARATES A DATA PROBLEM FROM CORRECT SILENCE: a scored stock that FILED for the
  //   current period but for which we hold no calendar row anywhere near that filing date.
  j(
    "scored stocks that FILED for the June-2026 quarter but have NO calendar row within ±10 days",
    await prisma.$queryRawUnsafe(`
      WITH scored AS (
        SELECT DISTINCT s.id, s.symbol FROM stocks s
        WHERE s.is_active AND EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id)
      ),
      fil AS (
        SELECT stock_id, filing_date::date AS fd FROM quarterly_results WHERE report_date = DATE '2026-06-30'
        UNION ALL SELECT stock_id, filing_date::date FROM banking_quarterly_results WHERE report_date = DATE '2026-06-30'
        UNION ALL SELECT stock_id, filing_date::date FROM nbfc_quarterly_results WHERE report_date = DATE '2026-06-30'
        UNION ALL SELECT stock_id, filing_date::date FROM life_insurance_quarterly_results WHERE report_date = DATE '2026-06-30'
        UNION ALL SELECT stock_id, filing_date::date FROM general_insurance_quarterly_results WHERE report_date = DATE '2026-06-30'
      )
      SELECT scored.symbol, min(fil.fd)::text AS filed_on
      FROM scored JOIN fil ON fil.stock_id = scored.id
      WHERE NOT EXISTS (
        SELECT 1 FROM corporate_events ce
        WHERE ce.stock_id = scored.id AND ce.event_type='earnings'
          AND ce.event_date BETWEEN fil.fd - 10 AND fil.fd + 10
      )
      GROUP BY 1 ORDER BY 2, 1
    `),
  );

  j(
    "…and the same for the whole active universe (the size of the gap, if there is one)",
    await prisma.$queryRawUnsafe(`
      WITH fil AS (
        SELECT stock_id, min(filing_date::date) AS fd FROM (
          SELECT stock_id, filing_date FROM quarterly_results WHERE report_date = DATE '2026-06-30'
          UNION ALL SELECT stock_id, filing_date FROM banking_quarterly_results WHERE report_date = DATE '2026-06-30'
          UNION ALL SELECT stock_id, filing_date FROM nbfc_quarterly_results WHERE report_date = DATE '2026-06-30'
          UNION ALL SELECT stock_id, filing_date FROM life_insurance_quarterly_results WHERE report_date = DATE '2026-06-30'
          UNION ALL SELECT stock_id, filing_date FROM general_insurance_quarterly_results WHERE report_date = DATE '2026-06-30'
        ) x GROUP BY 1
      )
      SELECT count(*)::int AS filed_for_jun_2026,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = fil.stock_id AND ce.event_type='earnings'
                 AND ce.event_date BETWEEN fil.fd - 10 AND fil.fd + 10
             ))::int AS have_a_matching_calendar_row,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM corporate_events ce WHERE ce.stock_id = fil.stock_id AND ce.event_type='earnings'
                 AND ce.event_date BETWEEN fil.fd - 10 AND fil.fd + 10
             ))::int AS no_matching_calendar_row
      FROM fil
    `),
  );

  // ── Which quarter does each live-firing stock resolve to? (Part 1's reporting ask) ──────────────
  j(
    "the live window by period end — which quarter each firing stock resolves to",
    await prisma.$queryRawUnsafe(`
      SELECT (date_trunc('quarter', ce.event_date)::date - 1)::text AS period_end,
             CASE WHEN EXTRACT(MONTH FROM (date_trunc('quarter', ce.event_date)::date - 1)) = 3
                  THEN 'Q4 (annual rides with it)' ELSE 'Q1-Q3 (quarterly only)' END AS voice,
             count(DISTINCT ce.stock_id)::int AS stocks
      FROM corporate_events ce
      JOIN stocks s ON s.id = ce.stock_id AND s.is_active
      WHERE ce.event_type='earnings' AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
      GROUP BY 1,2 ORDER BY 1
    `),
  );
}

main()
  .catch((e) => {
    console.error("RECON FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
