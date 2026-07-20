// ═══════════════════════════════════════════════════════════════════════
// ADD-TO-UNIVERSE (Step 7) — how a broker symbol we have never heard of becomes a stock.
//
// THE PROBLEM IT SOLVES. Until now, a broker holding whose symbol was outside our 504 was stored
// verbatim with stock_id NULL: displayable, honest, but held-NOT-VALUED and — as Step 6 proved —
// impossible to rescue when its account was deleted (holdings.stock_id is NOT NULL, so no manual
// holding can express it). The user owns those shares. They deserve a row.
//
// THE SPINE IS ISIN, AND IT IS NOT NEGOTIABLE. `stocks.isin` is UNIQUE NOT NULL (Step 1.4) because
// symbols drift and ISINs do not (LTIM→LTM renamed; the ISIN never moved). So:
//
//   symbol known            → resolve to it.                                   (unchanged)
//   symbol unknown, ISIN known and ALREADY IN THE DB
//                           → resolve to THAT stock. This is symbol drift, and catching it is the
//                             entire reason the catalog is keyed on ISIN. Creating a second row
//                             would fork one company into two — the exact bug the spine prevents.
//   ISIN is a CATALOGUED NON-EQUITY (an ETF, a fund)                          ← STEP 13
//                           → resolve to THAT INSTRUMENT, and do it BEFORE the ticker is even
//                             looked at. stock_id stays NULL: it is not an equity and never will
//                             be. Held, valued, NOT scored. This case used to fall through to
//                             ADMIT and fabricate a bare "stock" out of a mutual fund — see
//                             Pass 0 for the full autopsy.
//   symbol unknown, ISIN known and NEW
//                           → ADMIT: create a bare stock + its instrument row.
//   symbol unknown, NO ISIN → DO NOT CREATE. Keep the null-stock held-not-scored path.
//
// THE ORDER OF THOSE RULES IS ITSELF LOAD-BEARING. The catalogue is consulted FIRST, on the ISIN,
// because a broker ticker is not an identity — which is the whole reason this catalog is keyed on
// ISIN in the first place. Matching on the symbol before checking the ISIN would mean an ETF that
// ever listed under one of the 504's tickers got resolved to that STOCK and valued as an equity.
//
// "HELD-NOT-SCORED" NOW COVERS TWO GENUINELY DIFFERENT THINGS, and the sync outcome keeps them
// apart because they demand opposite responses:
//   · IDENTIFIED but unscoreable (an ETF)  → nothing is wrong. Nothing to fix. Do not page anyone.
//   · UNIDENTIFIABLE (the broker sent no ISIN) → a real gap, worth an operator's eye.
// Collapsing them — as `unmapped` did until Step 13 — makes a healthy ETF look like a data fault.
//
// WHY A MISSING ISIN IS A HARD STOP, not a thing to work around: a fabricated ISIN
// ("SYNTH:FAKESTOCK") would be accepted by the unique index and would look fine — until the real
// security arrived with its true ISIN and inserted as a SECOND row for the same company. The
// duplicate would be undetectable (different ISIN, different symbol) and permanent. A null
// stock_id is a visible, honest gap; a poisoned spine is an invisible, permanent lie. We take the
// gap. (The Step-6 rescue guard remains the fail-closed backstop for exactly these rows.)
//
// WHAT A BARE STOCK IS — AND IS NOT (§ honest-empty):
//   IS:     a symbol, a name, an ISIN, an exchange. An identity. It can be HELD, listed, valued
//           once we have a price, and rescued.
//   IS NOT: scored. It has no peer group, so the scoring engine never touches it — and that is
//           not a special case we invented here: 355 of 504 stocks ALREADY have no peer group and
//           ALREADY carry no score. A bare stock lands in well-trodden ground.
//   name:   the broker sends NO company name (confirmed against the Kite Connect v3 response
//           attributes). So name = the symbol. That is not a placeholder pretending to be a name;
//           it is the honest statement that the ticker is all anyone told us.
//   sector: NULL. The broker sends none, and we will not invent one. A fabricated "Unclassified"
//           sector would show up in sector rollups as though it meant something.
//
// This module CREATES rows in `stocks` / `instruments`. It writes NOTHING to the broker — there is
// no write seam to a broker anywhere in this codebase, and this does not add one.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { classifyIsin } from "../ingestions/shared/isin-class.js";
import { reportBrokerSeeded } from "../ingestions/shared/ingestion-error.js";
import type { StandardHolding } from "./types.js";

