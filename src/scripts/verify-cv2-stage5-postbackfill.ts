// CONSTRUCTION v2 — STAGE 5 — POST-BACKFILL VERIFICATION (read-only). Reads the PERSISTED rows directly
// (never recomputes) to prove the cutover landed: structure = Net, constant_version = 2.0, and — from
// the append-only history — Health/Quality/Signals UNCHANGED row-to-row while structure moved.
//   npx tsx src/scripts/verify-cv2-stage5-postbackfill.ts
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

// expected persisted values, by user prefix (from the dry-run projection).
const EXP: Record<string, { health: number; net: number }> = {
  "7985d813": { health: 65, net: 70.38 }, "e3c6bd3c": { health: 69, net: 27.76 },
  "4c5ca537": { health: 73, net: 21.00 }, "108fd2a6": { health: 50, net: 32.02 }, "ae8c6537": { health: 73, net: 21.00 },
};

async function main() {
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);

  console.log("═══ 1 · THE FIVE ROWS, AS PERSISTED (latest snapshot per user) ═══");
  for (const u of users) {
    const tag = u.user_id.slice(0, 8);
    const snap = await prisma.portfolioHealthSnapshot.findFirst({
      where: { userId: u.user_id }, orderBy: { createdAt: "desc" },
      select: { phs: true, structure: true, quality: true, signals: true, constantVersion: true },
    });
    const e = EXP[tag];
    console.log(`  ${tag} | health ${snap?.phs} · structure ${Number(snap?.structure).toFixed(2)} · quality ${Number(snap?.quality).toFixed(2)} · signals ${Number(snap?.signals).toFixed(2)} · cv "${snap?.constantVersion}"`);
    ok(`${tag} · health = ${e.health} (UNCHANGED — §13 survives the mass mutation)`, snap?.phs === e.health, `${snap?.phs}`);
    ok(`${tag} · structure = ${e.net} (the persisted Net)`, near(Number(snap?.structure), e.net), `${Number(snap?.structure).toFixed(2)}`);
    ok(`${tag} · constant_version = "portfolio-spec 2.0"`, snap?.constantVersion === "portfolio-spec 2.0", `${snap?.constantVersion}`);
  }

  console.log("\n═══ 4 · §13 FROM THE PERSISTED SIDE — append-only keeps the pre-backfill row; compare the two ═══");
  for (const u of users) {
    const tag = u.user_id.slice(0, 8);
    const rows = await prisma.portfolioHealthSnapshot.findMany({
      where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, take: 2,
      select: { phs: true, structure: true, quality: true, signals: true, constantVersion: true, createdAt: true },
    });
    if (rows.length < 2) { ok(`${tag} · has a pre-backfill row to compare against`, false, `only ${rows.length} snapshot(s)`); continue; }
    const [post, pre] = rows;
    ok(`${tag} · Health/Quality/Signals byte-identical row-to-row (the write touched ONLY structure)`,
      post.phs === pre.phs && Number(post.quality) === Number(pre.quality) && Number(post.signals) === Number(pre.signals),
      `health ${pre.phs}→${post.phs} · q ${Number(pre.quality).toFixed(4)}→${Number(post.quality).toFixed(4)} · sig ${Number(pre.signals).toFixed(4)}→${Number(post.signals).toFixed(4)}`);
    ok(`${tag} · structure MOVED (S-composite → Net) and cv bumped (1.2 → 2.0) in the same write`,
      Number(post.structure) !== Number(pre.structure) && post.constantVersion === "portfolio-spec 2.0" && pre.constantVersion === "portfolio-spec 1.2",
      `structure ${Number(pre.structure).toFixed(2)}→${Number(post.structure).toFixed(2)} · cv ${pre.constantVersion}→${post.constantVersion}`);
  }

  console.log("\n═══ 5 · CATALOG BYTE-IDENTICAL — the backfill wrote snapshots only ═══");
  const BASELINE: Record<string, number> = {
    mf_analytics: 30265506395726, daily_prices: 1216470182676443, stock_prices: 1067199306256,
    score_snapshots: 5156217484191, market_cap_tier_snapshot: 1083745276939, instruments: 40849366767338,
    instrument_corporate_events: 134636592678, instrument_prices: 9149761003566, index_prices: 311088550838147,
  };
  for (const [t, expected] of Object.entries(BASELINE)) {
    const r = (await q<{ fp: number }>(`SELECT COALESCE(SUM(('x'||substr(md5(x::text),1,8))::bit(32)::bigint),0)::bigint AS fp FROM ${t} x`))[0];
    ok(`${t} byte-identical`, Number(r.fp) === expected, `${Number(r.fp)}`);
  }
  const scored = (await q<{ n: number; fp: number }>(`SELECT COUNT(*)::int n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::bigint AS fp FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`))[0];
  ok("95 scored stocks unchanged", scored.n === 95 && Number(scored.fp) === 224788486973, `${scored.n} · ${Number(scored.fp)}`);

  console.log(`\n${fail === 0 ? "✅ CUTOVER LANDED — structure = Net, cv 2.0, Health untouched in the row, catalog byte-identical" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
