// ─────────────────────────────────────────────────────────────
// NSE eq_etfseclist.csv — the ETF TICKER seam (Step 13, SECONDARY source).
//
// AMFI is the identity spine: it gives every ETF its ISIN, scheme code, category and NAV. What
// AMFI does NOT give is the thing that makes an ETF an ETF — the EXCHANGE TICKER you actually
// buy it under. NSE's ETF security list carries (Symbol, ISINNumber), so one join on ISIN
// populates `instruments.symbol`.
//
// THIS SOURCE IS SUBORDINATE, AND THE CODE IS SHAPED SO IT CANNOT BECOME LOAD-BEARING:
//   · A failed fetch NEVER blocks ETF identity. The 337 rows land with the ticker they already
//     had (carry-forward); a fault is recorded and the run continues. NSE being down must not
//     mean the catalogue loses its ETFs.
//   · A miss NEVER fabricates. Recon: 327 of 337 AMFI ETF ISINs resolve. The 10 that do not are
//     BSE-listed (SBI/Nippon/Kotak "BSE Sensex" ETFs) or matured (BHARAT Bond ETF April 2025) —
//     they genuinely have no NSE ticker, and they get symbol = NULL. An honest NULL, not a
//     guessed ticker: a wrong ticker is a wrong instrument.
//
// The reverse direction is deliberately NOT actioned: 1 NSE ISIN (INF397L01554) is absent from
// AMFI's ETF sections. We do not invent a catalogue row for it — AMFI is the spine, and a row
// with no scheme code could never join the analytics fold anyway.
// ─────────────────────────────────────────────────────────────
import https from "https";

export const NSE_ETF_SECLIST_URL =
  "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv";

/** Provenance tag for the IngestionError rows this source writes. */
export const NSE_ETF_SOURCE = "nse_eq_etfseclist";

/** The exact column header. A rename means our column indices are wrong → shape guard. */
export const NSE_ETF_HEADER =
  "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue";

/** Sanity band. NSE lists ~328 ETFs; outside this the file is not the file. */
const MIN_ROWS = 100;
const MAX_ROWS = 2_000;

const MAX_REDIRECTS = 3;

export interface EtfSeclistFetch {
  body: string;
  status: number;
  bytes: number;
}

export function fetchEtfSeclist(url = NSE_ETF_SECLIST_URL, hop = 0): Promise<EtfSeclistFetch> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,text/plain,*/*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;

        if (status >= 300 && status < 400 && loc) {
          res.resume(); // drain, or the socket leaks
          if (hop >= MAX_REDIRECTS) {
            reject(new Error(`NSE ETF seclist: too many redirects (>${MAX_REDIRECTS})`));
            return;
          }
          fetchEtfSeclist(new URL(loc, url).toString(), hop + 1).then(resolve, reject);
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ body, status, bytes: Buffer.byteLength(body) }));
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("NSE ETF seclist: timed out")));
  });
}

export type EtfSeclistParse =
  | { ok: true; byIsin: Map<string, string>; rows: number }
  | { ok: false; reason: string; observed: string };

/**
 * Parse the CSV into ISIN → NSE ticker.
 *
 * Guarded like every other source in this codebase: a renamed header or an absurd row count is a
 * REFUSAL, not something to parse through. The caller degrades to carry-forward on a refusal —
 * it never writes a ticker it is not sure of.
 */
export function parseEtfSeclist(text: string): EtfSeclistParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines[0] ?? "").trim();

  if (header !== NSE_ETF_HEADER) {
    return {
      ok: false,
      reason: "shape",
      observed: header || "(no header found)",
    };
  }

  const byIsin = new Map<string, string>();
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.split(",").map((x) => x.trim());
    if (c.length < 7) continue; // a short line is not a security — skip it, do not guess
    const symbol = c[0]!;
    const isin = c[5]!;
    if (!symbol || !isin) continue; // absent, not a fault: no ticker to learn from this line
    rows++;
    // First writer wins. Recon proved the ISIN column is unique across the file (328/328), so
    // this never actually arbitrates — it just refuses to let a hypothetical dup silently
    // overwrite a ticker we already resolved.
    if (!byIsin.has(isin)) byIsin.set(isin, symbol);
  }

  if (rows < MIN_ROWS || rows > MAX_ROWS) {
    return {
      ok: false,
      reason: "count",
      observed: `${rows} data rows (expected ${MIN_ROWS}–${MAX_ROWS})`,
    };
  }

  return { ok: true, byIsin, rows };
}