/** Where a holding's stock came from — surfaced in the sync outcome so admission is never silent. */
export interface AdmissionOutcome {
  symbol: string;
  /** The stock this holding resolved to. null ⇒ not an equity, or unidentifiable. */
  stockId: string | null;
  instrumentId: string | null;
  how:
    | "known_symbol"
    | "matched_by_isin"
    | "admitted"
    /** STEP 17 — admitted as a NON-EQUITY catalogue row (today: a bond). stock_id NULL: it is not an
     *  equity and never will be. Held, valued if it prices, NEVER scored. */
    | "admitted_instrument"
    /** Resolved to a NON-EQUITY catalogue instrument (an ETF, a fund). Held, valued, NOT scored. */
    | "matched_instrument"
    /** No ISIN, OR an ISIN we cannot honestly classify ⇒ no row. The honest gap. */
    | "unidentifiable";
}

/** A resolved map the sync path can read straight through. */
export interface ResolutionResult {
  /**
   * stockId is NULLABLE here (Step 13). A holding can be fully IDENTIFIED — we know its
   * instrument, its name, its NAV — and still have no stock, because it is not an equity. That is
   * an ETF, and it is a resolved holding, not a failed one.
   */
  bySymbol: Map<string, { stockId: string | null; instrumentId: string | null }>;
  outcomes: AdmissionOutcome[];
  /** Newly created stocks (bare, unscored) — reported loudly by the sync outcome. */
  admitted: { symbol: string; isin: string; stockId: string }[];
  /** STEP 17 — newly created NON-EQUITY catalogue rows (a bond the broker surfaced that no bhavcopy
   *  had shown us). stock_id NULL, so held-NOT-scored by construction. */
  admittedInstruments: { symbol: string; isin: string; instrumentId: string; assetClass: string }[];
  /** Resolved to a non-equity instrument — identified, held, NOT scored. Named, never dropped. */
  heldNotScored: { symbol: string; isin: string; instrumentId: string; assetClass: string }[];
  /** Holdings we could not identify (no ISIN, or an ISIN we refuse to guess at) — they keep stock_id
   *  NULL. Named, never dropped. Identity/quantity/invested are all still shown; only VALUE is absent. */
  unidentifiable: string[];
}

/**
 * Resolve every holding in a broker snapshot to a stock, admitting new ones where the broker gave
 * us an ISIN. Read-mostly: it only ever INSERTS, never updates or deletes an existing stock — a
 * broker feed must not be able to rewrite our universe's facts, only to extend it with rows that
 * were not there.
 */
