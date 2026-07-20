// ─────────────────────────────────────────────────────────────
// THE LIVE FUND CHART — fetched at VIEW time, held for the length of one response, DISCARDED.
//
// Under Option B there is no NAV-history table to read a chart out of, and that is deliberate.
// So a fund's chart is a LIVE per-fund pull: one call, ~130 KB, ~300 ms → parse → respond →
// forget. Nothing is written. No cache table, no "is it cached?" state machine.
//
// SOURCE: api.mfapi.in/mf/{scheme_code}. Recon verified it against our own catalogue —
// scheme codes match ours exactly, the newest NAV agrees with our Layer-B current_nav, and it
// carries full per-scheme series (the probe fund had 3,264 points).
//
// WHY mfapi HERE AND AMFI FOR THE NIGHTLY FOLD: the fold needs the whole universe by date
// range (AMFI's endpoint is built for exactly that; mfapi would be 14,000 calls). A chart
// needs ONE fund's full series (mfapi is built for exactly that; AMFI would be a 59 MB
// window pull to serve one line on one page). Right tool, each way round.
//
// DEGRADES HONESTLY: source down, scheme unknown, or a malformed payload → `ok: false` with a
// reason. The endpoint says "chart unavailable". It NEVER fabricates a series, and it never
// silently returns a shorter one as if it were complete.
// ─────────────────────────────────────────────────────────────
import https from "https";

const MFAPI_BASE = "https://api.mfapi.in/mf";
const TIMEOUT_MS = 12_000; // a user is waiting on this — fail fast rather than hang the page

export interface ChartPoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** The NAV as a STRING — never a float. AMFI publishes up to 8 dp; parsing to a JS number
   *  and re-serialising would introduce binary drift into a value we are only passing through. */
  nav: string;
}

export type ChartResult =
  | {
      ok: true;
      schemeCode: string;
      schemeName: string | null;
      points: ChartPoint[];
      /** Oldest / newest dates actually returned — so the UI can label the axis honestly
       *  rather than implying the series starts at the fund's inception. */
      from: string | null;
      to: string | null;
      source: "mfapi.in";
    }
  | {
      ok: false;
      schemeCode: string;
      reason: string;
      source: "mfapi.in";
    };

/** Optional window: trim to the last N days. Trimming happens AFTER the fetch — the source
 *  has no date-range API, and asking for less would not save a byte. */
export interface ChartOptions {
  days?: number;
}

export async function fetchFundChart(
  schemeCode: string,
  opts: ChartOptions = {},
): Promise<ChartResult> {
  if (!/^\d+$/.test(schemeCode)) {
    return { ok: false, schemeCode, reason: "invalid scheme code", source: "mfapi.in" };
  }

  let raw: { status: number; body: string };
  try {
    raw = await get(`${MFAPI_BASE}/${schemeCode}`);
  } catch (err) {
    // The source being down is not the fund having no history. Say so.
    return {
      ok: false,
      schemeCode,
      reason: `NAV history source unreachable (${(err as Error).message})`,
      source: "mfapi.in",
    };
  }

  if (raw.status !== 200) {
    return { ok: false, schemeCode, reason: `NAV history source returned HTTP ${raw.status}`, source: "mfapi.in" };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw.body);
  } catch {
    return { ok: false, schemeCode, reason: "NAV history source returned a malformed payload", source: "mfapi.in" };
  }

  const data: any[] = Array.isArray(parsed?.data) ? parsed.data : [];
  if (data.length === 0) {
    // HONEST-EMPTY, not a fault: a brand-new fund genuinely has no series yet. Recon found
    // live examples with as few as 4 NAV points. That is a data STATE, not an error.
    return {
      ok: true,
      schemeCode,
      schemeName: parsed?.meta?.scheme_name ?? null,
      points: [],
      from: null,
      to: null,
      source: "mfapi.in",
    };
  }

  // mfapi ships newest-first with "DD-MM-YYYY" dates. Normalise to oldest-first ISO so the
  // chart can render it without every caller re-deriving the convention.
  const points: ChartPoint[] = [];
  for (const d of data) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d?.date ?? ""));
    const nav = String(d?.nav ?? "").trim();
    if (!m || !/^\d+(\.\d*)?$/.test(nav)) continue; // skip a junk point — never invent one
    points.push({ date: `${m[3]}-${m[2]}-${m[1]}`, nav });
  }
  points.reverse(); // oldest → newest

  const trimmed =
    opts.days && opts.days > 0
      ? points.filter(
          (p) => new Date(p.date).getTime() >= Date.now() - opts.days! * 86_400_000,
        )
      : points;

  return {
    ok: true,
    schemeCode,
    schemeName: parsed?.meta?.scheme_name ?? null,
    points: trimmed,
    from: trimmed[0]?.date ?? null,
    to: trimmed[trimmed.length - 1]?.date ?? null,
    source: "mfapi.in",
  };
}

function get(url: string, hop = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Vytal/1.0", Accept: "application/json" } },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && hop < 3) {
          res.resume();
          const next = new URL(loc, url);
          if (next.protocol !== "https:") {
            reject(new Error("refusing a non-HTTPS redirect"));
            return;
          }
          resolve(get(next.toString(), hop + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("NAV history source timed out")));
  });
}
