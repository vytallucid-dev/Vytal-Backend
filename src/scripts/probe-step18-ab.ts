// Why did the fingerprint move? AMFI drift, or my change? Read-only.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

console.log("as_of_date spread in mf_analytics NOW:");
console.log(J(await q(`SELECT as_of_date::text d, count(*)::int n FROM mf_analytics GROUP BY 1 ORDER BY 2 DESC LIMIT 5`)));

console.log("\nnav_date spread in instruments (what AMFI last published):");
console.log(J(await q(`SELECT nav_date::text d, count(*)::int n FROM instruments WHERE amfi_scheme_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`)));

console.log("\nmf run log (recent):");
console.log(J(await q(`SELECT * FROM mf_run_log ORDER BY 1 DESC LIMIT 3`).catch(() => [{ note: "no mf_run_log table" }])));
console.log(J(await q(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename ~* 'run_log'`)));

await prisma.$disconnect();