export async function resolveHoldingsToUniverse(holdings: StandardHolding[]): Promise<ResolutionResult> {
  const bySymbol = new Map<string, { stockId: string | null; instrumentId: string | null }>();
  const outcomes: AdmissionOutcome[] = [];
  const admitted: ResolutionResult["admitted"] = [];
  const admittedInstruments: ResolutionResult["admittedInstruments"] = [];
  const heldNotScored: ResolutionResult["heldNotScored"] = [];
  const unidentifiable: string[] = [];

  const symbols = [...new Set(holdings.map((h) => h.symbol))];
  if (symbols.length === 0)
    return { bySymbol, outcomes, admitted, admittedInstruments, heldNotScored, unidentifiable };

  // ══ Pass 0 (STEP 13): THE CATALOGUE ANSWERS FIRST. ═══════════════════════════════════════
  //
  // THE BUG THIS FIXES. This resolver only ever consulted `stocks`. So a broker ETF holding — a
  // real, catalogued, NAV-carrying instrument — matched nothing and fell through to Pass 3, which
  // ADMITTED IT AS A BARE STOCK: a `stocks` row with an INF (fund-namespace) ISIN and an
  // `instruments` row wearing asset_class='stock'. A mutual fund in the equity universe, sitting
  // exactly where the scoring engine goes looking. (Once Step 13 catalogues the 337 ETFs the
  // failure mode only CHANGES: admitBareStock's instrument.create hits UNIQUE(isin), throws
  // P2002, the transaction rolls back, the recovery hunts for a *stock* with that ISIN, finds
  // none, and the holding degrades to "unidentifiable" — reported as a mystery when we know
  // precisely what it is and are computing its analytics nightly.)
  //
  // WHY THIS RUNS BEFORE THE SYMBOL MATCH, not after it. Pass 1 keys on the broker's TICKER, and
  // a ticker is not an identity — that is the entire premise of the ISIN spine. If an ETF ever
  // listed under a ticker that collides with one of the 504 (today: zero collisions, measured —
  // but "zero today" is not a design), a symbol-first resolver would hand that ETF holding a
  // STOCK's id and value it as an equity. Asking the catalogue first makes the collision
  // unreachable: an ISIN we can identify is never re-identified by its ticker.
  //
  // NOTE THE `stockId: null` FILTER: non-equity rows only. An instrument WITH a stockId is an
  // equity's catalogue row, and those belong to Pass 1/2 (their ISIN lives in `stocks`). This
  // pass exists solely for the classes that have no stock — and never will.
  const allIsins = [...new Set(holdings.map((h) => h.isin).filter((i): i is string => !!i))];
  const catalogued = allIsins.length
    ? await prisma.instrument.findMany({
        where: { isin: { in: allIsins }, stockId: null },
        select: { id: true, isin: true, assetClass: true },
      })
    : [];
  const nonEquityByIsin = new Map(catalogued.map((i) => [i.isin, i]));

  for (const h of holdings) {
    if (!h.isin) continue;
    const inst = nonEquityByIsin.get(h.isin);
    if (!inst) continue;
    // Resolved — and deliberately NOT into the equity map. This holding has no stock and never
    // will; that is what it MEANS to be an ETF (or, since Step 14, a REIT/InvIT).
    //
    // Held and valued, never scored. (Step 14.5: "and valued" is now literally true — see
    // portfolio/price-resolver.ts. Until then this line was aspirational: nothing priced a
    // stock_id-NULL instrument, so a resolved ETF rendered with a name, a quantity, and no ₹.)
    bySymbol.set(h.symbol, { stockId: null, instrumentId: inst.id });
    heldNotScored.push({ symbol: h.symbol, isin: h.isin, instrumentId: inst.id, assetClass: inst.assetClass });
    outcomes.push({ symbol: h.symbol, stockId: null, instrumentId: inst.id, how: "matched_instrument" });
  }

  // Everything the catalogue already answered is OUT of the equity passes entirely.
  const equityCandidates = holdings.filter((h) => !bySymbol.has(h.symbol));
  const equitySymbols = [...new Set(equityCandidates.map((h) => h.symbol))];

  // ── Pass 1: the symbols we already know (the ordinary case; unchanged behaviour) ──
  const known = equitySymbols.length
    ? await prisma.stock.findMany({
        where: { symbol: { in: equitySymbols } },
        select: { id: true, symbol: true },
      })
    : [];
  const stockIdBySymbol = new Map(known.map((s) => [s.symbol, s.id]));

  // ── Pass 2: the strangers. Try the SPINE before creating anything. ──
  const strangers = equityCandidates.filter((h) => !stockIdBySymbol.has(h.symbol));
  const strangerIsins = [...new Set(strangers.map((h) => h.isin).filter((i): i is string => !!i))];

  // An unknown SYMBOL whose ISIN we already hold is not a new company — it is a RENAME. Resolve
  // it to the existing stock. (LTIM→LTM: the ticker moved, the security did not.)
  const byIsin = strangerIsins.length
    ? await prisma.stock.findMany({ where: { isin: { in: strangerIsins } }, select: { id: true, isin: true, symbol: true } })
    : [];
  const stockIdByIsin = new Map(byIsin.map((s) => [s.isin, s.id]));

  for (const h of strangers) {
    if (!h.isin) continue; // handled below — unidentifiable
    const existing = stockIdByIsin.get(h.isin);
    if (existing) {
      stockIdBySymbol.set(h.symbol, existing);
      outcomes.push({ symbol: h.symbol, stockId: existing, instrumentId: null, how: "matched_by_isin" });
    }
  }

  // ══ Pass 3 (STEP 17): ADMIT THE GENUINELY NEW — BRANCHING ON WHAT IT ACTUALLY IS. ═══════════
  //
  // THE BUG THIS FIXES, AND IT IS THE SAME BUG AS PASS 0's. Until now this pass called
  // admitBareStock() on ANYTHING carrying an ISIN. It had no notion of asset class, so a corporate
  // bond, a G-sec or an uncatalogued mutual fund all became `stocks` rows wearing
  // asset_class='stock' — fabricated into the equity universe, sitting exactly where loadUniverse()
  // and the scoring engine go looking. Step 13 fixed this FOR ETFs by CATALOGUING them (so Pass 0
  // catches them); it never fixed the FALL-THROUGH, so the hole stayed open for every class the
  // catalogue did not yet contain. Recon proved it live: all 356 NSE-traded bonds would have been
  // admitted as stocks.
  //
  // THE FIX IS NOT A NEW HEURISTIC — it is the SAME ISIN taxonomy the bond fence uses
  // (ingestions/shared/isin-class.ts). One module answers "what is this ISIN?" for both callers, so
  // the ingest and the broker resolver cannot drift apart and disagree about what a security is.
  //
  //   equity          → a `stocks` row + its catalogue row.   (UNCHANGED — the existing path.)
  //   debt            → a CATALOGUE row only, stock_id NULL.  (NEW — held, priced if it prices,
  //                     NEVER scored. It never enters `stocks`, so scoring cannot see it.)
  //   unclassifiable  → NO ROW. The honest gap.               (NEW — and strictly safer than today,
  //                     which fabricates a stock.)
  //
  // WHY `unclassifiable` COSTS THE USER NOTHING THEY WERE OWED. Identity (the ticker), quantity and
  // INVESTED AMOUNT (qty × the broker's avgCost) are all known from the broker's own snapshot and
  // are all still shown — see brokers/union.ts. The ONLY thing a missing catalogue row costs is the
  // CURRENT VALUE, which we genuinely do not know. That is an honest "unavailable", not a blank row,
  // and infinitely better than a confident lie about what the instrument is.
  for (const h of strangers) {
    if (stockIdBySymbol.has(h.symbol)) continue; // matched by symbol/ISIN above

    const cls = classifyIsin(h.isin);

    if (cls.kind === "unclassifiable") {
      // THE HONEST GAP. No ISIN ⇒ no identity. An ISIN we cannot honestly class ⇒ no HONEST identity.
      // Both refuse the row for the same reason: a fabricated identity in shared canonical data is
      // permanent and invisible, and a null is neither. (See the header on why a synthesised ISIN
      // would poison the spine — a synthesised CLASS poisons it in exactly the same way.)
      unidentifiable.push(h.symbol);
      outcomes.push({ symbol: h.symbol, stockId: null, instrumentId: null, how: "unidentifiable" });
      continue;
    }

    try {
      if (cls.kind === "debt") {
        // A BOND THE BHAVCOPY HAS NEVER SHOWN US — an OTC or BSE-only NCD, or simply one that had
        // not printed yet. The broker is the only source that will ever tell us this exists, so it
        // is admitted on the broker's word, keyed on the ISIN it gave us.
        const created = await admitCatalogueInstrument(h.symbol, h.isin!, "bond");
        bySymbol.set(h.symbol, { stockId: null, instrumentId: created.instrumentId });
        if (created.wasCreated) {
          admittedInstruments.push({ symbol: h.symbol, isin: h.isin!, instrumentId: created.instrumentId, assetClass: "bond" });
          // PART C — the audit event. Fires HERE, at catalogue-row CREATION, which is what makes it
          // per-instrument-ONCE for free: a second user holding the same ISIN resolves at Pass 0 and
          // never reaches this line.
          await reportBrokerSeeded({
            isin: h.isin!,
            name: h.symbol,
            assetClass: "bond",
            reason: cls.why,
          });
        }
        outcomes.push({ symbol: h.symbol, stockId: null, instrumentId: created.instrumentId, how: "admitted_instrument" });
        continue;
      }

      // EQUITY — the original path, byte-for-byte. A real stock outside our 504 still becomes a bare
      // stock: admitted, priced forward by the next daily-prices run (loadUniverse reads `stocks`),
      // and HELD-NOT-SCORED, because it has no peer group and the scoring engine only ever walks
      // PeerGroup → StockPeerGroup → Stock. Scoring it is a separate, deliberate promotion.
      const created = await admitBareStock(h.symbol, h.isin!, h.exchange);
      stockIdBySymbol.set(h.symbol, created.stockId);
      admitted.push({ symbol: h.symbol, isin: h.isin!, stockId: created.stockId });
      if (created.wasCreated) {
        await reportBrokerSeeded({
          isin: h.isin!,
          name: h.symbol,
          assetClass: "stock",
          reason: cls.why,
        });
      }
      outcomes.push({ symbol: h.symbol, stockId: created.stockId, instrumentId: created.instrumentId, how: "admitted" });
    } catch (e) {
      // ONE BAD ROW MUST NOT FAIL THE WHOLE SYNC. A mirror that refuses to mirror because one
      // instrument is odd is worse than a mirror with one honest gap in it. Fall back to the
      // null-stock path for this symbol and carry on with the rest of the snapshot.
      console.error(`[add-to-universe] could not admit ${h.symbol} (isin ${h.isin}) — falling back to held-not-scored`, e);
      unidentifiable.push(h.symbol);
      outcomes.push({ symbol: h.symbol, stockId: null, instrumentId: null, how: "unidentifiable" });
    }
  }

  // ── Instruments: every resolved stock needs its catalog row (the portfolio holds INSTRUMENTS) ──
  const resolvedStockIds = [...stockIdBySymbol.values()];
  const instruments = resolvedStockIds.length
    ? await prisma.instrument.findMany({ where: { stockId: { in: resolvedStockIds } }, select: { id: true, stockId: true } })
    : [];
  const instrumentIdByStockId = new Map(instruments.map((i) => [i.stockId!, i.id]));

  for (const [symbol, stockId] of stockIdBySymbol) {
    bySymbol.set(symbol, { stockId, instrumentId: instrumentIdByStockId.get(stockId) ?? null });
  }
  for (const o of outcomes) {
    if (o.stockId) o.instrumentId = instrumentIdByStockId.get(o.stockId) ?? null;
  }
  // Record the ordinary case too, so the outcome is a complete account of every symbol.
  for (const h of holdings) {
    if (outcomes.some((o) => o.symbol === h.symbol)) continue;
    const hit = bySymbol.get(h.symbol);
    outcomes.push({
      symbol: h.symbol,
      stockId: hit?.stockId ?? null,
      instrumentId: hit?.instrumentId ?? null,
      how: "known_symbol",
    });
  }

  return { bySymbol, outcomes, admitted, admittedInstruments, heldNotScored, unidentifiable };
}

