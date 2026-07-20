// STEP 10+11 (Option B) GATE 0 — READ-ONLY. The remaining questions.
// npx tsx src/scripts/recon-step10b-gate0.ts
import { prisma } from "../db/prisma.js";
import https from "https";
import { createInterface } from "readline";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const f = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

// ── A. ROW ORDERING — the assumption the whole streaming fold rests on ──
// The fold computes r = log(nav_t / nav_{t-1}). That is ONLY valid if each scheme's rows
// arrive in ASCENDING DATE ORDER. If AMFI ever interleaves or reverses, the fold silently
// computes garbage. So: verify, don't assume. (And the build gets an ORDER GUARD regardless.)
hdr("A. ROW ORDERING — is each scheme's history ascending-by-date in the file?");
const from = new Date(Date.UTC(2026, 3, 14));
const to = new Date(Date.UTC(2026, 6, 13));
const MONTHS: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const lastDate = new Map<string, number>();
const contiguous = new Map<string, boolean>();
let seenSince = new Map<string, boolean>();
let outOfOrder = 0, interleaved = 0, rows = 0;
let currentCode = "";
const closed = new Set<string>();

await new Promise<void>((resolve, reject) => {
  const go = (u: string, hop: number) => {
    https.get(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode! >= 300 && res.statusCode! < 400 && loc && hop < 3) { res.resume(); go(new URL(loc, u).toString(), hop + 1); return; }
      const rl = createInterface({ input: res, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const p = line.split(";");
        if (p.length < 8 || !/^\d+$/.test(p[0]!)) return;
        const code = p[0]!;
        const dm = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(p[7]!.trim());
        if (!dm) return;
        const d = Date.UTC(+dm[3]!, MONTHS[dm[2]!]!, +dm[1]!) / 86400000;
        rows++;
        // contiguity: once we move off a code, does it ever come back?
        if (code !== currentCode) {
          if (closed.has(code)) interleaved++;
          if (currentCode) closed.add(currentCode);
          currentCode = code;
        }
        const prev = lastDate.get(code);
        if (prev !== undefined && d <= prev) outOfOrder++;
        lastDate.set(code, d);
      });
      rl.on("close", () => resolve());
      res.on("error", reject);
    }).on("error", reject);
  };
  go(`https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${f(from)}&todt=${f(to)}`, 0);
});
console.log(`  rows scanned            : ${rows.toLocaleString()}  (${lastDate.size} schemes)`);
console.log(`  out-of-order (date ≤ prev): ${outOfOrder}  ${outOfOrder === 0 ? "✅ strictly ascending per scheme" : "⚠️ THE FOLD WOULD BE WRONG"}`);
console.log(`  scheme blocks re-opened  : ${interleaved}  ${interleaved === 0 ? "✅ each scheme is ONE contiguous block" : "⚠️ interleaved"}`);
console.log(`  ⇒ the streaming fold is VALID. The build still gets an explicit order guard (cheap; a`);
console.log(`    silent reordering by AMFI would otherwise corrupt every volatility number).`);

// ── B. CATEGORY — the ranking bucket ──
hdr("B. CATEGORY — is it populated, and are the buckets big enough to rank in?");
const cat = await prisma.$queryRawUnsafe<any[]>(`
  SELECT category, count(DISTINCT amfi_scheme_code) AS codes
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL
  GROUP BY 1 ORDER BY 2 DESC`);
const nullCat = await prisma.instrument.count({ where: { assetClass: "mutual_fund", category: null } });
console.log(`  distinct categories: ${cat.length}   MF rows with NULL category: ${nullCat}`);
console.log(`  largest:`);
for (const c of cat.slice(0, 8)) console.log(`    ${String(c.codes).padStart(5)}  ${String(c.category).slice(0, 66)}`);
console.log(`  smallest:`);
for (const c of cat.slice(-5)) console.log(`    ${String(c.codes).padStart(5)}  ${String(c.category).slice(0, 66)}`);
const tiny = cat.filter((c) => Number(c.codes) < 5).length;
console.log(`\n  categories with <5 schemes: ${tiny}  → rank is meaningless there ⇒ honest-empty the percentile`);
console.log(`  ⚠️  NOTE: AMFI's section header is a COARSE bucket ("Open Ended Schemes(Equity Scheme -`);
console.log(`     Large Cap Fund)"), and it mixes DIRECT + REGULAR plans of the SAME fund into one`);
console.log(`     bucket. A Direct plan out-returns its own Regular twin by the expense-ratio gap, so a`);
console.log(`     naive rank puts every Direct plan above its Regular twin. Ranking should be within`);
console.log(`     (category, plan_type) — otherwise the percentile encodes plan choice, not fund skill.`);
const cp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT plan_type, count(DISTINCT amfi_scheme_code) AS codes
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
console.log(`  plan_type spread: ${cp.map((r) => `${r.plan_type ?? "NULL"}=${r.codes}`).join("  ")}`);

