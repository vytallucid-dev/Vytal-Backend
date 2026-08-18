// ═══════════════════════════════════════════════════════════════
// C1e — DID THE COMPLETED 442 RUN CAUSE BREACHES NOBODY SAW?
// READ-ONLY. Pure file-vs-file; no DB, no NSE.
//   npx tsx src/scripts/_c1e-audit.ts <stage3bDir> <stage4bDir>
//
// The Stage 3b baseline was captured 11:19, BEFORE the 442 run.
// The Stage 4b baseline was captured 18:41, AFTER it and BEFORE T1/T3.
// Every row is keyed by ID in both, so comparing them isolates exactly what the
// completed run (plus concurrent crons) did to v3-era rows.
//
// ⚠ THE ID-KEYED TEST IS THE FENCE. The DB-wide "no *_legacy at/after the floor"
//   check cannot see an overwrite that drags report_date BELOW the floor — the row
//   leaves the fenced era rather than staying in it with a bad source. That is how
//   SIEMENS slipped past it in T3, and it is why this audit is by ID.
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";

const A = process.argv[2], B = process.argv[3];
if (!A || !B) { console.error("usage: _c1e-audit.ts <stage3bDir> <stage4bDir>"); process.exit(1); }
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

const load = (d: string) => {
  const j = JSON.parse(readFileSync(`${d}/_r1d-v3-before.json`, "utf8"));
  return { capturedAt: j.capturedAt, floor: j.v3Floor, rows: j.rows as any[] };
};
const before = load(A), after = load(B);

console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ C1e — did the COMPLETED 442 run breach the fence unnoticed?                ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  baseline A (pre-442 run) : ${before.capturedAt}  ${before.rows.length} v3 rows`);
console.log(`  baseline B (post-run)    : ${after.capturedAt}  ${after.rows.length} v3 rows`);
console.log(`  v3 floor                 : ${before.floor}`);

const bMap = new Map(after.rows.map((r) => [r.id, r]));

const vanished: any[] = [], srcMoved: any[] = [], rdMoved: any[] = [], uaMoved: any[] = [];
for (const a of before.rows) {
  const b = bMap.get(a.id);
  if (!b) { vanished.push(a); continue; }
  if (String(a.src) !== String(b.src)) srcMoved.push({ a, b });
  if (String(a.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) rdMoved.push({ a, b });
  if (String(a.ua) !== String(b.ua)) uaMoved.push({ a, b });
}
// rows that appeared in B but were not in A
const aIds = new Set(before.rows.map((r) => r.id));
const appeared = after.rows.filter((r) => !aIds.has(r.id));

console.log(`\n  ── DISQUALIFYING SIGNALS ──`);
console.log(`  rows VANISHED from the baseline set : ${vanished.length === 0 ? "✓ 0" : "⚠ " + vanished.length}`);
for (const v of vanished.slice(0, 20)) console.log(`      ⚠ ${v.sym} ${v.t} ${v.period} ${v.basis} (was ${String(v.rd).slice(0, 10)}, ${v.src})`);
console.log(`  rows whose SOURCE changed           : ${srcMoved.length === 0 ? "✓ 0" : "⚠ " + srcMoved.length}`);
for (const m of srcMoved.slice(0, 20)) console.log(`      ⚠ ${m.a.sym} ${m.a.t} ${m.a.period} ${m.a.basis}: ${m.a.src} → ${m.b.src}`);
console.log(`  rows whose REPORT_DATE moved        : ${rdMoved.length === 0 ? "✓ 0" : "⚠ " + rdMoved.length}`);
for (const m of rdMoved.slice(0, 20)) console.log(`      ⚠ ${m.a.sym} ${m.a.t} ${m.a.period} ${m.a.basis}: ${String(m.a.rd).slice(0, 10)} → ${String(m.b.rd).slice(0, 10)}`);
console.log(`  rows that APPEARED above the floor   : ${appeared.length === 0 ? "✓ 0" : appeared.length + " (new v3 rows — expected from the pipeline)"}`);

console.log(`\n  ── OBSERVED, not disqualifying ──`);
console.log(`  updated_at moved, v3 source intact  : ${uaMoved.length}`);
const byDay = new Map<string, number>();
for (const m of uaMoved) byDay.set(String(m.b.ua).slice(0, 13), (byDay.get(String(m.b.ua).slice(0, 13)) ?? 0) + 1);
for (const [k, v] of [...byDay.entries()].sort()) console.log(`      ${k}:00  ${lp(v, 5)} row(s)`);

const disq = vanished.length + srcMoved.length + rdMoved.length;
console.log(`\n  ══ VERDICT ══`);
console.log(`  ${disq === 0
  ? "✓✓ THE COMPLETED 442 RUN CAUSED NO FENCE BREACH.\n     Not one v3 row changed source, moved report_date or vanished across the run.\n     The updated_at movement is the production pipeline, as attributed at the time."
  : `✗✗ ${disq} DISQUALIFYING CHANGE(S) — the completed run DID breach the fence.`}`);
console.log();
