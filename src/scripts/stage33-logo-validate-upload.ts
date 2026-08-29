// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 33 — VALIDATE A FOLDER OF LOGOS, THEN UPLOAD THEM TO SUPABASE STORAGE.
//
//   npx tsx src/scripts/stage33-logo-validate-upload.ts --dir Logos/amc            # validate only
//   npx tsx src/scripts/stage33-logo-validate-upload.ts --dir Logos/amc --commit   # …then upload
//
// ── VALIDATE FIRST, ALWAYS. UPLOAD IS THE SECOND HALF OF THE SAME COMMAND ────────────────────────
// A logo that is blurry, boxed on white, or secretly an HTML error page is worse than no logo: the
// monogram fallback is DESIGNED and looks deliberate, while a 48px upscaled JPEG next to a crisp SVG
// looks broken. So nothing uploads unless it passes, and --commit does not skip the check — it just
// continues past it.
//
// ── NO IMAGE LIBRARY, ON PURPOSE ─────────────────────────────────────────────────────────────────
// `sharp` is a native build dependency and this is a one-off ingest of ~52 files. Dimensions come
// from parsing the image HEADER directly — PNG's IHDR, JPEG's SOFn, WebP's VP8/VP8L/VP8X, GIF's
// screen descriptor, SVG's width/height/viewBox. Every one of those is a documented fixed offset or
// a short scan; none needs a decoder.
//
// ── WHAT "PREMIUM" MEANS HERE, AS CHECKABLE RULES ────────────────────────────────────────────────
//   SVG            → passes on sight. Vector is resolution-independent; there is nothing to blur.
//   ≥ MIN_EDGE px  → 512 on the long edge. A logo renders at ~28–64px in a list, and a 3× retina
//                    display asks for 192px; 512 leaves headroom for a detail page or an OG image
//                    without a second sourcing round.
//   PNG or WebP    → these carry an alpha channel.
//   NOT JPEG       → ⚠ REJECTED regardless of size. JPEG cannot hold transparency, so the logo
//                    arrives welded to a white box that will sit visibly on a dark-theme row, and
//                    its ringing artifacts land hardest on exactly the flat colour and hard edges a
//                    logo is made of.
//   bytes/pixel    → below BYTES_PER_PIXEL_FLOOR a raster is almost certainly an upscaled small
//                    image: the file has too little information for the dimensions it claims. This is
//                    the closest thing to a blur check that a header parse can honestly give, and it
//                    is reported as a SUSPICION, never as a measurement of sharpness.
//   real image     → the magic bytes must match the extension. A "PNG" that begins with "<!DOCTYPE"
//                    is a download that silently saved an error page — MEASURED earlier in this
//                    project, when a logo CDN returned 413 KB of HTML with a 200 status.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv;
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const DIR = arg("--dir", "Logos/amc");
const BUCKET = arg("--bucket", "logos");
const PREFIX = arg("--prefix", "amc");
const COMMIT = argv.includes("--commit");
const CHECK = argv.includes("--check");
const MIN_EDGE = num("--min-edge", 512);
const BYTES_PER_PIXEL_FLOOR = 0.02;

/**
 * PER-FILE EXCEPTIONS TO THE SIZE BAR — a named list, never a lowered threshold.
 *
 * MIN_EDGE is one number applied to every shape, so it is occasionally stricter than the use case.
 * The temptation when that happens is to drop --min-edge for the whole run, which silently relaxes
 * the bar for all 52 files and every logo added afterwards. An exception costs one line, names the
 * file, and records WHY - so a later reader can disagree with the specific judgement instead of
 * discovering that the standard quietly moved.
 *
 * Each entry must state the measured size and the reasoning. An entry with no reason is not an
 * exception, it is a bypass.
 */
const SIZE_EXCEPTIONS: Record<string, string> = {
  // 447x447 against a 512 bar - 13% under. A square mark renders at 32-64px in every surface it
  // appears in, which is 7-14x even at this size; the bar exists for a large detail-page treatment
  // that this logo does not get. Accepted 2026-08-29 rather than block the remaining 0.2% of the
  // fund catalogue on it.
  "ppfas.png": "square mark, 447px is 7-14x at every render size in use",
};

type Kind = "svg" | "png" | "webp" | "jpeg" | "gif" | "unknown";
/** WebP only: which coder produced the pixels. See the note on `webpCoding`. */
type WebpCoding = "lossless" | "lossy" | "unknown";
interface Probe { kind: Kind; w: number | null; h: number | null; bytes: number; webp?: WebpCoding }

