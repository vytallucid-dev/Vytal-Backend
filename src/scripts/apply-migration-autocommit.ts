// ═══════════════════════════════════════════════════════════════
// AUTOCOMMIT MIGRATION APPLIER — the sibling of apply-migration-direct.ts for the ONE
// kind of DDL that must NOT run inside an explicit transaction: `ALTER TYPE … ADD VALUE`.
//
// apply-migration-direct wraps the whole file in BEGIN/COMMIT. Postgres forbids adding an
// enum value inside an explicit transaction block that then uses it, so enum widenings run
// here instead: each statement is sent on its own over DIRECT_URL with autocommit on (no
// BEGIN), so a lone statement commits immediately — truly "outside a transaction".
//
// Use ONLY for enum ADD VALUE / other autocommit-required DDL. For everything else use the
// transactional applier (rollback-on-failure is the safer default). On success the caller
// runs `prisma migrate resolve --applied <name>` so Prisma's history matches the DB.
//
//   npx tsx src/scripts/apply-migration-autocommit.ts <migration_dir_name> [--dry]
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const name = process.argv[2];
const dry = process.argv.includes("--dry");
if (!name) {
  console.error("usage: apply-migration-autocommit.ts <migration_dir_name> [--dry]");
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

// Strip line comments + blank lines, then split into individual statements. Each is sent
// alone so Postgres auto-commits it — NO wrapping BEGIN/COMMIT.
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`── applying ${name} over DIRECT_URL (AUTOCOMMIT — no transaction) ──`);
if (dry) {
  for (const s of statements) console.log(`${s};`);
  console.log("(--dry: nothing executed)");
  process.exit(0);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  for (const s of statements) {
    console.log(`→ ${s.slice(0, 80)}${s.length > 80 ? "…" : ""}`);
    await client.query(s); // lone statement, autocommit — no BEGIN
  }
  console.log(`✅ ${name} applied (${statements.length} statement(s), autocommit).`);
} catch (e: any) {
  console.error(`❌ FAILED — an autocommit run has NO rollback; inspect state.\n   ${e?.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
