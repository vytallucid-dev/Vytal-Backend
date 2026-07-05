// ═══════════════════════════════════════════════════════════════════════
// ALERT EVALUATION PASS — the DB-wired daily run.
//
// One pass over every ACTIVE alert: read the CURRENT computed reading for its stock
// (latest EOD close · current band · findings newly appeared since the prior snapshot),
// reduce to a boolean via the pure condition helpers, run the crossing/re-arm state
// machine (evaluate.ts), and — only on a genuine crossing — RECORD an alert_event and
// flip the alert's (active, armed) flags in ONE transaction. It SENDS NOTHING; email is a
// separate later stage that drains alert_events (delivered=false).
//
// READ-ONLY over computed data: price / band / findings already exist — we evaluate them,
// never recompute. Unscored stocks (no snapshot) can't evaluate band/finding → skipped
// HONESTLY (no fire, no error); price still works (they have a price row).
//
// Hung on the daily EOD cycle via the ALERTS_EVAL_DAILY job, scheduled AFTER the
// EOD-price → PG-rescore cascade settles (so band/findings reflect the day's rescore).
//
// TEST SEAMS (never used in production): `onlyUserIds` scopes the scan to specific owners
// (a hermetic harness), and `readingOverrides` substitutes the current reading per stock
// so the crossing/re-arm SEQUENCE can be driven deterministically through the real write
// path (the transition + event-write + flag-flip all run for real).
// ═══════════════════════════════════════════════════════════════════════
import type { AlertType, LabelBand } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import {
  priceConditionTrue,
  bandConditionTrue,
  findingConditionTrue,
  transition,
} from "./evaluate.js";

// ── the current computed reading for one stock (what the condition helpers consume) ──
export interface StockReading {
  /** latest EOD close (StockPrice.price), or null when the stock has no price row. */
  close: number | null;
  /** current LabelBand (latest snapshot), or null when unscored. */
  band: LabelBand | null;
  /** whether the stock has a latest snapshot at all (⇔ scored). */
  scored: boolean;
  /** finding keys present on the latest snapshot but NOT on the prior one (patterns ∪
   *  red-flags). Empty when unscored or when there is no prior snapshot to diff against. */
  newFindingKeys: Set<string>;
}

export interface RunAlertsEvalOptions {
  /** Fire timestamp (fired_at / last_triggered_at). Defaults to now. */
  now?: Date;
  /** TEST SEAM: scope the scan to these owners only. Omit in production (scan all). */
  onlyUserIds?: string[];
  /** TEST SEAM: override the current reading for specific stockIds (drives the
   *  crossing/re-arm sequence deterministically without fabricating real snapshots). */
  readingOverrides?: Map<string, StockReading>;
}

export type AlertEvalStatus =
  | "fired"
  | "rearmed"
  | "held"
  | "skipped_unscored"
  | "skipped_no_price";

export interface AlertEvalOutcome {
  alertId: string;
  stockId: string;
  symbol: string;
  type: AlertType;
  status: AlertEvalStatus;
  /** null when skipped (not evaluable). */
  conditionTrue: boolean | null;
  /** the recorded triggering value, when fired. */
  snapshot: string | null;
}

export interface AlertsEvalResult {
  scanned: number;
  fired: number;
  rearmed: number;
  held: number;
  skipped: number;
  outcomes: AlertEvalOutcome[];
}

/**
 * Bulk-read the current reading for a set of stocks (no N+1). Fixed handful of queries
 * regardless of how many stocks are in play:
 *   stock_prices (close) · score_snapshots (latest+prior per stock, for band + finding
 *   diff) · score_patterns + score_red_flags (finding keys on those snapshots).
 */
export async function assembleReadings(stockIds: string[]): Promise<Map<string, StockReading>> {
  const out = new Map<string, StockReading>();
  if (stockIds.length === 0) return out;

  const [prices, snapshots] = await Promise.all([
    prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true },
    }),
    // Latest + prior per stock: pre-sorted so the first two rows per stock are the two
    // most-recent snapshots (newest wins on ties by version).
    prisma.scoreSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      select: { id: true, stockId: true, labelBand: true },
    }),
  ]);

  const closeBy = new Map<string, number>();
  for (const p of prices) closeBy.set(p.stockId, Number(p.price));

  // First two snapshots per stock = [latest, prior].
  const snapsByStock = new Map<string, { id: string; band: LabelBand }[]>();
  for (const s of snapshots) {
    const arr = snapsByStock.get(s.stockId) ?? [];
    if (arr.length < 2) {
      arr.push({ id: s.id, band: s.labelBand });
      snapsByStock.set(s.stockId, arr);
    }
  }

  // Finding keys (patterns ∪ red-flags) for the latest + prior snapshot ids.
  const snapIds = [...snapsByStock.values()].flatMap((a) => a.map((s) => s.id));
  const [patterns, redFlags] =
    snapIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.scorePattern.findMany({
            where: { snapshotId: { in: snapIds } },
            select: { snapshotId: true, patternKey: true },
          }),
          prisma.redFlag.findMany({
            where: { snapshotId: { in: snapIds } },
            select: { snapshotId: true, flagKey: true },
          }),
        ]);

  const keysBySnap = new Map<string, Set<string>>();
  const add = (snapId: string, key: string) => {
    const set = keysBySnap.get(snapId) ?? new Set<string>();
    set.add(key);
    keysBySnap.set(snapId, set);
  };
  for (const p of patterns) add(p.snapshotId, p.patternKey);
  for (const f of redFlags) add(f.snapshotId, f.flagKey);

  for (const stockId of stockIds) {
    const snaps = snapsByStock.get(stockId) ?? [];
    const latest = snaps[0] ?? null;
    const prior = snaps[1] ?? null;
    let newFindingKeys = new Set<string>();
    if (latest) {
      const latestKeys = keysBySnap.get(latest.id) ?? new Set<string>();
      const priorKeys = prior ? keysBySnap.get(prior.id) ?? new Set<string>() : new Set<string>();
      // "Newly appeared" ⇔ on latest, not on prior. With no prior snapshot we cannot
      // establish "wasn't on the prior one" → treat as no new findings (conservative).
      if (prior) newFindingKeys = new Set([...latestKeys].filter((k) => !priorKeys.has(k)));
    }
    out.set(stockId, {
      close: closeBy.get(stockId) ?? null,
      band: latest ? latest.band : null,
      scored: latest != null,
      newFindingKeys,
    });
  }
  return out;
}

