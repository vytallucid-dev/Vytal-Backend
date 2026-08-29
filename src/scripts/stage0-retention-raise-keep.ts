// ═══════════════════════════════════════════════════════════════
// STAGE 0 — daily_prices retention keep 1800 → 2000, via the AUDITED route.
//
// WHY: the FY2019 backfill targets 2019-01-01, which is ~1,890 trading sessions
// at the measured 247.2/yr. daily_prices.armed is TRUE, so at keep=1800 the 3AM
// nightly prune trims the deepest ~90 bars the same night the backfill lands.
// This has bitten twice. Raise the ceiling BEFORE any fetch.
//
// HOW: applyPolicyChange() from the admin controller — NOT a raw UPDATE. It runs
// a real runRetention dry-run for the projection, then writes the policy row AND
// one retention_policy_audit row in the SAME transaction.
//
//   PREVIEW:  npx tsx src/scripts/stage0-retention-raise-keep.ts
//   EXECUTE:  npx tsx src/scripts/stage0-retention-raise-keep.ts --confirm
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { previewPolicyChange, applyPolicyChange } from "../controllers/admin/retention-controller.js";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = "daily_prices";
const NEW_KEEP = 2000;
const EXPECT_FLOOR = 760;
const CHANGED_BY = "stage0-retention-fy2019";

async function main() {
  console.log(`\n═══ STAGE 0 — ${TABLE}.keep → ${NEW_KEEP} ═══`);
  console.log(CONFIRM ? "MODE: --confirm (LIVE WRITE)\n" : "MODE: PREVIEW\n");

  const before = await prisma.retentionPolicy.findUnique({ where: { table: TABLE } });
  if (!before) throw new Error(`no retention_policy row for ${TABLE}`);
  console.log(`BEFORE  keep=${before.keep} floor=${before.floor} enabled=${before.enabled} armed=${before.armed}`);

  // ── depth reality check (what the rule would actually bite) ──
  const [d] = await prisma.$queryRawUnsafe<{ mx: number; mn: number; stocks: bigint; over: bigint }[]>(
    `WITH pk AS (SELECT stock_id, count(*)::int cnt FROM daily_prices GROUP BY stock_id)
     SELECT max(cnt) mx, min(cnt) mn, count(*) stocks, count(*) FILTER (WHERE cnt > $1) AS "over" FROM pk`,
    NEW_KEEP,
  );
  console.log(`DEPTH   max=${d.mx} min=${d.mn} stocks=${d.stocks} over-${NEW_KEEP}=${d.over}`);

  // ── the audited preview (a real dry-run through the engine) ──
  const pv = await previewPolicyChange(TABLE, "keep", NEW_KEEP);
  if (!pv.ok) throw new Error(`preview failed: ${pv.error}`);
  const p = pv.data;
  console.log(
    `PREVIEW currentDeletions=${p.currentDeletions} proposedDeletions=${p.proposedDeletions} delta=${p.delta}` +
    ` | matched ${p.currentMatched}→${p.proposedMatched} | clamped=${p.clamped} effective=${p.effective} floor=${p.floor}`,
  );

  // ── GATES ──
  const gates: [string, boolean][] = [
    [`proposedDeletions === 0`, p.proposedDeletions === 0],
    [`proposedMatched === 0`, p.proposedMatched === 0],
    [`floor untouched (=${EXPECT_FLOOR})`, p.floor === EXPECT_FLOOR],
    [`no clamp fired`, p.clamped === false],
    [`effective === ${NEW_KEEP}`, p.effective === NEW_KEEP],
    [`raise only (${before.keep} < ${NEW_KEEP})`, (before.keep ?? 0) < NEW_KEEP],
  ];
  console.log("\n── GATES ──");
  for (const [name, ok] of gates) console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  if (gates.some(([, ok]) => !ok)) {
    console.log("\n❌ GATE FAILED — STOP. Nothing written.\n");
    await prisma.$disconnect(); process.exit(1);
  }

  if (!CONFIRM) {
    console.log(`\nPREVIEW only — would set keep ${before.keep} → ${NEW_KEEP}. Re-run with --confirm.\n`);
    await prisma.$disconnect(); return;
  }

  const ap = await applyPolicyChange(TABLE, "keep", NEW_KEEP, CHANGED_BY);
  if (!ap.ok) throw new Error(`apply failed: ${ap.error}`);
  console.log(`\nAPPLIED — projectedDelta: "${ap.data.projectedDelta}" clamped=${ap.data.clamped} floor=${ap.data.floor}`);

  // ── re-read from the DB (not the returned object) ──
  const after = await prisma.retentionPolicy.findUnique({ where: { table: TABLE } });
  console.log(`AFTER   keep=${after?.keep} floor=${after?.floor} enabled=${after?.enabled} armed=${after?.armed}`);
  const audit = await prisma.retentionPolicyAudit.findFirst({ where: { policyTable: TABLE }, orderBy: { changedAt: "desc" } });
  console.log(`AUDIT   ${audit?.changedAt.toISOString()} ${audit?.field}: ${audit?.oldValue} → ${audit?.newValue} by=${audit?.changedBy}`);

  const clean =
    after?.keep === NEW_KEEP && after?.floor === EXPECT_FLOOR &&
    after?.armed === before.armed && after?.enabled === before.enabled &&
    audit?.newValue === String(NEW_KEEP) && audit?.oldValue === String(before.keep);
  console.log(`\n${clean ? "✅ STAGE 0 CLEAN" : "❌ STAGE 0 DIRTY — inspect"} \n`);
  await prisma.$disconnect();
  if (!clean) process.exit(1);
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
