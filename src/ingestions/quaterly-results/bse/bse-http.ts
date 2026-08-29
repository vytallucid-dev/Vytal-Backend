// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BSE HTTP CLIENT — pacing, backoff, and the throttle STOP.
//
// Access needs only a normal browser UA plus Referer + Origin. No cookies, no session handshake,
// no token. Without Referer/Origin the API 301s. MEASURED in the Stage-5 probe.
//
// ⚠ TWO SERVER BEHAVIOURS THIS FILE EXISTS TO SURVIVE, both MEASURED, neither documented by BSE:
//
//   1. THROTTLING IS REAL AND GRADUAL, AND IT DEGRADES RATHER THAN REFUSING. Latency ran 0.8s for
//      the first ~50 sequential calls, then settled at 26–28s. It is NOT a ban and NOT a 429 — there
//      is no status code to key on, and the slow responses are still HTTP 200 carrying the complete,
//      correct payload.
//      ⚠ RECOVERY IS NOT ALWAYS QUICK. Early on it cleared within ~2 minutes of quiet. After a day of
//      probing it did NOT: a single isolated request still took 28s, so the budget has a much longer
//      window than the first measurement suggested.
//      ⚠ SO THE POLICY IS: SLOW ⇒ WIDEN SPACING AND CONTINUE. BROKEN ⇒ STOP. Treating "slow" as
//      "stop" refuses data the server is willing to serve and makes every resume die on its first
//      request — measured, 0 units of progress per cycle. See `observe` for the full reasoning.
//
//   2. SOME RESPONSES CARRY A MALFORMED HEADER. Node's strict HTTP parser rejects them with
//      HPE_INVALID_HEADER_TOKEN ("Unexpected whitespace after header value") and the request dies.
//      It is intermittent and not tied to any one endpoint. `insecureHTTPParser` relaxes parsing of
//      the RESPONSE ONLY — it changes nothing we send, and is not impersonation of any kind.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import https from "https";
import zlib from "zlib";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const BSE_API = "https://api.bseindia.com/BseIndiaAPI/api";
export const BSE_FILES = "https://www.bseindia.com/XBRLFILES/";

/** Thrown when the measured latency signature of the throttle appears. The RUN stops; the request is
 *  never retried. Callers must let this propagate — catching it to continue is the bug it prevents. */
export class ThrottleStopError extends Error {
  constructor(public readonly observedMs: number, public readonly threshold: number) {
    super(
      `BSE latency ${Math.round(observedMs)}ms exceeded the throttle threshold ${threshold}ms — ` +
        `STOPPING the run. This is the measured throttle signature (0.8s → 26s after ~50 calls). ` +
        `It recovers in ~2 minutes of quiet; resume from the ledger.`,
    );
    this.name = "ThrottleStopError";
  }
}

export interface BseResponse {
  status: number;
  body: string;
  latencyMs: number;
}

export interface PacerOptions {
  /** Floor spacing between requests. */
  minSpacingMs?: number;
  /** A single response slower than this trips ThrottleStopError. */
  throttleStopMs?: number;
  /** Consecutive slow-but-not-stopping responses tolerated before stopping. */
  slowStreakLimit?: number;
  /** Above this, a response counts as "slow": spacing widens, but the run CONTINUES. */
  slowMs?: number;
  /** Ceiling for adaptive spacing when the service is degraded. */
  maxSpacingMs?: number;
  maxAttempts?: number;
}

/**
 * Serialises every BSE request behind one spacing gate and watches the latency trend.
 *
 * Backoff is exponential and applies ONLY to transport faults (socket errors, timeouts, 5xx).
 * A latency climb is handled by the opposite policy — stop, do not back off and retry — because
 * retrying is what deepens a throttle.
 */
export class BsePacer {
  private lastAt = 0;
  private slowStreak = 0;
  private adaptiveSpacingMs: number;
  private readonly maxSpacingMs: number;
  private readonly minSpacingMs: number;
  private readonly throttleStopMs: number;
  private readonly slowStreakLimit: number;
  private readonly slowMs: number;
  private readonly maxAttempts: number;
  /** Observability: every request's latency, in order, for the run report. */
  readonly latencies: number[] = [];
  /** Observability: transport-fault retries taken. A long run that is slower than
   *  its spacing floor explains itself here rather than by guesswork. */
  retries = 0;