/**
 * ⚠ WEBP IS TWO FORMATS WEARING ONE EXTENSION, AND ONLY ONE OF THEM IS A LOGO FORMAT.
 *
 *   VP8L → LOSSLESS. Ideal here: alpha, exact edges, and usually 25–35% smaller than the same PNG.
 *   VP8  → LOSSY. The same failure mode as JPEG — ringing on hard edges and flat colour, which is
 *          all a logo is. It DOES carry alpha, so it will not show a white box, and that is exactly
 *          what makes it easy to miss: the defect is softness, not an obvious rectangle.
 *
 * A plain VP8/VP8L file announces its coder in the fourcc at offset 12. An EXTENDED file (VP8X)
 * puts feature flags there instead and defers the real image to a later chunk, so the coder has to
 * be found by walking the chunks — hence the scan rather than a fixed offset read.
 */
function webpCoding(buf: Buffer): WebpCoding {
  const fourcc = buf.subarray(12, 16).toString("latin1");
  if (fourcc === "VP8L") return "lossless";
  if (fourcc === "VP8 ") return "lossy";
  if (fourcc !== "VP8X") return "unknown";
  // Extended: walk the chunk list (id[4] + size[4] + payload, padded to even) for the image chunk.
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.subarray(o, o + 4).toString("latin1");
    const size = buf.readUInt32LE(o + 4);
    if (id === "VP8L") return "lossless";
    if (id === "VP8 ") return "lossy";
    o += 8 + size + (size % 2);
  }
  return "unknown";
}