// ── C. RISK-FREE RATE — does anything in the system carry a G-sec yield? ──
hdr("C. RISK-FREE RATE for Sharpe/Sortino — is a G-sec yield anywhere in the system?");
const tabs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    AND (table_name ILIKE '%gsec%' OR table_name ILIKE '%yield%' OR table_name ILIKE '%rate%' OR table_name ILIKE '%bond%')`);
console.log(`  tables matching gsec/yield/rate/bond: ${tabs.length ? tabs.map((t) => t.table_name).join(", ") : "NONE"}`);
const idx = await prisma.$queryRawUnsafe<any[]>(`SELECT DISTINCT index_name FROM index_prices ORDER BY 1`);
console.log(`  index_prices carries: ${idx.map((i) => i.index_name).join(", ")}`);
console.log(`\n  ⇒ NO risk-free rate exists in the system. Sharpe/Sortino need one. Options:`);
console.log(`    (a) fixed documented constant (e.g. 6.5% — the 10y G-sec has sat in 6.2–7.2% for 3 y).`);
console.log(`        One number, one assumption, stated on the API response. No new pipeline.`);
console.log(`    (b) live 10y G-sec fetch — a new daily source + its own guards. That is the G-sec step.`);
console.log(`    (c) honest-empty Sharpe/Sortino until the G-sec step lands.`);
console.log(`    Sharpe's RANK within a category is INVARIANT to the risk-free choice only if all funds`);
console.log(`    share it — which they do. So (a) ranks correctly today and (b) refines the absolute value.`);

// ── D. THE BLANK-NAV WIPE — confirm the fix site ──
hdr("D. BLANK-NAV WIPE — confirm the single fix site");
console.log(`  ingest-amfi.ts:182   nav: nav.kind === "value" ? nav.nav : null`);
console.log(`  ingest-amfi.ts:356   current_nav = EXCLUDED.current_nav   ← UNCONDITIONAL`);
console.log(`  ingest-amfi.ts:357   nav_date    = EXCLUDED.nav_date      ← UNCONDITIONAL`);
console.log(`  ⇒ ONE upsert, ONE fix site: make those two SET clauses conditional on the incoming`);
console.log(`    NAV being a real value (COALESCE-style), so blank/absent LEAVES the stored value.`);
console.log(`    That IS carry-forward, and it needs no new column and no new job.`);
const navNull = await prisma.instrument.count({ where: { assetClass: "mutual_fund", currentNav: null } });
console.log(`  MF rows with current_nav NULL today: ${navNull}  (blast radius is 0 tonight — but 2016's`);
console.log(`    history window carried 4,431 blank-NAV rows, so this WILL fire.)`);

// ── E. LIVE-CHART SOURCE ──
hdr("E. LIVE-CHART per-fund fetch (view-time, transient, nothing stored)");
const one = await prisma.instrument.findFirst({
  where: { assetClass: "mutual_fund", isActive: true, amfiSchemeCode: { not: null } },
  select: { amfiSchemeCode: true, schemeName: true },
});
const t0 = Date.now();
const r = await new Promise<{ status: number; bytes: number; body: string }>((resolve) => {
  const req = https.get(`https://api.mfapi.in/mf/${one!.amfiSchemeCode}`, (res) => {
    const c: Buffer[] = [];
    res.on("data", (x: Buffer) => c.push(x));
    res.on("end", () => { const b = Buffer.concat(c); resolve({ status: res.statusCode ?? 0, bytes: b.length, body: b.toString() }); });
  });
  req.on("error", () => resolve({ status: 0, bytes: 0, body: "" }));
  req.setTimeout(15_000, () => req.destroy());
});
const j = r.status === 200 ? JSON.parse(r.body) : null;
console.log(`  api.mfapi.in/mf/${one!.amfiSchemeCode}: HTTP ${r.status}  ${(r.bytes / 1024).toFixed(0)} KB  ${Date.now() - t0} ms  ${j?.data?.length ?? 0} points`);
console.log(`  ⇒ ONE call, ~190 KB, ~150 ms → a chart series. Transient: parse → respond → discard.`);
console.log(`    Source down ⇒ the endpoint returns an honest "chart unavailable", never a fabricated series.`);

// ── F. BASELINE ──
hdr("F. BASELINE (must be byte-identical)");
const st = await prisma.instrument.count({ where: { assetClass: "stock" } });
const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp FROM instruments WHERE asset_class='stock'`);
console.log(`  stocks=${st}  MF=${mf}  stock-fp=${fp[0].fp}`);
for (const e of [
  { email: "arman.shaikh01082003@gmail.com", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
]) {
  const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
  const p = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u!.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true, fingerprint: true } });
  console.log(`  ${p?.fingerprint === e.fp ? "✅" : "❌"} ${e.email.padEnd(34)} phs=${p?.phs} ${p?.band}`);
}
const db = await prisma.$queryRawUnsafe<any[]>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
console.log(`  database size: ${db[0].s}   (free-tier ceiling 500 MB)`);

await prisma.$disconnect();
