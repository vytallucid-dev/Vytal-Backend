// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// IRDAI HTTP — spacing, and THE CONTENT TEST.
//
// ⚠ B1c. A STATUS-CODE CHECK IS NOT A FILE CHECK. Measured 2026-08-23, on real candidate URLs:
//
//     www.newindia.co.in/assets/docs/public-disclosure/Public-Disclosure-March-2026.pdf
//        -> HTTP 200 · content-type text/html · 4,165,540 bytes · the Angular SPA shell
//     www.gicre.in/phocadownload/quarterly/<missing>.pdf
//        -> HTTP 200 · text/html · silently redirected to ?option=com_content&view=article&id=304
//     www.godigit.com/content/dam/.../2025-2026/q1/NL-1-B-RA.pdf
//        -> HTTP 404 · text/html · 261,892 bytes
//     www.icicilombard.com/docs/.../q4-2026/nl-99.pdf
//        -> HTTP 404 · text/html · 207,023 bytes
//
//   Two of those four are 200. A `if (res.ok)` gate hands 4 MB of SPA markup to a PDF parser, which
//   then finds no text, extracts nothing, and — if the caller defaults on absence — writes nulls
//   over a period that actually exists. The status code is advisory. The BYTES are the fact.
//
// ★ THE CONTENT TEST, in order, all four required before a buffer is called a document:
//     1. the first five bytes are exactly "%PDF-"          (magic, not content-type)
//     2. the trailer contains "%%EOF"                       (not a truncated download)
//     3. at least one page carries a non-empty text layer   (checked in irdai-parse)
//     4. the page text matches a known IRDAI form title     (checked in irdai-forms)
//   Steps 1-2 live here because they need the raw buffer. 3-4 need the parse, and live there.
//
// ⚠ content-type is NOT part of the test. NIACL's shell declares text/html, which happens to be
//   honest, but a misconfigured host declaring application/pdf over an error page would pass a
//   content-type check and fail the magic check. Trust the bytes only.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Courtesy spacing between requests to the SAME host. Insurer sites are small; we are a guest. */
const PER_HOST_SPACING_MS = 5_200;

const lastByHost = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const IRDAI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FetchRecord {
  at: string;
  url: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  bytes: number;
  ms: number;
  error: string | null;
}

export const FETCH_LOG: FetchRecord[] = [];

/**
 * ⚠ The central repository at irdai.gov.in publishes `Disallow: /`. We respect it, so this lane
 *   reads insurer websites only. Refused at the transport so no caller can route around it.
 */
/**
 * Insurer hosts that publish a blanket `Disallow: /` for `User-agent: *`.
 *
 * MEASURED 2026-08-25 by stage7b-robots-probe.ts across all 11 insurers in the
 * universe. Only one refuses:
 *   www.icicilombard.com  —  User-agent: * / Disallow: /
 * The other ten serve either no robots.txt or rules that leave `/` open.
 *
 * ⚠ This list is EVIDENCE, not a guess, and it goes stale. Re-run
 *   stage7b-robots-probe.ts before any new crawl campaign and update this.
 *   ICICIGI is not a loss: Stage 7a already reads its results from BSE XBRL.
 */
const ROBOTS_REFUSED_HOSTS = new Set(["www.icicilombard.com", "icicilombard.com"]);

export function assertAllowedHost(url: string): void {
  const h = new URL(url).hostname.toLowerCase();
  if (h === "irdai.gov.in" || h.endsWith(".irdai.gov.in")) {
    throw new Error(
      `REFUSED: ${h} publishes "Disallow: /". The IRDAI lane reads insurer websites only.`,
    );
  }
  if (ROBOTS_REFUSED_HOSTS.has(h)) {
    throw new Error(
      `REFUSED: ${h} publishes "Disallow: /" for User-agent: *. ` +
        `Refused at the transport so no caller can route around it. ` +
        `Its results are already served by the BSE XBRL lane (Stage 7a).`,
    );
  }
}