/** Header-only dimension read. Returns nulls rather than guessing when a format hides its size. */
function probeImage(buf: Buffer): Probe {
  const bytes = buf.length;
  const head = buf.subarray(0, Math.min(1024, bytes)).toString("latin1");

  // SVG — text. Prefer width/height, fall back to viewBox's third and fourth numbers.
  if (/^\s*(<\?xml|<svg)/i.test(head) || head.includes("<svg")) {
    const txt = buf.toString("utf8");
    const wa = /width\s*=\s*["']([\d.]+)/i.exec(txt);
    const ha = /height\s*=\s*["']([\d.]+)/i.exec(txt);
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(txt);
    const w = wa ? Number(wa[1]) : vb ? Number(vb[1]) : null;
    const h = ha ? Number(ha[1]) : vb ? Number(vb[2]) : null;
    return { kind: "svg", w, h, bytes };
  }
  // PNG — IHDR is fixed: signature(8) + length(4) + "IHDR"(4), then width/height as big-endian u32.
  if (bytes > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { kind: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes };
  }
  // GIF — screen descriptor at offset 6, little-endian u16 pair.
  if (bytes > 10 && head.startsWith("GIF8")) {
    return { kind: "gif", w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), bytes };
  }
  // WebP — three sub-formats, each with its own size field.
  if (bytes > 30 && head.startsWith("RIFF") && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    const fourcc = buf.subarray(12, 16).toString("latin1");
    const webp = webpCoding(buf);
    if (fourcc === "VP8X") return { kind: "webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), bytes, webp };
    if (fourcc === "VP8 ") return { kind: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, bytes, webp };
    if (fourcc === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { kind: "webp", w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, bytes, webp };
    }
    return { kind: "webp", w: null, h: null, bytes, webp };
  }
  // JPEG — walk the marker chain to the first SOFn. Rejected later, but sized so the report can say why.
  if (bytes > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { kind: "jpeg", h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), bytes };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
    return { kind: "jpeg", w: null, h: null, bytes };
  }
  return { kind: "unknown", w: null, h: null, bytes };
}

const contentType: Record<Kind, string> = {
  svg: "image/svg+xml", png: "image/png", webp: "image/webp",
  jpeg: "image/jpeg", gif: "image/gif", unknown: "application/octet-stream",
};

interface Verdict { file: string; probe: Probe; ok: boolean; reasons: string[]; notes: string[] }

function judge(file: string, buf: Buffer): Verdict {
  const p = probeImage(buf);
  const reasons: string[] = [], notes: string[] = [];
  const ext = path.extname(file).toLowerCase().replace(".", "");

  if (p.kind === "unknown") reasons.push("not a recognised image — the file may be an HTML error page saved with an image extension");
  if (p.kind === "jpeg") reasons.push("JPEG — no alpha channel, so the logo carries a white box onto dark rows");
  // ⚠ Lossy WebP is rejected for the SAME reason as JPEG, and it is the easier one to miss: it keeps
  //   its alpha, so there is no white box to give it away — only softness on the hard edges.
  if (p.kind === "webp" && p.webp === "lossy")
    reasons.push("lossy WebP — same ringing on hard edges as JPEG; re-export as lossless WebP or PNG");
  if (p.kind === "gif") reasons.push("GIF — 256 colours and hard-edged alpha; not a logo format");
  if (ext && p.kind !== "unknown" && ext !== p.kind && !(ext === "jpg" && p.kind === "jpeg"))
    notes.push(`extension says .${ext} but the bytes are ${p.kind}`);

  if (p.kind === "svg") {
    if (p.w == null || p.h == null) notes.push("no width/height/viewBox — scales fine, but nothing to verify");
  } else if (p.kind === "png" || p.kind === "webp") {
    const long = Math.max(p.w ?? 0, p.h ?? 0);
    if (!long) reasons.push("could not read dimensions");
    else if (long < MIN_EDGE) {
      const why = SIZE_EXCEPTIONS[file];
      if (why) notes.push(`${p.w}×${p.h} — under the ${MIN_EDGE}px bar, ACCEPTED BY EXCEPTION: ${why}`);
      else reasons.push(`${p.w}×${p.h} — long edge under ${MIN_EDGE}px, will soften on a retina detail view`);
    }
    const px = (p.w ?? 0) * (p.h ?? 0);
    if (px && p.bytes / px < BYTES_PER_PIXEL_FLOOR)
      notes.push(`${(p.bytes / px).toFixed(4)} bytes/px — thin for its size; likely upscaled from a smaller original (check it by eye)`);
  }
  return { file, probe: p, ok: reasons.length === 0, reasons, notes };
}

/**
 * WARN: TWO KEY SCHEMES, AND THE NEW ONE IS NOT A JWT.
 *
 * Supabase replaced the anon/service_role JWT pair with publishable/secret keys. `sb_secret_...` is
 * the successor to service_role - same full access, same RLS bypass - and service_role now sits
 * under a "Legacy" tab. Either is accepted here, newest name first, so nobody has to adopt a
 * deprecated credential to run this.
 *
 * BOTH headers are sent. The legacy key is a JWT that `Authorization: Bearer` accepts; the new secret
 * key is an opaque token the gateway expects in `apikey`. Sending one without the other works on one
 * scheme and 401s on the other - and a 401 here would read as "wrong key" rather than "wrong header",
 * which is an hour spent looking in the wrong place.
 */
function storageAuth(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) {
    throw new Error(
      "No storage credential. Set SUPABASE_SECRET_KEY (the sb_secret_... key from Settings -> API), " +
        "or SUPABASE_SERVICE_ROLE_KEY if the project still uses legacy keys. The publishable/anon " +
        "key cannot write to storage.",
    );
  }
  return { url: url.replace(/[/]+$/, ""), key };
}

const authHeaders = (key: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`,
  apikey: key,
});

/** Prove the credential and the bucket BEFORE pushing 52 files at them. */
async function preflight(): Promise<void> {
  const { url, key } = storageAuth();
  const masked = key.length > 12 ? `${key.slice(0, 8)}...${key.slice(-4)}` : "(short)";
  const shape = key.startsWith("sb_secret")
    ? "new secret key"
    : key.startsWith("sb_publishable")
      ? "PUBLISHABLE key - this cannot write to storage"
      : key.startsWith("eyJ")
        ? "legacy JWT"
        : "unrecognised shape";
  console.log(`
  endpoint ${url}`);
  console.log(`  key      ${masked} (${shape})`);
  const res = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, { headers: authHeaders(key) });
  if (res.ok) {
    const b = (await res.json()) as { name?: string; public?: boolean };
    const vis = b.public === true ? "yes" : "no (uploads still work; reads will need signed URLs)";
    console.log(`  bucket   "${b.name ?? BUCKET}" reachable - public: ${vis}`);
    return;
  }
  const body = (await res.text()).slice(0, 200);
  if (res.status === 400 || res.status === 404) {
    throw new Error(`bucket "${BUCKET}" not found (HTTP ${res.status}). Bucket names are CASE-SENSITIVE - check --bucket. ${body}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`credential rejected (HTTP ${res.status}). Storage writes need the SECRET key, not the publishable/anon one. ${body}`);
  }
  throw new Error(`HTTP ${res.status} ${body}`);
}

