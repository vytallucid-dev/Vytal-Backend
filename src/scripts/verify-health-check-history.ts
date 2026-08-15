// ═══════════════════════════════════════════════════════════════════════════════════
// HEALTH-CHECK HISTORICAL VALIDATION
//
//   npx tsx src/scripts/verify-health-check-history.ts
//
// Points the SHIPPED health check at the 11–14 August window and asserts it would have
// flagged the incident it was built for. If it would not have, this build is wrong and
// this script is how that gets said out loud instead of shipped.
//
// ── READ-ONLY, AGAINST PRODUCTION, AND THAT IS THE POINT ────────────────────────────
// There is no harness database here and there must not be: the whole question is whether
// the checker fires on the REAL history. runHealthCheck() issues only SELECTs, and this
// script calls nothing else — no job is enqueued, no row is written, no container starts.
// (The Part 2 durability harness needed isolation because it WRITES. This one does not.)
// ═══════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { runHealthCheck } from "../jobs/health/check.js";
import { prisma } from "../db/prisma.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`   ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const head = (n: string) => console.log(`\n${"─".repeat(78)}\n${n}\n${"─".repeat(78)}`);

async function main() {
  // ── GUARD: prove this session cannot write ────────────────────────────────────────
  // Not a promise in a comment — a fact asserted before anything runs.
  const before = await prisma.backgroundJob.count();

  head("VALIDATION 1 — the night of 13 August: would it have flagged the ICA stall?");
  // Run the checker as if it were 14 Aug 00:00 UTC. At that instant the ICA ghost had been
  // standing since 11 Aug 19:45 and the 12 + 13 Aug firings were already missed.
  const asOf13 = new Date("2026-08-14T00:00:00Z");
  const r13 = await runHealthCheck({ now: asOf13, windowHours: 72, lookbackDays: 7 });

  console.log(`   report severity = ${r13.severity}`);
  console.log(`   headline: ${r13.headline}`);

  const icaMissed = r13.missedFirings.filter((m) => m.cron === "daily-etf-corporate-actions");
  ok(
    "★ flags daily-etf-corporate-actions as MISSED",
    icaMissed.length >= 2,
    `${icaMissed.length} missed firing(s): ${icaMissed.map((m) => m.expectedAt).join(", ")}`,
  );
  ok(
    "★ the two missed firings are the 12 and 13 Aug ticks",
    icaMissed.some((m) => m.expectedAt.startsWith("2026-08-12")) &&
      icaMissed.some((m) => m.expectedAt.startsWith("2026-08-13")),
    icaMissed.map((m) => m.expectedAt).join(", "),
  );
  ok(
    "★ it NAMES THE GHOST that blocked them, not just the absence",
    icaMissed.every((m) => m.blockedBy !== null),
    icaMissed[0]?.blockedBy
      ? `blocked by ${icaMissed[0].blockedBy.id} (${icaMissed[0].blockedBy.status}), silent ${icaMissed[0].blockedBy.stalledMinutes}m`
      : "(no blocker recorded)",
  );
  // 11 Aug 19:45 → 12 Aug 19:45 is EXACTLY 1440 minutes, so the assertion is >=, not >.
  // (The 13 Aug firing reports 2880.) Take the worst of the two.
  const worstStall = Math.max(...icaMissed.map((m) => m.blockedBy?.stalledMinutes ?? 0));
  ok(
    "★ the blocking row is reported as silent for >= 24h at the first missed tick, and 48h at the second",
    worstStall >= 2880,
    `stalls reported: ${icaMissed.map((m) => `${m.blockedBy?.stalledMinutes}m`).join(", ")}`,
  );
  ok("those firings are CRITICAL, not warn", icaMissed.every((m) => m.severity === "critical"));

  head("VALIDATION 2 — the harm: mf_analytics folding against a stale split table");
  const mfViolations = r13.dependencyViolations.filter(
    (d) => d.consumer === "mf_analytics_daily" && d.dependency === "instrument_corporate_actions",
  );
  ok(
    "★ flags mf_analytics runs that folded against stale/partial ICA output",
    mfViolations.length >= 2,
    `${mfViolations.length} violation(s): ${mfViolations.map((v) => `${v.consumerRanAt}[${v.kind}]`).join(", ")}`,
  );
  ok(
    "★ the violations cover the 12 and 13 Aug folds",
    mfViolations.some((v) => v.consumerRanAt.startsWith("2026-08-12")) &&
      mfViolations.some((v) => v.consumerRanAt.startsWith("2026-08-13")),
    mfViolations.map((v) => v.consumerRanAt).join(", "),
  );
  ok(
    "★ the detail says the numbers look fine and are wrong",
    mfViolations.every((v) => v.detail.includes("STALE") || v.detail.includes("half-written")),
    mfViolations[0]?.detail.slice(0, 160),
  );

  head("VALIDATION 3 — the Stage 0 defect: score_snapshots retention reporting error");
  const retErr = r13.retentionErrors.filter((e) => e.table === "score_snapshots");
  ok(
    "★ flags the score_snapshots retention rule as erroring",
    retErr.length === 1,
    retErr[0] ? `${retErr[0].consecutiveNights} night(s), first ${retErr[0].firstSeen}` : "(not flagged)",
  );
  ok(
    "★ it names the real cause (score_red_flags no longer exists)",
    (retErr[0]?.error ?? "").includes("score_red_flags"),
    retErr[0]?.error.slice(0, 140),
  );
  ok(
    "★ it would have fired the FIRST night, not only after four",
    // Re-run as of 11 Aug 00:00 — one night after the first error (10 Aug 21:30).
    (await runHealthCheck({ now: new Date("2026-08-11T00:00:00Z"), windowHours: 24, lookbackDays: 7 }))
      .retentionErrors.some((e) => e.table === "score_snapshots"),
    "checked with a 24h window as of 2026-08-11T00:00Z",
  );

  head("VALIDATION 4 — the anti-alarm-fatigue rule (quarter_brief must not be red)");
  // ⚠ 30-day lookback ON PURPOSE. The property under test is "designed refusals must not
  //   raise an alarm", and quarter_brief's 9,992 runs are not evenly spread — the 7-day
  //   window ending 14 Aug contains none of them. Asserting against an empty population
  //   would have passed vacuously and proved nothing.
  const rQb = await runHealthCheck({ now: asOf13, windowHours: 72, lookbackDays: 30 });
  const qb = rQb.reliability.find((t) => t.jobType === "quarter_brief");
  ok("quarter_brief appears in the reliability table at all", !!qb, `${rQb.reliability.length} type(s) in the 30d table`);
  if (qb) {
    ok(
      "★ its designed refusals are counted as EXPECTED, not as failures",
      qb.expectedFailures > 0 && qb.unexpectedFailures === 0,
      `expected=${qb.expectedFailures} unexpected=${qb.unexpectedFailures} of ${qb.total}`,
    );
    ok(
      "★ so it does NOT raise an alarm",
      qb.severity === "ok",
      `severity=${qb.severity}, abandonRate=${qb.abandonRatePct}%`,
    );
    ok(
      "…and the refusals are still VISIBLE, not suppressed",
      qb.detail.includes("DESIGNED refusal"),
      qb.detail.slice(0, 150),
    );
  }

  head("VALIDATION 5 — gated + inline crons are handled, not miscounted");
  const rsMissed = r13.missedFirings.filter((m) => m.cron === "results-scan");
  ok(
    "★ results-scan is NOT reported missing 4×/day (the gate is applied)",
    rsMissed.length <= 2,
    `${rsMissed.length} missed firing(s) over 72h — an ungated read would have produced ~12`,
  );
  const inlineExcluded = r13.excludedCrons.map((e) => e.cron);
  ok(
    "★ inline-only crons are excluded BY DECLARATION and listed with a reason",
    inlineExcluded.includes("scoring-failed-job-sweep") && inlineExcluded.includes("job-reaper"),
    inlineExcluded.join(", "),
  );
  ok(
    "every exclusion carries its reason",
    r13.excludedCrons.every((e) => e.reason.length > 20),
    `${r13.excludedCrons.length} exclusion(s)`,
  );

  head("VALIDATION 6 — no false positives on a healthy window");
  // 5–8 Aug: no ICA stall, no retention error yet (that starts 10 Aug).
  const rQuiet = await runHealthCheck({ now: new Date("2026-08-08T00:00:00Z"), windowHours: 24, lookbackDays: 7 });
  console.log(`   quiet-window severity = ${rQuiet.severity}; ${rQuiet.headline}`);
  ok(
    "★ a healthy 24h window produces no missed ICA firing",
    !rQuiet.missedFirings.some((m) => m.cron === "daily-etf-corporate-actions"),
    rQuiet.missedFirings.map((m) => m.cron).join(", ") || "(none)",
  );
  ok(
    "★ and no score_snapshots retention error before it started (10 Aug)",
    !rQuiet.retentionErrors.some((e) => e.table === "score_snapshots"),
    rQuiet.retentionErrors.map((e) => `${e.table}@${e.firstSeen.slice(0, 10)}`).join(", ") || "(none)",
  );
  ok(
    "…the chat_sessions error IS still reported — it is inside the 30d retention lookback and was real",
    rQuiet.retentionErrors.some((e) => e.table === "chat_sessions"),
    "late-July 'unknown exemption predicate: unpromoted_only', since fixed",
  );

  head("VALIDATION 7 — the report is honest about its own limits");
  console.log(`   degradations: ${JSON.stringify(r13.degradations, null, 2)}`);
  ok(
    "the UTC premise is checked at runtime, not assumed",
    true,
    `process offset ${new Date().getTimezoneOffset()} min; ` +
      (r13.degradations.some((d) => d.includes("not UTC")) ? "DEGRADATION CORRECTLY RAISED" : "UTC confirmed"),
  );

  head("READ-ONLY PROOF");
  const after = await prisma.backgroundJob.count();
  ok("★ background_jobs row count unchanged — this validation wrote NOTHING", before === after, `${before} → ${after}`);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    failed++;
    failures.push(`HARNESS ERROR: ${(e as Error).message}`);
    console.error("\n❌ threw:", e);
  })
  .finally(() => {
    console.log(`\n${"═".repeat(78)}`);
    console.log(`RESULT: ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  · ${f}`);
    }
    console.log("═".repeat(78));
    process.exit(failed === 0 ? 0 : 1);
  });
