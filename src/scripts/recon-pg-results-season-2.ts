// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECON 2 — the 13 SCORED ponds only (the ones whose detail page is reachable), with the exact
// window semantics Part 1 specifies: T-7 of the EARLIEST member date → T+7 of the LATEST.
//
// Answers: the lifespan of each pond's banner, which of the four states each pond is in TODAY,
// how many members carry no earnings row at all, and whether the season groups cleanly by period.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { periodEndFor, pickScheduledDate, today as todayFn, utcMidnight } from "../results-season/window.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(112) + "\n" + s + "\n" + "═".repeat(112));
const DAY = 86400000;

async function main() {
  const today = todayFn();
  line(`today (IST calendar day): ${iso(today)}`);

  // The scored ponds — the ones the index links to and the detail page renders.
  const scoredPonds = await prisma.$queryRaw<{ id: string; display_name: string; roster: bigint }[]>`
    SELECT pg.id, pg.display_name, count(spg.stock_id)::bigint AS roster
    FROM peer_groups pg
    JOIN stock_peer_groups spg ON spg.peer_group_id = pg.id
    WHERE EXISTS (SELECT 1 FROM score_snapshots ss JOIN stock_peer_groups s2 ON s2.stock_id = ss.stock_id
                  WHERE s2.peer_group_id = pg.id)
    GROUP BY pg.id, pg.display_name ORDER BY pg.display_name
  `;
  line(`scored ponds: ${scoredPonds.length}`);

  // ONE read: every member of every scored pond, its earnings rows in a ±45d band, its scored state,
  // and whether a filing for the June-2026 period exists.
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<
    {
      pg_id: string;
      display_name: string;
      stock_id: string;
      symbol: string;
      name: string;
      scored: boolean;
      event_date: Date | null;
      filed_on: Date | null;
    }[]
  >`
    WITH f AS (
      SELECT stock_id, report_date, min(filing_date) AS filed_on FROM (
        SELECT stock_id, report_date, filing_date FROM quarterly_results
        UNION ALL SELECT stock_id, report_date, filing_date FROM banking_quarterly_results
        UNION ALL SELECT stock_id, report_date, filing_date FROM nbfc_quarterly_results
        UNION ALL SELECT stock_id, report_date, filing_date FROM life_insurance_quarterly_results
        UNION ALL SELECT stock_id, report_date, filing_date FROM general_insurance_quarterly_results
      ) u GROUP BY stock_id, report_date
    )
    SELECT pg.id AS pg_id, pg.display_name, st.id AS stock_id, st.symbol, st.name,
           EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = st.id) AS scored,
           ce.event_date, f.filed_on
    FROM peer_groups pg
    JOIN stock_peer_groups spg ON spg.peer_group_id = pg.id
    JOIN stocks st ON st.id = spg.stock_id AND st.is_active = true
    LEFT JOIN corporate_events ce ON ce.stock_id = st.id AND ce.event_type = 'earnings'
      AND ce.event_date BETWEEN CURRENT_DATE - INTERVAL '45 days' AND CURRENT_DATE + INTERVAL '45 days'
    LEFT JOIN f ON f.stock_id = st.id AND f.report_date = DATE '2026-06-30'
    ORDER BY pg.display_name, st.symbol
  `;
  line(`ONE read for every member of every scored pond: ${rows.length} rows in ${Date.now() - t0} ms`);

  rule("PER-POND WINDOW + TODAY'S STATE (T-7 of earliest → T+7 of latest)");
  line(
    "pond".padEnd(40) +
      "mem dated  window                    life  today  state          rep/due  filed  next",
  );

  const lifespans: number[] = [];
  for (const p of scoredPonds) {
    const mine = rows.filter((r) => r.pg_id === p.id);
    const byStock = new Map<string, { symbol: string; scored: boolean; dates: Date[]; filedOn: Date | null }>();
    for (const r of mine) {
      const e = byStock.get(r.stock_id) ?? { symbol: r.symbol, scored: r.scored, dates: [], filedOn: r.filed_on };
      if (r.event_date) e.dates.push(r.event_date);
      if (r.filed_on) e.filedOn = r.filed_on;
      byStock.set(r.stock_id, e);
    }
    const members = [...byStock.values()];
    const dated = members
      .map((m) => ({ ...m, date: pickScheduledDate(m.dates, today) }))
      .filter((m) => m.date) as { symbol: string; scored: boolean; date: Date; filedOn: Date | null }[];

    if (dated.length === 0) {
      line(`${p.display_name.padEnd(40)} ${String(members.length).padStart(3)}   0  — no dated member —`);
      continue;
    }
    // Group by reporting period — the season key.
    const periods = new Map<string, typeof dated>();
    for (const d of dated) {
      const k = iso(periodEndFor(d.date));
      periods.set(k, [...(periods.get(k) ?? []), d]);
    }
    const periodKeys = [...periods.keys()].sort();
    const seasonKey = periodKeys[periodKeys.length - 1];
    const season = periods.get(seasonKey)!.sort((a, b) => +a.date - +b.date);

    const first = utcMidnight(season[0].date);
    const last = utcMidnight(season[season.length - 1].date);
    const from = new Date(+first - 7 * DAY);
    const to = new Date(+last + 7 * DAY);
    const life = Math.round((+to - +from) / DAY) + 1;
    lifespans.push(life);
    const inside = +today >= +from && +today <= +to;

    const reported = season.filter((m) => m.filedOn);
    const toGo = season.filter((m) => !m.filedOn);
    const next = toGo.sort((a, b) => +a.date - +b.date)[0];
    const state =
      reported.length === 0 ? "none-reported" : toGo.length === 0 ? "all-reported" : toGo.length === 1 ? "one-remaining" : "partly";

    line(
      `${p.display_name.padEnd(40)} ${String(members.length).padStart(3)} ${String(dated.length).padStart(4)}  ` +
        `${iso(from)}→${iso(to)}  ${String(life).padStart(3)}d  ${inside ? " IN  " : " out "}  ${state.padEnd(14)} ` +
        `${String(reported.length).padStart(2)}/${String(season.length).padStart(2)}   ` +
        `${periodKeys.length > 1 ? `⚠ ${periodKeys.length} periods` : seasonKey}  ${next ? `${next.symbol} ${iso(next.date)}` : "—"}`,
    );
  }
  if (lifespans.length) {
    const s = [...lifespans].sort((a, b) => a - b);
    line(`\nbanner lifespan — min ${s[0]}d  median ${s[Math.floor(s.length / 2)]}d  max ${s[s.length - 1]}d`);
  }

  rule("MEMBERS OF A SCORED POND WITH NO EARNINGS ROW IN ±45d");
  for (const p of scoredPonds) {
    const mine = rows.filter((r) => r.pg_id === p.id);
    const byStock = new Map<string, { symbol: string; any: boolean }>();
    for (const r of mine) {
      const e = byStock.get(r.stock_id) ?? { symbol: r.symbol, any: false };
      if (r.event_date) e.any = true;
      byStock.set(r.stock_id, e);
    }
    const missing = [...byStock.values()].filter((m) => !m.any).map((m) => m.symbol);
    if (missing.length) line(`  ${p.display_name.padEnd(40)} ${missing.join(", ")}`);
  }

  rule("FILED-BUT-NO-CALENDAR-ROW, and CALENDAR-ROW-BUT-NO-FILING-YET (scored ponds)");
  {
    const inScored = rows.filter((r) => scoredPonds.some((p) => p.id === r.pg_id));
    const byStock = new Map<string, { symbol: string; dates: Date[]; filedOn: Date | null }>();
    for (const r of inScored) {
      const e = byStock.get(r.stock_id) ?? { symbol: r.symbol, dates: [], filedOn: r.filed_on };
      if (r.event_date) e.dates.push(r.event_date);
      if (r.filed_on) e.filedOn = r.filed_on;
      byStock.set(r.stock_id, e);
    }
    const all = [...byStock.values()];
    const filedNoRow = all.filter((m) => m.filedOn && m.dates.length === 0);
    const rowNoFiling = all.filter((m) => !m.filedOn && m.dates.length > 0);
    line(`  filed but no calendar row: ${filedNoRow.length} — ${filedNoRow.map((m) => m.symbol).join(", ") || "none"}`);
    line(`  calendar row, nothing filed: ${rowNoFiling.length} — ${rowNoFiling.map((m) => `${m.symbol}@${iso(pickScheduledDate(m.dates, today)!)}`).join(", ") || "none"}`);

    // ⚠ Does a filing ever land BEFORE the scheduled date (which would make "reported" and
    //   "still to report" disagree with a purely date-ordered row)?
    const early = all.filter((m) => m.filedOn && m.dates.length && +utcMidnight(m.filedOn) < +pickScheduledDate(m.dates, today)!);
    line(`  filed EARLIER than the scheduled date: ${early.length} — ${early.map((m) => `${m.symbol} filed ${iso(m.filedOn!)} vs ${iso(pickScheduledDate(m.dates, today)!)}`).join(", ") || "none"}`);
  }

  rule("CAPSULE COUNT AT TODAY — how many capsules each pond would render");
  for (const p of scoredPonds) {
    const mine = rows.filter((r) => r.pg_id === p.id);
    const byStock = new Map<string, { symbol: string; dates: Date[]; filedOn: Date | null }>();
    for (const r of mine) {
      const e = byStock.get(r.stock_id) ?? { symbol: r.symbol, dates: [], filedOn: r.filed_on };
      if (r.event_date) e.dates.push(r.event_date);
      if (r.filed_on) e.filedOn = r.filed_on;
      byStock.set(r.stock_id, e);
    }
    const dated = [...byStock.values()]
      .map((m) => ({ ...m, date: pickScheduledDate(m.dates, today) }))
      .filter((m) => m.date) as { symbol: string; date: Date; filedOn: Date | null }[];
    if (!dated.length) continue;
    const rep = dated.filter((m) => m.filedOn).length;
    line(
      `  ${p.display_name.padEnd(40)} reported ${String(rep).padStart(2)}  to-report ${String(dated.length - rep).padStart(2)}  longest ticker ${Math.max(...dated.map((d) => d.symbol.length))} chars`,
    );
  }

  // Longest ticker across every member of every scored pond — the capsule width driver.
  const longest = rows.map((r) => r.symbol).sort((a, b) => b.length - a.length).slice(0, 6);
  line(`\nlongest tickers in scored ponds: ${[...new Set(longest)].join(", ")}`);
}

main()
  .catch((e) => {
    console.error("recon2 crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
