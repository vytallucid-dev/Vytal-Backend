// STEP 9 GATE 0 — READ-ONLY. Catalogue readiness for the AMFI MF/ETF load.
// npx tsx src/scripts/recon-step9-gate0.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

hdr("catalogue columns — what the AMFI payload must fit into");
const cols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, is_nullable, data_type FROM information_schema.columns
  WHERE table_name='instruments' ORDER BY ordinal_position`);
for (const c of cols) {
  const flag = c.is_nullable === "NO" && !["id", "isin", "asset_class", "is_active", "created_at", "updated_at"].includes(c.column_name) ? "  ← NOT NULL" : "";
  console.log(`  ${String(c.column_name).padEnd(13)} nullable=${c.is_nullable}  ${c.data_type}${flag}`);
}
console.log(`\n  ⚠️  'symbol' is NOT NULL — a mutual fund has NO ticker. This is the schema blocker.`);

hdr("AssetClass enum — EXACT member names");
const en = await prisma.$queryRawUnsafe<any[]>(`
  SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='AssetClass' ORDER BY e.enumsortorder`);
const labels = en.map((e) => e.enumlabel);
console.log(`  [${labels.join(", ")}]`);
console.log(`  'etf'         → ${labels.includes("etf") ? "✅ exists" : "❌ MISSING"}`);
console.log(`  'mutual_fund' → ${labels.includes("mutual_fund") ? "✅ exists" : "❌ MISSING"}   (NOT 'mutualfund' — the prompt's spelling)`);

hdr("baseline + overlap");
const n = await prisma.instrument.count();
const byClass = await prisma.instrument.groupBy({ by: ["assetClass"], _count: true });
console.log(`  instruments: ${n}  → ${byClass.map((g) => `${g.assetClass}=${g._count}`).join(", ")}`);
const stocks = await prisma.stock.count();
console.log(`  stocks     : ${stocks}`);

// AMFI ISINs are INF-prefixed; equities are INE-prefixed. Overlap should be structurally zero.
const inf = await prisma.instrument.count({ where: { isin: { startsWith: "INF" } } });
const ine = await prisma.instrument.count({ where: { isin: { startsWith: "INE" } } });
console.log(`  catalogue ISINs starting INF (fund): ${inf}   INE (equity): ${ine}`);
console.log(`  ⇒ overlap risk with the AMFI load: ${inf === 0 ? "ZERO — no INF ISIN in the catalogue today ✅" : `${inf} collisions ⚠️`}`);

const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp, count(*) AS n
  FROM instruments WHERE asset_class='stock'`);
console.log(`\n  stock-only fingerprint: ${fp[0].fp} (n=${fp[0].n})`);
for (const e of [
  { email: "arman.shaikh01082003@gmail.com", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
]) {
  const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
  const p = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u!.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true, fingerprint: true } });
  console.log(`  ${p?.fingerprint === e.fp ? "✅" : "❌"} ${e.email.padEnd(34)} phs=${p?.phs} ${p?.band}`);
}

hdr("scale check — indexes that will carry ~18k rows");
const idx = await prisma.$queryRawUnsafe<any[]>(`SELECT indexname FROM pg_indexes WHERE tablename='instruments'`);
console.log(`  ${idx.map((i) => i.indexname).join("\n  ")}`);
console.log(`  → no amfi_scheme_code index exists yet (needed as the Layer-C/D/E join key).`);

await prisma.$disconnect();
