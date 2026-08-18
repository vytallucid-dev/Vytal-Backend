// ═══════════════════════════════════════════════════════════════
// F0 — THE SCHEDULER HOLD. What can actually be held, and the exact clear window.
//   npx tsx src/scripts/_f0-hold.ts
// READ-ONLY.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { scheduledJobRegistry } from "../lib/scheduler.js";
import { parseCron, matchesCron } from "../lib/cron-expr.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n); const lp=(s:any,n:number)=>String(s).padStart(n);

// Job types that can WRITE the tables this stage touches.
const WRITERS = new Set(["results_scan","filing_recompute","filing_rolling_daily","shareholding_smart_refresh","peer_metrics_refresh"]);

const [t] = await raw(`SELECT now()::text n`);
const now = new Date(t.n.replace(" ","T").replace("+00","Z"));
console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ F0 — SCHEDULER HOLD                                                       ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  db now (UTC) : ${now.toISOString()}`);

const reg = scheduledJobRegistry();
console.log(`  registered scheduled jobs: ${reg.length}\n`);
console.log(`  ${pad("job",34)}${pad("schedule",22)}${pad("jobType",30)}next firing (UTC)      in`);
const rows:any[]=[];
for (const j of reg as any[]) {
  let f; try { f = parseCron(j.schedule); } catch { console.log(`  ${pad(j.name,34)}${pad(j.schedule,22)}(unparseable)`); continue; }
  let next: Date | null = null;
  for (let m=1;m<=60*24*8;m++){ const d=new Date(now.getTime()+m*60000); d.setUTCSeconds(0,0); if (matchesCron(f,d)){ next=d; break; } }
  const mins = next ? Math.round((next.getTime()-now.getTime())/60000) : null;
  const w = j.jobType && WRITERS.has(String(j.jobType));
  rows.push({name:j.name, sched:j.schedule, type:j.jobType, next, mins, w});
}
rows.sort((a,b)=>(a.mins??1e9)-(b.mins??1e9));
for (const r of rows) console.log(`  ${r.w?"⚠ ":"  "}${pad(r.name,32)}${pad(r.sched,22)}${pad(r.type ?? "(inline)",30)}${pad(r.next?r.next.toISOString().slice(0,16).replace("T"," "):"-",23)}${r.mins!=null?`${Math.floor(r.mins/60)}h${String(r.mins%60).padStart(2,"0")}m`:""}`);

const writers = rows.filter(r=>r.w);
console.log(`\n  ── crons that can WRITE the result tables this stage touches ──`);
for (const r of writers) console.log(`  ${pad(r.name,32)}${pad(r.sched,22)}next ${r.next.toISOString().slice(0,16).replace("T"," ")} UTC  (in ${Math.floor(r.mins/60)}h${String(r.mins%60).padStart(2,"0")}m)`);
const soonest = writers.reduce((a:any,b:any)=>a===null||b.mins<a.mins?b:a, null as any);
console.log(`\n  ⇒ CLEAR WINDOW before the next table-writing cron: ${Math.floor(soonest.mins/60)}h${String(soonest.mins%60).padStart(2,"0")}m  (until ${soonest.next.toISOString().slice(0,16).replace("T"," ")} UTC, "${soonest.name}")`);

// anything active right now?
const act = await raw(`SELECT "type","status",count(*)::int n, max("started_at")::text s FROM background_jobs
  WHERE "status" IN ('pending','running') GROUP BY 1,2 ORDER BY 1`);
console.log(`\n  ── background_jobs currently pending/running ──`);
if (!act.length) console.log(`  (none) ✓ nothing in flight`);
for (const a of act) console.log(`  ${pad(a.type,34)}${pad(a.status,10)}${lp(a.n,4)}   started ${String(a.s??"-").slice(0,19)}`);
await prisma.$disconnect();
