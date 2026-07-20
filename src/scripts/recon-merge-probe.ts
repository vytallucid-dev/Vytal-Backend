// ─────────────────────────────────────────────────────────────────────────────
// GATE-0 PROBE (pure, no DB) — does a naive ledger-concatenation MERGE hold up?
//   npx tsx src/scripts/recon-merge-probe.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "../generated/prisma/client.js";
import { replayFifo, type LedgerTxn } from "../portfolio/fifo-engine.js";

const D = (n: number | string) => new Prisma.Decimal(n);
let seq = 0;
const buy = (qty: number, price: number, date: string): LedgerTxn =>
  ({ id: `b${++seq}`, type: "buy", quantity: D(qty), price: D(price), fees: null, tradeDate: new Date(date), ratio: null, createdAt: new Date(date) });
const sell = (qty: number, price: number, date: string): LedgerTxn =>
  ({ id: `s${++seq}`, type: "sell", quantity: D(qty), price: D(price), fees: null, tradeDate: new Date(date), ratio: null, createdAt: new Date(date) });
const bonus = (ratio: string, date: string): LedgerTxn =>
  ({ id: `c${++seq}`, type: "bonus", quantity: null, price: null, fees: null, tradeDate: new Date(date), ratio, createdAt: new Date(date) });

const show = (tag: string, r: ReturnType<typeof replayFifo>) =>
  console.log(`  ${tag.padEnd(28)} qty=${r.quantity.toString().padEnd(6)} avg=${r.avgCost.toFixed(4).padEnd(10)} inv=${r.investedValue.toFixed(2).padEnd(11)} realized=${r.realizedPnl.toFixed(2).padEnd(10)} lots=${r.lots.length}`);

// ── PROBE 1: EMPTY LEDGER (what the SOURCE replays to after a full transfer-out) ──
console.log("\n═══ PROBE 1 — empty ledger (source after transfer-out) ═══");
const empty = replayFifo([]);
show("replayFifo([])", empty);
console.log(`  → no throw; qty=0 avg=0 realized=0 lots=0  ⇒ source materializes to a ZOMBIE 0-row`);

// ── PROBE 2: PLAIN TRANSFER (no corporate action, no sells in dest) — byte-identical? ──
console.log("\n═══ PROBE 2 — plain move: does the position replay identically on the destination? ═══");
const srcOnly = [buy(100, 100, "2024-01-01"), buy(50, 120, "2024-03-01"), sell(30, 150, "2024-06-01")];
const before = replayFifo(srcOnly);
const afterOnDest = replayFifo([...srcOnly]); // same rows, new parent account — same ledger
show("source (pre-transfer)", before);
show("dest (post-transfer)", afterOnDest);
console.log(`  → IDENTICAL: FIFO is a pure function of the ledger. Re-parenting rows does not touch the math.`);

// ── PROBE 3: THE MERGE — destination already holds the instrument ──
console.log("\n═══ PROBE 3 — MERGE into a destination that already holds it ═══");
seq = 0;
const A = [buy(100, 100, "2024-01-01")];                        // source book
const B = [buy(50, 200, "2023-06-01"), sell(20, 250, "2024-02-01")]; // dest book (has a SELL)
const aAlone = replayFifo(A);
const bAlone = replayFifo(B);
const merged = replayFifo([...A, ...B]);
show("source alone", aAlone);
show("dest alone", bAlone);
show("MERGED (A+B)", merged);
const sumRealized = aAlone.realizedPnl.plus(bAlone.realizedPnl);
console.log(`  Σ realized before merge = ${sumRealized.toFixed(2)}   |   realized AFTER merge = ${merged.realizedPnl.toFixed(2)}`);
console.log(`  Σ qty before = ${aAlone.quantity.plus(bAlone.quantity)}   |   qty after = ${merged.quantity}`);
console.log(`  → qty CONSERVED. realized ${sumRealized.equals(merged.realizedPnl) ? "unchanged (this case)" : "CHANGED — the dest's sell now matches against a different lot"}.`);

// ── PROBE 3b: the case where merge DOES re-attribute a sell ──
console.log("\n═══ PROBE 3b — MERGE where the dest's sell re-matches against the SOURCE's older lot ═══");
seq = 0;
const A2 = [buy(100, 50, "2023-01-01")];                          // source: OLDER, CHEAPER lot
const B2 = [buy(100, 200, "2024-01-01"), sell(100, 300, "2024-06-01")]; // dest: bought high, sold
const a2 = replayFifo(A2), b2 = replayFifo(B2), m2 = replayFifo([...A2, ...B2]);
show("source alone", a2);
show("dest alone", b2);
show("MERGED", m2);
console.log(`  Σ realized before = ${a2.realizedPnl.plus(b2.realizedPnl).toFixed(2)}   |   after = ${m2.realizedPnl.toFixed(2)}`);
console.log(`  → The dest's sell (2024-06) now consumes the SOURCE's 2023 lot @50 (FIFO = oldest first).`);
console.log(`     Realized ₹${b2.realizedPnl.toFixed(2)} → ₹${m2.realizedPnl.toFixed(2)}. The remaining lot is now the @200 one.`);
console.log(`     This is INHERENT to one-queue-per-(account,instrument): you cannot merge two FIFO queues`);
console.log(`     without re-deciding which lots the past sells consumed. RULING NEEDED.`);

// ── PROBE 4: THE CORPORATE-ACTION DUPLICATION BUG ──
console.log("\n═══ PROBE 4 — MERGE across a corporate action (the killer) ═══");
seq = 0;
// One market event: a 1:1 bonus on 2024-05-01. BOTH accounts must record it — each account's
// FIFO queue only scales its OWN lots, so the user enters a bonus row in each book. Correctly.
const A3 = [buy(100, 100, "2024-01-01"), bonus("1:1", "2024-05-01")]; // source: 100 → 200
const B3 = [buy(50, 100, "2024-01-01"), bonus("1:1", "2024-05-01")];  // dest:    50 → 100
const a3 = replayFifo(A3), b3 = replayFifo(B3);
show("source alone", a3);
show("dest alone", b3);
const truth = a3.quantity.plus(b3.quantity);
const naive = replayFifo([...A3, ...B3]);
show("MERGED (naive concat)", naive);
console.log(`  TRUTH (a+b) = ${truth}   |   naive merge = ${naive.quantity}   ${naive.quantity.equals(truth) ? "OK" : "❌ CORRUPT"}`);
console.log(`  → The merged ledger contains TWO bonus rows for ONE market event. The replay applies BOTH`);
console.log(`     to the WHOLE combined queue ⇒ 2× applied twice = 4×. Shares INVENTED out of nothing.`);

// Dedupe candidate: collapse identical (type, tradeDate, ratio) corporate actions.
const key = (t: LedgerTxn) => `${t.type}|${t.tradeDate.toISOString().slice(0, 10)}|${t.ratio}`;
const seen = new Set<string>();
const deduped = [...A3, ...B3].filter((t) => {
  if (t.type !== "split" && t.type !== "bonus") return true;
  const k = key(t);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const dd = replayFifo(deduped);
show("MERGED (CA-deduped)", dd);
console.log(`  dedupe → qty ${dd.quantity} vs truth ${truth}  ${dd.quantity.equals(truth) ? "✅ correct" : "❌ still wrong"}`);
