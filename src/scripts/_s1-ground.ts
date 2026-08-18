// ═══════════════════════════════════════════════════════════════
// STAGE 1.0 — GROUND IT. READ-ONLY. Zero mutating statements.
//   npx tsx src/scripts/_s1-ground.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { clampUp } from "../retention/policy.js";

const TARGETS: Record<string, number> = {
  quarterly_results: 32,
  fundamentals: 14,
  shareholding_patterns: 26,
  daily_prices: 1900,
  index_prices: 1900,
  banking_quarterly_results: 32,
  banking_fundamentals: 14,
  nbfc_quarterly_results: 32,
  nbfc_fundamentals: 14,
  life_insurance_quarterly_results: 32,
  life_insurance_fundamentals: 14,
  general_insurance_quarterly_results: 32,
  general_insurance_fundamentals: 14,
};
const REPORT_ONLY = ["insider_trades", "block_deals"];

const q = (id: string) => `"${id}"`;
const raw = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(sql, ...p)) as T[];
const num = (v: unknown): number => Number(v ?? 0);
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);
const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + " MB";
const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(3) + " GB";

async function main() {
  const pols = await prisma.retentionPolicy.findMany({ orderBy: { table: "asc" } });
  const byTable = new Map(pols.map((p) => [p.table, p]));

  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.0a — LIVE POLICY ROWS (measured from retention_policy)                 ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  console.log(
    `  ${pad("table", 36)}${pad("mode", 15)}${lpad("keep", 6)}${lpad("days", 6)}${lpad("floor", 7)}  arm  enab  order_col            key_cols`,
  );
  const allNames = [...Object.keys(TARGETS), ...REPORT_ONLY];
  for (const t of allNames) {
    const p = byTable.get(t);
    if (!p) { console.log(`  ${pad(t, 36)}  ⚠ NO POLICY ROW`); continue; }
    console.log(
      `  ${pad(t, 36)}${pad(p.mode, 15)}${lpad(p.keep ?? "-", 6)}${lpad(p.days ?? "-", 6)}${lpad(p.floor, 7)}  ${p.armed ? "Y" : "n"}    ${p.enabled ? "Y" : "n"}     ${pad(p.orderCol ?? p.tsColumn ?? "-", 20)} ${JSON.stringify(p.keyCols)}`,
    );
  }
  console.log("\n  floor_reason (target tables):");
  for (const t of Object.keys(TARGETS)) {
    const p = byTable.get(t);
    if (p) console.log(`    ${pad(t, 36)} floor=${lpad(p.floor, 5)}  ${p.floorReason}`);
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.0b — DEPTH REALITY: max rows/key, keys AT the cap, surplus today      ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");

  interface Depth {
    table: string; keep: number; floor: number; totalRows: number; keys: number;
    maxPerKey: number; atCapExact: number; atOrOverCap: number; surplusRows: number;
    stocks: number | null; keysPerStock: number | null; bytesPerRow: number; totalBytes: number;
    p50: number; p90: number;
  }
  const depths: Depth[] = [];

  for (const t of Object.keys(TARGETS)) {
    const p = byTable.get(t);
    if (!p) continue;
    if (p.mode !== "depth_per_key" || !p.orderCol || p.keyCols.length === 0 || p.keep == null) {
      console.log(`  ${pad(t, 36)} ⚠ not depth_per_key (mode=${p.mode}) — skipped from depth stats`);
      continue;
    }
    const eff = clampUp(p.keep, p.floor).value;
    const part = p.keyCols.map(q).join(", ");
    const [agg] = await raw(
      `WITH k AS (SELECT ${part}, count(*)::int AS c FROM ${q(t)} GROUP BY ${part})
       SELECT count(*)::int                                   AS keys,
              coalesce(sum(c),0)::int                          AS total_rows,
              coalesce(max(c),0)::int                          AS max_per_key,
              count(*) FILTER (WHERE c = $1)::int              AS at_cap_exact,
              count(*) FILTER (WHERE c >= $1)::int             AS at_or_over,
              coalesce(sum(GREATEST(c - $1, 0)),0)::int        AS surplus,
              coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY c),0)::int AS p50,
              coalesce(percentile_disc(0.9) WITHIN GROUP (ORDER BY c),0)::int AS p90
       FROM k`,
      eff,
    );
    let stocks: number | null = null;
    if (p.keyCols.includes("stock_id")) {
      const [s] = await raw(`SELECT count(DISTINCT "stock_id")::int AS n FROM ${q(t)}`);
      stocks = num(s.n);
    }
    const [sz] = await raw(`SELECT pg_total_relation_size($1)::bigint AS b`, t);
    const totalBytes = Number(sz.b);
    const totalRows = num(agg.total_rows);
    depths.push({
      table: t, keep: eff, floor: p.floor, totalRows, keys: num(agg.keys),
      maxPerKey: num(agg.max_per_key), atCapExact: num(agg.at_cap_exact),
      atOrOverCap: num(agg.at_or_over), surplusRows: num(agg.surplus),
      stocks, keysPerStock: stocks ? num(agg.keys) / stocks : null,
      bytesPerRow: totalRows > 0 ? totalBytes / totalRows : 0, totalBytes,
      p50: num(agg.p50), p90: num(agg.p90),
    });
  }

  console.log(
    `  ${pad("table", 36)}${lpad("keep", 5)}${lpad("keys", 7)}${lpad("rows", 10)}${lpad("max/key", 8)}${lpad("=cap", 7)}${lpad(">=cap", 7)}${lpad("surplus", 9)}${lpad("p50", 5)}${lpad("p90", 5)}`,
  );
  for (const d of depths) {
    const flag = d.surplusRows > 0 ? "  ← TRIMMING NOW" : d.atCapExact > 0 ? "  ← at cap (trims on next arrival)" : "";
    console.log(
      `  ${pad(d.table, 36)}${lpad(d.keep, 5)}${lpad(d.keys, 7)}${lpad(d.totalRows, 10)}${lpad(d.maxPerKey, 8)}${lpad(d.atCapExact, 7)}${lpad(d.atOrOverCap, 7)}${lpad(d.surplusRows, 9)}${lpad(d.p50, 5)}${lpad(d.p90, 5)}${flag}`,
    );
  }

  // index_prices oldest-date detail (the regime read)
  const ip = byTable.get("index_prices");
  if (ip?.keyCols.length) {
    const part = ip.keyCols.map(q).join(", ");
    console.log("\n  index_prices detail (oldest retained bar per index):");
    const rows = await raw(
      `SELECT ${part}, count(*)::int AS c, min(${q(ip.orderCol!)})::text AS oldest, max(${q(ip.orderCol!)})::text AS newest
         FROM ${q("index_prices")} GROUP BY ${part} ORDER BY 1`,
    );
    for (const r of rows) {
      const keyVal = ip.keyCols.map((k) => String(r[k])).join("/");
      console.log(`    ${pad(keyVal, 42)} rows=${lpad(r.c, 6)}  oldest=${r.oldest}  newest=${r.newest}`);
    }
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.0c — TARGET keep vs FLOOR (clampUp would silently raise a sub-floor)  ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  for (const [t, target] of Object.entries(TARGETS)) {
    const p = byTable.get(t);
    if (!p) continue;
    const c = clampUp(target, p.floor);
    console.log(
      `  ${pad(t, 36)} target=${lpad(target, 6)} floor=${lpad(p.floor, 6)} → effective=${lpad(c.value, 6)}  ${c.clamped ? "⚠ CLAMPED — edit silently ineffective" : "ok (target > floor)"}`,
    );
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.0d — insider_trades / block_deals (REPORT ONLY, no change)            ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  for (const t of REPORT_ONLY) {
    const p = byTable.get(t);
    if (!p) { console.log(`  ${t}: no policy row`); continue; }
    const tsCol = p.tsColumn!;
    const [st] = await raw(
      `SELECT count(*)::int AS rows, count(DISTINCT "stock_id")::int AS stocks,
              min(${q(tsCol)})::text AS oldest, max(${q(tsCol)})::text AS newest,
              count(*) FILTER (WHERE ${q(tsCol)} IS NULL)::int AS null_ts,
              count(*) FILTER (WHERE ${q(tsCol)} < now() - make_interval(days => $1::int))::int AS past_cutoff
         FROM ${q(t)}`,
      clampUp(p.days, p.floor).value,
    );
    const [sz] = await raw(`SELECT pg_total_relation_size($1)::bigint AS b`, t);
    console.log(
      `  ${pad(t, 18)} mode=${p.mode} days=${p.days} floor=${p.floor} armed=${p.armed} enabled=${p.enabled} ts=${tsCol} exempt=${p.exceptWhere ?? "-"}`,
    );
    console.log(
      `    rows=${st.rows} stocks=${st.stocks} oldest=${st.oldest} newest=${st.newest} null_ts=${st.null_ts} past_${p.days}d_cutoff=${st.past_cutoff} size=${mb(Number(sz.b))}`,
    );
    // How much sits inside the window a 2022-01-31 snapshot needs (90d back from ~2021-12-31 as-on).
    const [old22] = await raw(
      `SELECT count(*)::int AS n FROM ${q(t)} WHERE ${q(tsCol)} <= DATE '2022-01-31'`,
    );
    const [win22] = await raw(
      `SELECT count(*)::int AS n FROM ${q(t)} WHERE ${q(tsCol)} BETWEEN DATE '2021-10-02' AND DATE '2021-12-31'`,
    );
    console.log(`    rows <= 2022-01-31: ${old22.n}   rows in 2021-10-02..2021-12-31 (the C/D 90d window): ${win22.n}`);
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.0e — STORAGE PROJECTION at the new caps (measured bytes/row)          ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  const [dbsz] = await raw(`SELECT pg_database_size(current_database())::bigint AS b`);
  const dbBytes = Number(dbsz.b);
  const targetBytesSum = depths.reduce((s, d) => s + d.totalBytes, 0);
  console.log(`  live database size (measured): ${gb(dbBytes)}   ceiling 8.000 GB`);
  console.log(`  the 13 target tables today:    ${gb(targetBytesSum)}  (${((targetBytesSum / dbBytes) * 100).toFixed(1)}% of DB)`);
  console.log(`  everything else:               ${gb(dbBytes - targetBytesSum)}\n`);

  console.log(
    `  ${pad("table", 36)}${lpad("B/row", 8)}${lpad("now", 10)}${lpad("@504", 12)}${lpad("@2500", 12)}   keys/stock`,
  );
  let sum504 = 0, sum2500 = 0;
  for (const d of depths) {
    const target = TARGETS[d.table];
    const p = byTable.get(d.table)!;
    const effTarget = clampUp(target, p.floor).value;
    let rows504: number, rows2500: number;
    if (d.keysPerStock != null) {
      rows504 = d.keysPerStock * effTarget * 504;
      rows2500 = d.keysPerStock * effTarget * 2500;
    } else {
      rows504 = d.keys * effTarget; // not stock-keyed (index_prices) — universe-independent
      rows2500 = d.keys * effTarget;
    }
    const b504 = rows504 * d.bytesPerRow;
    const b2500 = rows2500 * d.bytesPerRow;
    sum504 += b504; sum2500 += b2500;
    console.log(
      `  ${pad(d.table, 36)}${lpad(d.bytesPerRow.toFixed(0), 8)}${lpad(mb(d.totalBytes), 10)}${lpad(mb(b504), 12)}${lpad(mb(b2500), 12)}   ${d.keysPerStock?.toFixed(2) ?? "n/a (not stock-keyed)"}`,
    );
  }
  const rest = dbBytes - targetBytesSum;
  console.log(`\n  TOTAL target tables @504 caps : ${gb(sum504)}`);
  console.log(`  TOTAL target tables @2500 caps: ${gb(sum2500)}`);
  console.log(`  + everything else (today)      : ${gb(rest)}`);
  console.log(`  ⇒ projected DB @504  : ${gb(sum504 + rest)}   headroom vs 8 GB: ${gb(8 * 1024 ** 3 - (sum504 + rest))}`);
  console.log(`  ⇒ projected DB @2500 : ${gb(sum2500 + rest)}   headroom vs 8 GB: ${gb(8 * 1024 ** 3 - (sum2500 + rest))}`);
  console.log(`     (rest held flat — it is NOT universe-flat; treat @2500 as a floor, see report)\n`);

  console.log("╔══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S1.3 — SHAREHOLDING INTERIM TRAP (report only)                           ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════╝");
  const sp = byTable.get("shareholding_patterns");
  if (sp?.orderCol) {
    const oc = q(sp.orderCol);
    // quarter-end = last calendar day of Mar/Jun/Sep/Dec
    const isQE = `(${oc} = (date_trunc('quarter', ${oc}) + interval '3 months - 1 day')::date)`;
    const [tot] = await raw(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE NOT ${isQE})::int AS interim_rows,
              count(DISTINCT "stock_id")::int AS stocks
         FROM ${q("shareholding_patterns")}`,
    );
    console.log(`  total rows=${tot.rows}  interim(non-quarter-end) rows=${tot.interim_rows}  stocks=${tot.stocks}`);
    const dist = await raw(
      `WITH per AS (
         SELECT "stock_id",
                count(*)::int AS rows,
                count(*) FILTER (WHERE NOT ${isQE})::int AS interim,
                count(*) FILTER (WHERE ${isQE})::int AS qe
           FROM ${q("shareholding_patterns")} GROUP BY "stock_id")
       SELECT interim, count(*)::int AS stocks FROM per GROUP BY interim ORDER BY interim`,
    );
    console.log("  interim-count distribution (interim rows → # stocks):");
    for (const r of dist) console.log(`    ${lpad(r.interim, 3)} interim → ${r.stocks} stocks`);
    const worst = await raw(
      `WITH per AS (
         SELECT s."stock_id", st."symbol",
                count(*)::int AS rows,
                count(*) FILTER (WHERE NOT ${isQE})::int AS interim,
                count(*) FILTER (WHERE ${isQE})::int AS qe
           FROM ${q("shareholding_patterns")} s JOIN stocks st ON st."id" = s."stock_id"
          GROUP BY s."stock_id", st."symbol")
       SELECT * FROM per ORDER BY interim DESC, rows DESC LIMIT 15`,
    );
    console.log("  worst cases (most interim rows):");
    for (const r of worst) console.log(`    ${pad(r.symbol, 16)} rows=${lpad(r.rows, 4)} interim=${lpad(r.interim, 3)} quarter_ends=${lpad(r.qe, 4)}`);

    // At keep=K, how many quarter-ends survive per stock? Pruner orders as_on_date DESC.
    for (const K of [20, 26, 28, 30, 32]) {
      const [res] = await raw(
        `WITH ranked AS (
           SELECT "stock_id", ${oc} AS d,
                  row_number() OVER (PARTITION BY "stock_id" ORDER BY ${oc} DESC, "id" DESC) AS rn,
                  ${isQE} AS qe
             FROM ${q("shareholding_patterns")}),
         kept AS (SELECT "stock_id", count(*) FILTER (WHERE qe)::int AS qe_kept FROM ranked WHERE rn <= $1 GROUP BY "stock_id")
         SELECT min(qe_kept)::int AS worst, round(avg(qe_kept),2)::text AS avg,
                count(*) FILTER (WHERE qe_kept < 16)::int AS below16 FROM kept`,
        K,
      );
      console.log(`    keep=${lpad(K, 3)} → worst-case quarter-ends retained: ${res.worst}  avg: ${res.avg}  stocks below 16 QE: ${res.below16}`);
    }
    // Oldest quarter-end retained at each K (does it reach 2022-01-31?)
    for (const K of [20, 26, 32]) {
      const [res] = await raw(
        `WITH ranked AS (
           SELECT "stock_id", ${oc} AS d,
                  row_number() OVER (PARTITION BY "stock_id" ORDER BY ${oc} DESC, "id" DESC) AS rn
             FROM ${q("shareholding_patterns")}),
         kept AS (SELECT "stock_id", min(d) AS oldest FROM ranked WHERE rn <= $1 GROUP BY "stock_id")
         SELECT max(oldest)::text AS newest_oldest, min(oldest)::text AS oldest_oldest,
                count(*) FILTER (WHERE oldest > DATE '2021-12-31')::int AS cannot_reach_2021Q4 FROM kept`,
        K,
      );
      console.log(`    keep=${lpad(K, 3)} → oldest retained as_on ranges ${res.oldest_oldest}..${res.newest_oldest}; stocks that cannot reach 2021-12-31: ${res.cannot_reach_2021Q4}`);
    }
  }

  console.log("\n  (READ-ONLY: this script issued only SELECTs.)\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