/**
 * Create the bare stock + its instrument catalog row, atomically.
 *
 * IDEMPOTENT ON THE SPINE. Two concurrent syncs (a poll sweep and a manual "Sync now") can race on
 * the same new symbol. The unique index on `isin` is the arbiter: the loser's insert throws P2002
 * and we simply re-read the winner's row. The universe cannot fork under concurrency, because the
 * database — not our check-then-insert — decides who wins.
 *
 * `wasCreated` distinguishes "I made this row" from "I lost the race and read yours" — which is what
 * keeps the Part-C audit event PER-INSTRUMENT-ONCE even under two concurrent syncs.
 */
async function admitBareStock(
  symbol: string,
  isin: string,
  exchange: string | null,
): Promise<{ stockId: string; instrumentId: string | null; wasCreated: boolean }> {
  try {
    const r = await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.create({
        data: {
          symbol,
          // The broker sends no company name. The ticker is genuinely all we know — say so, rather
          // than inventing a plausible-looking name that would then read as verified.
          name: symbol,
          isin, // THE SPINE — broker truth, and the reason this row is allowed to exist at all
          exchange: exchange ?? "NSE",
          sectorId: null, // we do not know it, and will not fabricate an "Unclassified" bucket
          isActive: true,
          // NO peer group ⇒ never scored. Not a special case: 355/504 stocks already live here.
        },
        select: { id: true },
      });
      const instrument = await tx.instrument.create({
        data: {
          isin,
          symbol,
          name: symbol,
          assetClass: "stock", // the ISIN says equity (isin-class) — no longer an "until proven otherwise" guess
          stockId: stock.id,
          isActive: true,
        },
        select: { id: true },
      });
      return { stockId: stock.id, instrumentId: instrument.id };
    });
    return { ...r, wasCreated: true };
  } catch (e) {
    // Lost the race (or the symbol/ISIN already exists) — read the winner's row rather than
    // fighting it. This is the ONLY correct response to a unique-violation on the spine.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.stock.findUnique({ where: { isin }, select: { id: true } });
      if (existing) {
        const inst = await prisma.instrument.findUnique({ where: { stockId: existing.id }, select: { id: true } });
        return { stockId: existing.id, instrumentId: inst?.id ?? null, wasCreated: false };
      }
    }
    throw e;
  }
}

