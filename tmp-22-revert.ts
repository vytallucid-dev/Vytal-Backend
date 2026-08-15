// ─────────────────────────────────────────────────────────────────────────────
// ITEM 2.2 — STANDALONE RE-ASSERT + REVERT.
// Run this ALONE at any time if the harness process dies. Idempotent: safe to run
// when the row is already true. Exits non-zero unless the census reads 504 / 0.
//   npx tsx tmp-22-revert.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./src/db/prisma.js";

const SYM = "NSLNISP";

async function census(): Promise<{ active: number; inactive: number }> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT is_active, count(*)::int AS n FROM stocks GROUP BY 1`,
  )) as { is_active: boolean; n: number }[];
  return {
    active: rows.find((r) => r.is_active)?.n ?? 0,
    inactive: rows.find((r) => !r.is_active)?.n ?? 0,
  };
}

async function main() {
  const before = await census();
  console.log(`census BEFORE revert: ${before.active} true / ${before.inactive} false`);

  const row = await prisma.stock.findUnique({ where: { symbol: SYM }, select: { isActive: true } });
  if (!row) throw new Error(`${SYM} not found — refusing to continue`);
  console.log(`${SYM}.isActive = ${row.isActive}`);

  if (row.isActive) {
    console.log(`${SYM} already active — nothing to revert (idempotent no-op)`);
  } else {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE stocks SET is_active = true WHERE symbol = $1 AND is_active = false`,
      SYM,
    );
    console.log(`REVERTED ${SYM}: ${n} row(s) set is_active = true`);
  }

  const after = await census();
  console.log(`census AFTER  revert: ${after.active} true / ${after.inactive} false`);

  const ok = after.active === 504 && after.inactive === 0;
  console.log(ok ? "GATE PASS — 504 true / 0 false" : "GATE FAIL — census deviates from 504/0");
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (e) => {
  console.error("REVERT SCRIPT FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
