// ═══════════════════════════════════════════════════════════════════════
// UNIFIED POSITIONS — a user's WHOLE portfolio: manual holdings (FIFO lot-replay) ⊎
// broker holdings (mirrored snapshot), across EVERY account they own.
//
// TWO VALUE ENGINES, ONE UNION, NEITHER CONTAMINATING THE OTHER (§2.2):
//   • manual  — our FIFO lot-replay owns qty / avgCost / invested / realized.
//   • broker  — the broker's snapshot is TRUTH. Its avgCost is taken AS-GIVEN and is NEVER
//               lot-replayed through our FIFO. It has no lot register, so realizedPnl is
//               `null` — HONESTLY ABSENT, never 0 (0 would assert "nothing was realized",
//               which we do not know; the broker holdings feed carries no realized figure).
// The two never merge in storage (separate tables); they merge only in THIS read projection.
//
// PER-ACCOUNT, NEVER COLLAPSED (§2.4): the same stock in two accounts is TWO positions, both
// real, both counted. This function returns per-account LINES — it does not aggregate. PHS
// aggregates by symbol downstream (concentration must see one combined exposure, not two
// half-sized ones); the display surface wants the lines. Those are deliberately different
// shapes — see phs/assemble.
//
// SOURCE IS A DISPLAY/TRUST LABEL, NEVER A SCORING INPUT (§2.4). Every share weighs the same
// regardless of where it came from. `brokerCurrentValue` is the broker's own ₹ figure and is
// carried for display ONLY — PHS values every share with OUR price × qty, so that the same
// stock can never score differently because of who reported it.
//
// `enabled` GATES SYNCING, NOT READING (Step 4). A severed connection (deactivated/unlinked)
// stops RECEIVING data; it does not stop HAVING it. Its holdings are a frozen last-known-good
// snapshot and they stay in the union — flagged `stale`, never dropped. Filtering them out
// here (as this function did until Step 4) silently deleted real positions from the user's
// score the moment they unlinked: the shares were still theirs, but PHS recomputed as if they
// held nothing. Freezing is the honest read; dropping is a lie that costs the user their score.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "./types.js";

export type PositionSource = "manual" | "broker";

export interface UnifiedPosition {
  source: PositionSource; // display/trust label ONLY — never an input to the score
  /** IDENTITY ONLY (Step 5) — the `holdings` row this position came from, so a DISPLAY surface
   *  can join back to the manual-only facts that live there (the lot register, lastComputedAt).
   *  null for a broker position: it has no holdings row, and no lot register to point at.
   *  Carries NO economic content — it adds nothing to what a position is WORTH, so the Step-3
   *  math this union feeds is untouched by its presence. */
  holdingId: string | null;
  /** The account this position sits in. Manual: the holding's account. Broker: the account the
   *  connection is BOUND to (§2.3 — derived, never denormalised, so it cannot drift). */
  accountId: string;
  accountName: string;
  /** The catalog row this position is OF. null ONLY for a broker symbol outside our universe
   *  (no instrument exists for it) — held-not-scored, never dropped. */
  instrumentId: string | null;
  /** null for a broker symbol outside our universe, or for a non-equity instrument.
   *  null ⇒ HELD-NOT-SCORED: we cannot price or score it, and we will not pretend to. */
  stockId: string | null;
  /** The downstream GROUPING key (concentration aggregates on it), not strictly a ticker.
   *  A fund instrument carries NO ticker (instruments.symbol is NULL since Step 9), so a
   *  manual fund position falls back to its ISIN — a real, unique identifier. We never
   *  fabricate a ticker, and we never drop the row. (Unreachable today: transactions.stock_id
   *  is NOT NULL, so the ledger cannot yet hold a fund.) */
  symbol: string;
  quantity: string; // decimal string (no float drift)
  avgCost: string; // manual → FIFO weighted-avg of open lots. broker → the BROKER's avg, as-given.
  /** Manual only. Broker positions have NO lot register, so this is null — absent, not zero. */
  realizedPnl: string | null;
  /** What the user PUT IN. manual → Σ open-lot qty × cost (FIFO). broker → quantity × the broker's
   *  avgCost, which is the same definition over a snapshot instead of a lot register.
   *
   *  NEVER NULL for a real position, and that is deliberate (Step 17): it is computed entirely from
   *  data we already hold and needs NO price. An unpriceable holding therefore still shows its
   *  invested amount — a name, a quantity and a cost, with only the CURRENT VALUE honestly absent.
   *  Nothing renders as a blank mystery row. */
  investedValue: string | null;
  // ── broker-only context (undefined for manual positions) ──
  broker?: BrokerId;
  brokerConnectionId?: string;
  brokerEnabled?: boolean;
  /** FROZEN (Step 4): the connection is severed, so this quantity is the LAST KNOWN one, not a
   *  current one. It STILL counts — the user still owns these shares; only our confidence in the
   *  QUANTITY is stale. The VALUE is not stale at all: PHS prices every share with OUR live price
   *  (§2.4 / Step-3 Ruling 1), never the broker's, so a frozen position is marked to today's
   *  market. Always false for a manual position (our own ledger is never stale). */
  stale?: boolean;
  /** When this snapshot was last refreshed from the broker. THE staleness fact — age is derived
   *  from it at READ time and never stored, because it grows every day a connection stays severed
   *  (a frozen `ageDays` would start lying the moment it was written). null ⇒ never synced. */
  lastSyncedAt?: string | null;
  /** The BROKER's own ₹ valuation. DISPLAY/TRUST ONLY — deliberately NOT what PHS scores on
   *  (see the §2.4 note in the header). null when the broker didn't provide one. */
  brokerCurrentValue?: string | null;
}

