// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 34 — CAN WE RESOLVE A COMPANY TO A DOMAIN, AND IS THERE A USABLE LOGO THERE? Read-only probe.
//
//   npx tsx src/scripts/stage34-domain-probe.ts [--n 30] [--spacing 1500]
//
// Phase 3 of the logo plan is domain resolution for 2,290 companies, and it is the expensive one. So
// this measures the hit rate on a SAMPLE before anything is built — because the two outcomes lead to
// completely different plans:
//
//   high hit rate → build the resolver, run it over the universe, self-host what comes back
//   low hit rate  → the monogram fallback IS the equity story, and the effort belongs elsewhere
//
// A 20% answer is worth having BEFORE writing a 2,290-row pipeline, not after.
//
// ── WHAT IS MEASURED, IN TWO INDEPENDENT STAGES ──────────────────────────────────────────────────
//  1. DOMAIN — Wikidata entity by company name → P856 (official website). Corroborated with P946
//     (ISIN) where the entity carries one.
//
//     ⚠ NAME MATCHING IS THE WEAK LINK AND IS TREATED AS SUCH. Probing the 52 AMCs this way matched
//       "SBI" to an entity whose official site is s7.ru — S7 AIRLINES. So every hit here is scored:
//       an ISIN that agrees is strong corroboration, a domain that echoes the company name is weak
//       corroboration, and neither is a guarantee. The report prints the score rather than a verdict,
//       because the failure mode is a CONFIDENT WRONG ANSWER, not a blank.
//
//     ⚠ ISIN DISAGREEMENT IS NOT DISPROOF. HDFC Bank's Wikidata ISIN is its US ADR (US40415F1015),
//       so a strict ISIN gate would reject a correct match. Disagreement lowers the score; it never
//       rejects on its own.
//
//  2. ICON — from a resolved domain, what the site itself serves: <link rel="icon">, apple-touch-icon
//     and og:image, plus /favicon.ico. Sizes are read with the same header parser the AMC uploader
//     uses, so "usable" here means exactly what it meant there.
//
// ⚠ EVERYTHING FETCHED COMES FROM THE COMPANY'S OWN SITE. No logo API, nothing whose terms forbid
//   storing what it returns — which is what ruled out logo.dev's free tier.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const N = num("--n", 30);
const SPACING = num("--spacing", 1500);