/**
 * STEP 17 — create a CATALOGUE-ONLY instrument (no `stocks` row, ever).
 *
 * THE WHOLE POINT IS WHAT IT DOES *NOT* DO. There is no `stocks` insert here and there never will
 * be. `stock_id` stays NULL, and that single fact is what makes the instrument HELD-NOT-SCORED by
 * construction rather than by a flag someone has to remember to set: the scoring universe is
 * PeerGroup → StockPeerGroup → Stock, and a row with no stock is unreachable from it. There is no
 * code path — not a rescore, not a cascade, not an admin trigger — that can hand this a Health Score.
 *
 * THE NAME. The broker sends NO company name (StandardHolding has no such field; Kite's
 * /portfolio/holdings does not carry one). So `name` is the TRADINGSYMBOL — genuinely all anyone told
 * us, and an exchange ticker, not broker branding. It is therefore already BROKER-NEUTRAL: two users
 * on two different brokers holding this ISIN get this one shared row, and neither sees the other's
 * broker anywhere on it (the broker association lives on `broker_holdings`, never on `instruments` —
 * which has no broker or user column at all).
 *
 * AND IT IS NOT PERMANENT. The moment this ISIN prints in an NSE BhavCopy, the bond ingest's
 * ON CONFLICT (isin) DO UPDATE rewrites `name` to the real FinInstrmNm. The honest placeholder is
 * replaced by the honest truth, for free. A genuinely OTC bond keeps its ticker — which is the
 * truthful outcome, not a failure.
 *
 * IDEMPOTENT ON THE SPINE, same as admitBareStock and for the same reason.
 */
async function admitCatalogueInstrument(
  symbol: string,
  isin: string,
  assetClass: "bond",
): Promise<{ instrumentId: string; wasCreated: boolean }> {
  try {
    const created = await prisma.instrument.create({
      data: {
        isin, // THE SPINE — broker truth
        symbol,
        name: symbol, // the broker sends no name; the ticker is all we know (see above)
        assetClass,
        stockId: null, // ← HELD-NOT-SCORED, structurally. Never set. Never settable.
        isActive: true,
      },
      select: { id: true },
    });
    return { instrumentId: created.id, wasCreated: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.instrument.findUnique({ where: { isin }, select: { id: true } });
      if (existing) return { instrumentId: existing.id, wasCreated: false };
    }
    throw e;
  }
}
