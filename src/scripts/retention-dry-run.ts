// ═══════════════════════════════════════════════════════════════
// RETENTION DRY-RUN — the GATE-3 deliverable. Runs the engine in dryRun mode
// (ZERO mutating statements — counts only) and prints the projection: per table,
// how many rows WOULD delete, the floor clamps that fired, the exemptions applied.
// Deletes nothing. Review this before arming the cron.
//
//   npx tsx src/scripts/retention-dry-run.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";

function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : str + " ".repeat(n - str.length);
}

async function main() {
  const report = await runRetention({ dryRun: true });

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(` RETENTION DRY-RUN — ${report.startedAt}  (${report.durationMs} ms)`);
  console.log(`   deletes nothing · totalDeleted=${report.totalDeleted} (MUST be 0)`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const depth = report.results.filter((r) => r.mode === "depth_per_key");
  const time = report.results.filter((r) => r.mode === "time");
  const sup = report.results.filter((r) => r.mode === "supersede_chain");
  const errs = report.results.filter((r) => r.status === "error");
  const disabled = report.results.filter((r) => r.status === "skipped_disabled");

  const line = (r: (typeof report.results)[number]) => {
    const gate = r.armed ? "[armed]" : "[held] ";
    const clamp = r.clamped ? `  ⚠ CLAMPED→${r.effective} (${r.floorReason})` : "";
    const ex = r.exemption ? `  exempt:${r.exemption}` : "";
    const err = r.error ? `  ERROR: ${r.error}` : "";
    console.log(
      `  ${gate} ${pad(r.table, 34)} would-delete ${pad(r.matched, 8)} keep/days=${pad(r.effective ?? "-", 6)} floor=${pad(r.floor, 5)}${clamp}${ex}${err}`,
    );
    if (r.detail) console.log(`        ${JSON.stringify(r.detail)}`);
  };

  console.log("── DEPTH-PER-KEY (keep newest N per key) ──────────────────────");
  depth.forEach(line);
  console.log("\n── TIME (older than N days on ts_column) ──────────────────────");
  time.forEach(line);
  console.log("\n── SUPERSEDE-CHAIN (score layer) ──────────────────────────────");
  sup.forEach(line);

  if (disabled.length) {
    console.log("\n── DISABLED (kill switch) ─────────────────────────────────────");
    disabled.forEach((r) => console.log(`  ${r.table} — ${r.note}`));
  }
  if (errs.length) {
    console.log("\n⚠️  ERRORS (rule skipped, deleted nothing) ───────────────────");
    errs.forEach((r) => console.log(`  ${r.table}: ${r.error}`));
  }

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log(` TOTAL would-delete: ${report.totalMatched} rows · clamps fired: ${report.clampsFired} · errors: ${errs.length}`);
  console.log("───────────────────────────────────────────────────────────────\n");

  await prisma.$disconnect();
  process.exit(report.totalDeleted === 0 ? 0 : 1); // a dry-run that deleted anything is a bug
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
