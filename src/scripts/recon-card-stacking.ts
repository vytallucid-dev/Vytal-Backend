// RECON — entry-count distribution + worst cases across every real (reader, stock) pair, for the Vytal
// Read cut. Read-only. Prints distribution, worst 10 cards (full entry list), and per-entry length stats.
//
//   npx tsx src/scripts/recon-card-stacking.ts

import { prisma } from "../db/prisma.js";
import { resolveRelationalState } from "../relational/service.js";

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
    entryIds: string[];
    claims: { entryId: string; family: string; len: number; sentences: number; claim: string }[];
  }[] = [];

  const countSentences = (s: string) => (s.match(/[.!?](\s|$)/g) ?? []).length || 1;

  for (const h of holdings) {
    try {
      const s = await resolveRelationalState(h.user_id, h.stock_id);
      if (!s) {
        console.error(`UNRESOLVED user=${h.user_id} stock=${h.stock_id}: no object state`);
        continue;
      }
      const all = [...s.slots, ...s.overflow];
      rows.push({
        userId: h.user_id,
        stockId: h.stock_id,
        mode: s.mode,
        slotCount: s.slots.length,
        overflowCount: s.overflow.length,
        total: all.length,
        entryIds: all.map((e) => e.entryId),
        claims: all.map((e) => ({
          entryId: e.entryId,
          family: e.family,
          len: e.claim.length,
          sentences: countSentences(e.claim),
          claim: e.claim,
        })),
      });
    } catch (err) {
      console.error(`FAILED user=${h.user_id} stock=${h.stock_id}:`, (err as Error).message);
    }
  }

  // Also anonymous + authenticated-no-holding resolves for distinct stocks (M9 cases), for completeness.
  const stockIds = [...new Set(holdings.map((h) => h.stock_id))];
  for (const stockId of stockIds) {
    try {
      const s = await resolveRelationalState(null, stockId);
      if (!s) {
        console.error(`UNRESOLVED anon stock=${stockId}: no object state`);
        continue;
      }
      const all = [...s.slots, ...s.overflow];
      rows.push({
        userId: null,
        stockId,
        mode: s.mode,
        slotCount: s.slots.length,
        overflowCount: s.overflow.length,
        total: all.length,
        entryIds: all.map((e) => e.entryId),
        claims: all.map((e) => ({
          entryId: e.entryId,
          family: e.family,
          len: e.claim.length,
          sentences: countSentences(e.claim),
          claim: e.claim,
        })),
      });
    } catch (err) {
      console.error(`FAILED anon stock=${stockId}:`, (err as Error).message);
    }
  }

  console.log(`\n${"═".repeat(78)}\nTOTAL CARDS RESOLVED: ${rows.length}\n${"═".repeat(78)}`);

  // ── Distribution of total entry count (slots + overflow) ──
  const dist = new Map<number, number>();
  for (const r of rows) dist.set(r.total, (dist.get(r.total) ?? 0) + 1);
  console.log("\n-- ENTRY COUNT DISTRIBUTION (slots+overflow) --");
  [...dist.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, c]) => console.log(`  ${n} entries: ${c} cards`));

  // ── Distribution of slot count alone ──
  const slotDist = new Map<number, number>();
  for (const r of rows) slotDist.set(r.slotCount, (slotDist.get(r.slotCount) ?? 0) + 1);
  console.log("\n-- SLOT COUNT DISTRIBUTION (visible without expanding) --");
  [...slotDist.entries()].sort((a, b) => a[0] - b[0]).forEach(([n, c]) => console.log(`  ${n} slots: ${c} cards`));

  // ── Mode distribution ──
  const modeDist = new Map<string, number>();
  for (const r of rows) modeDist.set(r.mode, (modeDist.get(r.mode) ?? 0) + 1);
  console.log("\n-- MODE DISTRIBUTION --");
  [...modeDist.entries()].sort().forEach(([m, c]) => console.log(`  ${m}: ${c} cards`));

  // ── Worst 10 cards by total entry count ──
  const worst = [...rows].sort((a, b) => b.total - a.total).slice(0, 10);
  console.log("\n-- WORST 10 CARDS (by total entry count) --");
  for (const w of worst) {
    console.log(`\nuser=${w.userId ?? "ANON"} stock=${w.stockId} mode=${w.mode} slots=${w.slotCount} overflow=${w.overflowCount} total=${w.total}`);
    w.entryIds.forEach((id, i) => console.log(`  [${i + 1}] ${id}`));
  }

  // ── Family frequency across all resolved cards ──
  const famCount = new Map<string, number>();
  for (const r of rows) for (const c of r.claims) famCount.set(c.family, (famCount.get(c.family) ?? 0) + 1);
  console.log("\n-- FAMILY FREQUENCY (occurrences across all resolved cards) --");
  [...famCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, c]) => console.log(`  ${f}: ${c}`));

  // ── Entry-id frequency ──
  const idCount = new Map<string, number>();
  for (const r of rows) for (const c of r.claims) {
    const base = c.entryId.split(":")[0];
    idCount.set(base, (idCount.get(base) ?? 0) + 1);
  }
  console.log("\n-- ENTRY-ID (base) FREQUENCY --");
  [...idCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, c]) => console.log(`  ${id}: ${c}`));

  // ── Length / sentence-count outliers ──
  const allClaims = rows.flatMap((r) => r.claims);
  const seen = new Set<string>();
  const uniqueLong: typeof allClaims = [];
  for (const c of allClaims.sort((a, b) => b.sentences - a.sentences || b.len - a.len)) {
    const key = `${c.entryId.split(":")[0]}::${c.claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLong.push(c);
    if (uniqueLong.length >= 40) break;
  }
  console.log("\n-- LONGEST/MOST-SENTENCE CLAIMS (unique, top 40) --");
  for (const c of uniqueLong) {
    console.log(`  [${c.entryId}] sentences=${c.sentences} chars=${c.len}\n    "${c.claim}"`);
  }

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
