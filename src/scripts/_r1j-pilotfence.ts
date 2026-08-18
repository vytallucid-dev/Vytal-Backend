// ═══════════════════════════════════════════════════════════════
// R1j — WHAT THE PILOT ACTUALLY PROVED ABOUT THE FENCE. READ-ONLY, no DB.
//   npx tsx src/scripts/_r1j-pilotfence.ts <pilotDir>
// Diffs the T4 before/after snapshots on their v3-era rows ONLY. SIEMENS is in
// that cohort and is the single worst key-monotonicity case in the universe, so
// if its v3 rows are byte-identical across a real legacy run at toDate=2025-01-31,
// the fence held on the hardest input we have.
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";

const DIR = process.argv[2];
if (!DIR) { console.error("usage: _r1j-pilotfence.ts <dir containing _t4-before.json/_t4-after.json>"); process.exit(1); }
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const V3 = "2025-03-31";

const load = (f: string) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
const before = load("_t4-before.json"), after = load("_t4-after.json");

interface Row { k: string; src: string; ua: string; rd: string }
function v3rows(snap: any): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const [sym, per] of Object.entries<any>(snap.stocks)) {
    for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
      for (const r of (per[t]?.rows ?? []) as any[]) {
        const rd = String(r.report_date ?? "").slice(0, 10);
        if (rd < V3) continue;
        const k = `${sym}|${t}|${r.fiscal_year}${r.quarter ?? ""}|${r.result_type}`;
        out.set(k, { k, src: String(r.source), ua: String(r.updated_at), rd });
      }
    }
  }
  return out;
}

const b = v3rows(before), a = v3rows(after);
console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ R1j — THE PILOT'S OWN FENCE RESULT (27 stocks, real run, toDate=2025-01-31)║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  before captured ${before.capturedAt} · after captured ${after.capturedAt}`);
console.log(`  v3-era rows (report_date >= ${V3}) — before ${b.size} · after ${a.size}`);

const moved: string[] = [], vanished: string[] = [], appeared: string[] = [];
for (const [k, bv] of b) {
  const av = a.get(k);
  if (!av) { vanished.push(k); continue; }
  if (av.src !== bv.src || av.ua !== bv.ua) moved.push(`${k}  src ${bv.src}→${av.src}  ua ${bv.ua}→${av.ua}`);
}
for (const k of a.keys()) if (!b.has(k)) appeared.push(k);

console.log(`\n  rows whose source or updated_at MOVED : ${moved.length === 0 ? "✓ 0" : "⚠ " + moved.length}`);
for (const m of moved.slice(0, 20)) console.log(`    ⚠ ${m}`);
console.log(`  rows that VANISHED                    : ${vanished.length === 0 ? "✓ 0" : "⚠ " + vanished.length}`);
for (const v of vanished.slice(0, 20)) console.log(`    ⚠ ${v}`);
console.log(`  rows that APPEARED above the fence    : ${appeared.length === 0 ? "✓ 0" : "⚠ " + appeared.length}`);
for (const v of appeared.slice(0, 20)) console.log(`    ⚠ ${v}`);

// SIEMENS specifically — the worst key-monotonicity case in the universe
console.log(`\n  ── SIEMENS, the worst case, in detail ──`);
const sB = [...b.values()].filter((r) => r.k.startsWith("SIEMENS|"));
const sA = [...a.values()].filter((r) => r.k.startsWith("SIEMENS|"));
console.log(`     v3-era rows before ${sB.length} · after ${sA.length}`);
for (const r of sB.sort((x, y) => x.k.localeCompare(y.k))) {
  const av = a.get(r.k);
  const same = av && av.src === r.src && av.ua === r.ua;
  console.log(`     ${same ? "✓" : "⚠"} ${pad(r.k.replace("SIEMENS|", ""), 44)} rd ${r.rd}  ua ${r.ua}`);
}

// And what the pilot DID write for SIEMENS below the fence — the key set it produced
console.log(`\n  ── the KEYS the pilot wrote for SIEMENS below the fence (quarterly) ──`);
const qb = (before.stocks.SIEMENS?.quarterly_results?.rows ?? []) as any[];
const qa = (after.stocks.SIEMENS?.quarterly_results?.rows ?? []) as any[];
const kb = new Set(qb.filter((r) => String(r.report_date).slice(0, 10) < V3).map((r) => `${r.fiscal_year}${r.quarter}|${r.result_type}`));
const ka = new Set(qa.filter((r) => String(r.report_date).slice(0, 10) < V3).map((r) => `${r.fiscal_year}${r.quarter}|${r.result_type}`));
console.log(`     legacy-era keys before ${kb.size} · after ${ka.size}`);
const added = [...ka].filter((k) => !kb.has(k));
console.log(`     keys ADDED by the pilot: ${added.length}`);
for (let i = 0; i < added.length; i += 5) console.log(`       ${added.slice(i, i + 5).map((x) => pad(x, 24)).join("")}`);
const dropped = [...kb].filter((k) => !ka.has(k));
console.log(`     keys DROPPED: ${dropped.length === 0 ? "✓ none" : "⚠ " + dropped.join(", ")}`);
console.log();
