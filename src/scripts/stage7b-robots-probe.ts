// ═══════════════════════════════════════════════════════════════
// STAGE 7b — ROBOTS PRE-FLIGHT, before any crawling.
//
//   npx tsx src/scripts/stage7b-robots-probe.ts
//
// irdai-http.ts already refuses irdai.gov.in because it publishes "Disallow: /".
// It does NOT check the INSURER hosts, because until now the lane only fetched
// URLs that were already known. A discovery crawler is different: it will read
// listing PAGES and follow links, so each host's own robots.txt has to be read
// and honoured first.
//
// Read-only. Fetches nothing but /robots.txt.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";

const OUT = "_s7b-robots.json";

/** Public-disclosure entry points, per insurer. Life first — that is where the gap is. */
const HOSTS: { symbol: string; family: string; host: string }[] = [
  { symbol: "HDFCLIFE", family: "life", host: "www.hdfclife.com" },
  { symbol: "SBILIFE", family: "life", host: "www.sbilife.co.in" },
  { symbol: "ICICIPRULI", family: "life", host: "www.iciciprulife.com" },
  { symbol: "LICI", family: "life", host: "licindia.in" },
  { symbol: "CANHLIFE", family: "life", host: "www.canarahsbclife.com" },
  { symbol: "GODIGIT", family: "general", host: "www.godigit.com" },
  { symbol: "STARHEALTH", family: "general", host: "www.starhealth.in" },
  { symbol: "NIACL", family: "general", host: "www.newindia.co.in" },
  { symbol: "ICICIGI", family: "general", host: "www.icicilombard.com" },
  { symbol: "GICRE", family: "general", host: "www.gicre.in" },
  { symbol: "NIVABUPA", family: "general", host: "www.nivabupa.com" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Does robots.txt forbid `path` for a generic agent? Conservative: any doubt ⇒ treat as blocked. */
function verdict(robots: string, path: string): { blocked: boolean; why: string } {
  // Collect the rules that apply to us: the "*" group (we are not a named bot).
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  let inStar = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const l of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { inStar = v === "*"; continue; }
    if (!inStar) continue;
    if (k === "disallow" && v) disallow.push(v);
    if (k === "allow" && v) allow.push(v);
    if (k === "disallow" && v === "") allow.push("/"); // explicit "allow everything"
  }
  // Longest-match wins, per the de-facto standard.
  const match = (rules: string[]): number =>
    rules.filter((r) => path.startsWith(r)).reduce((best, r) => Math.max(best, r.length), -1);
  const d = match(disallow), a = match(allow);
  if (d === -1) return { blocked: false, why: "no matching Disallow" };
  if (a >= d) return { blocked: false, why: `Allow(${a}) >= Disallow(${d})` };
  return { blocked: true, why: `Disallow rule of length ${d} matches` };
}

async function main(): Promise<void> {
  console.log(`\n=== STAGE 7b — robots.txt pre-flight (${HOSTS.length} hosts) ===\n`);
  const out: Record<string, unknown>[] = [];
  for (const h of HOSTS) {
    const url = `https://${h.host}/robots.txt`;
    let status = 0, body = "", err: string | null = null;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25_000);
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal, redirect: "follow" });
      clearTimeout(t);
      status = res.status;
      body = await res.text();
    } catch (e) {
      err = (e as Error).message;
    }
    // A missing robots.txt means "no restrictions stated"; a blanket Disallow: / means stop.
    const blanket = /^\s*disallow\s*:\s*\/\s*$/im.test(body) && /user-agent\s*:\s*\*/i.test(body);
    const v = body ? verdict(body, "/") : { blocked: false, why: "no robots.txt served" };
    const crawlDelay = /crawl-delay\s*:\s*(\d+)/i.exec(body)?.[1] ?? null;
    const state = err ? `ERROR ${err.slice(0, 40)}`
      : status >= 400 ? `HTTP ${status} — no robots served, treat as unrestricted`
      : blanket ? "⛔ BLANKET Disallow: /  — DO NOT CRAWL"
      : v.blocked ? `⛔ root blocked (${v.why})`
      : `OK to crawl${crawlDelay ? ` · crawl-delay ${crawlDelay}s` : ""}`;
    console.log(`  ${h.symbol.padEnd(12)} ${h.family.padEnd(8)} ${h.host.padEnd(26)} ${state}`);
    out.push({ ...h, url, status, blanket, blocked: blanket || v.blocked, crawlDelay, why: v.why, error: err,
      robotsBytes: body.length });
    await sleep(2000);
  }
  const blocked = out.filter((o) => o.blocked);
  console.log(`\n  crawlable: ${out.length - blocked.length}/${out.length}`);
  if (blocked.length) console.log(`  ⛔ blocked: ${blocked.map((o) => o.symbol).join(", ")} — these are OUT of the crawler`);
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), hosts: out }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
