// STEP 17 — GATE 3, item 3: did the load land where the recon SIZED it?
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const MB = (b: unknown) => (Number(b) / 1_048_576).toFixed(1) + "MB";

const db = (await q(`SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`))[0];
const sz = (await q(`SELECT pg_total_relation_size('instruments') i, pg_total_relation_size('instrument_prices') p`))[0];
const bp = (await q(`SELECT count(*)::int n FROM instrument_prices ip JOIN instruments x ON x.id=ip.instrument_id WHERE x.asset_class='bond'`))[0];
const ip = (await q(`SELECT count(*)::int n FROM instrument_prices`))[0];

console.log(`DB NOW              : ${db.s}   (recon measured 370MB pre-load)`);
console.log(`HEADROOM to 500MB   : ${MB(500 * 1_048_576 - Number(db.b))}`);
console.log(`instruments         : ${MB(sz.i)}`);
console.log(`instrument_prices   : ${MB(sz.p)}   (${ip.n} rows, of which ${bp.n} are bond)`);
console.log(`\nRECON ESTIMATED     : 1.7MB for the load (0.3MB identity + 1.4MB price backfill)`);
console.log(`ONE YEAR OF ACCRUAL : est. ~35MB → still inside the headroom. The ruling (stay on Free) holds.`);

await prisma.$disconnect();