const UA = { "User-Agent": "Mozilla/5.0 (compatible; VytalLogoProbe/1.0)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Icon { url: string; kind: string; w: number | null; h: number | null; bytes: number }

/** Same header parse as the uploader — dimensions without decoding. */
function sizeOf(buf: Buffer): { kind: string; w: number | null; h: number | null } {
  const head = buf.subarray(0, Math.min(512, buf.length)).toString("latin1");
  if (head.includes("<svg")) {
    const t = buf.toString("utf8");
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(t);
    const w = /width\s*=\s*["']([\d.]+)/i.exec(t);
    const h = /height\s*=\s*["']([\d.]+)/i.exec(t);
    return { kind: "svg", w: w ? +w[1] : vb ? +vb[1] : null, h: h ? +h[1] : vb ? +vb[2] : null };
  }
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { kind: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 30 && head.startsWith("RIFF") && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    const f = buf.subarray(12, 16).toString("latin1");
    if (f === "VP8X") return { kind: "webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (f === "VP8 ") return { kind: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (f === "VP8L") { const b = buf.readUInt32LE(21); return { kind: "webp", w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf.length > 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1) {
    // ICO — the directory's first entry carries the size; 0 means 256.
    return { kind: "ico", w: buf[6] || 256, h: buf[7] || 256 };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return { kind: "jpeg", w: null, h: null };
  return { kind: "unknown", w: null, h: null };
}

async function grab(url: string): Promise<Icon | null> {
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100) return null;
    const s = sizeOf(buf);
    if (s.kind === "unknown") return null;      // an HTML error page saved as an icon
    return { url, kind: s.kind, w: s.w, h: s.h, bytes: buf.length };
  } catch { return null; }
}

/** Icons the site itself declares, best first. */
async function iconsFor(site: string): Promise<Icon[]> {
  const out: Icon[] = [];
  let html = "";
  let base = site;
  try {
    const r = await fetch(site, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(15000) });
    base = r.url || site;
    html = (await r.text()).slice(0, 400_000);
  } catch { return out; }

  const abs = (h: string): string | null => { try { return new URL(h, base).href; } catch { return null; } };
  const cands: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["'][^"']*(icon|apple-touch-icon|mask-icon)/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)/i.exec(tag)?.[1];
    const u = href && abs(href);
    if (u) cands.push(u);
  }
  const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i.exec(html)?.[1]
    ?? /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i.exec(html)?.[1];
  if (og) { const u = abs(og); if (u) cands.push(u); }
  const fav = abs("/favicon.ico");
  if (fav) cands.push(fav);

  for (const u of [...new Set(cands)].slice(0, 6)) {
    const i = await grab(u);
    if (i) out.push(i);
  }
  // Biggest long edge first; SVG counts as infinite.
  return out.sort((a, b) => {
    const la = a.kind === "svg" ? 1e9 : Math.max(a.w ?? 0, a.h ?? 0);
    const lb = b.kind === "svg" ? 1e9 : Math.max(b.w ?? 0, b.h ?? 0);
    return lb - la;
  });
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 34 — domain + icon hit-rate probe (sample of ${N})`);
  console.log("=".repeat(104));

  // Stratified: the plan's value differs by tier, so a flat random sample would hide that.
  const rows = (await prisma.$queryRawUnsafe(`
    (SELECT symbol, name, isin, market_cap_category tier FROM stocks
      WHERE is_active AND market_cap_category='large_cap' ORDER BY random() LIMIT ${Math.ceil(N / 3)})
    UNION ALL
    (SELECT symbol, name, isin, market_cap_category FROM stocks
      WHERE is_active AND market_cap_category='mid_cap' ORDER BY random() LIMIT ${Math.ceil(N / 3)})
    UNION ALL
    (SELECT symbol, name, isin, market_cap_category FROM stocks
      WHERE is_active AND market_cap_category='small_cap' ORDER BY random() LIMIT ${Math.floor(N / 3)})`)) as
    Array<{ symbol: string; name: string; isin: string; tier: string }>;

  let domains = 0, isinOk = 0, nameEcho = 0, anyIcon = 0, goodIcon = 0;
  const perTier = new Map<string, { n: number; dom: number; good: number }>();

  for (const s of rows) {
    const t = perTier.get(s.tier) ?? { n: 0, dom: 0, good: 0 };
    t.n++;
    const clean = s.name.replace(/\b(Ltd|Limited|Ltd\.|Corporation|Corp|Inc)\b\.?/gi, "").replace(/\s+/g, " ").trim();
    let site: string | null = null, wdIsin: string | null = null, wd: string | null = null;
    try {
      const q = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(clean)}&language=en&format=json&limit=1`, { headers: UA })).json() as any;
      wd = q.search?.[0]?.id ?? null;
      if (wd) {
        await sleep(SPACING);
        const e = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wd}&format=json`, { headers: UA })).json() as any;
        site = e.claims?.P856?.[0]?.mainsnak?.datavalue?.value ?? null;
        wdIsin = e.claims?.P946?.[0]?.mainsnak?.datavalue?.value ?? null;
      }
    } catch { /* rate limit or transport — counted as a miss, not retried */ }

    let score = "";
    if (site) {
      domains++; t.dom++;
      if (wdIsin === s.isin) { isinOk++; score = "ISIN✓"; }
      else if (wdIsin) score = "ISIN✗";
      const host = (() => { try { return new URL(site).hostname.replace(/^www\./, ""); } catch { return ""; } })();
      const token = clean.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
      if (token.length >= 4 && host.includes(token.slice(0, Math.min(6, token.length)))) { nameEcho++; score += score ? "+name" : "name~"; }
      if (!score) score = "unverified";
    }

    let best: Icon | null = null;
    if (site) {
      const icons = await iconsFor(site);
      if (icons.length) { anyIcon++; best = icons[0]; }
      const long = best ? (best.kind === "svg" ? 1e9 : Math.max(best.w ?? 0, best.h ?? 0)) : 0;
      if (best && long >= 180 && best.kind !== "jpeg") { goodIcon++; t.good++; }
    }
    perTier.set(s.tier, t);

    const dim = best ? (best.kind === "svg" ? "vector" : `${best.w}×${best.h}`) : "—";
    console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap", "").padEnd(6)} ${(site ? new URL(site).hostname.replace(/^www\./, "") : "NO DOMAIN").slice(0, 30).padEnd(31)} ${score.padEnd(11)} ${best ? `${best.kind} ${dim}` : "no icon"}`);
    await sleep(SPACING);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  sampled                       ${rows.length}`);
  console.log(`  domain resolved               ${domains}  (${((domains / rows.length) * 100).toFixed(0)}%)`);
  console.log(`     …ISIN corroborated         ${isinOk}`);
  console.log(`     …domain echoes the name    ${nameEcho}`);
  console.log(`  site served ANY icon          ${anyIcon}`);
  console.log(`  icon ≥180px and not JPEG      ${goodIcon}  (${((goodIcon / rows.length) * 100).toFixed(0)}% end-to-end)`);
  console.log(`\n  by tier:`);
  for (const [tier, t] of perTier) console.log(`     ${tier.padEnd(12)} ${t.n} sampled · ${t.dom} domain · ${t.good} usable icon`);
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
