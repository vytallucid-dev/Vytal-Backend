// ═══════════════════════════════════════════════════════════════
// PART C — VACUUM FULL to return freed pages to the OS (a plain DELETE only marks
// them reusable). ⚠️ ACCESS EXCLUSIVE lock per table — run in a quiet window only.
// ONE-TIME: the tables are bounded now; do NOT wire this into the nightly engine
// (a nightly exclusive lock is a scheduler hazard).
//
// Runs over DIRECT_URL in AUTOCOMMIT (VACUUM cannot run inside a transaction, and
// pgbouncer transaction-mode can't carry it either — same reason DDL uses DIRECT_URL).
//
//   npx tsx src/scripts/retention-vacuum.ts --confirm
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { Client } from "pg";

const CONFIRM = process.argv.includes("--confirm");
const TABLES = ["index_prices", "mf_analytics", "instruments", "daily_prices"]; // biggest last

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) { console.error("DIRECT_URL not set"); process.exit(1); }
  const c = new Client({ connectionString: url });
  await c.connect();

  const size = async (t: string) =>
    (await c.query(`SELECT pg_size_pretty(pg_total_relation_size($1)) s, pg_total_relation_size($1) b`, [t])).rows[0];
  const db = async () =>
    (await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) s, pg_database_size(current_database()) b`)).rows[0];

  const dbBefore = await db();
  const before: Record<string, any> = {};
  for (const t of TABLES) before[t] = await size(t);
  console.log(`\n═══ PART C — VACUUM FULL ${CONFIRM ? "· LIVE" : "· DRY (pass --confirm)"} ═══`);
  console.log(`DB before: ${dbBefore.s}`);
  for (const t of TABLES) console.log(`  ${t.padEnd(16)} ${before[t].s}`);

  if (!CONFIRM) { console.log("\nDRY — pass --confirm to run VACUUM FULL.\n"); await c.end(); return; }

  for (const t of TABLES) {
    const t0 = Date.now();
    process.stdout.write(`\nVACUUM FULL ${t} … `);
    await c.query(`VACUUM (FULL, ANALYZE) "${t}"`); // autocommit — no BEGIN wrapper
    console.log(`done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const dbAfter = await db();
  console.log(`\n── RESULT ─────────────────────────────────────────────────────`);
  let reclaimed = 0;
  for (const t of TABLES) {
    const a = await size(t);
    const d = Number(before[t].b) - Number(a.b);
    reclaimed += d;
    console.log(`  ${t.padEnd(16)} ${String(before[t].s).padStart(9)} → ${String(a.s).padStart(9)}   (-${(d / 1e6).toFixed(1)} MB)`);
  }
  console.log(`\n  DB: ${dbBefore.s} → ${dbAfter.s}   (table-level reclaim ${(reclaimed / 1e6).toFixed(1)} MB)`);
  console.log(`  DB delta: ${((Number(dbBefore.b) - Number(dbAfter.b)) / 1e6).toFixed(1)} MB\n`);
  await c.end();
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
