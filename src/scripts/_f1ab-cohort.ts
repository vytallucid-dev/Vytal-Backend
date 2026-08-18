// F1a/F1b — RE-DERIVE THE C1 COHORT AND SCREEN IT. READ-ONLY.
import "dotenv/config"; import { readFileSync, writeFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n); const lp=(s:any,n:number)=>String(s).padStart(n);
const rc = JSON.parse(readFileSync("_s4d-recount.json","utf-8"));
const c1a = JSON.parse(readFileSync("_c1a-candidates.json","utf-8"));
const C1: any[] = rc.c1;
const relabelCands = new Set<string>(c1a.candidates.map((c:any)=>c.sym));

console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ F1a/F1b — the C1 cohort, re-derived now, and screened against C1a          ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  F1a · C1 cohort measured NOW              : ${C1.length}`);
console.log(`       the figure carried into this stage   : 37`);
console.log(`       ⇒ ${C1.length===37?"unchanged":`DIFFERENT — ${C1.length}, not 37 (${C1.length>37?"+":""}${C1.length-37})`}`);
console.log(`  C1a relabel candidates (all 442)          : ${relabelCands.size}  [${[...relabelCands].join(", ")}]`);

const excluded = C1.filter(c=>relabelCands.has(c.sym));
const clean = C1.filter(c=>!relabelCands.has(c.sym));
console.log(`\n  F1b · C1 ∩ C1a  → EXCLUDED                 : ${excluded.length}${excluded.length?`  [${excluded.map(e=>e.sym).join(", ")}]`:"  (none)"}`);
console.log(`       C1 cleared to run                    : ${clean.length}`);

// what each excluded stock would relabel, and why it is the T3 shape
if (excluded.length) {
  console.log(`\n  ── why each is excluded ──`);
  for (const e of excluded) {
    const c:any = c1a.candidates.find((x:any)=>x.sym===e.sym);
    console.log(`  ${pad(e.sym,13)}odd rows=${lp(c.oddRows,3)}/${lp(c.rows,3)}   missing=${e.missing.length}   ${c.samples[0]}`);
  }
}

// the run plan: rows to recover, per stock
console.log(`\n  ── the ${clean.length} stocks cleared, and what each is missing ──`);
console.log(`  ${pad("symbol",14)}${pad("first filing",14)}${lp("missing",8)}${lp("recov",7)}   the missing quarters`);
let totalRows=0;
for (const c of clean.sort((a,b)=>b.missing.length-a.missing.length||a.sym.localeCompare(b.sym))) {
  totalRows += c.missing.length;
  console.log(`  ${pad(c.sym,14)}${pad(c.first,14)}${lp(c.missing.length,8)}${lp(c.recoverable,7)}   ${c.missing.join(" ")}`);
}
console.log(`\n  standalone rows to recover in total : ${totalRows}`);
const CH=10; console.log(`  chunk plan @${CH}/chunk           : ${Math.ceil(clean.length/CH)} chunk(s)`);

// cross-check against the industry split (banking uses a different table)
const ind = await raw(`SELECT "symbol" sym, "industryType"::text ind FROM stocks WHERE "symbol"=ANY($1::text[])`, clean.map(c=>c.sym));
const byInd = new Map<string,number>(); for (const r of ind) byInd.set(r.ind,(byInd.get(r.ind)??0)+1);
console.log(`  industry split                     : ${[...byInd].map(([k,v])=>`${k}=${v}`).join("  ")}`);
writeFileSync("_f1ab-cohort.json", JSON.stringify({ c1Count: C1.length, excluded, clean, totalRows }, null, 1));
console.log(`\n  → ./_f1ab-cohort.json\n`);
await prisma.$disconnect();
