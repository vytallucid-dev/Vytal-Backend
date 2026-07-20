// ─────────────────────────────────────────────────────────────────────────────
// SEED — a deliberate portfolio for eye-verifying the Portfolio Overview + NAV.
//
// Plants transactions for ONE real user THROUGH THE REAL WRITE PATH (the
// addTransaction controller via mock req/res) — so each insert fires the exact
// production chain: validate → create txn → FIFO replay → materialize holdings →
// refreshPhsForUser → PHS snapshot. i.e. running this also PROVES the
// write→replay→PHS→read chain, and now seeds enough HISTORY for the NAV series to
// have real shape.
//
// The book is shaped to exercise the Overview states that matter:
//   • Real history      — 7 first-buys STAGGERED across ~24 months (anchor earliest),
//                          plus mid-history add-on buys and a mid-history partial sell,
//                          so GET /me/portfolio/nav spans a real window with rises, a
//                          sell step, and price drift (the value chart + Performance).
//   • Concentration     — uneven weights (a ~22% anchor, mids, smalls; top-3 ~56%)
//   • Coverage honesty   — ONE deliberately-unscored holding (in the universe, priced,
//                          no ScoreSnapshot) → PHS reads scoped ("reflects X% · N not
//                          scored"), not whole-book.
//   • Varied sectors     — banking / IT / metals / energy / pharma / FMCG + the unscored
//   • Realized P&L       — a buy-then-partial-sell mid-history (FIFO booked gain)
//   • Mixed health       — scored names spanning bands (healthy → steady → below_par)
//
// Dates are snapped to REAL trading days that have a DailyPrice close, and buy/sell
// prices ARE that day's close — so invested / unrealized / realized are honest, and the
// NAV can value every day. If a symbol's price history doesn't reach a target date, the
// buy snaps to the earliest date it DOES cover (honest, never fabricated).
//
// ── ACCOUNT-AWARE (post-accounts) ─────────────────────────────────────────────
// The book belongs to ONE account, not "the user". SEED_ACCOUNT_ID is REQUIRED and is
// sent on every POST /me/transactions. The seeder NEVER infers an account (no "first",
// no "only", no auto-create): an inferred target is how the next operator silently seeds
// the wrong book. It also REFUSES a broker-attested (linked_live / linked_stale) account —
// a Verified book must never hold hand-made transactions; the backend already refuses manual
// entry there (manualEntryAllowed=false), and this seeder will not be the hole in that wall.
//
// SAFE ORDERING (never destroy before you can rebuild): on a reset run the write path is
// PROVEN with one real accepted write (a preflight) BEFORE anything is cleared. A rejected
// preflight leaves the pre-existing book fully intact. (We can't reset+write in one
// rollback-all transaction: each POST opens its own $transaction and post-commits a PHS
// refresh through the controller, and the script must go through that real controller — so
// preflight-then-reset is the honest option the API architecture allows.)
//
// ── RUN ──────────────────────────────────────────────────────────────────────
//   SEED_USER_EMAIL="you@example.com" SEED_ACCOUNT_ID="<portfolio_account.id>" \
//     npx tsx src/scripts/seed-portfolio-overview.ts
//   (or SEED_USER_ID="<public.users.id>" in place of the email)
//   Run with no SEED_ACCOUNT_ID to have the user's accounts (id · name · state) listed.
// Options (env):
//   SEED_RESET=false   append instead of resetting the TARGET ACCOUNT first
//                      (default: reset — deletes only the target account's txns/holdings/lots
//                       so re-runs are deterministic. Other accounts are byte-untouched, and
//                       broker-synced holdings — a separate mirror table — are never touched.)
//   SEED_DRY_RUN=true  resolve + print the plan (dates, prices, qtys, span) and exit
//                      WITHOUT writing anything.
// Needs: DATABASE_URL reachable (same as the verify-* scripts). No running server or
// Supabase token needed to SEED — the token is only for viewing in the frontend.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { computePortfolioNav } from "../portfolio/nav/assemble.js";

