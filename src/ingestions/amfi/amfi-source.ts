// ─────────────────────────────────────────────────────────────
// AMFI NAVAll.txt — the fetch seam.
//
// The official AMFI daily NAV file: every live scheme's LATEST NAV in ONE ~1.6 MB file.
// No API key, no session, no rate limit. This is why the nightly refresh needs no
// per-scheme fan-out (14,216 schemes, one HTTP GET).
// ─────────────────────────────────────────────────────────────
import https from "https";

export const AMFI_NAVALL_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

export interface AmfiFetch {
  body: string;
  status: number;
  bytes: number;
}

/** AMFI 302-redirects www.amfiindia.com → portal.amfiindia.com. https.get does NOT follow
 *  redirects, so we follow them explicitly — bounded, and HTTPS-only (never downgrade). */
const MAX_REDIRECTS = 3;

export function fetchNavAll(url = AMFI_NAVALL_URL, hop = 0): Promise<AmfiFetch> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/plain,*/*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;

        if (status >= 300 && status < 400 && loc) {
          res.resume(); // drain, or the socket leaks
          if (hop >= MAX_REDIRECTS) {
            reject(new Error(`AMFI: too many redirects (>${MAX_REDIRECTS})`));
            return;
          }
          const next = new URL(loc, url);
          if (next.protocol !== "https:") {
            reject(new Error(`AMFI: refusing to follow a non-HTTPS redirect to ${next.protocol}//`));
            return;
          }
          resolve(fetchNavAll(next.toString(), hop + 1));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ body: buf.toString("utf-8"), status, bytes: buf.length });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("AMFI NAVAll fetch timed out")));
  });
}
