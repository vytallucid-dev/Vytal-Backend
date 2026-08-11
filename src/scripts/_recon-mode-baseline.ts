// SCRATCH — throwaway, SELECT-only, deleted this session. Extends recon-card-stacking.ts's shape with
// per-mode grouping and rung>=10 tallying, needed for the mode-contract change's before/after report and
// the floor-shrinkage safety check (M9/M10-12 floor 2->1). Run before AND after the change, diff by hand.
//
//   npx tsx src/scripts/_recon-mode-baseline.ts > <scratchpad>/recon-before.txt   (before any code change)
//   npx tsx src/scripts/_recon-mode-baseline.ts > <scratchpad>/recon-after.txt    (after full change)

import { prisma } from "../db/prisma.js";
import { resolveRelationalState } from "../relational/service.js";

const RUNG10_PLUS_FAMILIES_HINT = new Set(["UE", "UN", "UG", "UO"]); // informational only; real gate is ladderRung>=10

async function main() {
  const holdings = await prisma.$queryRaw<{ user_id: string; stock_id: string }[]>`
    SELECT DISTINCT user_id, stock_id FROM holdings WHERE quantity > 0 AND stock_id IS NOT NULL`;

  const rows: {
    userId: string | null;
    stockId: string;
    mode: string;
    slotCount: number;
    overflowCount: number;
    total: number;
    entries: { entryId: string; family: string; ladderRung: number }[];
  }[] = [];

  async function resolveAndCollect(userId: string | null, stockId: string) {
    try {
      const s = await resolveRelationalState(userId, stockId);
      if (!s) return;
      const all = [...s.slots, ...s.overflow];
      rows.push({
        userId,
        stockId,
        mode: s.mode,
        slotCount: s.slots.length,
        overflowCount: s.overflow.length,
        total: all.length,
        entries: all.map((e) => ({ entryId: e.entryId, family: e.family, ladderRung: e.weight.ladderRung })),
      });
    } catch (err) {
      console.error(`FAILED user=${userId ?? "ANON"} stock=${stockId}:`, (err as Error).message);
    }
  }

  for (const h of holdings) await resolveAndCollect(h.user_id, h.stock_id);
  const stockIds = [...new Set(holdings.map((h) => h.stock_id))];
  for (const stockId of stockIds) await resolveAndCollect(null, stockId);

  console.log(`\n${"═".repeat(78)}\nTOTAL CARDS RESOLVED: ${rows.length}\n${"═".repeat(78)}`);

  // ── Per-mode entry-count distribution (mean, and the actual worst card) ──
  console.log("\n-- PER-MODE ENTRY COUNT (slots+overflow) --");
  const byMode = new Map<string, typeof rows>();
  for (const r of rows) byMode.set(r.mode, [...(byMode.get(r.mode) ?? []), r]);
  for (const [mode, rs] of [...byMode.entries()].sort()) {
    const totals = rs.map((r) => r.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const max = Math.max(...totals);
    const worstRow = rs.find((r) => r.total === max)!;
    console.log(
      `  ${mode}: n=${rs.length} mean_total=${mean.toFixed(2)} max_total=${max} ` +
        `(user=${worstRow.userId ?? "ANON"} stock=${worstRow.stockId}) ` +
        `mean_slots=${(rs.reduce((a, r) => a + r.slotCount, 0) / rs.length).toFixed(2)}`,
    );
  }

  // ── Per-mode family frequency ──
  console.log("\n-- PER-MODE FAMILY FREQUENCY --");
  for (const [mode, rs] of [...byMode.entries()].sort()) {
    const fam = new Map<string, number>();
    for (const r of rs) for (const e of r.entries) fam.set(e.family, (fam.get(e.family) ?? 0) + 1);
    console.log(`  ${mode}:`, [...fam.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f}=${c}`).join(" "));
  }

  // ── Per-mode entry-id frequency ──
  console.log("\n-- PER-MODE ENTRY-ID (base) FREQUENCY --");
  for (const [mode, rs] of [...byMode.entries()].sort()) {
    const id = new Map<string, number>();
    for (const r of rs) for (const e of r.entries) {
      const base = e.entryId.split(":")[0];
      id.set(base, (id.get(base) ?? 0) + 1);
    }
    console.log(`  ${mode}:`, [...id.entries()].sort((a, b) => b[1] - a[1]).map(([i, c]) => `${i}=${c}`).join(" "));
  }

  // ── THE SAFETY CHECK — rung>=10 frequency per mode (must not decrease post-change for M9/M10/M11/M12) ──
  console.log("\n-- PER-MODE RUNG>=10 FREQUENCY (floor-shrinkage safety check) --");
  for (const [mode, rs] of [...byMode.entries()].sort()) {
    let count = 0;
    let total = 0;
    for (const r of rs) for (const e of r.entries) {
      total++;
      if (e.ladderRung >= 10) count++;
    }
    console.log(`  ${mode}: rung>=10 occurrences=${count} / total_entries=${total} (${((count / total) * 100).toFixed(1)}%)`);
  }

  // ── Worst 10 cards overall, full detail ──
  const worst = [...rows].sort((a, b) => b.total - a.total).slice(0, 10);
  console.log("\n-- WORST 10 CARDS (by total entry count) --");
  for (const w of worst) {
    console.log(`\nuser=${w.userId ?? "ANON"} stock=${w.stockId} mode=${w.mode} slots=${w.slotCount} overflow=${w.overflowCount} total=${w.total}`);
    w.entries.forEach((e, i) => console.log(`  [${i + 1}] ${e.entryId} (rung ${e.ladderRung})`));
  }

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