// ── mock req/res (mirrors verify-portfolio-fifo) ──
function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
function mockReq(userId: string, opts: { body?: any; params?: any; query?: any } = {}) {
  return { authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: opts.query ?? {} } as any;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
function monthsAgoIso(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ── the intended book (target weights sum to 1.00 WITH the unscored name) ──────────
const TOTAL_TARGET = 1_500_000; // ₹15L notional current value — qtys sized off latest close
interface Plan {
  symbol: string;
  role: string;
  weight: number; // FINAL target weight (share of current book value)
  firstBuyMonthsAgo: number; // staggered entry
  addOn?: { monthsAgo: number; fraction: number }; // mid-history add-on buy (share of final qty)
  sell?: { monthsAgo: number; fraction: number }; // mid-history partial sell → realized P&L
}
const SCORED_PLAN: Plan[] = [
  { symbol: "HDFCBANK",  role: "anchor · large",              weight: 0.22, firstBuyMonthsAgo: 24, addOn: { monthsAgo: 12, fraction: 0.40 } },
  { symbol: "TCS",       role: "mid · IT",                    weight: 0.16, firstBuyMonthsAgo: 20, addOn: { monthsAgo: 9,  fraction: 0.45 } },
  { symbol: "TATASTEEL", role: "mid · metals",                weight: 0.14, firstBuyMonthsAgo: 16 },
  { symbol: "RELIANCE",  role: "mid · energy",                weight: 0.12, firstBuyMonthsAgo: 13 },
  { symbol: "SUNPHARMA", role: "small · pharma + realized",   weight: 0.10, firstBuyMonthsAgo: 11, sell: { monthsAgo: 5, fraction: 0.40 } },
  { symbol: "ITC",       role: "small · FMCG",                weight: 0.08, firstBuyMonthsAgo: 8 },
];
const UNSCORED_PLAN = { role: "UNSCORED · coverage state", weight: 0.18, firstBuyMonthsAgo: 5 };

// ── resolution ─────────────────────────────────────────────────────────────────
interface Daily { date: string; close: number }
async function fetchDaily(stockId: string): Promise<Daily[]> {
  const rows = await prisma.dailyPrice.findMany({ where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), close: Number(r.close) }));
}
/** First trading day ≥ target (and strictly after `after`, if given). Before coverage
 *  → the earliest available day (honest); after coverage → the last. null if empty. */
function snapDay(daily: Daily[], targetIso: string, after?: string): Daily | null {
  const pool = after ? daily.filter((d) => d.date > after) : daily;
  if (pool.length === 0) return null;
  if (targetIso <= pool[0].date) return pool[0];
  for (const d of pool) if (d.date >= targetIso) return d;
  return pool[pool.length - 1];
}

interface Resolved {
  symbol: string; name: string; role: string; weight: number;
  firstBuyMonthsAgo: number; addOn?: Plan["addOn"]; sell?: Plan["sell"];
  scored: boolean; band: string | null; composite: number | null; tier: string; sector: string | null;
  daily: Daily[]; currentPrice: number;
}

async function resolveScored(p: Plan): Promise<Resolved | null> {
  const s = await prisma.stock.findUnique({
    where: { symbol: p.symbol },
    select: {
      id: true, symbol: true, name: true,
      sector: { select: { name: true } },
      scoreSnapshots: { orderBy: [{ asOfDate: "desc" }, { version: "desc" }], take: 1, select: { composite: true, labelBand: true } },
      marketCapTierSnapshots: { orderBy: { asOfDate: "desc" }, take: 1, select: { tier: true } },
    },
  });
  if (!s) { console.log(`⚠ ${p.symbol} not in universe — skipping.`); return null; }
  const daily = await fetchDaily(s.id);
  if (daily.length === 0) { console.log(`⚠ ${p.symbol} has no DailyPrice — skipping (cannot value it).`); return null; }
  const sc = s.scoreSnapshots[0];
  return {
    symbol: s.symbol, name: s.name, role: p.role, weight: p.weight,
    firstBuyMonthsAgo: p.firstBuyMonthsAgo, addOn: p.addOn, sell: p.sell,
    scored: !!sc, band: sc?.labelBand ?? null, composite: sc ? Number(sc.composite) : null,
    tier: s.marketCapTierSnapshots[0]?.tier ?? "unknown", sector: s.sector?.name ?? null,
    daily, currentPrice: daily[daily.length - 1].close,
  };
}

