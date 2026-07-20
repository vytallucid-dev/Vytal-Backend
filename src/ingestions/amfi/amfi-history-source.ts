// ─────────────────────────────────────────────────────────────
// AMFI NAV-HISTORY — the STREAMING fetch seam.
//
// THE ARCHITECTURE, IN ONE SENTENCE: the response body is NEVER materialised.
//
// Why that is not an optimisation but a REQUIREMENT: a 90-day window is ~59 MB of ASCII,
// which becomes ~118 MB the moment it is a JS string (V8 strings are UTF-16). A 5-year
// nightly run is 20 such windows and ~10.7 M rows; holding them as {date,nav} objects is
// 0.6–1 GB+. Streaming instead pipes the response, splits on newlines, and hands each row
// straight to a fold — so peak memory is O(schemes), never O(rows). Recon measured the
// streaming shape at 19.9 MB heap / 114 MB RSS folding 535,680 rows.
//
// The endpoint is DATE-RANGED OVER THE WHOLE UNIVERSE (not per-scheme): one GET returns
// every scheme × every date in the window. That is why the backfill is ~20 pulls and not
// a 14,000-call fan-out.
// ─────────────────────────────────────────────────────────────
import https from "https";
import { createInterface } from "readline";
import { dayToIso } from "./amfi-history-parse.js";

/**
 * The history endpoint.
 *
 * Overridable via AMFI_HISTORY_BASE_URL. Two real uses:
 *   · ops — repoint at a mirror if AMFI moves the endpoint, without a deploy;
 *   · verification — point at a host that returns a valid HTTP 200 carrying a NON-AMFI body,
 *     which is exactly what a maintenance page or a redirect-to-login looks like on the wire.
 *     That is the ONLY honest way to prove the shape guard actually refuses such a response
 *     instead of folding it as "the source published nothing" (the Step-9 incident).
 */
export const AMFI_HISTORY_URL =
  process.env.AMFI_HISTORY_BASE_URL ?? "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Day-number → AMFI's "13-Jul-2026" query format. */