  constructor(opts: PacerOptions = {}) {
    this.minSpacingMs = opts.minSpacingMs ?? 1500;
    this.adaptiveSpacingMs = this.minSpacingMs;
    this.maxSpacingMs = opts.maxSpacingMs ?? 30_000;
    this.throttleStopMs = opts.throttleStopMs ?? 15_000;
    this.slowStreakLimit = opts.slowStreakLimit ?? 3;
    this.slowMs = opts.slowMs ?? 6_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
  }

  private async space(): Promise<void> {
    const wait = this.lastAt + this.adaptiveSpacingMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();
  }

  /**
   * ⚠ DEGRADED IS NOT BROKEN, AND CONFLATING THEM COST A PILOT RUN.
   *
   * The original policy stopped on any latency climb. MEASURED 2026-08-22: after a day of probing,
   * BSE settled at ~28 s per request while still answering HTTP 200 with the complete, correct
   * payload (71,880 bytes of RELIANCE's results listing, fully parseable). Stopping on that refused
   * data the server was willingly serving, and every 3-minute resume was stopped again on its first
   * request — 0 units of progress per cycle, indefinitely.
   *
   * So the two states are now separated:
   *   DEGRADED — slow, but a 200 with a valid body. BACK OFF (widen spacing) and keep going. The
   *              effective rate at 28 s latency plus spacing is roughly one request per 36 s, which
   *              is gentler than the run that provoked the throttle in the first place.
   *   BROKEN   — timeouts, 5xx, or a body with no Table key. Those raise from the call path, and a
   *              sustained streak of them is what STOPS the run.
   *
   * The stop threshold is therefore about the request FAILING, not about it being slow. A slow
   * response that carries the data is a successful response.
   */
  private observe(latencyMs: number): void {
    this.latencies.push(latencyMs);
    if (latencyMs >= this.throttleStopMs) {
      throw new ThrottleStopError(latencyMs, this.throttleStopMs);
    }
    if (latencyMs >= this.slowMs) {
      this.slowStreak++;
      // DEGRADED: widen spacing so the sustained rate drops, and carry on.
      this.adaptiveSpacingMs = Math.min(this.adaptiveSpacingMs * 1.5, this.maxSpacingMs);
    } else {
      this.slowStreak = 0;
      // Relax back toward the floor once responses are healthy again.
      this.adaptiveSpacingMs = Math.max(this.minSpacingMs, this.adaptiveSpacingMs * 0.8);
    }
  }

  /** Current spacing, after adaptation. Exposed for the run report. */
  get spacingMs(): number {
    return this.adaptiveSpacingMs;
  }

  async get(url: string, accept = "application/json, text/plain, */*"): Promise<BseResponse> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.space();
      const started = Date.now();
      try {
        const res = await rawGet(url, accept);
        const latencyMs = Date.now() - started;
        // 5xx is a transport-class fault: back off and retry. 4xx is an answer: return it.
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        this.observe(latencyMs);
        return { ...res, latencyMs };
      } catch (e) {
        if (e instanceof ThrottleStopError) throw e;
        lastErr = e;
        this.retries++;
        if (attempt < this.maxAttempts) {
          // exponential backoff: 2s, 4s, 8s …
          await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
        }
      }
    }
    throw new Error(
      `BSE request failed after ${this.maxAttempts} attempts: ${url} — ${String(
        lastErr instanceof Error ? lastErr.message : lastErr,
      )}`,
    );
  }
}

function rawGet(url: string, accept: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": UA,
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          Referer: "https://www.bseindia.com/",
          Origin: "https://www.bseindia.com",
        },
        // ⚠ RESPONSE-side leniency only. See the header note at the top of this file.
        insecureHTTPParser: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = res.headers["content-encoding"];
          const done = (b: Buffer) =>
            resolve({ status: res.statusCode ?? 0, body: b.toString("utf8") });
          if (enc === "gzip") zlib.gunzip(buf, (e, d) => (e ? reject(e) : done(d)));
          else if (enc === "deflate") zlib.inflate(buf, (e, d) => (e ? reject(e) : done(d)));
          else done(buf);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("BSE request timed out")));
  });
}
