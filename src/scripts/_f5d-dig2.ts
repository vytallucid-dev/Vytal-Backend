import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n);
const SYMS=["ABBOTINDIA","BAYERCROP","MCX"];
const f = await raw(`SELECT s."symbol" sym, f."rule_key" k, f."evaluation_state" st, f."not_evaluable_reason" why,
    f."display_state" ds, f."period_key" pk, max(f."updated_at")::text upd, count(*)::int n
  FROM stock_findings f JOIN stocks s ON s."id"=f."stock_id" WHERE s."symbol"=ANY($1::text[])
  GROUP BY 1,2,3,4,5,6 ORDER BY 1,2`, SYMS);
console.log(`\n── the findings these three hold (${f.length} rows) ──`);
console.log(`  ${pad("sym",12)}${pad("rule_key",22)}${pad("state",16)}${pad("display",12)}${pad("period",9)}reason`);
for (const r of f) console.log(`  ${pad(r.sym,12)}${pad(r.k,22)}${pad(r.st,16)}${pad(r.ds ?? "-",12)}${pad(r.pk ?? "-",9)}${String(r.why ?? "-").slice(0,40)}`);
const st = await raw(`SELECT f."evaluation_state" st, count(*)::int n FROM stock_findings f JOIN stocks s ON s."id"=f."stock_id"
  WHERE s."symbol"=ANY($1::text[]) GROUP BY 1`, SYMS);
console.log(`\n  by state: ${st.map((r:any)=>`${r.st}=${r.n}`).join("  ")}`);
console.log(`\n── the 6 members of MCX's peer group, and whether any is scored ──`);
const m = await raw(`SELECT s."symbol" sym, s."is_active" act,
   (SELECT count(*)::int FROM score_snapshots x WHERE x."stock_id"=s."id") snap,
   (SELECT count(*)::int FROM quarterly_results q WHERE q."stock_id"=s."id") q
  FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
  WHERE g."peer_group_id"=(SELECT g2."peer_group_id" FROM stock_peer_groups g2 JOIN stocks s2 ON s2."id"=g2."stock_id" WHERE s2."symbol"='MCX' LIMIT 1)
  ORDER BY s."symbol"`);
for (const r of m) console.log(`  ${pad(r.sym,13)}active=${pad(r.act,7)}score_snapshots=${pad(r.snap,5)}quarterly_rows=${r.q}`);
console.log(`\n── is that PG in the SCORED registry? ──`);
const pgs = await raw(`SELECT p."id", p."name", p."is_active" act FROM peer_groups p
  WHERE p."id"=(SELECT g2."peer_group_id" FROM stock_peer_groups g2 JOIN stocks s2 ON s2."id"=g2."stock_id" WHERE s2."symbol"='MCX' LIMIT 1)`).catch(()=>[]);
for (const r of pgs) console.log(`  peer_group ${r.name} (${r.id}) active=${r.act}`);
await prisma.$disconnect();
