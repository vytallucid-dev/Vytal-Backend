// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONSHIP GROUNDING — the retrieval half of the PERSONALIZED stock insight.
//
// The stock fact block (grounding.ts) describes the COMPANY. This module describes the READER'S
// RELATIONSHIP to it — held? / weight / sector exposure / peers held / since-added health delta —
// and renders a `[YOUR RELATIONSHIP TO THIS STOCK]` section for the SAME closed-world prompt. The
// personalized insight seam concatenates the two blocks; the model reads the health facts THROUGH the
// reader's position.
//
// ── ★ EVERY PERSONAL NUMBER GOES THROUGH A SPOKEN-FORM HELPER (pctStr / scoreStr) ─────────────────
// Exactly like the health block: a fraction renders "~4% (raw fraction 0.0417)", a score renders the
// integer. So `factsKeyOf`'s strip-`(raw …)` absorbs a price tick that nudges a weight from 0.0417 to
// 0.0419 — the SPOKEN "~4%" is unchanged, the key is unchanged, the cached card survives. No 3-sig-fig
// sweep is needed because nothing here leaks a raw float outside the convention (the portfolio block's
// entity-ledger ₹ and bind JSON did; this block has none). The counts ("3 of 10") and the since-added
// delta ("+9") are integers already in spoken form, with no raw tail to strip.
//
// ── FAIL-SOFT ─────────────────────────────────────────────────────────────────────────────────────
// A LEGITIMATE ABSENCE (held but no snapshot yet ⇒ weight unknown) renders honest-empty "not available"
// — it is a fact, not a failure. A THROWN sub-read error (holdings, portfolio view, peer join) returns
// `degraded: true`, and the caller treats the whole request as ORIENTING and serves the shared card.
// We never render a half-built personalized block, and we never persist one.
//
// ── POSTURE IS NOT A BLOCK FACT ───────────────────────────────────────────────────────────────────
// It selects the ask and routes the cache (caller's job). It is NOT written into the block: a label
// invites the model to lean on the label over the facts. The facts imply the posture.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { buildPortfolioHealthView } from "../../portfolio/phs/portfolio-health-view.js";
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";
import { NA, isNum, pctStr, scoreStr } from "../core/grounding.js";

/** held → MONITORING · watched-not-held → DECIDING · neither → ORIENTING (caller serves the shared card). */
export type StockPosture = "monitoring" | "deciding" | "orienting";

/** The stock, resolved to what the relationship reads need: its id, symbol, and its sector NAME in the
 *  entity-ledger vocabulary (`stocks.sector.name`, the exact string `EntityLedgerEntry.sector` carries). */
export interface StockRef {
  id: string;
  symbol: string;
  sectorName: string | null;
}

export interface StockRelationshipFacts {
  posture: StockPosture;
  held: boolean;
  watched: boolean;
  /** Fraction 0–1 — the issuer's share of the whole book (from the entity ledger). null ⇔ no snapshot. */
  positionWeight: number | null;
  /** Coarse bucket ("a recent position" …) — the ONE clock-derived fact; see periodBucket. null when
   *  not held, or held via a broker feed that carries no FIFO lot (so no buy date). */
  holdingPeriodBucket: string | null;
  /** Fraction 0–1 — the user's total weight in THIS stock's resolved sector (includes this position). */
  sectorWeight: number | null;
  sectorName: string | null;
  /** Members of this stock's peer group the user directly holds (this stock included when held). */
  peersHeld: number | null;
  peerGroupSize: number | null;
  pinnedAt: Date | null;
  /** Composite health at pin-time (Watchlist.pinnedHealth) — null ⇔ unscored when pinned / not watched. */
  pinnedHealth: number | null;
  favorite: boolean;
  /** Current composite (from the health view) — the far end of the since-added delta. */
  currentComposite: number | null;
}

export interface StockRelationshipGrounding {
  facts: StockRelationshipFacts;
  /** The `[YOUR RELATIONSHIP TO THIS STOCK]` block, or "" when degraded (caller falls back to shared). */
  block: string;
  degraded: boolean;
}

/** ★ THE PERSONAL-FACT LABELS — the anchor set. Phase 2 requires the model's payload to carry ≥1
 *  citation whose `label` matches one of these, so a generic impersonal read cannot pass. Each is a
 *  substring of its rendered line, which is how the citation echo-and-assert locates it. */
