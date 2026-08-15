// ─────────────────────────────────────────────────────────────
// CRON EXPRESSION READER — turn a schedule string into the instants it fires.
//
// WHY THIS EXISTS. The health check has to answer "which scheduled jobs did not run
// in their expected window?", and the only honest source for "expected" is the cron
// EXPRESSION ITSELF. A hardcoded table of cadences would rot exactly the way every
// comment this build has had to correct rotted: somebody changes "0 4 * * 1-5" to
// "0 4 * * *" and the monitor keeps checking the old shape, silently.
//
// So nothing here is configured. Feed it the same string that was handed to
// node-cron and it enumerates the firings.
//
// ── TIMEZONE ────────────────────────────────────────────────────────────────────
// Everything is evaluated in UTC. scheduler.ts calls cron.schedule() with NO timezone
// option, so node-cron uses the process timezone — and the process runs in UTC.
// That is not assumed, it is MEASURED: over 14 days, cron:daily-amfi-nav ("0 19 * * *")
// created its rows at exactly 19:00 UTC, 14/14; cron:daily-etf-corporate-actions
// ("45 19 * * *") at 19:45 UTC, 12/12; cron:nightly-retention-prune ("30 21 * * *") at
// 21:30 UTC, 14/14. assertUtcProcess() below re-checks the premise at runtime rather
// than trusting this paragraph.
//
// ── SUPPORTED SYNTAX ────────────────────────────────────────────────────────────
// Standard 5-field: minute hour day-of-month month day-of-week.
// Per field: `*`, `n`, `a-b`, `a-b/s`, `*/s`, and comma-unions of those.
// Day-of-week accepts 0-7 with both 0 and 7 meaning Sunday.
// Names (JAN, MON) are NOT supported — nothing in this codebase uses them, and
// accepting them silently-wrongly would be worse than refusing them loudly.
// ─────────────────────────────────────────────────────────────

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** True when the field was `*` — needed for the dom/dow rule below. */
  domUnrestricted: boolean;
  dowUnrestricted: boolean;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 7],
} as const;

function parseField(raw: string, lo: number, hi: number, label: string): { set: Set<number>; unrestricted: boolean } {
  const out = new Set<number>();
  const unrestricted = raw.trim() === "*";
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) throw new Error(`cron: empty ${label} field element in "${raw}"`);

    const [spec, stepRaw] = piece.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`cron: bad step "${stepRaw}" in ${label} field "${raw}"`);
    }

    let start: number;
    let end: number;
    if (spec === "*") {
      start = lo;
      end = hi;
    } else if (spec.includes("-")) {
      const [a, b] = spec.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`cron: bad range "${spec}" in ${label} field "${raw}"`);
      }
      start = a;
      end = b;
    } else {
      const n = Number(spec);
      if (!Number.isInteger(n)) {
        // Deliberately loud: JAN/MON style names land here rather than being guessed at.
        throw new Error(`cron: unsupported ${label} value "${spec}" in "${raw}" (names are not supported)`);
      }
      start = n;
      end = n;
    }
    if (start < lo || end > hi || start > end) {
      throw new Error(`cron: ${label} value out of range in "${raw}" (${start}-${end}, allowed ${lo}-${hi})`);
    }
    for (let v = start; v <= end; v += step) out.add(v);
  }
  return { set: out, unrestricted };
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expr}"`);
  }
  const [m, h, dom, mon, dow] = parts;
  const fm = parseField(m, ...RANGES.minute, "minute");
  const fh = parseField(h, ...RANGES.hour, "hour");
  const fd = parseField(dom, ...RANGES.dom, "day-of-month");
  const fmo = parseField(mon, ...RANGES.month, "month");
  const fdw = parseField(dow, ...RANGES.dow, "day-of-week");

  // Normalise Sunday: cron allows both 0 and 7.
  if (fdw.set.has(7)) fdw.set.add(0);

  return {
    minute: fm.set,
    hour: fh.set,
    dom: fd.set,
    month: fmo.set,
    dow: fdw.set,
    domUnrestricted: fd.unrestricted,
    dowUnrestricted: fdw.unrestricted,
  };
}

/**
 * Does this expression fire at this instant (minute resolution, UTC)?
 *
 * ⚠ THE dom/dow RULE. POSIX cron says: when BOTH day-of-month and day-of-week are
 * restricted, a firing happens if EITHER matches (an OR, not an AND) — which surprises
 * almost everyone. No expression in this codebase restricts both, so the rule is never
 * exercised here; it is implemented correctly anyway, and `assertUnambiguousDayFields`
 * exists so that if someone ever writes one, they are told rather than silently served a
 * schedule that may not match node-cron's own interpretation.
 */
export function matchesCron(f: CronFields, at: Date): boolean {
  if (!f.minute.has(at.getUTCMinutes())) return false;
  if (!f.hour.has(at.getUTCHours())) return false;
  if (!f.month.has(at.getUTCMonth() + 1)) return false;

  const domHit = f.dom.has(at.getUTCDate());
  const dowHit = f.dow.has(at.getUTCDay());
  if (f.domUnrestricted && f.dowUnrestricted) return true;
  if (f.domUnrestricted) return dowHit;
  if (f.dowUnrestricted) return domHit;
  return domHit || dowHit; // both restricted → OR, per POSIX
}

/** Throws if an expression restricts BOTH day fields — see the note on matchesCron. */
export function assertUnambiguousDayFields(expr: string, label: string): void {
  const f = parseCron(expr);
  if (!f.domUnrestricted && !f.dowUnrestricted) {
    throw new Error(
      `cron registry "${label}" (${expr}) restricts BOTH day-of-month and day-of-week. ` +
        `POSIX reads that as OR; node-cron may not. Rewrite it as two entries so the ` +
        `expected-firing calculation and the actual scheduler cannot disagree.`,
    );
  }
}

/**
 * Every instant the expression fires in [from, to). Minute resolution, UTC.
 *
 * `gate` is the escape hatch for a cron whose expression is NOT its schedule. results-scan
 * is the live case: it ticks every 4 hours year-round and a predicate decides which ticks
 * actually enqueue (see resultsScanShouldEnqueue). Passing that same predicate here means
 * the health check computes the REAL expected set instead of over-counting 6 firings a day
 * and reporting four phantom misses every night.
 */
export function expectedFirings(
  expr: string,
  from: Date,
  to: Date,
  gate?: (at: Date) => boolean,
): Date[] {
  const f = parseCron(expr);
  const out: Date[] = [];
  // Walk minute by minute. A 7-day window is 10,080 iterations per expression — the whole
  // registry costs a few hundred thousand integer comparisons, i.e. nothing. Being dumb
  // and exhaustive here is worth more than being clever: there is no "next firing"
  // arithmetic to get subtly wrong.
  const cursor = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  for (let t = cursor.getTime(); t < to.getTime(); t += 60_000) {
    const at = new Date(t);
    if (!matchesCron(f, at)) continue;
    if (gate && !gate(at)) continue;
    out.push(at);
  }
  return out;
}

/**
 * The premise this whole module rests on. Called by the health check so a server that
 * is NOT running in UTC produces a stated degradation rather than a page of false misses.
 */
export function assertUtcProcess(): { utc: boolean; offsetMinutes: number } {
  const offsetMinutes = new Date().getTimezoneOffset();
  return { utc: offsetMinutes === 0, offsetMinutes };
}
