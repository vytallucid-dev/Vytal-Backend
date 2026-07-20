// ═══════════════════════════════════════════════════════════════
// STEP 8 (RE-SCOPED) GATE 0 — READ-ONLY (the one INSERT is inside a rolled-back txn).
// Settles, against the live DB, whether the proposed restructure is needed at all:
//   Q1. Is stock_id the PRIMARY KEY, or does instruments already have its own id?
//   Q2. Is stock_id already a nullable FK with a unique index?
//   Q3. Can a null-stock ETF instrument ALREADY be inserted, with no migration?
//   Q4. What actually fails today? (reit/invit enum members)
// npx tsx src/scripts/recon-step8-gate0c.ts
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// ── Q1/Q2: the authoritative DDL, straight from the catalog ──
hdr("Q1/Q2 — live constraints on `instruments` (pg_constraint)");
const cons = await prisma.$queryRawUnsafe<any[]>(`
  SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'instruments'::regclass
  ORDER BY contype DESC`);
for (const c of cons) {
  const kind = { p: "PRIMARY KEY", u: "UNIQUE", f: "FOREIGN KEY", c: "CHECK" }[c.contype as string] ?? c.contype;
  console.log(`  [${String(kind).padEnd(11)}] ${c.conname}\n        ${c.def}`);
}

const pkCol = await prisma.$queryRawUnsafe<any[]>(`
  SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'instruments'::regclass AND i.indisprimary`);
console.log(`\n  PRIMARY KEY column(s): ${pkCol.map((c) => `${c.attname} (${c.typ}, notnull=${c.attnotnull})`).join(", ")}`);

const sid = await prisma.$queryRawUnsafe<any[]>(`
  SELECT is_nullable, data_type FROM information_schema.columns
  WHERE table_name='instruments' AND column_name='stock_id'`);
console.log(`  stock_id: nullable=${sid[0].is_nullable}, type=${sid[0].data_type}`);

// ── Q3: can we ALREADY insert a null-stock, non-equity instrument? Rolled back. ──
hdr("Q3 — null-stock ETF instrument: insertable TODAY, with no migration?");
const before = await prisma.instrument.count();
try {
  await prisma.$transaction(async (tx) => {
    const created = await tx.instrument.create({
      data: {
        isin: "INF204KB14I2",           // NIFTYBEES — real ISIN from NSE's ETF master
        symbol: "NIFTYBEES",
        name: "Nippon India ETF Nifty 50 BeES",
        assetClass: "etf",              // enum member ALREADY exists
        stockId: null,                  // ← the whole question
        attributes: { underlying: "Nifty50" },
      },
      select: { id: true, isin: true, symbol: true, assetClass: true, stockId: true },
    });
    console.log(`  ✅ INSERT SUCCEEDED with stock_id = NULL and no migration:`);
    console.log(`     id=${created.id}`);
    console.log(`     ${created.symbol} / ${created.isin} / asset_class=${created.assetClass} / stock_id=${created.stockId}`);

    // And a SECOND null-stock row — proves the unique index does NOT block multiple nulls.
    const second = await tx.instrument.create({
      data: { isin: "INF204KB17I5", symbol: "GOLDBEES", name: "Nippon India ETF Gold BeES", assetClass: "etf", stockId: null },
      select: { id: true, symbol: true },
    });
    console.log(`  ✅ SECOND null-stock row also inserted (${second.symbol}) — UNIQUE(stock_id) is NULLS DISTINCT,`);
    console.log(`     so it already permits unlimited null-stock rows. A partial index would add nothing.`);

    throw new Error("__ROLLBACK__"); // never persist
  });
} catch (e: any) {
  if (e?.message !== "__ROLLBACK__") console.log(`  ❌ FAILED: ${e?.message}`);
}
const after = await prisma.instrument.count();
console.log(`  rolled back cleanly: instruments ${before} → ${after} ${before === after ? "✅" : "❌ LEAK"}`);

// ── Q4: what DOES fail today? ──
hdr("Q4 — what actually blocks a REIT today?");
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO instruments (id,isin,symbol,name,asset_class,stock_id,is_active,created_at,updated_at)
       VALUES (gen_random_uuid()::text,'INE041025011','EMBASSY','Embassy Office Parks REIT','reit',NULL,true,now(),now())`,
    );
    throw new Error("__ROLLBACK__");
  });
  console.log("  reit insert unexpectedly succeeded?!");
} catch (e: any) {
  if (e?.message === "__ROLLBACK__") console.log("  reit accepted (unexpected)");
  else console.log(`  ❌ BLOCKED, as expected — the ONLY real gap:\n     ${String(e?.message).split("\n").find((l: string) => l.includes("invalid input value")) ?? String(e?.message).slice(0, 140)}`);
}

// ── Baseline re-confirm ──
hdr("baseline (unchanged)");
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp, count(*) AS n
  FROM instruments WHERE asset_class='stock'`);
console.log(`  stock-only fingerprint: ${fp[0].fp} (n=${fp[0].n})`);

await prisma.$disconnect();
