import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n);
const cols = await raw(`SELECT column_name c FROM information_schema.columns WHERE table_name='peer_groups' ORDER BY ordinal_position`);
console.log("peer_groups cols:", cols.map((x:any)=>x.c).join(", "));
const pg = await raw(`SELECT p.* FROM peer_groups p
  WHERE p."id"=(SELECT g."peer_group_id" FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id" WHERE s."symbol"='MCX' LIMIT 1)`);
for (const r of pg) console.log("  MCX's PG:", JSON.stringify(r).slice(0,400));
console.log(`\n── how many PGs currently produce score_snapshots? ──`);
const scored = await raw(`SELECT count(DISTINCT g."peer_group_id")::int n FROM stock_peer_groups g
  WHERE EXISTS (SELECT 1 FROM score_snapshots x WHERE x."stock_id"=g."stock_id")`);
const total = await raw(`SELECT count(*)::int n FROM peer_groups`);
console.log(`  peer_groups total: ${total[0].n} · PGs with at least one scored member: ${scored[0].n}`);
console.log(`\n── member counts for MCX's PG, active vs all ──`);
const m = await raw(`SELECT count(*)::int all_m, count(*) FILTER (WHERE s."is_active")::int active_m
  FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
  WHERE g."peer_group_id"=(SELECT g2."peer_group_id" FROM stock_peer_groups g2 JOIN stocks s2 ON s2."id"=g2."stock_id" WHERE s2."symbol"='MCX' LIMIT 1)`);
console.log(`  members: ${m[0].all_m} total · ${m[0].active_m} active  ⇒ after deactivating MCX: ${m[0].active_m-1} active`);
await prisma.$disconnect();
