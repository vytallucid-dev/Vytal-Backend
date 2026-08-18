// S4G · P1a — remove MCX's peer-group seat AND correct peer_groups.stock_count, one transaction.
//
// WHY BOTH IN ONE TRANSACTION. Nothing recomputes stock_count (G2). get-peer-group.ts:105
// prints `members.length` and `pg.stockCount` on the SAME LINE ("Members listed: 5 (group
// roster count: 6)"), so a delete without the count correction ships a visible contradiction
// to the chat surface. They are one change, not two.
//
// Plan-only by default. --commit to write.
import { prisma } from "../db/prisma.js";
import { writeFileSync } from "node:fs";

const COMMIT = process.argv.includes("--commit");
const PG_NAME = "Large-Cap AMCs & Exchanges";
const SYM = "MCX";
const raw = <T = any>(q: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(q, ...a);

async function snap(tx: any = prisma) {
  const [r] = await tx.$queryRawUnsafe<any[]>(`
    SELECT pg."id", pg."stock_count"::int stored,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."peer_group_id"=pg."id") roster,
      (SELECT count(*)::int FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
        WHERE g."peer_group_id"=pg."id" AND s."is_active"=true) active
    FROM peer_groups pg WHERE pg."name"=$1`, PG_NAME);
  return r as { id: string; stored: number; roster: number; active: number };
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S4G · P1a — DELETE MCX roster row + stock_count 6 → 5 (one transaction)    ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");

  const before = await snap();
  console.log(`\n  pg.id   ${before.id}`);
  console.log(`  before: stored=${before.stored}  roster=${before.roster}  active=${before.active}`);

  const [seat] = await raw<{ id: string; act: boolean }>(`
    SELECT g."id", s."is_active" act FROM stock_peer_groups g
      JOIN stocks s ON s."id"=g."stock_id"
     WHERE g."peer_group_id"=$1 AND s."symbol"=$2`, before.id, SYM);
  if (!seat) throw new Error(`${SYM} holds no roster row in '${PG_NAME}' — nothing to do`);
  if (seat.act) throw new Error(`${SYM} is is_active=TRUE — refusing to remove an ACTIVE member`);
  console.log(`  ${SYM} seat: ${seat.id}   (is_active=false ✓ precondition holds)`);

  console.log(`\n  THE STATEMENTS:`);
  console.log(`     DELETE FROM stock_peer_groups g USING stocks s`);
  console.log(`      WHERE g.stock_id = s.id AND g.peer_group_id = '${before.id}'`);
  console.log(`        AND s.symbol = '${SYM}' AND s.is_active = false;`);
  console.log(`     UPDATE peer_groups SET stock_count = 5 WHERE id = '${before.id}' AND stock_count = 6;`);
  console.log(`     (both predicates pinned so a re-run is a no-op, never a silent 0-row "success")`);

  if (!COMMIT) { console.log(`\n  (plan only — nothing written. add --commit)\n`); await prisma.$disconnect(); return; }

  let delCount = 0, updCount = 0;
  await prisma.$transaction(async (tx) => {
    delCount = await tx.$executeRawUnsafe(`
      DELETE FROM stock_peer_groups g USING stocks s
       WHERE g."stock_id"=s."id" AND g."peer_group_id"=$1 AND s."symbol"=$2 AND s."is_active"=false`,
      before.id, SYM);
    console.log(`\n  roster rows deleted: ${delCount}`);
    if (delCount !== 1) throw new Error(`expected exactly 1 roster row deleted, got ${delCount} — ROLLBACK`);

    updCount = await tx.$executeRawUnsafe(
      `UPDATE peer_groups SET "stock_count"=5 WHERE "id"=$1 AND "stock_count"=6`, before.id);
    console.log(`  peer_groups rows updated: ${updCount}`);
    if (updCount !== 1) throw new Error(`expected exactly 1 stock_count update, got ${updCount} — ROLLBACK`);

    const a = await snap(tx);
    if (a.stored !== 5) throw new Error(`stock_count=${a.stored} != 5 — ROLLBACK`);
    if (a.roster !== 5) throw new Error(`roster=${a.roster} != 5 — ROLLBACK`);
    if (a.active !== 5) throw new Error(`active=${a.active} != 5 — ROLLBACK`);

    // Nothing outside this group may have moved.
    const [g] = await tx.$queryRawUnsafe<any[]>(`SELECT count(*)::int n FROM stock_peer_groups`);
    console.log(`  ✓ assertions: deleted=1 · stock_count=5 · roster=5 · active=5 · stock_peer_groups total now ${g.n}`);
  });
  console.log(`  ✓ COMMITTED`);

  const after = await snap();
  console.log(`\n  after:  stored=${after.stored}  roster=${after.roster}  active=${after.active}   ${after.stored === after.roster && after.roster === after.active ? "✓ all three agree" : "⚠ MISMATCH"}`);

  // MCX itself: the stock row and all its data are untouched — only the seat is gone.
  const [k] = await raw<any>(`
    SELECT s."symbol" sym, s."is_active" act,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."stock_id"=s."id") pg,
      (SELECT count(*)::int FROM daily_prices d WHERE d."stock_id"=s."id") p,
      (SELECT count(*)::int FROM stock_findings f WHERE f."stock_id"=s."id") f
    FROM stocks s WHERE s."symbol"=$1`, SYM);
  console.log(`\n  ── MCX ITSELF UNTOUCHED — only the seat was removed ──`);
  console.log(`  ${k.sym}  is_active=${k.act}  peer_group_rows=${k.pg}  daily_prices=${k.p}  findings=${k.f}`);

  // P1c re-sweep — confirm zero, do not assume.
  const sweep = await raw<any>(`
    SELECT s."symbol" sym, pg."name" pgname FROM stock_peer_groups g
      JOIN stocks s ON s."id"=g."stock_id" JOIN peer_groups pg ON pg."id"=g."peer_group_id"
     WHERE s."is_active"=false ORDER BY s."symbol"`);
  console.log(`\n  ── P1c re-sweep · inactive stocks still holding a roster row ──`);
  if (!sweep.length) console.log(`  (none) ✓ zero — confirmed, not assumed`);
  for (const r of sweep) console.log(`  ⚠ ${r.sym} — ${r.pgname}`);

  const drift = await raw<any>(`
    SELECT pg."name", pg."stock_count"::int stored,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."peer_group_id"=pg."id") roster,
      (SELECT count(*)::int FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
        WHERE g."peer_group_id"=pg."id" AND s."is_active"=true) active
    FROM peer_groups pg ORDER BY pg."name"`);
  const bad = drift.filter((d: any) => d.stored !== d.roster || d.roster !== d.active);
  console.log(`\n  ── stored = roster = active, all ${drift.length} groups ──`);
  console.log(bad.length ? `  ⚠ drift remains in ${bad.length}` : `  ✓ zero drift across all ${drift.length} groups`);

  writeFileSync("./_s4g-p1a.json", JSON.stringify({
    pgId: before.id, before, after, deleted: delCount, updated: updCount,
    seatId: seat.id, inactiveWithSeat: sweep.length, groupsWithDrift: bad.length,
  }, null, 1));
  console.log(`\n  → ./_s4g-p1a.json`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("\n  ✗", e.message); await prisma.$disconnect(); process.exit(1); });
