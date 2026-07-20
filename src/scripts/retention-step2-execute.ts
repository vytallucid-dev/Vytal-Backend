// ═══════════════════════════════════════════════════════════════
// RETENTION — STEP 2 EXECUTOR: the daily_prices 5.2y→4y correction, ISOLATED.
// Snapshots §13 (composite + Market subtotal per stock, PHS per user) BEFORE,
// runs ONLY the daily_prices depth prune via the engine (force-armed for this
// explicit run), snapshots §13 AFTER, asserts byte-identical — Market subscore
// specifically — and flips daily_prices.armed=true ONLY on a clean result.
//
//   PREVIEW:  npx tsx src/scripts/retention-step2-execute.ts
//   EXECUTE:  npx tsx src/scripts/retention-step2-execute.ts --confirm
//
// ⚠️ --confirm deletes ~105k rows from daily_prices (a scoring input). The floor
//    (760) guarantees every A2-capable stock keeps ≥1000 > 756; §13 is the proof.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = "daily_prices";
const KEEP = 1000, FLOOR = 760;

const rows = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(sql, ...p)) as T[];
const one = async (sql: string, ...p: unknown[]): Promise<number> =>
  Number(((await rows(sql, ...p)) as { n: number | bigint }[])[0]?.n ?? 0);

// §13 — the in-force snapshot per stock: composite AND market_subtotal AND band.
async function scores(): Promise<Map<string, string>> {
  const r = await rows<{ stock_id: string; c: string; m: string; b: string }>(
    `SELECT DISTINCT ON (stock_id) stock_id, composite::text c, market_subtotal::text m, label_band b
     FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC`,
  );
  return new Map(r.map((x) => [x.stock_id, `${x.c}|${x.m}|${x.b}`]));
}
async function phs(): Promise<Map<string, string>> {
  const r = await rows<{ user_id: string; phs: number | null; band: string | null }>(
    `SELECT DISTINCT ON (user_id) user_id, phs, band FROM portfolio_health_snapshot ORDER BY user_id, created_at DESC`,
  );
  return new Map(r.map((x) => [x.user_id, `${x.phs}|${x.band}`]));
}
function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const d: string[] = [];
  if (a.size !== b.size) d.push(`size ${a.size}→${b.size}`);
  for (const [k, v] of a) if (b.get(k) !== v) d.push(`${k}: ${v} → ${b.get(k)}`);
  return d;
}

async function main() {
  const eff = Math.max(KEEP, FLOOR);
  console.log(`\n═══ STEP 2 — ${TABLE} keep=${KEEP} floor=${FLOOR} (eff=${eff}) ═══`);
  console.log(CONFIRM ? "MODE: --confirm (LIVE DELETE)\n" : "MODE: PREVIEW\n");

  // 2 — re-read the live count. 3 — hot floor assertion.
  const stocks = await rows<{ symbol: string; cnt: number; post: number; trimmed: number }>(
    `WITH pk AS (SELECT stock_id, count(*)::int cnt FROM ${'"daily_prices"'} GROUP BY stock_id)
     SELECT s.symbol, pk.cnt, LEAST(pk.cnt,$1)::int post, GREATEST(pk.cnt-$1,0)::int trimmed
     FROM pk JOIN stocks s ON s.id = pk.stock_id ORDER BY pk.cnt ASC`,
    eff,
  );
  const surplus = stocks.reduce((s, r) => s + r.trimmed, 0);
  const trimmed = stocks.filter((r) => r.trimmed > 0);
  const minPostTrimmed = trimmed.length ? Math.min(...trimmed.map((r) => r.post)) : eff;
  const under800 = trimmed.filter((r) => r.post < 800);
  console.log(`Live surplus now: ${surplus} rows across ${trimmed.length} stocks (of ${stocks.length}).`);
  console.log(`Thinnest 6 (kept whole): ${stocks.slice(0, 6).map((r) => `${r.symbol}(${r.cnt})`).join(", ")}`);
  console.log(`Floor: min post-trim among trimmed = ${minPostTrimmed} (≥${FLOOR}? ${minPostTrimmed >= FLOOR}) · trimmed-under-800 = ${under800.length}`);
  if (minPostTrimmed < FLOOR || under800.length > 0) {
    console.log(`\n❌ FLOOR VIOLATION — STOP. ${under800.map((r) => r.symbol + "(" + r.post + ")").join(", ")}`);
    await prisma.$disconnect(); process.exit(1);
  }
  console.log("✅ floor margin clean — no trimmed stock lands below 800.\n");

  // 1 — §13 baseline BEFORE
  const s0 = await scores(), p0 = await phs();
  const books0 = [...p0.values()].map((v) => v.split("|")[0]).filter((v) => v !== "null").map(Number).sort((a, b) => b - a);
  console.log(`§13 baseline: ${s0.size} in-force stock scores · books = [${books0.join(", ")}]`);

  if (!CONFIRM) {
    console.log(`\nPREVIEW only — would delete ${surplus} rows. Re-run with --confirm.\n`);
    await prisma.$disconnect(); return;
  }

  // 4 — watched delete, daily_prices ONLY (force-armed for this explicit run; DB flag still false)
  console.log(`\nDeleting ${surplus} rows from ${TABLE} …`);
  const report = await runRetention({ dryRun: false, only: [TABLE], forceArmOnly: true });
  const r = report.results.find((x) => x.table === TABLE)!;
  console.log(`Deleted: ${r.deleted} (matched ${r.matched}).`);

  // 5 — §13 IMMEDIATELY AFTER — Market subscore specifically
  const s1 = await scores(), p1 = await phs();
  const sd = diff(s0, s1), pd = diff(p0, p1);
  const books1 = [...p1.values()].map((v) => v.split("|")[0]).filter((v) => v !== "null").map(Number).sort((a, b) => b - a);
  console.log("\n── §13 (composite + Market subtotal + PHS) ────────────────────");
  console.log(`  ${sd.length === 0 ? "✅" : "❌"} in-force stock scores byte-identical (composite AND market_subtotal)`);
  if (sd.length) sd.slice(0, 10).forEach((x) => console.log(`     ${x}`));
  console.log(`  ${pd.length === 0 ? "✅" : "❌"} book PHS byte-identical — [${books1.join(", ")}]`);
  if (pd.length) pd.slice(0, 10).forEach((x) => console.log(`     ${x}`));

  const clean = sd.length === 0 && pd.length === 0;
  if (!clean) {
    console.log(`\n❌ §13 MOVED — NOT flipping the flag. daily_prices rows are already deleted; investigate the diffs above.`);
    await prisma.$disconnect(); process.exit(1);
  }

  // 6 — on clean §13, flip the DB flag so the nightly maintains it going forward
  await prisma.retentionPolicy.update({ where: { table: TABLE }, data: { armed: true } });
  console.log(`\n✅ §13 clean. Flipped ${TABLE}.armed = true — nightly now maintains it (~424 rows/day).`);
  const finalCnt = await one(`SELECT count(*)::int n FROM ${'"daily_prices"'}`);
  console.log(`\n═══ STEP 2 DONE — ${r.deleted} deleted · daily_prices now ${finalCnt} rows · §13 clean ═══\n`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
