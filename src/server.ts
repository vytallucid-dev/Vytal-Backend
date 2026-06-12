import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { jobWorker } from "./jobs/worker.js";
import { startScheduler } from "./lib/scheduler.js";

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