export interface RawFetch {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  buf: Buffer;
  text: string;
  error: string | null;
  finalUrl: string | null;
  ms: number;
}

export async function fetchRaw(
  url: string,
  opts: { binary?: boolean; timeoutMs?: number; referer?: string } = {},
): Promise<RawFetch> {
  assertAllowedHost(url);
  const host = new URL(url).hostname;
  const wait = Math.max(0, (lastByHost.get(host) ?? 0) + PER_HOST_SPACING_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastByHost.set(host, Date.now());

  const at = new Date().toISOString();
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "user-agent": IRDAI_UA,
        accept: opts.binary ? "application/pdf,*/*" : "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...(opts.referer ? { referer: opts.referer } : {}),
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    FETCH_LOG.push({
      at,
      url,
      finalUrl: res.url === url ? null : res.url,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bytes: buf.length,
      ms,
      error: null,
    });
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      buf,
      text: opts.binary ? "" : buf.toString("utf8"),
      error: null,
      finalUrl: res.url === url ? null : res.url,
      ms,
    };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    FETCH_LOG.push({ at, url, finalUrl: null, status: null, contentType: null, bytes: 0, ms, error });
    return { ok: false, status: null, contentType: null, buf: Buffer.alloc(0), text: "", error, finalUrl: null, ms };
  } finally {
    clearTimeout(timer);
  }
}

export type ContentVerdict =
  | { isDocument: true }
  | { isDocument: false; reason: "empty" | "not_pdf_magic" | "truncated"; detail: string };

const PDF_MAGIC = "%PDF-";

/**
 * ⚠ THE CONTENT TEST (steps 1-2). Never `res.ok`, never content-type.
 *   Returns a REASON, never a bare false — the ledger records which of the two it was, because
 *   "not_pdf_magic" on a 200 is the SPA trap and "truncated" is a network problem worth retrying.
 */
export function contentTest(buf: Buffer): ContentVerdict {
  if (buf.length === 0) return { isDocument: false, reason: "empty", detail: "zero bytes" };
  const magic = buf.subarray(0, 5).toString("latin1");
  if (magic !== PDF_MAGIC) {
    const head = buf.subarray(0, 120).toString("latin1").replace(/\s+/g, " ");
    return {
      isDocument: false,
      reason: "not_pdf_magic",
      detail: `first 5 bytes were ${JSON.stringify(magic)}, not "%PDF-" — head: ${JSON.stringify(head)}`,
    };
  }
  // A PDF ends with %%EOF. Look only at the tail: some producers pad after it.
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1");
  if (!tail.includes("%%EOF")) {
    return {
      isDocument: false,
      reason: "truncated",
      detail: `no %%EOF in the last 2048 bytes of a ${buf.length}-byte body`,
    };
  }
  return { isDocument: true };
}

/** Fetch a document and apply the content test. The ONLY way this lane obtains a PDF. */
export async function fetchDocument(
  url: string,
  opts: { timeoutMs?: number; referer?: string } = {},
): Promise<
  | { ok: true; buf: Buffer; status: number; ms: number }
  | { ok: false; status: number | null; reason: string; detail: string; ms: number }
> {
  const r = await fetchRaw(url, { ...opts, binary: true });
  if (r.error) return { ok: false, status: r.status, reason: "fetch_failed", detail: r.error, ms: r.ms };
  const verdict = contentTest(r.buf);
  if (!verdict.isDocument) {
    return {
      ok: false,
      status: r.status,
      reason: `content_test_${verdict.reason}`,
      // ⚠ the status is recorded but is NOT what decided this.
      detail: `HTTP ${r.status} content-type ${r.contentType} — ${verdict.detail}`,
      ms: r.ms,
    };
  }
  return { ok: true, buf: r.buf, status: r.status ?? 200, ms: r.ms };
}