export const PERSONAL_FACT_LABELS = [
  "Position weight in book",
  "Sector exposure",
  "Members of this stock's peer group you hold",
  "Health since you added it",
] as const;

/** The cheap relationship PROBE — three indexed lookups. It decides routing (held OR watched →
 *  personalize) AND fetches the watchlist row (so the rich gather needn't re-read it). Held is
 *  union-aware: manual FIFO holdings OR the broker mirror. Throws propagate → caller degrades. */
export interface RelationshipProbe {
  held: boolean;
  watchlist: { addedAt: Date; favorite: boolean; pinnedHealth: number | null } | null;
}

export async function probeStockRelationship(userId: string, stockId: string): Promise<RelationshipProbe> {
  const [watchlist, manual, broker] = await Promise.all([
    prisma.watchlist.findUnique({
      where: { userId_stockId: { userId, stockId } },
      select: { addedAt: true, favorite: true, pinnedHealth: true },
    }),
    prisma.holding.findFirst({ where: { userId, stockId }, select: { id: true } }),
    prisma.brokerHolding.findFirst({ where: { userId, stockId }, select: { id: true } }),
  ]);
  return { held: Boolean(manual) || Boolean(broker), watchlist };
}

/** Distinct stockIds the user DIRECTLY holds (manual FIFO ∪ broker mirror) — for the peer intersection. */
async function heldStockIds(userId: string): Promise<Set<string>> {
  const [manual, broker] = await Promise.all([
    prisma.holding.findMany({ where: { userId, stockId: { not: null } }, select: { stockId: true }, distinct: ["stockId"] }),
    prisma.brokerHolding.findMany({ where: { userId, stockId: { not: null } }, select: { stockId: true }, distinct: ["stockId"] }),
  ]);
  const ids = new Set<string>();
  for (const r of [...manual, ...broker]) if (r.stockId) ids.add(r.stockId);
  return ids;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** ⚠ THE ONE CLOCK-DERIVED FACT. Coarse by design so it churns the key at MOST twice in a holding's
 *  life (the 3-month and 12-month crossings) rather than daily — and coarse so a bounded-stale
 *  "a recent position" degrades gracefully, unlike a precise "held 3 days" (the PD7 failure). It stays
 *  IN the key so it can never lie: when the bucket flips, the key flips and the card regenerates. */
function periodBucket(buyDate: Date, now: Date): string {
  const months = (now.getUTCFullYear() - buyDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - buyDate.getUTCMonth());
  if (months < 3) return "a recent position (held under three months)";
  if (months < 12) return "a position held for several months";
  return "a long-held position (held over a year)";
}

/**
 * Gather the reader's relationship to one SCORED stock and render its block. Caller guarantees the
 * stock is scored and the user is related (held or watched) — ORIENTING never reaches here.
 *
 * `probe` is threaded in from the routing probe so the watchlist row is read once. Any thrown sub-read
 * (portfolio view, peer join, lot read) → `degraded: true`; the caller serves the shared card.
 */
export async function groundStockRelationship(
  userId: string,
  stock: StockRef,
  view: HealthSnapshotView,
  probe: RelationshipProbe,
): Promise<StockRelationshipGrounding> {
  const held = probe.held;
  const watched = Boolean(probe.watchlist);
  const posture: StockPosture = held ? "monitoring" : "deciding";
  const currentComposite = view.verdict?.composite ?? null;

  try {
    // ── Position + sector weight — off the same union-aware entity ledger the portfolio page reads. ──
    const pv = await buildPortfolioHealthView(userId);
    const entities = pv.snapshot?.constructionRead.entities ?? null;
    let positionWeight: number | null = null;
    let sectorWeight: number | null = null;
    if (entities) {
      const mine = entities.find((e) => e.constituentInstruments.some((c) => c.symbol === stock.symbol));
      positionWeight = mine?.weight ?? null;
      if (stock.sectorName) {
        const inSector = entities.filter((e) => e.sector === stock.sectorName);
        sectorWeight = inSector.length ? inSector.reduce((s, e) => s + (e.weight ?? 0), 0) : null;
      }
    }

    // ── Peers of this stock held (direct equity intersection). ──
    let peersHeld: number | null = null;
    let peerGroupSize: number | null = null;
    if (view.identity.peerGroup) {
      const [members, held] = await Promise.all([
        prisma.stockPeerGroup.findMany({ where: { peerGroupId: view.identity.peerGroup.id }, select: { stockId: true } }),
        heldStockIds(userId),
      ]);
      peerGroupSize = members.length;
      peersHeld = members.filter((m) => held.has(m.stockId)).length;
    }

    // ── Holding period — earliest OPEN FIFO lot (preserved through splits). Broker-only → none. ──
    let holdingPeriodBucket: string | null = null;
    if (held) {
      const lot = await prisma.holdingLot.findFirst({
        where: { holding: { userId, stockId: stock.id } },
        orderBy: { buyDate: "asc" },
        select: { buyDate: true },
      });
      holdingPeriodBucket = lot ? periodBucket(lot.buyDate, new Date()) : null;
    }

    const facts: StockRelationshipFacts = {
      posture,
      held,
      watched,
      positionWeight,
      holdingPeriodBucket,
      sectorWeight,
      sectorName: stock.sectorName,
      peersHeld,
      peerGroupSize,
      pinnedAt: probe.watchlist?.addedAt ?? null,
      pinnedHealth: probe.watchlist?.pinnedHealth ?? null,
      favorite: probe.watchlist?.favorite ?? false,
      currentComposite,
    };
    const sectorDisplay = view.identity.sector?.displayName ?? stock.sectorName;
    return { facts, block: renderRelationshipBlock(facts, sectorDisplay), degraded: false };
  } catch (err) {
    console.warn(
      `[ai/insight-personal] relationship read failed for ${stock.symbol} — degrading to orienting: ${(err as Error).message}`,
    );
    return { facts: { ...orientingFacts(), held, watched, currentComposite }, block: "", degraded: true };
  }
}

/** A relationship struct with no relationship — the shape returned on a degrade (block is ""). */
function orientingFacts(): StockRelationshipFacts {
  return {
    posture: "orienting",
    held: false,
    watched: false,
    positionWeight: null,
    holdingPeriodBucket: null,
    sectorWeight: null,
    sectorName: null,
    peersHeld: null,
    peerGroupSize: null,
    pinnedAt: null,
    pinnedHealth: null,
    favorite: false,
    currentComposite: null,
  };
}

/** Render the `[YOUR RELATIONSHIP TO THIS STOCK]` section. Every number is a spoken-form helper or an
 *  integer; a legitimately-absent value is honest-empty "not available", never omitted. */
function renderRelationshipBlock(f: StockRelationshipFacts, sectorDisplay: string | null): string {
  const L: string[] = [];
  L.push(
    "[YOUR RELATIONSHIP TO THIS STOCK] (the reader's own position and watch context — facts about their exposure, never instructions about what to do)",
  );
  L.push(`Held: ${f.held ? "yes" : "no"}`);
  L.push(`On watchlist: ${f.watched ? "yes" : "no"}`);

  if (f.held) {
    L.push(`Position weight in book: ${isNum(f.positionWeight) ? pctStr(f.positionWeight) : NA}`);
    L.push(`Holding period: ${f.holdingPeriodBucket ?? NA}`);
  }

  // Sector exposure + peers-held speak to BOTH a holder and a watcher ("a third bank you're weighing").
  const sectorLabel = sectorDisplay ? `your weight in ${sectorDisplay}` : "your weight in this stock's sector";
  L.push(`Sector exposure (${sectorLabel}): ${isNum(f.sectorWeight) ? pctStr(f.sectorWeight) : NA}`);
  L.push(
    `Members of this stock's peer group you hold: ${
      f.peersHeld != null && f.peerGroupSize != null ? `${f.peersHeld} of ${f.peerGroupSize}` : NA
    }`,
  );

  if (f.watched) {
    L.push(`On watchlist since: ${f.pinnedAt ? monthYear(f.pinnedAt) : NA}`);
    if (f.pinnedHealth != null && isNum(f.currentComposite)) {
      const now = Math.round(f.currentComposite);
      const delta = now - f.pinnedHealth;
      L.push(
        `Health since you added it: pinned ${scoreStr(f.pinnedHealth)} → now ${scoreStr(f.currentComposite)} (change ${delta >= 0 ? `+${delta}` : `${delta}`})`,
      );
    } else {
      L.push(`Health since you added it: ${f.pinnedHealth == null ? "not scored when you added it" : NA}`);
    }
  }

  return L.join("\n");
}
