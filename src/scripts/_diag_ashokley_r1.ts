// THROWAWAY — READ-ONLY DIAGNOSIS. Deleted at end of session. No writes anywhere in this file.
import { prisma } from "../db/prisma.js";
import { getLatestSnapshotRef } from "../scoring/read/scoring-read.service.js";
import { resolveObjectState } from "../relational/object-state.js";
import { resolveReaderContext, anonymousContext } from "../relational/reader-context.js";
import { resolveMode } from "../relational/mode.js";
import { buildEntries } from "../relational/entries.js";
import { assemble } from "../relational/arbitration.js";
import { getBaseRates } from "../relational/base-rates.js";
import { composeRelationalState } from "../relational/service.js";

async function main() {
  const stock = await prisma.stock.findFirst({ where: { symbol: "ASHOKLEY" }, select: { id: true, symbol: true } });
  if (!stock) { console.log("ASHOKLEY not found"); return; }
  console.log("=== STOCK ===", JSON.stringify(stock));

  // ── STEP 1: SCOPE — every scored stock with ≥1 red flag: does it render? ──
  const stocksWithRF = await prisma.$queryRaw<{ stock_id: string; symbol: string; flag_count: bigint }[]>`
    SELECT s.id AS stock_id, s.symbol, COUNT(*) AS flag_count
    FROM stocks s
    JOIN score_snapshots ss ON ss.stock_id = s.id
    JOIN score_red_flags rf ON rf.snapshot_id = ss.id
    GROUP BY s.id, s.symbol`;
  console.log(`\n=== SCOPE: ${stocksWithRF.length} stocks carry ≥1 red-flag row (any snapshot, not necessarily in-force) ===`);

  let renderedCount = 0, notRenderedCount = 0;
  const misses: string[] = [];
  for (const row of stocksWithRF) {
    const ref = await getLatestSnapshotRef(row.stock_id, "quarterly");
    if (!ref) continue;
    const inForceFlags = await prisma.redFlag.findMany({ where: { snapshotId: ref.id }, select: { flagKey: true, severity: true } });
    if (inForceFlags.length === 0) continue; // red flag exists historically but not on the in-force snapshot
    const s = await composeRelationalState(anonymousContext(), (await resolveObjectState(row.stock_id))!, new Date(), null);
    const allEntries = [...s.slots, ...s.overflow];
    const rendered = inForceFlags.filter((f) => allEntries.some((e) => e.entryId === `ELEVATED:${f.flagKey}`));
    const missed = inForceFlags.filter((f) => !allEntries.some((e) => e.entryId === `ELEVATED:${f.flagKey}`));
    if (missed.length > 0) { notRenderedCount++; misses.push(`${row.symbol}: missed=${missed.map((m) => `${m.flagKey}(${m.severity})`).join(",")}`); }
    else renderedCount++;
  }
  console.log(`Stocks with in-force red flags fully rendered: ${renderedCount}`);
  console.log(`Stocks with at least one in-force red flag NOT rendered: ${notRenderedCount}`);
  console.log("Misses:", JSON.stringify(misses, null, 2));

  // ── STEP 2: IS IT IN THE DATA? ──
  const snapRef = await getLatestSnapshotRef(stock.id, "quarterly");
  console.log("\n=== STEP 2: in-force snapshot ref ===", JSON.stringify(snapRef));
  if (!snapRef) { console.log("NO IN-FORCE SNAPSHOT — stop here"); return; }
  const r1Rows = await prisma.redFlag.findMany({ where: { snapshotId: snapRef.id, flagKey: "ownership_R1_pledge" } });
  console.log("R1 rows on in-force snapshot:", JSON.stringify(r1Rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  // Also check ALL versions/snapshots for R1, to see if it sits on a superseded row
  const allR1 = await prisma.$queryRaw<any[]>`
    SELECT ss.id AS snapshot_id, ss.period_key, ss.version, ss.as_of_date, rf.flag_key, rf.severity, rf.triggering_values
    FROM score_red_flags rf
    JOIN score_snapshots ss ON ss.id = rf.snapshot_id
    WHERE ss.stock_id = ${stock.id} AND rf.flag_key = 'ownership_R1_pledge'
    ORDER BY ss.period_key DESC, ss.version DESC`;
  console.log("ALL R1 rows across all ASHOKLEY snapshots/versions:", JSON.stringify(allR1, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  // ── STEP 3: DOES IT REACH OBJECTSTATE? ──
  const obj = await resolveObjectState(stock.id);
  console.log("\n=== STEP 3: ObjectState.findings ===", JSON.stringify(obj?.findings, null, 2));
  const r1Finding = obj?.findings.find((f) => f.key === "ownership_R1_pledge");
  console.log("R1 in ObjectState.findings:", r1Finding ? JSON.stringify(r1Finding, null, 2) : "ABSENT");

  // ── STEP 4/5: CANDIDATES + ARBITRATION (anonymous reader, since this is object-side) ──
  const ctx = anonymousContext();
  const mode = resolveMode(ctx, new Date());
  console.log("\n=== STEP 4: mode ===", JSON.stringify(mode));
  const rates = await getBaseRates();
  const built = buildEntries(ctx, obj!, mode, rates);
  console.log("=== STEP 4: ALL CANDIDATES (rung, entryId) ===");
  for (const c of built.candidates) console.log(`  rung=${c.weight.ladderRung}  ${c.entryId}  claim="${c.claim.slice(0, 80)}"`);
  const elevatedR1 = built.candidates.find((c) => c.entryId === "ELEVATED:ownership_R1_pledge");
  console.log("ELEVATED:ownership_R1_pledge candidate:", elevatedR1 ? JSON.stringify(elevatedR1, null, 2) : "ABSENT FROM CANDIDATES");

  console.log("\n=== STEP 5: floorIds / cap ===", JSON.stringify({ floorIds: built.floorIds, cap: built.cap }));
  const assembled = assemble(built.floorIds, built.candidates, built.cap);
  console.log("=== STEP 5: FINAL SLOTS ===");
  for (const s of assembled.slots) console.log(`  ${s.entryId}  rung=${s.weight.ladderRung}`);
  console.log("=== STEP 5: OVERFLOW ===");
  for (const s of assembled.overflow) console.log(`  ${s.entryId}  rung=${s.weight.ladderRung}`);
  const inSlots = assembled.slots.some((s) => s.entryId === "ELEVATED:ownership_R1_pledge");
  const inOverflow = assembled.overflow.some((s) => s.entryId === "ELEVATED:ownership_R1_pledge");
  console.log(`R1 in final slots: ${inSlots} | in overflow: ${inOverflow}`);

  // ── Also resolve the FULL live card via the real entrypoint (composeRelationalState), anonymous ──
  const state = composeRelationalState(ctx, obj!, new Date(), rates);
  const stateHasR1 = [...state.slots, ...state.overflow].some((e) => e.entryId === "ELEVATED:ownership_R1_pledge");
  console.log("\n=== Full composeRelationalState (anonymous) — R1 present anywhere on card:", stateHasR1, "===");

  await prisma.$disconnect();
}
main();
