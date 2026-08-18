// ═══════════════════════════════════════════════════════════════
// F5f + G2 + G3 — the peer-group seat, and the denormalised count. READ-ONLY.
//   npx tsx src/scripts/_f5f-g123.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  // ── F5f · MCX's seat ────────────────────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5f — MCX's PEER-GROUP SEAT, after deactivation                            ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const pgId = (await raw(`SELECT g."peer_group_id" id FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id" WHERE s."symbol"='MCX'`))[0]?.id;
  const [pg] = await raw(`SELECT "id","name","stock_count" sc FROM peer_groups WHERE "id"=$1`, pgId);
  const members = await raw(`
    SELECT s."symbol" sym, s."is_active" act,
      (SELECT count(*)::int FROM score_snapshots x WHERE x."stock_id"=s."id") snap
    FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id" WHERE g."peer_group_id"=$1 ORDER BY s."symbol"`, pgId);
  const active = members.filter((m: any) => m.act).length;
  console.log(`  group            : "${pg.name}"`);
  console.log(`  roster rows      : ${members.length}`);
  console.log(`  ACTIVE members   : ${active}   ${active === 5 ? "✓ 5, as expected" : "⚠ expected 5"}`);
  console.log(`  peer_groups.stock_count (STORED, denormalised) : ${pg.sc}   ${pg.sc === members.length ? `— matches the ROSTER (${members.length}) but NOT the active count (${active})` : "⚠ matches neither"}`);
  console.log(`  members with a score_snapshot : ${members.filter((m: any) => m.snap > 0).length}  ⇒ this group scores nothing today`);
  console.log(`\n  ${pad("member", 14)}${pad("active", 9)}${lp("snapshots", 11)}`);
  for (const m of members) console.log(`  ${pad(m.sym, 14)}${pad(m.act, 9)}${lp(m.snap, 11)}${m.act ? "" : "   ← the retained seat"}`);
  console.log(`\n  ⚠ THE PG ROW IS RETAINED, AS RULED. Not deleted, not altered.`);
  console.log(`     If it is later removed, peer_groups.stock_count must go 6 → 5 in the SAME`);
  console.log(`     transaction — nothing recomputes it (see G2). That is a separate ruling.`);

  // ── G3 · do the roster queries filter isActive? ─────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ G3 — a deactivated stock keeping a PG seat: is it still scoreable?         ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  CONFIRMED BY READING THE TWO CALL SITES — neither filters isActive:`);
  console.log(`    scoring/composite/score-pass.ts  computePgScores()`);
  console.log(`      prisma.peerGroup.findFirst({ where: { name }, include: { stocks: { include: { stock:`);
  console.log(`        { select: { id, symbol, industryType } } } } } })      ← no isActive predicate`);
  console.log(`    scoring/market/orchestrate.ts    scoreMarketForPg()`);
  console.log(`      prisma.peerGroup.findFirst({ where: { name }, include: { stocks: { include: { stock:`);
  console.log(`        { select: { id, symbol } } } } } })                    ← no isActive predicate`);
  console.log(`\n  ⇒ if "${pg.name}" is ever scored, MCX is scored WITH it, deactivated or not.`);
  console.log(`     Today that is latent (0 of ${members.length} members carry a snapshot), not firing.`);
  console.log(`\n  WHERE isActive IS filtered, for contrast — the same fact, three different answers:`);
  const surfaces = [
    ["scoring/composite/score-pass.ts:308", "computePgScores roster", "NO — scores a deactivated member"],
    ["scoring/market/orchestrate.ts:31", "scoreMarketForPg roster", "NO — scores a deactivated member"],
    ["ingestions/peer-metrics/compute.ts:181", "peer-metric averages", "YES — .filter(s => s.stock.isActive)"],
    ["scoring/read/result-detail.service.ts:486", "displayed peer list", "YES — .filter(s => s.isActive)"],
    ["insight/quarter-brief/peers.ts:178", "brief peer list", "YES — .filter(s => s.isActive)"],
  ];
  console.log(`  ${pad("call site", 46)}${pad("what it drives", 26)}filters isActive?`);
  for (const [a, b, c] of surfaces) console.log(`  ${pad(a, 46)}${pad(b, 26)}${c}`);

  // ── G2 · who reads the denormalised stock_count? ────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ G2 — peer_groups.stock_count is denormalised and nothing recomputes it     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const drift = await raw(`
    SELECT p."name", p."stock_count" stored,
           (SELECT count(*)::int FROM stock_peer_groups g WHERE g."peer_group_id"=p."id") roster,
           (SELECT count(*)::int FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
              WHERE g."peer_group_id"=p."id" AND s."is_active") active
      FROM peer_groups p ORDER BY p."name"`);
  const bad = drift.filter((d: any) => d.stored !== d.roster || d.roster !== d.active);
  console.log(`  peer_groups: ${drift.length}`);
  console.log(`  stored stock_count == roster row count : ${drift.filter((d: any) => d.stored === d.roster).length}/${drift.length}`);
  console.log(`  stored stock_count == ACTIVE count     : ${drift.filter((d: any) => d.stored === d.active).length}/${drift.length}`);
  console.log(`\n  ${pad("peer group", 34)}${lp("stored", 8)}${lp("roster", 8)}${lp("active", 8)}   drift`);
  for (const d of drift) {
    const note = d.stored !== d.roster ? "⚠ stored ≠ roster" : d.roster !== d.active ? "⚠ roster ≠ active (a deactivated member holds a seat)" : "";
    if (note) console.log(`  ${pad(d.name, 34)}${lp(d.stored, 8)}${lp(d.roster, 8)}${lp(d.active, 8)}   ${note}`);
  }
  if (!bad.length) console.log(`  (no drift)`);
  console.log(`\n  ⇒ ${bad.length} of ${drift.length} group(s) now carry a count that disagrees with the live roster or the active roster.`);
  console.log(`     REPORTED ONLY — not fixed, as ruled.`);

  writeFileSync("_f5f-g123.json", JSON.stringify({ pg, members, drift }, null, 1));
  console.log(`\n  → ./_f5f-g123.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