async function upload(file: string, buf: Buffer, kind: Kind): Promise<string> {
  const { url, key } = storageAuth();
  const objectPath = `${PREFIX}/${file}`;
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      ...authHeaders(key),
      "Content-Type": contentType[kind],
      "x-upsert": "true",              // re-running replaces rather than erroring on a duplicate
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return objectPath;
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 33 — logo validation${COMMIT ? " + UPLOAD" : " (validate only)"}   ${DIR}`);
  console.log("=".repeat(100));
  if (!fs.existsSync(DIR)) { console.log(`\n  no folder at ${DIR}\n`); return; }

  const files = fs.readdirSync(DIR).filter((f) => !f.startsWith(".") && fs.statSync(path.join(DIR, f)).isFile()).sort();
  if (!files.length) { console.log(`\n  ${DIR} is empty\n`); return; }

  const verdicts = files.map((f) => judge(f, fs.readFileSync(path.join(DIR, f))));
  const pass = verdicts.filter((v) => v.ok);
  const fail = verdicts.filter((v) => !v.ok);

  console.log(`\n  ${"file".padEnd(34)} ${"format".padEnd(11)} ${"size".padEnd(12)} ${"weight".padEnd(9)} verdict`);
  for (const v of verdicts) {
    const dim = v.probe.w && v.probe.h ? `${Math.round(v.probe.w)}×${Math.round(v.probe.h)}` : "—";
    const kb = `${(v.probe.bytes / 1024).toFixed(0)} KB`;
    const fmt = v.probe.kind === "webp" && v.probe.webp && v.probe.webp !== "unknown"
      ? `webp/${v.probe.webp === "lossless" ? "ll" : "lossy"}` : v.probe.kind;
    console.log(`  ${v.file.slice(0, 33).padEnd(34)} ${fmt.padEnd(11)} ${dim.padEnd(12)} ${kb.padEnd(9)} ${v.ok ? "✅ pass" : "❌ " + v.reasons[0]}`);
    for (const n of v.notes) console.log(`      ⚠ ${n}`);
    for (const r of v.reasons.slice(1)) console.log(`      ❌ ${r}`);
  }

  const byException = pass.filter((v) => SIZE_EXCEPTIONS[v.file]).length;
  console.log(`\n  ${verdicts.length} file(s) · ${pass.length} pass · ${fail.length} rejected`);
  if (byException) console.log(`  ${byException} of the passes cleared only via a named size exception — see SIZE_EXCEPTIONS.`);
  const svgs = pass.filter((v) => v.probe.kind === "svg").length;
  const ll = pass.filter((v) => v.probe.kind === "webp" && v.probe.webp === "lossless").length;
  console.log(`  of the passes: ${svgs} SVG (resolution-independent) · ${ll} lossless WebP · ${pass.length - svgs - ll} other raster`);

  if (CHECK) {
    // Credential + bucket check that touches no files at all.
    try {
      await preflight();
      console.log(`\n  storage is reachable and writable.\n`);
    } catch (e) {
      console.log(`\n  FAILED: ${String(e).replace(/^Error:\s*/, "")}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (!COMMIT) {
    console.log(`\n  validation only — re-run with --commit to upload the ${pass.length} that passed.`);
    console.log(`  tip: --check verifies the key and bucket first, without uploading anything.\n`);
    return;
  }

  // WARN: PREFLIGHT BEFORE THE LOOP. Discovering a bad key on file 1 of 52 is fine; discovering
  //   it on file 30 leaves the bucket half-populated and the report ambiguous about which half
  //   is real.
  await preflight();
  if (fail.length) console.log(`\n  ⚠ uploading the ${pass.length} that passed; the ${fail.length} rejected are NOT uploaded.`);

  let done = 0;
  const errs: string[] = [];
  for (const v of pass) {
    try {
      const at = await upload(v.file, fs.readFileSync(path.join(DIR, v.file)), v.probe.kind);
      done++;
      console.log(`     ✅ ${at}`);
    } catch (e) {
      errs.push(`${v.file}: ${String(e).slice(0, 150)}`);
      if (errs.length === 1) console.log(`     ❌ ${v.file}: ${String(e).slice(0, 150)}`);
    }
  }
  console.log(`\n  uploaded ${done}/${pass.length}`);
  if (errs.length > 1) { console.log(`  ${errs.length} failure(s):`); for (const e of errs.slice(0, 8)) console.log(`     ${e}`); }
  console.log("");
}
main().catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1); });
