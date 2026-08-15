import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { resolveProcessRole, formatProcessRoleBanner } from "./config/process-role.js";
import { jobWorker } from "./jobs/worker.js";
import { startScheduler } from "./lib/scheduler.js";

// ── REQUIRED ENVIRONMENT, ASSERTED AT BOOT ────────────────────────────────────────────────────────
// This is the RUNTIME entry point, and it is the right place for this check. It used to happen by
// accident, inside middleware/auth.ts, where `new URL(SUPABASE_URL)` threw at module load — which also
// meant no consumer of createApp() could construct the app without a live environment, including the
// build gate that boots it. auth.ts is lazy now, so the assertion is here, explicitly, and it fails
// before the port is bound rather than on the first authenticated request.
const REQUIRED_ENV = ["DATABASE_URL", "SUPABASE_URL"] as const;
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
if (missingEnv.length) {
  console.error(`FATAL: missing required environment: ${missingEnv.join(", ")}`);
  console.error("       The server cannot verify tokens or reach the database without them.");
  process.exit(1);
}
// SUPABASE_URL must also PARSE — the JWKS discovery endpoint is derived from it, and a malformed one
// would otherwise surface as a 401 on every authenticated request instead of a refusal to start.
try {
  new URL(env.SUPABASE_URL);
} catch {
  console.error(`FATAL: SUPABASE_URL is not a valid URL: ${env.SUPABASE_URL}`);
  process.exit(1);
}

// ── PROCESS ROLE, RESOLVED AND ANNOUNCED BEFORE ANYTHING STARTS ───────────────────
// ONE decision, read by both the worker and the scheduler below. Printed first, so the
// role is known even if a later step throws — and printed in BOTH modes, because the
// 21-day incident this closes was invisible precisely because a process doing background
// work looked identical at startup to one that was not.
const role = resolveProcessRole();
console.log(formatProcessRoleBanner(role));

const app = createApp();

// ⚠ THIS WAS UNCONDITIONAL AND THAT WAS THE HOLE. The scheduler below has always been
//   gated on NODE_ENV === "production"; the worker was not. A developer running
//   `npm run dev` against the production DATABASE_URL got a second worker claiming real
//   jobs, and because it fired no crons it looked idle. Measured consequences over 21
//   days: 34 overlapping execution intervals, 4 of them the ICA × mf_analytics pair whose
//   ordering is load-bearing, and retention_prune — maxAttempts:1, no retry path, deletes
//   production data — executed TWICE.
//
// Both branches now read the SAME resolved role, so the two cannot drift apart again.
// Don't await start() — it runs forever in the background.
if (role.worker) {
  jobWorker.start();
}

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────────────
//
// ⚠ THE OLD COMMENT HERE SAID "let the current one finish". IT NEVER DID, and could not:
//   the worker loop only re-reads its `running` flag after `await runJob()` returns, so a
//   job mid-run was never told anything. It kept working for 30 seconds and was then
//   killed by process.exit with its row still `running` — a ghost that blocks its own cron
//   via enqueueIfNotActive. Measured job durations make "finish in 30s" impossible for the
//   jobs that matter: results_scan p50 2.29h, instrument_corporate_actions p50 26min.
//
// What happens now: jobWorker.shutdown() hands the in-flight row back to `pending` (or
// fails it, per RESTART_POLICIES) BEFORE waiting on anything, then aborts the handler's
// signal as a courtesy. See the contract on JobWorker.shutdown().
//
// The forced-exit timer is the backstop for the case shutdown() cannot cover: a handler
// holding the event loop synchronously, where no callback of ours can run at all. 28s
// keeps us inside the platform's typical 30s SIGTERM→SIGKILL budget, so the process exits
// on our terms rather than being killed mid-write.
const shutdownAndExit = async (signal: string) => {
  console.log(`[shutdown] ${signal} received — protecting the in-flight job`);
  const forced = setTimeout(() => {
    console.error("[shutdown] grace expired with shutdown() still running — forcing exit");
    process.exit(0);
  }, 28_000);
  try {
    await jobWorker.shutdown();
  } catch (err) {
    console.error("[shutdown] worker shutdown error:", err);
  }
  clearTimeout(forced);
  console.log(`[shutdown] complete — exiting`);
  process.exit(0);
};

process.on("SIGTERM", () => void shutdownAndExit("SIGTERM"));
// SIGINT gets the same treatment: a Ctrl-C in local dev leaves exactly the same ghost a
// production redeploy does, and "it was only my laptop" is how a stuck row reaches staging.
process.on("SIGINT", () => void shutdownAndExit("SIGINT"));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Same resolved role as the worker above — deliberately not a second NODE_ENV read.
// Registering the scheduler also starts the 2-minute job reaper and the three inline
// scoring sweeps, which are cron entries rather than separate starters (see the registry).
if (role.scheduler) {
  startScheduler();
}

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