// ── reduce one alert + its reading to a boolean condition, or an honest skip ──
type Reduced =
  | { kind: "cond"; conditionTrue: boolean; snapshotValue: string }
  | { kind: "skip"; status: "skipped_unscored" | "skipped_no_price" };

interface AlertRow {
  type: AlertType;
  operator: "above" | "below" | "fires";
  thresholdPrice: unknown; // Prisma.Decimal | null
  thresholdBand: LabelBand | null;
  findingKey: string | null;
}

function reduce(a: AlertRow, reading: StockReading | undefined): Reduced {
  switch (a.type) {
    case "price": {
      const close = reading?.close ?? null;
      if (close == null) return { kind: "skip", status: "skipped_no_price" };
      const threshold = Number(a.thresholdPrice);
      const conditionTrue = priceConditionTrue(a.operator as "above" | "below", close, threshold);
      return { kind: "cond", conditionTrue, snapshotValue: close.toFixed(2) };
    }
    case "health_band": {
      if (!reading || !reading.scored || reading.band == null) {
        return { kind: "skip", status: "skipped_unscored" };
      }
      const conditionTrue = bandConditionTrue(
        a.operator as "above" | "below",
        reading.band,
        a.thresholdBand as LabelBand,
      );
      return { kind: "cond", conditionTrue, snapshotValue: reading.band };
    }
    case "finding": {
      if (!reading || !reading.scored) return { kind: "skip", status: "skipped_unscored" };
      const conditionTrue = findingConditionTrue(a.findingKey, reading.newFindingKeys);
      // Record WHAT fired: the specific key, or the newly-appeared set for an "any" alert.
      const snapshotValue = a.findingKey ?? [...reading.newFindingKeys].sort().join(",");
      return { kind: "cond", conditionTrue, snapshotValue };
    }
    default:
      return { kind: "skip", status: "skipped_unscored" };
  }
}

/**
 * Run ONE evaluation pass over the active alerts. Records fires into alert_events and
 * updates (active, armed, last_triggered_at) — nothing else. Idempotent-friendly: a
 * still-true condition on a disarmed repeating alert is a no-op (the anti-spam rule).
 */
export async function runAlertsEvalPass(opts: RunAlertsEvalOptions = {}): Promise<AlertsEvalResult> {
  const now = opts.now ?? new Date();

  const alerts = await prisma.alert.findMany({
    where: { active: true, ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}) },
    select: {
      id: true,
      userId: true,
      stockId: true,
      type: true,
      operator: true,
      thresholdPrice: true,
      thresholdBand: true,
      findingKey: true,
      repeatMode: true,
      active: true,
      armed: true,
      stock: { select: { symbol: true } },
    },
  });

  const stockIds = [...new Set(alerts.map((a) => a.stockId))];
  const readings = await assembleReadings(stockIds);
  if (opts.readingOverrides) {
    for (const [k, v] of opts.readingOverrides) readings.set(k, v);
  }

  const outcomes: AlertEvalOutcome[] = [];
  let fired = 0,
    rearmed = 0,
    held = 0,
    skipped = 0;

  for (const a of alerts) {
    const base = {
      alertId: a.id,
      stockId: a.stockId,
      symbol: a.stock.symbol,
      type: a.type,
    };
    const r = reduce(a, readings.get(a.stockId));

    if (r.kind === "skip") {
      skipped++;
      outcomes.push({ ...base, status: r.status, conditionTrue: null, snapshot: null });
      continue;
    }

    const t = transition(
      { repeatMode: a.repeatMode, active: a.active, armed: a.armed },
      r.conditionTrue,
    );

    if (t.fire) {
      // Event write + flag flip MUST be atomic — else a crash between them would either
      // lose the record or leave the alert armed and re-fire next pass.
      await prisma.$transaction([
        prisma.alertEvent.create({
          data: {
            alertId: a.id,
            userId: a.userId,
            stockId: a.stockId,
            firedAt: now,
            snapshot: r.snapshotValue,
          },
        }),
        prisma.alert.update({
          where: { id: a.id },
          data: { active: t.nextActive, armed: t.nextArmed, lastTriggeredAt: now },
        }),
      ]);
      fired++;
      outcomes.push({ ...base, status: "fired", conditionTrue: true, snapshot: r.snapshotValue });
    } else if (t.changed) {
      await prisma.alert.update({
        where: { id: a.id },
        data: { active: t.nextActive, armed: t.nextArmed },
      });
      rearmed++;
      outcomes.push({ ...base, status: "rearmed", conditionTrue: r.conditionTrue, snapshot: null });
    } else {
      held++;
      outcomes.push({ ...base, status: "held", conditionTrue: r.conditionTrue, snapshot: null });
    }
  }

  return { scanned: alerts.length, fired, rearmed, held, skipped, outcomes };
}
