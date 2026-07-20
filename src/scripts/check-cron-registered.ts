// ═══════════════════════════════════════════════════════════════
// Verify the retention cron REGISTERS on scheduler boot (correctness check, not a
// wait). Captures startScheduler's log lines and asserts the nightly-retention-prune
// line reads "Registered", not "HELD (disabled)". Schedules timers then exits.
//
//   npx tsx src/scripts/check-cron-registered.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";

const logs: string[] = [];
const orig = console.log.bind(console);
console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };

const { startScheduler } = await import("../lib/scheduler.js");
startScheduler();

console.log = orig;
const reg = logs.find((l) => l.includes("nightly-retention-prune"));
console.log("scheduler boot — retention cron line:");
console.log("  " + (reg ?? "(no nightly-retention-prune line found)"));
const ok = !!reg && reg.includes("Registered") && !reg.includes("HELD");
console.log(ok ? '\n✅ nightly-retention-prune is REGISTERED (30 21 * * *)' : "\n❌ NOT registered (HELD or missing) — restart the server with RETENTION_CRON_ARMED=true");
process.exit(ok ? 0 : 1);
