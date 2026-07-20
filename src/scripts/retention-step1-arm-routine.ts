// ═══════════════════════════════════════════════════════════════
// RETENTION — ARMING SEQUENCE, STEP 1. Arm the 30 ROUTINE tables (everything
// EXCEPT daily_prices), run the pruner LIVE once, and assert nothing moved that
// must not. daily_prices is HELD (armed=false) for Step 2.
//
//   PREVIEW (no delete):  npx tsx src/scripts/retention-step1-arm-routine.ts
//   EXECUTE (deletes):    npx tsx src/scripts/retention-step1-arm-routine.ts --confirm
//
// ⚠️ --confirm DELETES production data. Even so, daily_prices cannot be touched:
//    it stays armed=false, so the engine counts it and never deletes it.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";

const CONFIRM = process.argv.includes("--confirm");
const HOLD = "daily_prices"; // the ONE table held back for Step 2

let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const rows = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(sql, ...p)) as T[];
const n = async (sql: string, ...p: unknown[]): Promise<number> =>
  Number(((await rows(sql, ...p)) as { n: number | bigint }[])[0]?.n ?? 0);

// §13 snapshots — the in-force composite per stock, and the latest PHS per user.
async function inForceComposites(): Promise<Map<string, string>> {
  const r = await rows<{ stock_id: string; c: string; b: string }>(
    `SELECT DISTINCT ON (stock_id) stock_id, composite::text AS c, label_band AS b
     FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC`,
  );
  return new Map(r.map((x) => [x.stock_id, `${x.c}|${x.b}`]));
}
async function latestPhs(): Promise<Map<string, string>> {
  const r = await rows<{ user_id: string; phs: number | null; band: string | null }>(
    `SELECT DISTINCT ON (user_id) user_id, phs, band
     FROM portfolio_health_snapshot ORDER BY user_id, created_at DESC`,
  );
  return new Map(r.map((x) => [x.user_id, `${x.phs}|${x.band}`]));
}
function mapsEqual(a: Map<string, string>, b: Map<string, string>): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (a.size !== b.size) diffs.push(`size ${a.size}→${b.size}`);
  for (const [k, v] of a) if (b.get(k) !== v) diffs.push(`${k}: ${v}→${b.get(k)}`);
  return { equal: diffs.length === 0, diffs: diffs.slice(0, 10) };
}

