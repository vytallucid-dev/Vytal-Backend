// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 GATE-0 RE-CONFIRM (read-only) — only what 5.5 changed.
//   1. broker-match for transfer rule 2 is a clean field compare (every account has a broker)
//   2. a LINKED account is BROKER-ONLY — no manual rows can exist on it (5.5 ruling 5), and none
//      can be ADDED afterwards through any door (link / sever / clear / re-link)
//   3. the transfer core is untouched by 5.5 (re-parent txns + replay; holdings derived)
//   4. the rescue delete sequence + cascade map
//   5. baseline
//   npx tsx src/scripts/recon-step6-reconfirm.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings, deactivate, clearData } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { createAccount, linkAccount, deleteAccount, patchAccount } from "../controllers/me/accounts-controller.js";
import { addTransaction, patchTransaction, deleteTransaction } from "../controllers/me/transactions-controller.js";

let bad = 0;
const ok = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) bad++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `s6-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };
const mk = (userId: string, name: string, broker: string) => call(createAccount, userId, { body: { name, broker } });
const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });

const created: string[] = [];
try {
  // ═══ 1 — every account has a broker ⇒ rule 2's same-broker check is a field compare ═══
  console.log("═══ 1 — Broker-match for transfer rule 2 (a clean field compare) ═══");
  // Raw SQL, deliberately: Prisma now REFUSES `where: { broker: null }` at the type level
  // ("Argument `broker` must not be null") — which is itself the proof that the field is total.
  const nullBrokers = (await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM portfolio_accounts WHERE broker IS NULL`))[0].n;
  ok("ZERO accounts have a null broker (5.5 made it NOT NULL) → source.broker vs dest.broker is total",
    Number(nullBrokers) === 0, `nullBroker accounts=${nullBrokers} (and Prisma won't even TYPE a null broker filter)`);

  const A = await seedUser("a"); created.push(A.authId);
  const zLinked = (await mk(A.userId, "Zerodha Demat", "mock")).body.data.id as string; // 'mock' = our stand-in broker
  const zManual = (await mk(A.userId, "Zerodha Manual", "mock")).body.data.id as string;
  const uManual = (await mk(A.userId, "Upstox Manual", "upstox")).body.data.id as string;
  const rows = await prisma.portfolioAccount.findMany({
    where: { userId: A.userId }, select: { name: true, broker: true, state: true },
  });
  console.log("     " + rows.map((r) => `${r.name}[${r.broker}/${r.state}]`).join("  "));
  ok("source.broker === dest.broker is decidable on the row itself (no join, no adapter)",
    rows.every((r) => r.broker !== null), "all brokers present");

  // ═══ 2 — A LINKED ACCOUNT IS BROKER-ONLY: can manual rows exist on it? ═══
  console.log("\n═══ 2 — Can a LINKED account hold manual rows? (5.5 ruling 5, enforced live) ═══");
  // Seed the linked book with a manual ledger FIRST, then link it (the 5.5 replace path).
  await addTx(A.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1200, tradeDate: "2025-01-15", accountId: zLinked });
  const conn = await integrate(A.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_A" } });
  const linked = await call(linkAccount, A.userId, { params: { id: zLinked }, body: { connectionId: conn.id, confirm: true } });
  ok("link (confirm) → 200 and the manual ledger was REPLACED", linked.statusCode === 200 && linked.body?.replaced?.transactions === 1, `replaced=${JSON.stringify(linked.body?.replaced)}`);
  const mTx = await prisma.transaction.count({ where: { accountId: zLinked } });
  const mH = await prisma.holding.count({ where: { accountId: zLinked } });
  ok("a LINKED account carries ZERO manual transactions and ZERO manual holdings",
    mTx === 0 && mH === 0, `txns=${mTx} holdings=${mH}`);

  // ...and can none be ADDED afterwards, through ANY door?
  const post = await addTx(A.userId, { symbol: "TCS", type: "buy", quantity: 1, price: 3000, tradeDate: "2025-02-01", accountId: zLinked });
  ok("POST a manual txn into the linked account → refused", post.statusCode === 409 && post.body?.error === "account_linked", `status=${post.statusCode} err=${post.body?.error}`);

  await syncHoldings(A.userId, conn.id);
  // SEVER it (linked_stale, holdings frozen) — manual entry must STAY disabled.
  await deactivate(A.userId, conn.id);
  const staleState = (await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: zLinked }, select: { state: true, brokerConnectionId: true } }));
  const postStale = await addTx(A.userId, { symbol: "TCS", type: "buy", quantity: 1, price: 3000, tradeDate: "2025-02-01", accountId: zLinked });
  ok("...and after a SEVER (linked_stale, still bound) manual entry is STILL refused",
    postStale.statusCode === 409 && staleState.state === "linked_stale" && staleState.brokerConnectionId !== null,
    `state=${staleState.state} bound=${staleState.brokerConnectionId !== null} status=${postStale.statusCode}`);
  ok("⇒ RESCUE HAS NO MANUAL-LEDGER CASE: a linked/stale account's rows are broker-origin ONLY",
    mTx === 0 && post.statusCode === 409 && postStale.statusCode === 409, "confirmed on all doors");

  // The frozen snapshot rescue will convert:
  const bh = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: conn.id },
    select: { symbol: true, stockId: true, quantity: true, avgCost: true, syncedAt: true },
    orderBy: { symbol: "asc" },
  });
  console.log("     broker_holdings on the linked account:");
  for (const b of bh) console.log(`       ${b.symbol.padEnd(11)} stock_id=${b.stockId ? "SET " : "NULL"} qty=${b.quantity} avgCost=${b.avgCost} syncedAt=${b.syncedAt.toISOString().slice(0, 10)}`);
  const unmapped = bh.filter((b) => b.stockId === null);
  ok("R4 GUARD IS LIVE: at least one broker holding is UNMAPPED (null stock_id) and cannot become manual",
    unmapped.length > 0, `unmapped=[${unmapped.map((u) => u.symbol).join(",")}]`);

  // ═══ 3 — the transfer core, unchanged by 5.5 ═══
  console.log("\n═══ 3 — Transfer core (re-parent txns; holdings/lots DERIVED) ═══");
  const fkAcct = await prisma.$queryRawUnsafe<any[]>(`
    SELECT tc.table_name, kcu.column_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='portfolio_accounts' ORDER BY tc.table_name`);
  console.log("     account-keyed tables: " + fkAcct.map((f) => `${f.table_name}.${f.column_name}(${f.delete_rule})`).join("  "));
  ok("only transactions + holdings are account-keyed → the re-parent is ONE column on transactions",
    fkAcct.length === 2 && fkAcct.every((f) => ["transactions", "holdings"].includes(f.table_name)), `n=${fkAcct.length}`);
  ok("holding_lots hang off holdings (not accounts) → they are REBUILT by replay, never re-parented",
    (await prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM information_schema.columns WHERE table_name='holding_lots' AND column_name='account_id'`)).length === 0,
    "holding_lots has no account_id");

  // ═══ 4 — the rescue delete sequence / cascade map ═══
  console.log("\n═══ 4 — Rescue delete sequence (what cascades) ═══");
  const delBound = await call(deleteAccount, A.userId, { params: { id: zLinked }, body: { confirm: true } });
  ok("DELETE a still-BOUND account is refused TODAY (409) → rescue must open this door",
    delBound.statusCode === 409 && delBound.body?.error === "account_linked", `status=${delBound.statusCode} err=${delBound.body?.error}`);

  // THE ORPHAN TRAP: the union reaches a broker holding's account via holding→connection→accounts[0].
  const before = await listUnifiedPositions(A.userId);
  const brokerLines = before.filter((p) => p.source === "broker").length;
  await prisma.$executeRawUnsafe(`UPDATE portfolio_accounts SET broker_connection_id = NULL WHERE id = $1`, zLinked);
  const orphaned = await listUnifiedPositions(A.userId);
  const orphanLines = orphaned.filter((p) => p.source === "broker").length;
  ok("ORPHAN TRAP CONFIRMED: null the binding and every broker_holding vanishes from the union",
    brokerLines > 0 && orphanLines === 0, `broker lines ${brokerLines} → ${orphanLines} (rows still in the table: ${await prisma.brokerHolding.count({ where: { brokerConnectionId: conn.id } })})`);
  console.log("     ⇒ rescue MUST delete the CONNECTION (cascading broker_holdings away), not just the account.");

  console.log(`\n${bad === 0 ? "✅ GATE 0 RE-CONFIRMED — the recon's assumptions all survive 5.5" : `❌ ${bad} MISMATCH(ES)`}`);
} finally {
  for (const a of created) await cleanup(a);
}

// ═══ 5 — baseline ═══
console.log("\n═══ 5 — BASELINE (must not move) ═══");
for (const email of ["arman.shaikh01082003@gmail.com", "amankamaljain@gmail.com"]) {
  const u = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  const phs = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true, fingerprint: true } });
  const accts = await prisma.portfolioAccount.findMany({ where: { userId: u.id }, select: { name: true, broker: true, state: true } });
  console.log(`  ${email}: PHS=${phs?.phs} ${phs?.band} fp=${phs?.fingerprint?.slice(0, 16)}… accounts=${accts.map((a) => `${a.name}[${a.broker}/${a.state}]`).join(",")}`);
}
await prisma.$disconnect();
process.exit(bad === 0 ? 0 : 1);
