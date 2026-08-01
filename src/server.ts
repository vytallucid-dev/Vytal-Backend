import { createApp } from "./app.js";
import { env } from "./config/env.js";
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

const app = createApp();

// Boot the worker once the app is ready to accept work.
// Don't await this — it runs forever in the background.
jobWorker.start();

// Graceful shutdown — stop accepting new jobs but let the current one finish.
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, stopping worker...");
  jobWorker.stop();
  // Give the current job a moment to finish; tune to your typical job duration.
  await new Promise((r) => setTimeout(r, 30_000));
  process.exit(0);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

if (process.env.NODE_ENV === "production") {
  startScheduler();
}

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