function amfiDate(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export function historyWindowUrl(fromDay: number, toDay: number): string {
  return `${AMFI_HISTORY_URL}?frmdt=${amfiDate(fromDay)}&todt=${amfiDate(toDay)}`;
}

/** What the stream saw. The caller's shape guard reads these. */
export interface StreamResult {
  status: number;
  bytes: number;
  /** Lines that looked like data rows (before NAV validation). */
  dataRows: number;
  /** The column header as shipped — the shape guard's evidence. */
  headerLine: string | null;
  durationMs: number;
}

/** Redirects: AMFI bounces www→portal. Bounded, and HTTPS-only (never downgrade). */
const MAX_REDIRECTS = 3;

/**
 * INACTIVITY timeout — fires only when the socket goes SILENT for this long.
 *
 * It is NOT a bound on how long a window may take, and mistaking it for one is what hung this
 * pipeline (see DEADLINE_MS).
 */
const TIMEOUT_MS = 180_000; // a 90-day window is ~59 MB / ~35 s; 3 min of silence is generous

/**
 * TOTAL-DURATION CAP — the wall-clock ceiling on ONE window, whatever the socket is doing.
 *
 * ⚠️  WHY THIS EXISTS. `req.setTimeout` above is an INACTIVITY timer: every arriving byte resets
 *     it. So a server that DRIBBLES — sending a few bytes every couple of seconds — keeps the
 *     socket "active" forever and the timeout NEVER fires. The request hangs indefinitely, and
 *     because it never errors, the caller's error handling never runs either. The job simply
 *     stops, alive and connected and making no progress, with no fault raised and nothing logged.
 *
 *     That is not hypothetical: AMFI throttled us to exactly this dribble. A single window held
 *     one TCP socket open for 15+ minutes against a ~35 s norm, with bytes still trickling in.
 *     Both the inception walk and the nightly fold hung on it — the walk for 46 minutes before it
 *     was killed by hand. A cron job that hangs forever instead of failing is strictly worse than
 *     one that fails: a failure is visible, retried and logged; a hang is silent.
 *
 * 10 minutes = ~17× the normal window time. Nothing legitimate takes that long; anything that
 * does is a starved socket, and the honest response is to abandon it and say so. The callers
 * already know what to do with the rejection — the fold ABORTS BEFORE ANY WRITE (yesterday's
 * analytics stand), and the walk logs the window as failed and moves on.
 */
const DEADLINE_MS = 600_000;

/**
 * Stream ONE date-range window, invoking `onRow` for every line.
 *
 * `onRow` receives the RAW split fields — no object is allocated per row, and nothing is
 * retained here. The caller folds and forgets.
 *
 * Rejects on transport failure OR on the total-duration cap (the caller turns that into an
 * IngestionError + ABORT — a failed fetch must never be mistaken for "AMFI published nothing").
 */
export function streamHistoryWindow(
  fromDay: number,
  toDay: number,
  onRow: (parts: string[]) => void,
): Promise<StreamResult> {
  const t0 = Date.now();
  const url = historyWindowUrl(fromDay, toDay);

  return new Promise<StreamResult>((resolve, reject) => {
    let bytes = 0;
    let dataRows = 0;
    let headerLine: string | null = null;
    let settled = false;
    let activeReq: import("http").ClientRequest | null = null;

    // The cap runs against the WINDOW, not against any one socket, so a redirect chain or a
    // reconnect cannot reset it. Cleared on settle so a finished window never fires it.
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeReq?.destroy();
      reject(
        new Error(
          `AMFI history window ${dayToIso(fromDay)}→${dayToIso(toDay)} exceeded the ` +
            `${DEADLINE_MS / 1000}s total-duration cap (${(bytes / 1e6).toFixed(1)} MB in). ` +
            `The socket was still trickling — a throttled/starved stream, not a dead one, which ` +
            `is exactly what the inactivity timeout cannot catch.`,
        ),
      );
    }, DEADLINE_MS);

    const done = <T>(fn: (v: T) => void) => (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(v);
    };
    const ok = done(resolve);
    const bad = done(reject);

    const go = (u: string, hop: number) => {
      const req = https.get(
        u,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/plain,*/*",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const loc = res.headers.location;

          if (status >= 300 && status < 400 && loc) {
            res.resume(); // drain, or the socket leaks
            if (hop >= MAX_REDIRECTS) {
              bad(new Error(`AMFI history: too many redirects (>${MAX_REDIRECTS}) for ${dayToIso(fromDay)}→${dayToIso(toDay)}`));
              return;
            }
            const next = new URL(loc, u);
            if (next.protocol !== "https:") {
              bad(new Error(`AMFI history: refusing a non-HTTPS redirect to ${next.protocol}//`));
              return;
            }
            go(next.toString(), hop + 1);
            return;
          }

          res.on("data", (c: Buffer) => {
            bytes += c.length;
          });

          // readline consumes the stream incrementally — the body is never assembled.
          const rl = createInterface({ input: res, crlfDelay: Infinity });
          rl.on("line", (line) => {
            if (!line) return;
            if (line.startsWith("Scheme Code;")) {
              headerLine ??= line.trim(); // captured once, for the shape guard
              return;
            }
            const parts = line.split(";");
            if (parts.length < 8 || !/^\d+$/.test(parts[0]!.trim())) return; // section / AMC header
            dataRows++;
            onRow(parts);
          });

          // ⚠️  BUG FIX (found by Step 13, but NOT a Step-13 bug — it has always been here).
          //
          // A mid-stream connection reset from AMFI (ECONNRESET — routine on a 59 MB / 35 s
          // transfer, and it happened on the very first ETF inception walk) CRASHED THE PROCESS.
          //
          // `res.on("error", reject)` below looks like it covers this, and it does not: readline
          // FORWARDS its input stream's error onto the Interface, and an unhandled 'error' event
          // on an EventEmitter is a hard, uncatchable process kill. So the rejection never
          // reached the promise, and the careful try/catch in mf-inception-walk (which exists
          // precisely to log-and-continue past one bad window) and the ABORT-BEFORE-WRITE handler
          // in mf-analytics (which exists precisely so a failed fetch cannot half-write the
          // table) were both dead code on the one failure mode they were written for. A flaky
          // night took the whole job down with an uncaught exception instead.
          //
          // Wiring the Interface's error to the rejection is the entire fix: the transport
          // failure now arrives as a rejected promise, where both callers already know exactly
          // what to do with it.
          //
          // A stream that errors also CLOSES, so the resolve is guarded too (`ok`/`bad` settle
          // once): a truncated window must REJECT, not resolve with a plausible-looking partial
          // row count that the fold would happily treat as a short but honest day.
          rl.on("error", bad);
          res.on("error", bad);
          rl.on("close", () =>
            ok({ status, bytes, dataRows, headerLine, durationMs: Date.now() - t0 }),
          );
        },
      );
      activeReq = req; // so the total-duration cap can destroy whichever socket is live
      req.on("error", bad);
      req.setTimeout(TIMEOUT_MS, () =>
        req.destroy(new Error(`AMFI history fetch timed out (${dayToIso(fromDay)}→${dayToIso(toDay)})`)),
      );
    };

    go(url, 0);
  });
}
