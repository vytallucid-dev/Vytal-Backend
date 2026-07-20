// ═══════════════════════════════════════════════════════════════
// STEP 8 — GATE 0 RECON. READ-ONLY. Writes nothing, mutates nothing.
// Answers: instruments schema state, AssetClass enum members, catalogue
// census, ETF/REIT overlap with the existing stock universe, and the
// byte-identical baseline.   npx tsx src/scripts/recon-step8-gate0.ts
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const line = (s: string) => console.log(s);
const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// The 17 REIT (RR) + InvIT (IV) symbols observed in the live NSE bhavcopy 10-Jul-2026.
const REIT_SYMBOLS = ["BAGMANE", "BIRET", "EMBASSY", "KRT", "MINDSPACE", "NXST"];
const INVIT_SYMBOLS = ["ANANTAM", "ANZEN", "CAPINVIT", "CITIUSINVT", "INDIGRID", "INDUSINVIT",
  "IRBINVIT", "NHIT", "PGINVIT", "RIIT", "VERTIS"];

// ── 1. instruments schema: is stock_id ALREADY nullable? what indexes exist? ──
hdr("1. instruments — live column + index state");
const cols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_name='instruments' ORDER BY ordinal_position`);
for (const c of cols) line(`  ${String(c.column_name).padEnd(14)} nullable=${c.is_nullable}  ${c.data_type}`);

const idx = await prisma.$queryRawUnsafe<any[]>(`
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename='instruments'`);
line("");
for (const i of idx) line(`  ${i.indexname}\n      ${i.indexdef}`);

// ── 2. AssetClass enum — EXACT member names ──
hdr("2. AssetClass enum members (exact labels)");
const enums = await prisma.$queryRawUnsafe<any[]>(`
  SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='AssetClass' ORDER BY e.enumsortorder`);
const labels = enums.map((e) => e.enumlabel);
line(`  [${labels.join(", ")}]`);
for (const want of ["etf", "reit", "invit", "bond", "gsec", "sgb", "mutual_fund"]) {
  line(`  ${labels.includes(want) ? "✅ PRESENT" : "❌ MISSING "}  ${want}`);
}

// ── 3. Catalogue census ──
hdr("3. catalogue census");
const totalInst = await prisma.instrument.count();
const totalStocks = await prisma.stock.count();
const nullStock = await prisma.instrument.count({ where: { stockId: null } });
const byClass = await prisma.instrument.groupBy({ by: ["assetClass"], _count: true });
line(`  stocks rows            : ${totalStocks}`);
line(`  instruments rows       : ${totalInst}`);
line(`  instruments stock_id=NULL : ${nullStock}`);
for (const g of byClass) line(`    asset_class=${String(g.assetClass).padEnd(12)} ${g._count}`);
line(`  1:1 with stocks? ${totalInst === totalStocks && nullStock === 0 ? "YES" : "NO"}`);

// ── 4. OVERLAP GUARD: are any ETFs / REITs / InvITs ALREADY in `stocks`? ──
hdr("4. overlap guard — ETF/REIT/InvIT already in the stock universe?");

// 4a. REIT/InvIT by symbol
const reitHits = await prisma.stock.findMany({
  where: { symbol: { in: [...REIT_SYMBOLS, ...INVIT_SYMBOLS] } },
  select: { symbol: true, isin: true, name: true },
});
line(`  REIT/InvIT symbols found in stocks: ${reitHits.length} / ${REIT_SYMBOLS.length + INVIT_SYMBOLS.length}`);
for (const s of reitHits) line(`    ⚠️  ${s.symbol.padEnd(12)} ${s.isin}  ${s.name}`);

// 4b. ETF by ISIN — pull the live NSE ETF master and intersect on the spine
const res = await fetch("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv", {
  headers: { "User-Agent": "Mozilla/5.0" },
});
const csv = await res.text();
const etfRows = csv.trim().split("\n").slice(1).map((r) => {
  const c = r.split(",");
  return { symbol: c[0]?.trim(), name: c[2]?.trim(), isin: c[5]?.trim() };
}).filter((r) => r.isin && /^IN/.test(r.isin));
line(`\n  NSE ETF master rows (with ISIN): ${etfRows.length}`);

const etfIsins = etfRows.map((r) => r.isin!);
const etfIsinHits = await prisma.stock.findMany({
  where: { isin: { in: etfIsins } }, select: { symbol: true, isin: true, name: true },
});
const etfSymHits = await prisma.stock.findMany({
  where: { symbol: { in: etfRows.map((r) => r.symbol!) } }, select: { symbol: true, isin: true, name: true },
});
line(`  ETF ISINs already in stocks  : ${etfIsinHits.length}`);
for (const s of etfIsinHits) line(`    ⚠️  ${s.symbol.padEnd(12)} ${s.isin}  ${s.name}`);
line(`  ETF symbols already in stocks: ${etfSymHits.length}`);
for (const s of etfSymHits) line(`    ⚠️  ${s.symbol.padEnd(12)} ${s.isin}  ${s.name}`);

// 4c. any ETF ISIN already in the catalogue at all?
const etfInstHits = await prisma.instrument.count({ where: { isin: { in: etfIsins } } });
line(`  ETF ISINs already in instruments: ${etfInstHits}`);

// ── 5. BASELINE (byte-identical anchors) ──
hdr("5. baseline — the anchors GATE 3 must reproduce");
const EXPECTED = [
  { email: "arman.shaikh01082003@gmail.com", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
];
for (const exp of EXPECTED) {
  const u = await prisma.user.findFirst({ where: { email: exp.email }, select: { id: true } });
  if (!u) { line(`  ⚠️  ${exp.email} — NOT FOUND`); continue; }
  const phs = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u.id }, orderBy: { createdAt: "desc" },
    select: { phs: true, band: true, fingerprint: true },
  });
  const hc = await prisma.holding.count({ where: { userId: u.id } });
  const match = phs?.fingerprint === exp.fp;
  line(`  ${match ? "✅" : "❌"} ${exp.email.padEnd(34)} phs=${phs?.phs} band=${phs?.band} holdings=${hc} fp=${phs?.fingerprint?.slice(0, 16)}…`);
}
const instFp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id || ':' || isin || ':' || COALESCE(stock_id,'-') || ':' || asset_class, '|' ORDER BY isin)) AS fp,
         count(*) AS n
  FROM instruments`);
line(`\n  instruments baseline fingerprint: ${instFp[0].fp}  (n=${instFp[0].n})`);
line("  ^ GATE 3 must show the 504 stock rows still hashing identically (recompute over asset_class='stock' only).");

const stockOnlyFp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id || ':' || isin || ':' || COALESCE(stock_id,'-'), '|' ORDER BY isin)) AS fp,
         count(*) AS n
  FROM instruments WHERE asset_class='stock'`);
line(`  stock-only (504) fingerprint   : ${stockOnlyFp[0].fp}  (n=${stockOnlyFp[0].n})`);

await prisma.$disconnect();
