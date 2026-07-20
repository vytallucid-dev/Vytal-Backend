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
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`✅ ${name} applied and COMMITTED.`);
} catch (e: any) {
  await client.query("ROLLBACK");
  console.error(`❌ ROLLED BACK — nothing applied.\n   ${e?.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
