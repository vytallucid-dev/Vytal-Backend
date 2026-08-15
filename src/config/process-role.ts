// ─────────────────────────────────────────────────────────────
// PROCESS ROLE — is this process allowed to do background work?
//
// ── THE INCIDENT THIS CLOSES ───────────────────────────────────────────────────────
// server.ts gated the SCHEDULER on NODE_ENV === "production" but started the WORKER
// unconditionally. A developer running `npm run dev` against the production DATABASE_URL
// therefore got a second worker claiming real jobs — silently, because the asymmetry meant
// it fired no crons and looked idle.
//
// MEASURED over 21 days: 34 overlapping execution intervals; 4 of them
// instrument_corporate_actions × mf_analytics_daily, the pair whose ordering is
// load-bearing; and `retention_prune` — maxAttempts:1, no retry path, DELETES PRODUCTION
// DATA — ran TWICE, evidenced by attempts:2 on two rows. Nothing alerted. The only trace
// was a counter exceeding its own declared maximum.
//
// ── ONE BOOLEAN, TWO CONSUMERS ─────────────────────────────────────────────────────
// The fix is not "gate the worker too" — it is that there must be exactly ONE decision,
// resolved here, that both the worker and the scheduler read. Two conditions that happen
// to match today are the shape the bug had; the whole failure was an asymmetry nobody
// noticed because each half looked reasonable on its own.
//
// ★ A process that runs the worker but NOT the scheduler is precisely the configuration
//   that caused this. It is no longer expressible.
//
// ── THE OVERRIDE IS OPT-IN ONLY ────────────────────────────────────────────────────
// ENABLE_WORKER can turn background work ON in development. It can NEVER turn it OFF in
// production: the expression is `isProduction || overrideRequested`, an OR, so
// ENABLE_WORKER=false on the deployed process changes nothing. That direction matters —
// a flag that could silently disable the production worker would be far worse than the
// problem being fixed here.
//
// ── WHY NODE_ENV IS TRUSTWORTHY HERE ───────────────────────────────────────────────
// Not assumed — measured. `startScheduler()` has exactly one call site and it is already
// gated on NODE_ENV === "production"; production fired 42 cron-triggered jobs in the last
// 24 hours, each landing on its expression's exact UTC minute at :00 seconds. The
// scheduler runs, therefore the gate passes, therefore NODE_ENV is "production" in the
// deployed process. `.env` (which carries NODE_ENV=development locally) is gitignored and
// never ships, and dotenv does not override a value the platform already set.
// ─────────────────────────────────────────────────────────────

export interface ProcessRole {
  /** Claim and execute jobs from background_jobs. */
  worker: boolean;
  /** Register cron entries (which includes the 2-minute job reaper and the inline sweeps). */
  scheduler: boolean;
  nodeEnv: string;
  isProduction: boolean;
  /** ENABLE_WORKER was set to a truthy value. */
  overrideRequested: boolean;
  /** The override actually changed the outcome (i.e. it is not production already). */
  overrideActive: boolean;
  /** One sentence naming the env and flag that decided this. Goes in the banner. */
  reason: string;
  /** Conditions worth shouting about even when the role itself is correct. */
  warnings: string[];
}

/** Accepts the usual truthy spellings; anything else (including absent) is false. */
function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  return ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
}

/** Does DATABASE_URL point somewhere local? Used only to sharpen a warning. */
function looksLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "host.docker.internal";
  } catch {
    return false;
  }
}

export function resolveProcessRole(envSource: NodeJS.ProcessEnv = process.env): ProcessRole {
  const nodeEnv = envSource.NODE_ENV?.trim() || "(unset)";
  const isProduction = envSource.NODE_ENV === "production";
  const overrideRequested = isTruthy(envSource.ENABLE_WORKER);

  // ★ OR, deliberately. The override can only ever ADD background work.
  const enabled = isProduction || overrideRequested;
  const overrideActive = overrideRequested && !isProduction;

  const warnings: string[] = [];
  if (overrideRequested && isProduction) {
    warnings.push(
      "ENABLE_WORKER is set on a production process. It is redundant and has NO effect — " +
        "background work is already on, and this flag cannot switch it off by design.",
    );
  }
  if (overrideActive && !looksLocal(envSource.DATABASE_URL)) {
    warnings.push(
      "⚠⚠ ENABLE_WORKER is ON and DATABASE_URL is NOT local. This process will claim jobs from a " +
        "REMOTE database alongside whatever worker is already there. That is exactly the " +
        "configuration that ran retention_prune twice and produced 34 overlapping executions. " +
        "If you did not mean this, unset ENABLE_WORKER now.",
    );
  }

  const reason = enabled
    ? isProduction
      ? `NODE_ENV=production`
      : `NODE_ENV=${nodeEnv} with ENABLE_WORKER override`
    : `NODE_ENV=${nodeEnv} and ENABLE_WORKER ${overrideRequested ? "unrecognised" : "unset"}`;

  return {
    worker: enabled,
    scheduler: enabled,
    nodeEnv,
    isProduction,
    overrideRequested,
    overrideActive,
    reason,
    warnings,
  };
}

/**
 * The startup banner. Printed in BOTH modes, always, before anything starts.
 *
 * ★ THE POINT IS THAT IT IS UNMISSABLE AND UNAMBIGUOUS. The failure this closes was
 *   invisible for 21 days because a process that was quietly doing background work looked
 *   identical at startup to one that was not. Whatever else is true of a Vytal process, it
 *   must never again be unclear which of the two it is.
 */
export function formatProcessRoleBanner(role: ProcessRole): string {
  const line = "═".repeat(76);
  const on = (b: boolean) => (b ? "ON " : "OFF");
  const rows = [
    `  worker    : ${on(role.worker)}  ${
      role.worker
        ? "claims and executes jobs from background_jobs"
        : "this process will NOT claim any job"
    }`,
    `  scheduler : ${on(role.scheduler)}  ${
      role.scheduler ? "cron entries registered (incl. the 2-min job reaper)" : "no cron will fire here"
    }`,
    `  reaper    : ${on(role.worker)}  ${
      role.worker
        ? "boot pass (worker.start) + 2-min timer (scheduler entry)"
        : "neither the boot pass nor the timer"
    }`,
    `  sweeps    : ${on(role.scheduler)}  ${
      role.scheduler
        ? "3 inline scoring sweeps + retention cron (scheduler entries)"
        : "no inline scoring sweep, no retention prune"
    }`,
  ];

  const head = role.worker
    ? `  PROCESS ROLE: API + BACKGROUND WORK`
    : `  PROCESS ROLE: API ONLY — background work DISABLED`;

  const why = `  Decided by: ${role.reason}`;

  const footer = role.worker
    ? []
    : [
        "",
        "  A dev process pointed at the production database claimed jobs alongside the",
        "  deployed worker for 21 days: 34 overlapping executions, and retention_prune",
        "  (which deletes data and has no retry path) ran twice. That is why this is off.",
        "",
        "  To run background work locally ON PURPOSE: ENABLE_WORKER=true",
        "  Point DATABASE_URL at a local database first.",
      ];

  const warn = role.warnings.length ? ["", ...role.warnings.map((w) => `  ${w}`)] : [];

  return [line, head, why, "", ...rows, ...warn, ...footer, line].join("\n");
}