/** A universe stock IN the universe, WITH daily-price history, but NOT scored — the
 *  coverage-honesty holding. Prefers one with a sector so the sector mix stays rich. */
async function resolveUnscored(exclude: string[]): Promise<Resolved | null> {
  const base = { isActive: true, symbol: { notIn: exclude }, scoreSnapshots: { none: {} }, dailyPrices: { some: {} } } as const;
  const sel = { id: true, symbol: true, name: true, sector: { select: { name: true } }, marketCapTierSnapshots: { orderBy: { asOfDate: "desc" as const }, take: 1, select: { tier: true } } };
  const s =
    (await prisma.stock.findFirst({ where: { ...base, sectorId: { not: null } }, orderBy: { symbol: "asc" }, select: sel })) ??
    (await prisma.stock.findFirst({ where: base, orderBy: { symbol: "asc" }, select: sel }));
  if (!s) return null;
  const daily = await fetchDaily(s.id);
  if (daily.length === 0) return null;
  return {
    symbol: s.symbol, name: s.name, role: UNSCORED_PLAN.role, weight: UNSCORED_PLAN.weight,
    firstBuyMonthsAgo: UNSCORED_PLAN.firstBuyMonthsAgo, scored: false, band: null, composite: null,
    tier: s.marketCapTierSnapshots[0]?.tier ?? "unknown", sector: s.sector?.name ?? null,
    daily, currentPrice: daily[daily.length - 1].close,
  };
}

/** ACCOUNT-SCOPED reset (post-accounts). Clears ONLY the target account's ledger — its
 *  transactions and its holdings (holding_lots cascade via FK ON DELETE CASCADE). Deliberately
 *  narrow:
 *    • Other accounts' txns/holdings → NOT in the `where`, so byte-untouched.
 *    • broker_holdings (the synced MIRROR) → a SEPARATE table; never referenced here, so a
 *      linked account's feed survives even a full reset of a manual sibling.
 *    • portfolio_health_snapshot → PER-USER (whole book), append-only. NOT deleted: it is not
 *      account-scoped state, and the seed's writes append fresh snapshots that supersede it on
 *      the read path. (The honest "a snapshot was produced" check keys off a pre-run baseline id,
 *      not off an empty table — see printResult.) */
async function resetAccount(userId: string, accountId: string) {
  const holds = await prisma.holding.deleteMany({ where: { userId, accountId } }); // cascades holding_lots
  const txns = await prisma.transaction.deleteMany({ where: { userId, accountId } });
  return { holdings: holds.count, transactions: txns.count };
}

/** POST one transaction through the REAL controller, ALWAYS carrying the target accountId
 *  (absent → the addTransaction guard rejects multi-account users with 400 account_required —
 *  which is exactly the guard that broke the original run; we satisfy it, never bypass it). */
async function post(userId: string, accountId: string, body: any, tag = ""): Promise<boolean> {
  const r = mockRes();
  await addTransaction(mockReq(userId, { body: { ...body, accountId } }), r);
  const ok = r.statusCode < 400;
  console.log(
    `   ${ok ? "✅" : "⚠️"} ${tag ? tag + " " : ""}${body.type.padEnd(4)} ${String(body.symbol).padEnd(11)} ${String(body.quantity).padStart(5)} @ ₹${String(body.price).padEnd(9)} ${body.tradeDate}` +
      `${ok ? "" : `  → ${r.statusCode} ${JSON.stringify(r.body)}`}`,
  );
  return ok;
}

