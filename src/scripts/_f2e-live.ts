// F2e — RE-RUN THE EXHAUSTIVE PROOF AGAINST THE ACTUAL SHIPPED FUNCTION. READ-ONLY.
// The harness in _f2d-proof.ts re-implemented the guard to compare candidates. This
// runs the REAL deriveFiscalPeriod as now edited, over the same 29,535 stored rows,
// so the proof is of the code that would ship rather than of a model of it.
import "dotenv/config"; import { readFileSync } from "node:fs";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";
const pad=(s:any,n:number)=>String(s).padEnd(n); const lp=(s:any,n:number)=>String(s).padStart(n);
const D=(s:string)=>new Date(`${s}T00:00:00Z`);
const MN=["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const all = readFileSync("_f2-corpus.jsonl","utf-8").split("\n").filter(l=>l.trim()).map(l=>JSON.parse(l));
const truth=(pe:Date)=>{const m=pe.getUTCMonth()+1,y=pe.getUTCFullYear();const q=m<=3?4:m<=6?1:m<=9?2:3;return `FY${String(m<=3?y:y+1).slice(-2)}Q${q}`;};

let n=0, same=0; const changed:any[]=[];
const byFem=new Map<number,[number,number]>(); const byYear=new Map<number,[number,number]>(); const byLen=new Map<number,[number,number]>();
for (const c of all) {
  if (c.err || !c.fys || !c.fye) continue;
  const fs=D(c.fys), fe=D(c.fye);
  const lenM=(fe.getUTCFullYear()-fs.getUTCFullYear())*12+(fe.getUTCMonth()-fs.getUTCMonth())+1;
  for (const r of c.rows) {
    const ft = r.q==="Y" ? "annual" : "quarterly";
    const peStr = ft==="quarterly" ? c.re1 : (c.re4 ?? c.re1);
    if (!peStr) continue;
    const pe=D(peStr);
    // BEFORE: the shipped S4.3 arithmetic, inline (no window guard).
    const fem=fe.getUTCMonth()+1, fey=fe.getUTCFullYear(); const fyLabel=`FY${String(fey).slice(-2)}`;
    let before:string;
    if (ft==="annual") before=`${fyLabel}Y`;
    else { const fsm=(fem%12)+1, fsy=fem===12?fey:fey-1;
      const mfs=(pe.getUTCFullYear()-fsy)*12+((pe.getUTCMonth()+1)-fsm);
      before = (mfs<0||mfs>11||(mfs+1)%3!==0) ? "REFUSE" : `${fyLabel}Q${Math.floor(mfs/3)+1}`; }
    // AFTER: the real function as edited.
    let after:string; try { const d=deriveFiscalPeriod(pe,fs,fe,ft as any); after=`${d.fiscalYear}${d.quarter}`; } catch { after="REFUSE"; }
    n++; const eq = before===after; if (eq) same++; else changed.push({sym:c.sym,stored:`${r.fy}${r.q}`,before,after,truth:ft==="quarterly"?truth(pe):null,win:`${c.fys}..${c.fye}`,lenM,tbl:r.tbl,rt:r.rt});
    for (const [m,k] of [[byFem,fem],[byYear,pe.getUTCFullYear()],[byLen,lenM]] as any) {
      const e=(m as Map<number,[number,number]>).get(k)??[0,0]; e[0]++; if(eq)e[1]++; (m as Map<number,[number,number]>).set(k,e); }
  }
}
console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ F2e — EXHAUSTIVE PROOF AGAINST THE SHIPPED FUNCTION (not a model of it)    ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  stored rows re-derived        : ${n}`);
console.log(`  byte-identical to before      : ${same}   (${(same/n*100).toFixed(4)}%)`);
console.log(`  changed                       : ${changed.length}`);
console.log(`\n  ── every row that changes ──`);
console.log(`  ${pad("symbol",13)}${pad("stored",9)}${pad("before",9)}${pad("after",9)}${pad("truth",9)}${lp("len",5)}  ${pad("declared window",25)}${pad("table",22)}basis`);
for (const c of changed) console.log(`  ${pad(c.sym,13)}${pad(c.stored,9)}${pad(c.before,9)}${pad(c.after,9)}${pad(c.truth??"-",9)}${lp(c.lenM,5)}  ${pad(c.win,25)}${pad(c.tbl,22)}${c.rt}`);
console.log(`\n  ── ZERO-MISMATCH PROOF, by declared fiscal-year-END month ──`);
console.log(`  ${lp("fyEnd month",13)}${lp("rows",9)}${lp("identical",11)}   verdict`);
for (const [m,[t,s]] of [...byFem].sort((a,b)=>a[0]-b[0])) console.log(`  ${lp(`${MN[m]} (${m})`,13)}${lp(t,9)}${lp(s,11)}   ${t===s?"✓ ZERO MISMATCHES":`${t-s} changed (intended)`}`);
console.log(`\n  ── by reporting year (full range) ──`);
for (const [y,[t,s]] of [...byYear].sort((a,b)=>a[0]-b[0])) console.log(`  ${lp(y,8)}${lp(t,9)}${lp(s,11)}   ${t===s?"✓":`${t-s} changed`}`);
console.log(`\n  ── by declared-window length ──`);
for (const [l,[t,s]] of [...byLen].sort((a,b)=>a[0]-b[0])) console.log(`  ${lp(l+"m",8)}${lp(t,9)}${lp(s,11)}   ${t===s?"✓":`${t-s} changed`}`);
console.log();
