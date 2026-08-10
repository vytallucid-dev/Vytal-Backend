// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECON — PEER-GROUP RESULTS SEASON (Prompt 29, Part 0). Read-only.
//
// Five questions, measured rather than assumed:
//   1 · the ponds, their rosters and their scored counts
//   2 · every member's earnings row this season, and the EARLIEST→LATEST spread per pond
//   3 · the cost of reaching those rows (one read or a fan-out)
//   4 · whether a reported member's results page is reachable and non-empty when it is UNSCORED
//   5 · what the reader-exposure joins cost over a whole roster
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildResultDetail } from "../scoring/read/result-detail.service.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(104) + "\n" + s + "\n" + "═".repeat(104));

async function main() {
  const today = new Date();
  line(`today (server clock): ${today.toISOString()}`);

  // ── 1 · THE PONDS ────────────────────────────────────────────────────────────────────────────
  rule("1 · THE PONDS — roster, scored count, sector");
  const pgs = await prisma.$queryRaw<
    { id: string; name: string; display_name: string; sector: string | null; roster: bigint; scored: bigint }[]
  >`
    SELECT pg.id, pg.name, pg.display_name, sec.display_name AS sector,
           count(DISTINCT spg.stock_id)::bigint AS roster,
           count(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = spg.stock_id)
                               THEN spg.stock_id END)::bigint AS scored
    FROM peer_groups pg
    LEFT JOIN sectors sec ON sec.id = pg.sector_id
    LEFT JOIN stock_peer_groups spg ON spg.peer_group_id = pg.id
    GROUP BY pg.id, pg.name, pg.display_name, sec.display_name
    ORDER BY pg.display_name
  `;
  line(`peer_groups rows: ${pgs.length}`);
  for (const p of pgs) {
    line(`  ${p.display_name.padEnd(42)} roster ${String(p.roster).padStart(2)}  scored ${String(p.scored).padStart(2)}  · ${p.sector ?? "—"}`);
  }
  const withRoster = pgs.filter((p) => Number(p.roster) > 0);
  line(`\nponds with ≥1 member: ${withRoster.length}   largest roster: ${Math.max(...pgs.map((p) => Number(p.roster)))}`);

  // ── 2 · EARNINGS ROWS PER POND — ONE READ ────────────────────────────────────────────────────
  rule("2 · EVERY MEMBER'S EARNINGS ROW — one grouped read across all ponds");
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<
    { pg_id: string; display_name: string; symbol: string; stock_id: string; event_date: Date; days_out: number; scored: boolean }[]
  >`
    SELECT pg.id AS pg_id, pg.display_name, st.symbol, st.id AS stock_id,
           ce.event_date, (ce.event_date::date - CURRENT_DATE) AS days_out,
           EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = st.id) AS scored
    FROM peer_groups pg
    JOIN stock_peer_groups spg ON spg.peer_group_id = pg.id
    JOIN stocks st ON st.id = spg.stock_id AND st.is_active = true
    JOIN corporate_events ce ON ce.stock_id = st.id AND ce.event_type = 'earnings'
    WHERE ce.event_date >= CURRENT_DATE - INTERVAL '75 days'
      AND ce.event_date <= CURRENT_DATE + INTERVAL '75 days'
    ORDER BY pg.display_name, ce.event_date
  `;
  const ms = Date.now() - t0;
  line(`one grouped read: ${rows.length} rows in ${ms} ms (±75 days, every pond at once)`);

  // Per-pond spread over the ±75d band, then over the tighter "this season" band.
  const byPg = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.display_name;
    if (!byPg.has(k)) byPg.set(k, []);
    byPg.get(k)!.push(r);
  }

  rule("2a · THE SPREAD PER POND — earliest → latest earnings date, ±75 days");
  line("pond".padEnd(42) + "n  earliest     latest       spread  reported  toGo  scored");
  const spreads: number[] = [];
  for (const p of withRoster) {
    const rs = (byPg.get(p.display_name) ?? []).slice();
    if (rs.length === 0) {
      line(`${p.display_name.padEnd(42)} —  (no earnings rows in ±75d)`);
      continue;
    }
    // Distinct per stock: reschedule residue leaves two rows. Take the same rule the stock
    // banner uses — earliest date at-or-ahead of today, else the latest behind.
    const perStock = new Map<string, Date[]>();
    for (const r of rs) {
      const a = perStock.get(r.symbol) ?? [];
      a.push(r.event_date);
      perStock.set(r.symbol, a);
    }
    const picked: { symbol: string; date: Date; scored: boolean }[] = [];
    for (const [symbol, dates] of perStock) {
      const norm = dates.map((d) => new Date(iso(d) + "T00:00:00.000Z")).sort((a, b) => +a - +b);
      const todayUtc = new Date(iso(today) + "T00:00:00.000Z");
      const ahead = norm.filter((d) => +d >= +todayUtc);
      const pick = ahead.length ? ahead[0] : norm[norm.length - 1];
      picked.push({ symbol, date: pick, scored: rs.find((r) => r.symbol === symbol)!.scored });
    }
    picked.sort((a, b) => +a.date - +b.date);
    const first = picked[0].date, last = picked[picked.length - 1].date;
    const spread = Math.round((+last - +first) / 86400000);
    spreads.push(spread);
    const todayUtc = new Date(iso(today) + "T00:00:00.000Z");
    const reported = picked.filter((x) => +x.date < +todayUtc).length;
    const toGo = picked.length - reported;
    const scoredN = picked.filter((x) => x.scored).length;
    line(
      `${p.display_name.padEnd(42)} ${String(picked.length).padStart(2)}  ${iso(first)}   ${iso(last)}   ${String(spread).padStart(4)}d   ${String(reported).padStart(6)}  ${String(toGo).padStart(4)}  ${String(scoredN).padStart(4)}/${picked.length}`,
    );
  }
  if (spreads.length) {
    const s = [...spreads].sort((a, b) => a - b);
    line(`\nspread across ponds — min ${s[0]}d  median ${s[Math.floor(s.length / 2)]}d  max ${s[s.length - 1]}d`);
  }

  // ── 2b · SEASON CLUSTERING — is one pond's set one season or two? ────────────────────────────
  rule("2b · DATE HISTOGRAM PER POND (±75d) — to see whether the dates form one season or two");
  for (const p of withRoster) {
    const rs = byPg.get(p.display_name) ?? [];
    if (!rs.length) continue;
    const dates = [...new Set(rs.map((r) => iso(r.event_date)))].sort();
    line(`  ${p.display_name.padEnd(42)} ${dates.join("  ")}`);
  }

  // ── 3 · FILINGS — who has actually reported ──────────────────────────────────────────────────
  rule("3 · REPORTED vs SCHEDULED — the filing union, one read for every member of every pond");
  const t1 = Date.now();
  const filings = await prisma.$queryRaw<{ stock_id: string; symbol: string; report_date: Date; filed_on: Date }[]>`
    WITH members AS (
      SELECT DISTINCT st.id AS stock_id, st.symbol
      FROM stock_peer_groups spg JOIN stocks st ON st.id = spg.stock_id AND st.is_active = true
    ), f AS (
      SELECT stock_id, report_date, filing_date FROM quarterly_results
      UNION ALL SELECT stock_id, report_date, filing_date FROM banking_quarterly_results
      UNION ALL SELECT stock_id, report_date, filing_date FROM nbfc_quarterly_results
      UNION ALL SELECT stock_id, report_date, filing_date FROM life_insurance_quarterly_results
      UNION ALL SELECT stock_id, report_date, filing_date FROM general_insurance_quarterly_results
    )
    SELECT m.stock_id, m.symbol, f.report_date, min(f.filing_date) AS filed_on
    FROM members m JOIN f ON f.stock_id = m.stock_id
    WHERE f.report_date >= DATE '2026-06-30'
    GROUP BY m.stock_id, m.symbol, f.report_date
    ORDER BY filed_on
  `;
  line(`one grouped filing read: ${filings.length} rows in ${Date.now() - t1} ms (period end ≥ 2026-06-30)`);
  const filedBy = new Map<string, Date>();
  for (const f of filings) if (iso(f.report_date) === "2026-06-30") filedBy.set(f.stock_id, f.filed_on);
  line(`members with a June-2026-period filing: ${filedBy.size}`);

  // ── 4 · IS A REPORTED-BUT-UNSCORED MEMBER'S RESULTS PAGE NON-EMPTY? ──────────────────────────
  rule("4 · THE CAPSULE LINK TARGET — /results/:symbol for reported members, scored AND unscored");
  const memberStocks = await prisma.$queryRaw<{ stock_id: string; symbol: string; scored: boolean }[]>`
    SELECT DISTINCT st.id AS stock_id, st.symbol,
      EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = st.id) AS scored
    FROM stock_peer_groups spg JOIN stocks st ON st.id = spg.stock_id AND st.is_active = true
  `;
  const reportedMembers = memberStocks.filter((m) => filedBy.has(m.stock_id));
  const unscoredReported = reportedMembers.filter((m) => !m.scored);
  line(`peer-group members total: ${memberStocks.length}   scored: ${memberStocks.filter((m) => m.scored).length}`);
  line(`reported this period: ${reportedMembers.length}   of which UNSCORED: ${unscoredReported.length}`);

  const probe = [...unscoredReported.slice(0, 6), ...reportedMembers.filter((m) => m.scored).slice(0, 4)];
  for (const m of probe) {
    const t = Date.now();
    let verdict: string;
    try {
      const d = await buildResultDetail(m.symbol, undefined, null);
      verdict = d
        ? `OK — ${d.periodsAvailable.length} periods, current ${d.current.periodKey}, health.scored=${d.health?.scored}`
        : "NULL → the page 404s";
    } catch (e) {
      verdict = `THREW — ${(e as Error).message}`;
    }
    line(`  ${m.symbol.padEnd(14)} scored=${String(m.scored).padEnd(5)} ${verdict}  (${Date.now() - t} ms)`);
  }

  // ── 5 · READER EXPOSURE OVER A ROSTER ────────────────────────────────────────────────────────
  rule("5 · READER EXPOSURE — one read for a whole roster (watchlist + positive-quantity holdings)");
  const someUser = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!someUser) line("  no users in this database — skipping the timed probe");
  else {
    const biggest = withRoster.sort((a, b) => Number(b.roster) - Number(a.roster))[0];
    const t = Date.now();
    const exposure = await prisma.$queryRaw<{ stock_id: string; watched: boolean; held: boolean }[]>`
      WITH members AS (
        SELECT spg.stock_id FROM stock_peer_groups spg WHERE spg.peer_group_id = ${biggest.id}
      )
      SELECT m.stock_id,
        EXISTS (SELECT 1 FROM watchlist w WHERE w.user_id = ${someUser.id} AND w.stock_id = m.stock_id) AS watched,
        EXISTS (SELECT 1 FROM holdings h WHERE h.user_id = ${someUser.id} AND h.stock_id = m.stock_id AND h.quantity > 0)
          OR EXISTS (SELECT 1 FROM broker_holdings b WHERE b.user_id = ${someUser.id} AND b.stock_id = m.stock_id AND b.quantity > 0) AS held
      FROM members m
    `;
    line(`  pond ${biggest.display_name} · ${exposure.length} members · ${Date.now() - t} ms for the whole roster in ONE read`);
    line(`  watched ${exposure.filter((e) => e.watched).length}  held ${exposure.filter((e) => e.held).length}`);
  }

  // How many readers have any exposure at all, so the report can say whether the state is testable.
  const counts = await prisma.$queryRaw<{ users: bigint; wl: bigint; hold: bigint }[]>`
    SELECT (SELECT count(*) FROM users)::bigint AS users,
           (SELECT count(DISTINCT user_id) FROM watchlist)::bigint AS wl,
           (SELECT count(DISTINCT user_id) FROM holdings WHERE quantity > 0)::bigint AS hold
  `;
  line(`\n  users ${counts[0].users} · with a watchlist row ${counts[0].wl} · with a live holding ${counts[0].hold}`);
}

main()
  .catch((e) => {
    console.error("recon crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
