// ═══════════════════════════════════════════════════════════════
// DRIFT-SAFE MIGRATION APPLIER — runs a hand-authored migration.sql inside ONE
// transaction over DIRECT_URL (not the pooled DATABASE_URL: DDL + pgbouncer don't mix).
//
// Any failure → ROLLBACK → zero half-applied state. On success the caller runs
// `prisma migrate resolve --applied <name>` so Prisma's history matches the DB.
//
//   npx tsx src/scripts/apply-migration-direct.ts <migration_dir_name> [--dry]
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const name = process.argv[2];
const dry = process.argv.includes("--dry");
if (!name) {
  console.error("usage: apply-migration-direct.ts <migration_dir_name> [--dry]");
  process.exit(1);
}

const sqlPath = path.join(process.cwd(), "prisma", "migrations", name, "migration.sql");
if (!fs.existsSync(sqlPath)) {
  console.error(`❌ no migration.sql at ${sqlPath}`);
  process.exit(1);
}
const sql = fs.readFileSync(sqlPath, "utf8");

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("❌ DIRECT_URL is not set — refusing to run DDL over the pooled connection.");
  process.exit(1);
}

console.log(`── applying ${name} over DIRECT_URL ──`);
if (dry) {
  console.log(sql);
  console.log("(--dry: nothing executed)");
  process.exit(0);
}

const client = new Client({ connectionString: url });
await client.connect();
let committed = false;
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  committed = true;
  console.log(`✅ ${name} applied and COMMITTED.`);
} catch (e: any) {
  await client.query("ROLLBACK");
  console.error(`❌ ROLLED BACK — nothing applied.
   ${e?.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

// ═══ ★ THE HISTORY RECORD IS WRITTEN HERE, AND ONLY ON A CONFIRMED COMMIT. ═══
//
// `prisma migrate resolve --applied` used to be run BY HAND after this script. On 2026-08-03 it was
// chained to an apply that had ROLLED BACK, so a migration was recorded as applied against a database
// where nothing had happened — and `prisma migrate status` then reported "up to date", because the
// check's own premise had been falsified by the thing it was checking. The drift was invisible to
// every tool and was caught only by querying _prisma_migrations directly.
//
// Moving `resolve` inside this script, behind `committed`, makes that failure unreachable: the record
// is written by the same process that watched the COMMIT succeed, and a rollback returns before it.
// ⚠ Do NOT run `migrate resolve` by hand alongside this script — that is the hand-chaining this
// replaces.
if (!committed) {
  console.error("   ↳ migration history NOT written (nothing was applied).");
  process.exit(1);
}

const { execFileSync } = await import("node:child_process");
try {
  execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", name], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  console.log(`✅ ${name} recorded in migration history.`);
} catch (e: any) {
  console.error(
    `❌ APPLIED BUT NOT RECORDED — the DDL committed and the history write failed.
` +
      `   ${String(e?.stderr ?? e?.message ?? e).trim()}
` +
      `   The database is AHEAD of its history. Record it with:
` +
      `     npx prisma migrate resolve --applied ${name}`,
  );
  process.exitCode = 1;
}