// ── build the chronological order list for one resolved holding ──────────────────
interface Order { symbol: string; type: "buy" | "sell"; quantity: number; price: number; tradeDate: string }
function ordersFor(e: Resolved): Order[] {
  const out: Order[] = [];
  const baseQty = Math.max(1, Math.round((e.weight * TOTAL_TARGET) / e.currentPrice));
  const first = snapDay(e.daily, monthsAgoIso(e.firstBuyMonthsAgo));
  if (!first) return out;

  if (e.addOn) {
    const initialQty = Math.max(1, Math.round(baseQty * (1 - e.addOn.fraction)));
    const addQty = Math.max(1, baseQty - initialQty);
    out.push({ symbol: e.symbol, type: "buy", quantity: initialQty, price: round2(first.close), tradeDate: first.date });
    const add = snapDay(e.daily, monthsAgoIso(e.addOn.monthsAgo), first.date);
    if (add) out.push({ symbol: e.symbol, type: "buy", quantity: addQty, price: round2(add.close), tradeDate: add.date });
  } else if (e.sell) {
    const initialQty = Math.max(baseQty + 1, Math.round(baseQty / (1 - e.sell.fraction)));
    const sellQty = initialQty - baseQty;
    out.push({ symbol: e.symbol, type: "buy", quantity: initialQty, price: round2(first.close), tradeDate: first.date });
    const s = snapDay(e.daily, monthsAgoIso(e.sell.monthsAgo), first.date);
    if (s && sellQty > 0) out.push({ symbol: e.symbol, type: "sell", quantity: sellQty, price: round2(s.close), tradeDate: s.date });
  } else {
    out.push({ symbol: e.symbol, type: "buy", quantity: baseQty, price: round2(first.close), tradeDate: first.date });
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  const email = process.env.SEED_USER_EMAIL?.trim();
  const userIdArg = process.env.SEED_USER_ID?.trim();
  const accountIdArg = process.env.SEED_ACCOUNT_ID?.trim();
  const doReset = (process.env.SEED_RESET ?? "true").toLowerCase() !== "false";
  const dryRun = (process.env.SEED_DRY_RUN ?? "").toLowerCase() === "true";

  if (!email && !userIdArg) {
    console.error("✖ Set SEED_USER_EMAIL=\"you@example.com\" (or SEED_USER_ID=\"<public.users.id>\") — the user whose book to seed.");
    return finish(1);
  }
  const user = userIdArg
    ? await prisma.user.findUnique({ where: { id: userIdArg }, select: { id: true, email: true } })
    : await prisma.user.findFirst({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    console.error(`✖ No user found for ${userIdArg ? `id=${userIdArg}` : `email=${email}`}. Sign in once via the app so the signup trigger creates public.users, then re-run.`);
    return finish(1);
  }
  const userId = user.id;
  console.log(`\n═══ SEED PORTFOLIO OVERVIEW (with history) ═══`);
  console.log(`User: ${user.email}  (id ${userId})`);

  // ── REQUIRE an explicit, OWNED, MANUAL account — never infer one (§2/§3) ──────────────────
  // The user's accounts, owner-scoped: an id NOT in this list is unknown-or-not-yours, indistinguishably.
  const accounts = await prisma.portfolioAccount.findMany({
    where: { userId }, select: { id: true, name: true, state: true }, orderBy: { createdAt: "asc" },
  });
  const listAccounts = () => {
    if (accounts.length === 0) { console.error("   (this user has NO accounts — create one via the app / POST /me/accounts first.)"); return; }
    console.error("   Pass one of these as SEED_ACCOUNT_ID (only a `manual` account can be seeded):");
    for (const a of accounts) console.error(`     ${a.id}   ${a.name}   [${a.state}]`);
  };

  if (!accountIdArg) {
    console.error(`\n✖ SEED_ACCOUNT_ID is required. This seeder writes to ONE account and will NOT guess which — an inferred target silently seeds the wrong book. Nothing written.`);
    listAccounts();
    return finish(1);
  }
  const account = accounts.find((a) => a.id === accountIdArg);
  if (!account) {
    console.error(`\n✖ Account ${accountIdArg} is not one of ${user.email}'s accounts (unknown, or owned by another user). Nothing written.`);
    listAccounts();
    return finish(1);
  }
  // §3 — a broker-attested (Verified) book must never contain hand-made transactions.
  if (account.state !== "manual") {
    console.error(`\n✖ Account "${account.name}" (${account.id}) is ${account.state} — a broker-attested (Verified) book. Seeding hand-made transactions into it would corrupt the mirror the broker owns; the backend itself refuses manual entry on linked accounts (manualEntryAllowed=false). Refusing. Nothing written.`);
    return finish(1);
  }
  console.log(`Account: "${account.name}"  (id ${account.id})  [${account.state}]`);

  // ── resolve the book against the live corpus ──
  const excluded = SCORED_PLAN.map((p) => p.symbol);
  const book: Resolved[] = [];
  for (const p of SCORED_PLAN) { const r = await resolveScored(p); if (r) book.push(r); }
  const unscored = await resolveUnscored(excluded);
  if (unscored) book.push(unscored);
  else console.log("⚠ No unscored universe stock with daily prices — the coverage-honesty state may not fire.");

  // ── build orders + print the plan ──
  const orders: Order[] = [];
  console.log(`\nResolved book (${book.length} names) — target ${inr(TOTAL_TARGET)}, staggered over ~24 months:`);
  console.log("  " + "SYMBOL".padEnd(11) + "SCORED".padEnd(18) + "SECTOR".padEnd(16) + "WT".padEnd(5) + "FIRST BUY".padEnd(13) + "@CLOSE".padEnd(11) + "ROLE");
  let earliest = "9999-99-99";
  for (const e of book) {
    const os = ordersFor(e);
    orders.push(...os);
    const firstBuy = os[0];
    if (firstBuy && firstBuy.tradeDate < earliest) earliest = firstBuy.tradeDate;
    const scoredLabel = e.scored ? `yes ${e.composite?.toFixed(1)} ${e.band}` : "NO (unscored)";
    const extra = e.addOn ? " +add-on" : e.sell ? " +sell" : "";
    console.log(
      "  " + e.symbol.padEnd(11) + scoredLabel.padEnd(18) + String(e.sector ?? "—").slice(0, 15).padEnd(16) +
        `${Math.round(e.weight * 100)}%`.padEnd(5) + (firstBuy?.tradeDate ?? "—").padEnd(13) +
        inr(firstBuy?.price ?? 0).padEnd(11) + e.role + extra,
    );
  }
  orders.sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));

  const scoredCount = book.filter((e) => e.scored).length;
  const unscoredCount = book.length - scoredCount;
  console.log(`\nCoverage: ${scoredCount} scored · ${unscoredCount} unscored → PHS reads SCOPED ("reflects <100% · N not scored").`);
  console.log(`History: ${orders.length} transactions, first buy ${earliest} → today. NAV should span ~${earliest} → last close.`);

  if (dryRun) {
    console.log("\n[dry-run] SEED_DRY_RUN=true — resolved only, wrote nothing. Unset it to seed.");
    return finish(0);
  }

  if (orders.length === 0) {
    console.error("\n✖ Resolved 0 transactions — the book failed to resolve against the corpus. Nothing to seed, nothing written.");
    return finish(1);
  }

  // Baseline for the HONEST "a PHS snapshot was produced" check (§6). PHS is per-user + append-only,
  // and reset does NOT clear it — so we can't infer freshness from an empty table. We record the
  // latest snapshot id BEFORE this run and later require a NEWER one to exist.
  const snapBefore = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true },
  });

  // ── §5 — NEVER DESTROY BEFORE YOU CAN REBUILD. On a reset run, PROVE the write path with one real
  //    accepted write BEFORE clearing anything. A rejected preflight → the pre-existing book is
  //    fully intact (reset never ran). The preflight row is then swept by the reset below, so the
  //    final book is exactly the intended orders — the preflight leaves no trace. ────────────────
  if (doReset) {
    console.log(`\n[preflight] proving the write path accepts a real transaction on "${account.name}" BEFORE touching anything…`);
    if (!(await post(userId, account.id, orders[0], "preflight"))) {
      console.error(`\n✖ Preflight write was REJECTED (see the ⚠️ line above). The write path is broken for this account, so the reset did NOT run — the pre-existing book is fully intact, NOTHING was destroyed. Fix the rejection and re-run.`);
      return finish(1);
    }
    const del = await resetAccount(userId, account.id);
    console.log(`   ✅ preflight accepted — safe to reset.\n[reset] cleared account "${account.name}" → ${del.transactions} txns, ${del.holdings} holdings deleted (incl. the preflight row). Other accounts + broker-synced holdings untouched. (SEED_RESET=false to append.)`);
  } else {
    console.log("\n[append] SEED_RESET=false — adding on top of this account's existing portfolio (no reset, nothing destroyed).");
  }

  // ── WRITE chronologically through the real path (replay → materialize → PHS per write). STOP on
  //    the FIRST failure: after the reset the book is half-built, so carrying on would pile more
  //    partial state onto a run that has already failed (§5). ─────────────────────────────────────
  console.log(`\nWriting ${orders.length} transactions via POST /me/transactions (chronological):`);
  let ok = 0;
  let writeFailed = false;
  for (const o of orders) {
    if (await post(userId, account.id, o)) { ok++; continue; }
    writeFailed = true;
    console.error(`\n✖ A write FAILED mid-run (see the ⚠️ line above) — STOPPING, not carrying on.`);
    console.error(`   Left behind: account "${account.name}" ${doReset ? "was reset and is now PARTIALLY seeded" : "was appended to and is now PARTIALLY updated"} — ${ok}/${orders.length} of the intended rows landed. Fix the cause and re-run to rebuild it.`);
    break;
  }
  console.log(`\n${ok}/${orders.length} transactions accepted.`);

  // Honest verdict: ✅ only if EVERY write landed AND a fresh PHS snapshot exists AND NAV is non-empty.
  const passed = await printResult(userId, { expected: orders.length, accepted: ok, snapBeforeId: snapBefore?.id ?? null });
  if (writeFailed && passed) throw new Error("invariant: a write failed but printResult passed");
  return finish(passed ? 0 : 1);
}