export interface UnifiedOptions {
  /** include manual holdings fully exited (qty=0) — default false (current positions only). */
  includeExited?: boolean;
}

/**
 * Read a user's canonical positions across ALL their accounts. Read-only.
 *
 * IDOR: every row is scoped to `userId` (taken from the auth token by the caller, never from a
 * payload). Manual holdings carry user_id; broker holdings carry a denormalised user_id AND
 * hang off a user-owned connection — so a position from another user's account is unreachable.
 */
export async function listUnifiedPositions(
  userId: string,
  opts: UnifiedOptions = {},
): Promise<UnifiedPosition[]> {
  const [manual, brokerRows] = await Promise.all([
    prisma.holding.findMany({
      where: { userId, ...(opts.includeExited ? {} : { quantity: { gt: 0 } }) },
      select: {
        id: true, // identity for the display join (lots / lastComputedAt) — see holdingId
        accountId: true,
        account: { select: { name: true } },
        instrumentId: true,
        quantity: true,
        avgCost: true,
        investedValue: true,
        realizedPnl: true,
        instrument: { select: { symbol: true, stockId: true, isin: true } },
      },
    }),
    prisma.brokerHolding.findMany({
      // NO `enabled` FILTER (Step 4 — this is the BUG-A fix). Every broker holding the user has
      // is read, severed or not. A severed connection's rows are FROZEN, not gone.
      //
      // ── qty > 0: THE SAME RULE THE MANUAL BRANCH APPLIES, FINALLY APPLIED HERE TOO ──────────
      // "An exited position is not a holding" lived on the manual side alone (the `gt: 0` above)
      // and was simply forgotten here. So a position sold MANUALLY vanished, while the same
      // position sold AT THE BROKER ghosted on at qty 0 / ₹0 / 0.0% weight. One fact, two answers,
      // decided by which engine happened to hold the row — the tell that the rule had no single home.
      //
      // IT IS NOT A DEFENSIVE GUARD; the broker really does send these. Kite keeps a sold
      // instrument in GET /portfolio/holdings for the settlement day, every pool zeroed
      // (quantity/t1/collateral all 0 ⇒ heldQuantity 0) with the sale recorded in `used_quantity`.
      // Observed on a live sold-out demat: 3 rows back, 3 rows at zero. The mirror stored them
      // faithfully — faithful is right for a mirror, but a settled-out row is not a POSITION, and
      // this read is what decides what counts as one.
      //
      // THIS IS THE CHOKEPOINT, which is why the filter belongs here: display, the account-card
      // count, and PHS assemble all read positions through this one function. Anywhere else would
      // fix one of the three and leave the other two counting ghosts — and PHS is the one that
      // matters most, because N (position count) is a SCORING INPUT twice over:
      //   • C1's threshold is max(15, 1.5 × 100/N). The 15 floor binds for N ≥ 10, so on a normal
      //     book a ghost changes nothing — but on a THIN book (N < 10) it lowers the bar, which
      //     means MORE entities clear it and a LARGER deduction. A ghost PENALISES; it does not
      //     flatter. A 3-position book carrying 2 ghosts was judged at the 5-position bar.
      //   • C6 charges 0.5/holding above 25. A ghost pushes a wide book further over.
      // Both run the same direction: ghosts understate Construction, so removing them can RAISE a
      // score. That is a correction, not a regression — but it IS a score change, and §13 requires
      // it be asserted rather than assumed (see verify-broker-exited.ts, sections D and E).
      //
      // Honours `includeExited` on the SAME terms as the manual branch — one option, one meaning,
      // both engines.
      where: { userId, ...(opts.includeExited ? {} : { quantity: { gt: 0 } }) },
      select: {
        instrumentId: true, // null ⇒ symbol outside our universe (held-not-scored)
        stockId: true,
        symbol: true,
        quantity: true,
        avgCost: true,
        currentValue: true,
        brokerConnectionId: true,
        // The §2.3 binding: a connection backs at most ONE account. Derived here rather than
        // denormalised onto broker_holdings, so an account_id can never drift out of sync.
        //
        // ⚠️ THIS DERIVATION IS WHY SEVER MUST NEVER NULL `account.broker_connection_id`: the
        // path to the account runs holding → connection → accounts[0]. Null the pointer and
        // every frozen row below falls into the `if (!acct) continue` skip — the act of
        // severing would erase the very snapshot it exists to preserve. Sever freezes the
        // FEED (`enabled=false`); the BINDING is the anchor and stays. (See lifecycle.sever.)
        connection: {
          select: {
            broker: true,
            enabled: true,
            lastSyncedAt: true,
            accounts: { select: { id: true, name: true }, take: 1 },
          },
        },
      },
    }),
  ]);

  const positions: UnifiedPosition[] = [];

  for (const h of manual) {
    positions.push({
      source: "manual",
      holdingId: h.id,
      accountId: h.accountId,
      accountName: h.account.name,
      instrumentId: h.instrumentId, // always present for a manual holding (NOT NULL)
      stockId: h.instrument.stockId, // null ⇒ non-equity instrument (held-not-scored)
      // A fund has no ticker (symbol NULL). Group it by its ISIN — real and unique — rather
      // than inventing a symbol or dropping the position. See UnifiedPosition.symbol.
      symbol: h.instrument.symbol ?? h.instrument.isin,
      quantity: h.quantity.toString(),
      avgCost: h.avgCost.toString(), // FIFO weighted-avg of OPEN lots
      realizedPnl: h.realizedPnl.toString(), // FIFO-matched
      investedValue: h.investedValue.toString(),
      stale: false, // our own ledger — it is the source of truth, so it is never stale
    });
  }

  for (const b of brokerRows) {
    // A connection with no bound account cannot sync (Step 2b refuses it), so any broker holding
    // that exists has a bound account. Defensive: skip rather than invent an account id.
    const acct = b.connection.accounts[0];
    if (!acct) continue;

    positions.push({
      source: "broker",
      holdingId: null, // a mirrored snapshot row — there is no holdings row, and no lot register
      accountId: acct.id,
      accountName: acct.name,
      // Both null for a symbol outside our universe. The row is STILL emitted — stored verbatim,
      // displayable, simply unscorable. Never dropped, never faked.
      instrumentId: b.instrumentId,
      stockId: b.stockId,
      symbol: b.symbol,
      quantity: b.quantity.toString(),
      avgCost: b.avgCost.toString(), // the BROKER's avg — as-given, NEVER FIFO-replayed
      realizedPnl: null, // no lot register ⇒ honestly absent (NOT 0 — we do not know it)
      // ── INVESTED (Step 17) ───────────────────────────────────────────────────────────────────
      // This was `null`, on the reasoning that "the snapshot feed carries no invested figure". That
      // is TRUE OF THE FEED and FALSE OF THE ARITHMETIC: quantity and avg_cost are both NOT NULL on
      // every broker holding, and their product IS the invested amount — the same definition the
      // manual side uses (Σ open-lot qty × cost), so the two engines stay directly comparable.
      //
      // WHY IT MATTERS MORE THAN IT LOOKS. This number needs NO PRICE OF OURS. So a holding we
      // cannot value — an OTC bond with no exchange close, an instrument whose ISIN we refuse to
      // guess at — still shows the user WHAT THEY PUT IN, beside their quantity and their name.
      // That is the difference between "current value unavailable" and a blank, mystery row. It is
      // the whole of Part B's promise in one field.
      //
      // Still NOT a FIFO figure and still not pretending to be: realizedPnl above stays null,
      // because a snapshot has no lot register and we will not invent one.
      investedValue: b.quantity.mul(b.avgCost).toString(),
      broker: b.connection.broker,
      brokerConnectionId: b.brokerConnectionId,
      brokerEnabled: b.connection.enabled,
      // NOT SYNCING ⇔ STALE (Step 4). One meaning, so a paused connection and an unlinked one
      // cannot behave differently: both stopped receiving, both are frozen, both still count.
      // NOTE this is deliberately NOT keyed on the session token: a DEAD token is ROUTINE (§2.5
      // — broker tokens die daily; that is a reconnect, not a sever) and leaves the position
      // fresh-but-unrefreshable, disclosed via lastSyncedAt. Only a severed BINDING is stale.
      stale: !b.connection.enabled,
      lastSyncedAt: b.connection.lastSyncedAt?.toISOString() ?? null,
      brokerCurrentValue: b.currentValue?.toString() ?? null, // display/trust only — NOT scored on
    });
  }

  return positions;
}