async function main() {
  console.log(`\n═══ RETENTION STEP 1 — arm 30 routine tables (hold ${HOLD}) ═══`);
  console.log(CONFIRM ? "MODE: --confirm (LIVE — will delete armed rows)\n" : "MODE: PREVIEW (no delete; pass --confirm to execute)\n");

  // ── Exemption + §13 baselines (before) ──
  const openErrBefore = await n(`SELECT count(*)::int AS n FROM ingestion_errors WHERE status = 'open'`);
  const undelivRemBefore = await n(`SELECT count(*)::int AS n FROM event_reminder_events WHERE delivered = false`);
  const activeJobsBefore = await n(`SELECT count(*)::int AS n FROM background_jobs WHERE status IN ('pending','running')`);
  const compBefore = await inForceComposites();
  const phsBefore = await latestPhs();
  const phsValues = [...phsBefore.values()].map((v) => v.split("|")[0]).filter((v) => v !== "null").map(Number).sort((a, b) => b - a);
  console.log(`§13 baseline: ${compBefore.size} in-force stock scores · book PHS values = [${phsValues.join(", ")}]`);

  if (!CONFIRM) {
    // Preview: show what WOULD be armed and the projected deletes (no state change).
    const preview = await prisma.retentionPolicy.findMany({ where: { enabled: true }, select: { table: true, armed: true } });
    const toArm = preview.filter((p) => p.table !== HOLD && !p.armed).map((p) => p.table);
    console.log(`\nWould ARM ${preview.length - 1} routine tables (currently armed: ${preview.filter((p) => p.armed).length}).`);
    if (toArm.length) console.log(`  newly armed: ${toArm.join(", ")}`);
    console.log(`  held back:  ${HOLD}`);
    const rep = await runRetention({ dryRun: true });
    const routine = rep.results.filter((r) => r.table !== HOLD).reduce((s, r) => s + r.matched, 0);
    console.log(`\nProjected routine deletes (all tables except ${HOLD}): ${routine} rows`);
    console.log(`Held (${HOLD}) would-delete: ${rep.results.find((r) => r.table === HOLD)?.matched} (NOT deleted)\n`);
    console.log("Re-run with --confirm to arm + execute.\n");
    await prisma.$disconnect();
    return;
  }

  // ── ARM the 30 routine tables (explicit, logged). daily_prices stays armed=false. ──
  const armed = await prisma.retentionPolicy.updateMany({
    where: { table: { not: HOLD }, enabled: true },
    data: { armed: true },
  });
  console.log(`\nArmed ${armed.count} routine tables. ${HOLD} held (armed=false).`);

  // ── LIVE run — engine deletes armed rows only; daily_prices held ──
  const report = await runRetention({ dryRun: false });

  console.log("\n── LIVE deleted counts ────────────────────────────────────────");
  for (const r of report.results.filter((x) => x.mode === "depth_per_key" || x.table === HOLD)) {
    console.log(`  ${r.held ? "[HELD]" : "[del] "} ${r.table.padEnd(34)} deleted=${String(r.deleted).padEnd(8)} matched=${r.matched}`);
  }
  for (const r of report.results.filter((x) => x.mode === "time")) {
    console.log(`  [del]  ${r.table.padEnd(34)} deleted=${String(r.deleted).padEnd(8)} matched=${r.matched}${r.exemption ? ` exempt:${r.exemption}` : ""}`);
  }
  const sup = report.results.find((r) => r.mode === "supersede_chain")!;
  console.log(`  [del]  ${sup.table.padEnd(34)} deleted=${String(sup.deleted).padEnd(8)} ${JSON.stringify(sup.detail)}`);
  console.log(`\n  TOTAL deleted (live): ${report.totalDeleted}   |   ${HOLD} held would-delete: ${report.results.find((r) => r.table === HOLD)?.matched}`);

  // ── Assert daily_prices was HELD ──
  console.log("\n── Assertions ─────────────────────────────────────────────────");
  const dp = report.results.find((r) => r.table === HOLD)!;
  check(`${HOLD} HELD — 0 deleted despite ${dp.matched} matched`, dp.deleted === 0 && dp.held === true);

  // ── §13: no score moved ──
  const compAfter = await inForceComposites();
  const phsAfter = await latestPhs();
  const cEq = mapsEqual(compBefore, compAfter);
  const pEq = mapsEqual(phsBefore, phsAfter);
  check("§13 — in-force stock composites byte-identical", cEq.equal, cEq.diffs.join("; "));
  check("§13 — book PHS byte-identical", pEq.equal, pEq.diffs.join("; "));
  const phsAfterValues = [...phsAfter.values()].map((v) => v.split("|")[0]).filter((v) => v !== "null").map(Number).sort((a, b) => b - a);
  check("§13 — book PHS values unchanged", JSON.stringify(phsValues) === JSON.stringify(phsAfterValues), `[${phsAfterValues.join(", ")}]`);

  // ── Exemptions held live ──
  const openErrAfter = await n(`SELECT count(*)::int AS n FROM ingestion_errors WHERE status = 'open'`);
  const undelivRemAfter = await n(`SELECT count(*)::int AS n FROM event_reminder_events WHERE delivered = false`);
  const activeJobsAfter = await n(`SELECT count(*)::int AS n FROM background_jobs WHERE status IN ('pending','running')`);
  check("exemption — every OPEN ingestion_error spared", openErrAfter === openErrBefore, `${openErrBefore}→${openErrAfter}`);
  check("exemption — every UNDELIVERED reminder spared", undelivRemAfter === undelivRemBefore, `${undelivRemBefore}→${undelivRemAfter}`);
  check("exemption — every PENDING/RUNNING job spared", activeJobsAfter === activeJobsBefore, `${activeJobsBefore}→${activeJobsAfter}`);

  console.log(`\n═══ STEP 1 ${fail === 0 ? "PASS" : "FAIL (" + fail + ")"} — ${report.totalDeleted} rows deleted, ${HOLD} held ═══\n`);
  if (fail === 0) console.log("Next: set RETENTION_CRON_ARMED=true to let the nightly 3 AM run maintain the 30. Then STOP for Step 2.\n");

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
