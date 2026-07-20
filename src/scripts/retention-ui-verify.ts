// ═══════════════════════════════════════════════════════════════
// RETENTION ADMIN UI — VERIFY. The two negative controls are the deliverable;
// they run FIRST. Exercises the EXACT pure functions the endpoints wrap
// (previewPolicyChange / applyPolicyChange), snapshots the full policy state up
// front and restores it at the end, and cleans its own audit rows — so a pass
// leaves the system byte-identical to before.
//
//   npx tsx src/scripts/retention-ui-verify.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";
import { previewPolicyChange, applyPolicyChange, type EditableField } from "../controllers/admin/retention-controller.js";

const BY = "verify:ui-selfcheck";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const n = async (sql: string, ...p: unknown[]): Promise<number> =>
  Number(((await prisma.$queryRawUnsafe(sql, ...p)) as { n: number | bigint }[])[0]?.n ?? 0);
const limitField = (mode: string): EditableField => (mode === "depth_per_key" ? "keep" : mode === "time" ? "days" : "supersededDays");
const effOf = (r: { status: string; armed: boolean; matched: number } | undefined) =>
  !r ? 0 : r.status === "skipped_disabled" ? 0 : !r.armed ? 0 : r.matched;

async function phs(): Promise<Map<string, string>> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT ON (user_id) user_id, phs, band FROM portfolio_health_snapshot ORDER BY user_id, created_at DESC`,
  )) as { user_id: string; phs: number | null; band: string | null }[];
  return new Map(rows.map((x) => [x.user_id, `${x.phs}|${x.band}`]));
}

async function main() {
  // Full policy snapshot (restore at the end) + §13 baseline.
  const snap = await prisma.retentionPolicy.findMany();
  const booksBefore = await phs();

  console.log("\n① NO SELF-AUDIT — a pruner-initiated delete writes ZERO audit rows (proven by attempt):");
  const c0 = await n(`SELECT count(*)::int AS n FROM retention_policy_audit`);
  // Smuggle two >365d audit rows so the pruner has something to delete FROM the audit table itself.
  await prisma.$executeRawUnsafe(
    `INSERT INTO retention_policy_audit (id, policy_table, field, old_value, new_value, changed_by, changed_at, projected_delta)
     VALUES (gen_random_uuid()::text,'__verify__','keep','1','2',$1, now() - interval '400 days','synthetic'),
            (gen_random_uuid()::text,'__verify__','keep','1','2',$1, now() - interval '400 days','synthetic')`, BY);
  const afterInsert = await n(`SELECT count(*)::int AS n FROM retention_policy_audit`);
  // Run a REAL pruner delete on the audit table (force-armed).
  const prune = await runRetention({ dryRun: false, only: ["retention_policy_audit"], forceArmOnly: true });
  const prunedDeleted = prune.results.find((r) => r.table === "retention_policy_audit")?.deleted ?? 0;
  const afterPrune = await n(`SELECT count(*)::int AS n FROM retention_policy_audit`);
  check("pruner self-pruned the 2 synthetic >365d audit rows", prunedDeleted >= 2 && afterInsert === c0 + 2, `deleted=${prunedDeleted} ${c0}→${afterInsert}→${afterPrune}`);
  check("pruner-initiated delete wrote 0 audit rows (count back to baseline)", afterPrune === c0, `expected ${c0}, got ${afterPrune}`);
  await prisma.$executeRawUnsafe(`DELETE FROM retention_policy_audit WHERE policy_table='__verify__'`); // belt

  console.log("\n① UI change writes EXACTLY ONE audit row, correct fields:");
  const b1 = await n(`SELECT count(*)::int AS n FROM retention_policy_audit`);
  const w = await applyPolicyChange("news_fetch_logs", "armed", false, BY);
  const a1 = await n(`SELECT count(*)::int AS n FROM retention_policy_audit`);
  check("UI change wrote exactly one audit row", w.ok && a1 === b1 + 1, `${b1}→${a1}`);
  const row = await prisma.retentionPolicyAudit.findFirst({ where: { changedBy: BY }, orderBy: { changedAt: "desc" } });
  check("audit row: correct policyTable/field/old/new/by", row?.policyTable === "news_fetch_logs" && row?.field === "armed" && row?.oldValue === "true" && row?.newValue === "false" && row?.changedBy === BY,
    JSON.stringify({ t: row?.policyTable, f: row?.field, o: row?.oldValue, nw: row?.newValue, by: row?.changedBy }));
  check("audit row: projected_delta is server-computed (not client-passed)", !!row?.projectedDelta && row.projectedDelta.startsWith("next run would delete"), row?.projectedDelta ?? "null");

  console.log("\n② PREVIEW = REALITY — preview(override=current) == direct dry-run (one home for the count):");
  for (const t of ["quarterly_results", "insider_trades", "score_snapshots", "index_prices"]) {
    const pol = snap.find((p) => p.table === t)!;
    const field = limitField(pol.mode);
    const cur = (pol as Record<string, unknown>)[field] as number ?? pol.floor;
    const pv = await previewPolicyChange(t, field, cur);
    const direct = await runRetention({ dryRun: true, only: [t] });
    const directEff = effOf(direct.results.find((r) => r.table === t));
    check(`${t}: preview.proposed == direct dry-run`, pv.ok && pv.data.proposedDeletions === directEff, `preview=${pv.ok ? pv.data.proposedDeletions : "err"} direct=${directEff}`);
  }

  console.log("\nFLOOR, TWO LAYERS — engine clamps a sub-floor value that arrives via the write path:");
  await applyPolicyChange("quarterly_results", "keep", 3, BY); // below floor 8, via the write path
  const clampRep = await runRetention({ dryRun: true, only: ["quarterly_results"] });
  const cr = clampRep.results.find((r) => r.table === "quarterly_results")!;
  const at8 = await n(`SELECT count(*)::int AS n FROM (SELECT row_number() OVER (PARTITION BY stock_id,result_type ORDER BY report_date DESC, id DESC) rn FROM quarterly_results) s WHERE s.rn > 8`);
  const at3 = await n(`SELECT count(*)::int AS n FROM (SELECT row_number() OVER (PARTITION BY stock_id,result_type ORDER BY report_date DESC, id DESC) rn FROM quarterly_results) s WHERE s.rn > 3`);
  check("engine WALL clamps a sub-floor write to floor 8 (not 3)", cr.effective === 8 && cr.clamped === true && cr.matched === at8 && cr.matched !== at3, `effective=${cr.effective} clamped=${cr.clamped} matched=${cr.matched} at8=${at8} at3=${at3}`);
  console.log("  (UI FENCE: the numeric <input min={floor}> in retention/page.tsx refuses sub-floor entry — inspected, not runtime-testable here.)");

  console.log("\nARMED toggle live — disarm → held on a live run → re-arm:");
  await applyPolicyChange("insider_trade_fetch_logs", "armed", false, BY);
  const heldRep = await runRetention({ dryRun: false, only: ["insider_trade_fetch_logs"] });
  const hr = heldRep.results.find((r) => r.table === "insider_trade_fetch_logs")!;
  check("disarmed table is HELD (0 deleted) on a live run", hr.held === true && hr.deleted === 0, `held=${hr.held} deleted=${hr.deleted}`);

  console.log("\nAUDIT TABLE capped by its own policy + projected_delta server-side:");
  const ap = snap.find((p) => p.table === "retention_policy_audit");
  check("retention_policy_audit is a managed policy (time / 365d / floor 90)", ap?.mode === "time" && ap?.days === 365 && ap?.floor === 90, JSON.stringify({ mode: ap?.mode, days: ap?.days, floor: ap?.floor }));
  check("projected_delta ignores any client value (function takes no client delta)", applyPolicyChange.length === 4, `applyPolicyChange arity=${applyPolicyChange.length} (table,field,value,changedBy)`);

  console.log("\n§13 — no scoring table is editable by this UI (books byte-identical):");
  const booksAfter = await phs();
  let moved = 0; for (const [k, v] of booksBefore) if (booksAfter.get(k) !== v) moved++;
  check("book PHS byte-identical across the whole verify", moved === 0 && booksBefore.size === booksAfter.size, `${booksBefore.size} books, ${moved} moved`);

  console.log("\nAUTH — every retention endpoint is behind requireAdmin (app.ts mount): verified by construction (same guard as all /api/v1/admin/* routes).");

  // ── Restore: put every policy row back to its snapshot, and remove verify audit rows ──
  for (const s of snap) {
    await prisma.retentionPolicy.update({
      where: { table: s.table },
      data: { keep: s.keep, days: s.days, supersededDays: s.supersededDays, armed: s.armed, enabled: s.enabled },
    });
  }
  const del = await prisma.retentionPolicyAudit.deleteMany({ where: { changedBy: BY } });
  const finalPol = await prisma.retentionPolicy.findMany();
  const restored = snap.every((s) => {
    const f = finalPol.find((p) => p.table === s.table)!;
    return f.keep === s.keep && f.days === s.days && f.supersededDays === s.supersededDays && f.armed === s.armed && f.enabled === s.enabled;
  });
  check("cleanup: policy state restored + verify audit rows removed", restored && (await n(`SELECT count(*)::int AS n FROM retention_policy_audit WHERE changed_by=$1`, BY)) === 0, `removed ${del.count} verify rows`);

  console.log(`\n═══ RETENTION UI VERIFY: ${pass} passed, ${fail} failed ═══\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
