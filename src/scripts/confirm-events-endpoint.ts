// Confirm the events block on buildOwnershipView for WITH-events + no-events stocks.
//   npx tsx src/scripts/confirm-events-endpoint.ts
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";

async function show(symbol: string) {
  const v = await buildOwnershipView(symbol, 4);
  if (!v) { console.log(`  ${symbol}: NOT IN UNIVERSE`); return; }
  const ins = v.events.insider;
  const blk = v.events.block;
  console.log(`\n${symbol} — insider: ${ins.length}  block: ${blk.length}`);
  if (ins.length) {
    console.log("  Insider (top 3):");
    for (const e of ins.slice(0, 3))
      console.log(`    ${e.tradeDate ?? "—"}  ${e.personCategory.padEnd(18)} ${e.transactionType.padEnd(7)} ${e.personName.slice(0, 30).padEnd(30)} ₹${e.tradeValueCr != null ? e.tradeValueCr.toFixed(2) + "Cr" : "—"}`);
  } else {
    console.log("  → No insider activity in window (honest empty state)");
  }
  if (blk.length) {
    console.log("  Block (all):");
    for (const e of blk)
      console.log(`    ${e.dealDate}  ${e.dealType.padEnd(6)} ${e.transactionType.padEnd(5)} ${e.clientName.slice(0, 35).padEnd(35)} ₹${e.valueCr != null ? e.valueCr.toFixed(2) + "Cr" : "—"}`);
  } else {
    console.log("  → No block/bulk deals in window (honest empty state)");
  }
}

// HCLTECH — rich insider history (247 rows total)
await show("HCLTECH");
// BHEL — has both insider + block deals in universe
await show("BHEL");
// TORNTPOWER — no insider/block events in DB (67 scored but neutral)
await show("TORNTPOWER");
// POLYCAB — has block deals
await show("POLYCAB");

import { prisma } from "../db/prisma.js";
await prisma.$disconnect();
