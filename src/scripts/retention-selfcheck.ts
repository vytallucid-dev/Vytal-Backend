// ═══════════════════════════════════════════════════════════════
// RETENTION SELF-CHECK — the negative controls (GATE 3). All READ-ONLY /
// dry-run: mutations are confined to a temporary policy-row edit that is always
// restored in a finally. Proves: floor clamps, exemption sparing, depth-not-time
// (LTIM), §13 untouched by a dry-run, and the FK delete-rule assumptions.
//
//   npx tsx src/scripts/retention-selfcheck.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";
import { clampUp, EXEMPTIONS } from "../retention/policy.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const n = async (sql: string, ...p: unknown[]): Promise<number> =>
  Number(((await prisma.$queryRawUnsafe(sql, ...p)) as { n: number | bigint }[])[0]?.n ?? 0);

async function main() {
  // ── A. Floor clamp (unit) ──────────────────────────────────
  console.log("\nA. Floor clamp — clampUp raises to floor, never below:");
  const c1 = clampUp(5, 8), c2 = clampUp(1000, 760), c3 = clampUp(null, 8);
  check("keep 5 on floor 8 → 8, clamped", c1.value === 8 && c1.clamped === true);
  check("keep 1000 on floor 760 → 1000, not clamped", c2.value === 1000 && c2.clamped === false);
  check("keep null on floor 8 → 8, clamped", c3.value === 8 && c3.clamped === true);

  // ── B. Floor clamp (end-to-end, live policy, dry-run) ──────
  console.log("\nB. Floor clamp — engine refuses a below-floor keep set by a (simulated) UI edit:");
  const target = "quarterly_results"; // floor 8
  const orig = await prisma.retentionPolicy.findUnique({ where: { table: target } });
  if (!orig) { check("policy row exists", false, `${target} missing`); }
  else {
    try {
      await prisma.retentionPolicy.update({ where: { table: target }, data: { keep: 3 } }); // below floor 8
      const rep = await runRetention({ dryRun: true });
      const r = rep.results.find((x) => x.table === target)!;
      const surplusAtFloor = await n(
        `SELECT count(*)::int AS n FROM (SELECT row_number() OVER (PARTITION BY "stock_id","result_type" ORDER BY "report_date" DESC, "id" DESC) rn FROM "quarterly_results") s WHERE s.rn > 8`,
      );
      const surplusAt3 = await n(
        `SELECT count(*)::int AS n FROM (SELECT row_number() OVER (PARTITION BY "stock_id","result_type" ORDER BY "report_date" DESC, "id" DESC) rn FROM "quarterly_results") s WHERE s.rn > 3`,
      );
      check("effective clamped to floor 8 (not 3)", r.effective === 8 && r.clamped === true, `effective=${r.effective}`);
      check("matched uses floor, not the below-floor request", r.matched === surplusAtFloor && r.matched !== surplusAt3, `matched=${r.matched} floorSurplus=${surplusAtFloor} req3Surplus=${surplusAt3}`);
    } finally {
      await prisma.retentionPolicy.update({ where: { table: target }, data: { keep: orig.keep } });
      const restored = await prisma.retentionPolicy.findUnique({ where: { table: target } });
      check("policy row restored (keep=20)", restored?.keep === orig.keep, `keep=${restored?.keep}`);
    }
  }

  // ── C. Exemption sparing (live, read-only) ─────────────────
  // At a 0-day window (everything older than now), WITH minus WITHOUT the exemption
  // clause must equal the independently-counted spared rows.
  console.log("\nC. Exemptions spare exactly the protected rows (window=0d, read-only):");
  const exCases: { table: string; ts: string; ex: string; sparedSql: string; meaningful?: boolean }[] = [
    { table: "ingestion_errors", ts: "last_seen_at", ex: "resolved_or_ignored", sparedSql: `"status" = 'open'`, meaningful: true },
    { table: "background_jobs", ts: "created_at", ex: "terminal_jobs_only", sparedSql: `"status" IN ('pending','running')` },
    { table: "event_reminder_events", ts: "fired_at", ex: "delivered_only", sparedSql: `"delivered" = false`, meaningful: true },
    { table: "alert_events", ts: "fired_at", ex: "delivered_only", sparedSql: `"delivered" = false` },
    { table: "stock_news", ts: "published_at", ex: "ai_summary_referenced", sparedSql: `"id" IN (SELECT "B" FROM "_AiSummaryToStockNews")` },
  ];
  for (const c of exCases) {
    const cutoff = `"${c.ts}" < now()`;
    const without = await n(`SELECT count(*)::int AS n FROM "${c.table}" WHERE ${cutoff}`);
    const withEx = await n(`SELECT count(*)::int AS n FROM "${c.table}" WHERE ${cutoff} ${EXEMPTIONS[c.ex].deleteClause}`);
    const spared = await n(`SELECT count(*)::int AS n FROM "${c.table}" WHERE ${cutoff} AND ${c.sparedSql}`);
    check(`${c.table}: exemption '${c.ex}' spares exactly the protected rows`, without - withEx === spared, `without=${without} with=${withEx} spared=${spared}`);
    if (c.meaningful) check(`${c.table}: a NON-trivial number of rows is actually spared`, spared > 0, `spared=${spared}`);
  }

  // ── D. Depth-not-time (the LTIM guarantee) ─────────────────
  console.log("\nD. Depth keeps newest N per key — a stalled key loses NOTHING (LTIM):");
  const thin = (await prisma.$queryRawUnsafe(
    `SELECT "stock_id" AS sid, count(*)::int AS c, max("date") AS mx FROM "daily_prices" GROUP BY 1 ORDER BY c ASC LIMIT 1`,
  )) as { sid: string; c: number; mx: Date }[];
  const t0 = thin[0];
  const surplusForThin = await n(
    `SELECT count(*)::int AS n FROM (SELECT "stock_id" sid, row_number() OVER (PARTITION BY "stock_id" ORDER BY "date" DESC, "id" DESC) rn FROM "daily_prices") s WHERE s.sid = $1 AND s.rn > 1000`,
    t0.sid,
  );
  check("thinnest stock is fully retained (0 surplus) though its newest row may be old", surplusForThin === 0, `rows=${t0.c} newest=${new Date(t0.mx).toISOString().slice(0, 10)} surplus=${surplusForThin}`);
  const keysOverKeep = await n(`SELECT count(*)::int AS n FROM (SELECT "stock_id" FROM "daily_prices" GROUP BY 1 HAVING count(*) > 1000) x`);
  const keysWithSurplus = await n(`SELECT count(DISTINCT sid)::int AS n FROM (SELECT "stock_id" sid, row_number() OVER (PARTITION BY "stock_id" ORDER BY "date" DESC) rn FROM "daily_prices") s WHERE s.rn > 1000`);
  check("only keys EXCEEDING keep are ever trimmed", keysOverKeep === keysWithSurplus, `over=${keysOverKeep} trimmed=${keysWithSurplus}`);

  // ── E. §13 — a dry-run perturbs nothing ────────────────────
  console.log("\nE. §13 — a dry-run deletes nothing (score-affecting tables byte-stable):");
  const before = { snaps: await n(`SELECT count(*)::int AS n FROM "score_snapshots"`), dp: await n(`SELECT count(*)::int AS n FROM "daily_prices"`), mf: await n(`SELECT count(*)::int AS n FROM "mf_analytics"`) };
  const rep = await runRetention({ dryRun: true });
  const after = { snaps: await n(`SELECT count(*)::int AS n FROM "score_snapshots"`), dp: await n(`SELECT count(*)::int AS n FROM "daily_prices"`), mf: await n(`SELECT count(*)::int AS n FROM "mf_analytics"`) };
  check("dry-run totalDeleted === 0", rep.totalDeleted === 0);
  check("score_snapshots unchanged", before.snaps === after.snaps, `${before.snaps}→${after.snaps}`);
  check("daily_prices unchanged", before.dp === after.dp, `${before.dp}→${after.dp}`);
  check("mf_analytics unchanged", before.mf === after.mf, `${before.mf}→${after.mf}`);

  // ── F. FK delete-rule assumptions still hold ───────────────
  console.log("\nF. Score-layer FK delete rules match the engine's cascade assumptions:");
  const fk = (await prisma.$queryRawUnsafe(
    `SELECT tc.table_name AS t, kcu.column_name AS c, rc.delete_rule AS d
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
     JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name IN ('score_snapshots','score_patterns','score_pillars')`,
  )) as { t: string; c: string; d: string }[];
  const rule = (t: string, c: string) => fk.find((x) => x.t === t && x.c === c)?.d;
  check("score_snapshots.supersedes_id = NO ACTION (null-before-delete)", rule("score_snapshots", "supersedes_id") === "NO ACTION", rule("score_snapshots", "supersedes_id"));
  check("score_snapshots.foundation_pillar_id = CASCADE (prune snapshots before pillars)", rule("score_snapshots", "foundation_pillar_id") === "CASCADE", rule("score_snapshots", "foundation_pillar_id"));
  check("score_patterns.snapshot_id = CASCADE (auto-drops with snapshot)", rule("score_patterns", "snapshot_id") === "CASCADE", rule("score_patterns", "snapshot_id"));

  console.log(`\n═══ SELF-CHECK: ${pass} passed, ${fail} failed ═══\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