// ── read back holdings (enriched) + PHS snapshot + the NAV span, print them, and RETURN the
//    honest verdict: true ⇔ every write landed AND a fresh PHS snapshot was produced AND the NAV
//    series is non-empty. A harness that prints ✅ it didn't earn is worse than none (§6). ────────
interface ResultCtx { expected: number; accepted: number; snapBeforeId: string | null }
async function printResult(userId: string, ctx: ResultCtx): Promise<boolean> {
  const r = mockRes();
  await listHoldings(mockReq(userId, { query: {} }), r);
  const holdings: any[] = r.body?.data?.holdings ?? [];
  const totals = r.body?.data?.totals ?? {};

  console.log(`\n─── HOLDINGS (GET /me/holdings) ───`);
  console.log("  " + "SYMBOL".padEnd(11) + "WT".padEnd(7) + "VALUE".padEnd(12) + "UNRL P&L".padEnd(13) + "HEALTH".padEnd(9) + "TIER");
  for (const h of holdings) {
    const wt = `${(Number(h.weight) * 100).toFixed(1)}%`;
    const val = h.marketValue != null ? inr(Number(h.marketValue)) : "—";
    const unrl = h.unrealizedPnl != null ? inr(Number(h.unrealizedPnl)) : "—";
    const health = h.health != null ? `${Number(h.health).toFixed(0)} ${h.band}` : "unscored";
    console.log("  " + String(h.symbol).padEnd(11) + wt.padEnd(7) + val.padEnd(12) + unrl.padEnd(13) + health.padEnd(9) + h.tier);
  }
  console.log(
    `  TOTALS  value ${inr(Number(totals.currentValue ?? 0))} · invested ${inr(Number(totals.investedValue ?? 0))} · ` +
      `unrealized ${inr(Number(totals.unrealizedPnl ?? 0))} · realized(booked) ${inr(Number(totals.realizedPnlAll ?? 0))}`,
  );

  const snap = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  // FRESH ⇔ a snapshot exists that this run PRODUCED (a different row than the pre-run latest). A
  // stale pre-existing snapshot must not be mistaken for the seed having fired the PHS chain.
  const snapFresh = !!snap && snap.id !== ctx.snapBeforeId;
  console.log(`\n─── PHS SNAPSHOT ───`);
  if (!snap) console.log("  ✖ NO SNAPSHOT — the PHS trigger did not fire.");
  else if (!snapFresh) console.log("  ✖ NO FRESH SNAPSHOT — the latest snapshot predates this run; the seed did not produce one.");
  else {
    const cov = Math.round(Number(snap.coverage) * 100);
    const findings = (snap.firedFindings as any[]) ?? [];
    // (Stage 7 §12) the ceiling columns are dropped — retired in 1.2, Health shows TRUE and uncapped.
    console.log(`  PHS ${snap.phs ?? "—"}  band ${snap.band ?? "—"}  ${snap.provisional ? "PROVISIONAL " : ""}`);
    console.log(`  Coverage ${cov}% of book by value → ${cov < 100 ? `SCOPED: "reflects ${cov}% · unscored named"` : "whole-book"}  ·  findings ${findings.length}`);
  }

  // ── the NAV span — the point of this update ──
  const nav = await computePortfolioNav(userId);
  const navOk = nav.points > 0;
  console.log(`\n─── NAV SERIES (GET /me/portfolio/nav?period=ALL) ───`);
  if (!navOk) {
    console.log("  ✖ empty series — check DailyPrice coverage for the held symbols.");
  } else {
    const first = nav.series[0];
    const last = nav.series[nav.series.length - 1];
    const mid = nav.series[Math.floor(nav.series.length / 2)];
    const lo = Math.min(...nav.series.map((p) => p.value));
    const hi = Math.max(...nav.series.map((p) => p.value));
    console.log(`  SPAN ${nav.firstDate} → ${nav.lastDate}   ·   ${nav.points} trading-day points`);
    console.log(`  value: first ${inr(first.value)} · mid (${mid.date}) ${inr(mid.value)} · last ${inr(last.value)}   ·   range ${inr(lo)}–${inr(hi)}`);
    if (nav.symbolsNoPrice.length) console.log(`  (no-price, contributed 0: ${nav.symbolsNoPrice.join(", ")})`);
    console.log(`  → multi-hundred points with rises + a mid-history sell step + drift: ready to wire the value chart / Performance.`);
  }

  // ── THE HONEST VERDICT ──────────────────────────────────────────────────────────────────────
  const writesOk = ctx.expected > 0 && ctx.accepted === ctx.expected;
  const passed = writesOk && snapFresh && navOk;
  console.log(`\n─── VERDICT ───`);
  if (passed) {
    console.log(`✅ Chain proven: transaction write → FIFO replay → materialized holdings → PHS snapshot → NAV read.`);
    console.log(`   ${ctx.accepted}/${ctx.expected} writes accepted · fresh PHS snapshot · ${nav.points}-point NAV series.`);
    console.log(`   Open the Portfolio tab (signed in as ${process.env.SEED_USER_EMAIL ?? "this user"}) to eye-verify.`);
  } else {
    console.log(`✖ FAILED — the chain was NOT proven. This run did not do what it set out to do:`);
    if (!writesOk) console.log(`   • writes:        ${ctx.accepted}/${ctx.expected} accepted (need ALL).`);
    if (!snapFresh) console.log(`   • PHS snapshot:  ${snap ? "no snapshot produced by this run" : "none exists"} (need a fresh one).`);
    if (!navOk)     console.log(`   • NAV series:    empty (need ≥1 point).`);
  }
  return passed;
}

function finish(code: number) {
  return prisma.$disconnect().then(() => process.exit(code));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
