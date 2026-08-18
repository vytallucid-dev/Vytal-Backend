import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n);
const SYMS=["ABBOTINDIA","BAYERCROP","MCX"];
console.log(`\n── MCX's peer-group membership ──`);
const pg = await raw(`SELECT s."symbol" sym, g."peer_group_id" pgid, p."name" pgname, p."id" pid,
    (SELECT count(*)::int FROM stock_peer_groups x WHERE x."peer_group_id"=g."peer_group_id") members,
    (SELECT count(*)::int FROM score_snapshots x JOIN stock_peer_groups y ON y."stock_id"=x."stock_id"
       WHERE y."peer_group_id"=g."peer_group_id") scored
  FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
  LEFT JOIN peer_groups p ON p."id"=g."peer_group_id" WHERE s."symbol"=ANY($1::text[])`, SYMS);
for (const r of pg) console.log(`  ${pad(r.sym,12)}pg=${pad(r.pgname ?? r.pgid,28)} members=${r.members}  members-with-snapshots=${r.scored}`);
console.log(`\n── the findings these three hold ──`);
const f = await raw(`SELECT s."symbol" sym, f."finding_key" k, f."evaluation_state" st, count(*)::int n, max(f."updated_at")::text upd
  FROM stock_findings f JOIN stocks s ON s."id"=f."stock_id" WHERE s."symbol"=ANY($1::text[])
  GROUP BY 1,2,3 ORDER BY 1,2`, SYMS).catch(async()=>{
  const cols=await raw(`SELECT column_name c FROM information_schema.columns WHERE table_name='stock_findings' ORDER BY ordinal_position`);
  console.log(`  stock_findings columns: ${cols.map((x:any)=>x.c).join(", ")}`); return [];});
for (const r of f) console.log(`  ${pad(r.sym,12)}${pad(r.k,34)}${pad(r.st,16)}n=${r.n}  updated ${String(r.upd).slice(0,19)}`);
console.log(`\n── does any PG the three sit in currently produce scores? ──`);
const sc = await raw(`SELECT count(*)::int n FROM score_snapshots`); console.log(`  score_snapshots total in DB: ${sc[0].n}`);
await prisma.$disconnect();
