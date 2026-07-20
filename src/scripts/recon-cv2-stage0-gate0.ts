// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 0 — GATE 0 RECON (READ-ONLY. Writes NOTHING.)
//
// Verifies the spec's premise and captures the baselines that gate the whole stage:
//   · per-user Health / Quality / Signals / coverage / totalValue (the UN-WAIVABLE baseline)
//   · scored / heldNotScored / heldNotValued populations + values (items 5 + 7)
//   · the coverage line the ₹10L/₹90L user reads TODAY vs what it WOULD read after (item 4)
//   · the `: 0` fallback blast radius — priced stocks that assembled to marketValue 0 (item 5)
//   · the 9 byte-identical table fingerprints + 504-scored-stock fingerprint (item 8)
//
// assemblePortfolio / computePhs / listPortfolioDisclosure are pure reads (grep-proven elsewhere).
// Every SQL below is a SELECT. This script is a fossil-safe mirror of the live read path.
//   node_modules/.bin/tsx src/scripts/recon-cv2-stage0-gate0.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio, listPortfolioDisclosure } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";

const q = <T = any>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
const money = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Order-independent row fingerprint — identical method to recon-step21-baseline.ts.
async function fp(table: string) {
  const r = await q(
    `SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(('x'||substr(md5(t::text),1,8))::bit(32)::bigint),0)::bigint AS fingerprint
     FROM ${table} t`,
  );
  return { table, rows: Number(r[0].rows), fingerprint: Number(r[0].fingerprint) };
}

async function main() {
  // ── 9 BYTE-IDENTICAL FINGERPRINTS (Stage 0 must not touch any of them) ──
  const fps = [];
  for (const t of ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots",
                   "market_cap_tier_snapshot", "instruments", "instrument_corporate_events",
                   "instrument_prices", "index_prices"]) {
    fps.push(await fp(t));
  }
  console.log("=== 9 TABLE FINGERPRINTS (byte-identical guard) ===\n" + j(fps));

  const scored = await q(`
    SELECT COUNT(*)::int AS scored_stocks,
           COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::bigint AS fp
    FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band
          FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`);
  console.log("\n=== SCORED-STOCK FINGERPRINT (the 504 + their snapshots) ===\n" + j(scored));
  const snapCount = await q(`SELECT COUNT(*)::int n FROM score_snapshots`);
  console.log("score_snapshots total rows: " + snapCount[0].n);

  // ── TEST-USER COHORT: everyone with transactions, + their latest persisted PHS snapshot ──
  const users = await q<{ user_id: string; email: string | null; txns: number }>(`
    WITH u AS (SELECT DISTINCT user_id FROM transactions),
    tx AS (SELECT user_id, COUNT(*)::int AS txns FROM transactions GROUP BY user_id)
    SELECT u.user_id, us.email, COALESCE(tx.txns,0) AS txns
    FROM u
    LEFT JOIN tx ON tx.user_id=u.user_id
    LEFT JOIN users us ON us.id=u.user_id
    ORDER BY tx.txns DESC NULLS LAST`);

  console.log(`\n=== COHORT: ${users.length} users with transactions ===`);

  const perUser: any[] = [];
  for (const u of users) {
    const prefix = u.user_id.slice(0, 8);

    // Latest persisted snapshot (the fossil the FE renders today) — the un-waivable baseline source.
    const snapRows = await q<any>(`
      SELECT phs, band, quality::text, signals::text, coverage::text,
             total_value::text, scored_value::text, provisional, fingerprint
      FROM portfolio_health_snapshot WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, u.user_id);
    const snap = snapRows[0] ?? null;

    // LIVE engine recompute (pure read) — what the number IS right now.
    const { holdings } = await assemblePortfolio(u.user_id);
    const r = computePhs(holdings);

    // `: 0` blast radius — a stock in byStock (confirmed-priced) that assembled to marketValue 0.
    const zeroValued = holdings.filter((h) => h.marketValue === 0).map((h) => h.symbol);

    // Disclosure (the READ path) — heldNotScored (priced, unjudged) + heldNotValued (unpriceable).
    const disc = await listPortfolioDisclosure(u.user_id);
    const hnsValue = Number(disc.heldNotScoredValue);
    const hnvBrokerValue = disc.heldNotValued.reduce((s, h) => s + (h.brokerCurrentValue ? Number(h.brokerCurrentValue) : 0), 0);
    const hnvNullCount = disc.heldNotValued.filter((h) => h.brokerCurrentValue == null).length;

    // Controller's live coverage-line counts (reproduced EXACTLY).
    const totalCount = await prisma.holding.count({ where: { userId: u.user_id, quantity: { gt: 0 } } });
    const scoredCount = await prisma.holding.count({
      where: { userId: u.user_id, quantity: { gt: 0 }, instrument: { stock: { scoreSnapshots: { some: {} } } } },
    });

    // BEFORE vs AFTER coverage line.
    const beforeCoveragePct = Math.round(r.coverage * 100);
    const afterTotal = r.totalValue + hnsValue;                 // heldNotScored ENTERS the denominator
    const afterCoveragePct = afterTotal > 0 ? Math.round((r.scoredValue / afterTotal) * 100) : 0;
    const unvaluedShareOfBook = (afterTotal + hnvBrokerValue) > 0
      ? hnvBrokerValue / (afterTotal + hnvBrokerValue) : 0;

    perUser.push({
      prefix, email: u.email, txns: u.txns,
      // ── UN-WAIVABLE baseline (must be byte-identical at Gate 3) ──
      live_health: r.health, live_quality: r.quality, live_signals: r.signals,
      live_coverage: Number(r.coverage.toFixed(6)),
      live_totalValue: Number(r.totalValue.toFixed(2)),
      live_scoredValue: Number(r.scoredValue.toFixed(2)),
      snapshot_phs: snap?.phs ?? null,
      snapshot_quality: snap?.quality ?? null,
      snapshot_signals: snap?.signals ?? null,
      snapshot_coverage: snap?.coverage ?? null,
      snapshot_totalValue: snap?.total_value ?? null,
      snapshot_fingerprint: snap?.fingerprint ?? null,
      snapshot_provisional: snap?.provisional ?? null,
      // ── populations (items 5 + 7) ──
      counts: {
        byStock_holdings: holdings.length,
        heldNotScored: disc.heldNotScored.length,
        heldNotValued: disc.heldNotValued.length,
        zeroValued_stocks: zeroValued.length,
      },
      zeroValued_symbols: zeroValued,
      heldNotScored_value: Number(hnsValue.toFixed(2)),
      heldNotScored_symbols: disc.heldNotScored.map((h) => `${h.symbol}=${money(Number(h.marketValue))}(${h.assetClass}/${h.priceSource})`),
      heldNotValued_brokerValue: Number(hnvBrokerValue.toFixed(2)),
      heldNotValued_nullValueCount: hnvNullCount,
      heldNotValued_symbols: disc.heldNotValued.map((h) => `${h.symbol}${h.brokerCurrentValue ? "=" + money(Number(h.brokerCurrentValue)) : "=?"}`),
      // ── the coverage line: TODAY vs AFTER ──
      coverage_line_today: `Covers ${scoredCount} of ${totalCount} holdings · ${beforeCoveragePct}% of book value.`,
      coverage_line_after: `Covers ${scoredCount} of ${totalCount + disc.heldNotScored.length + disc.heldNotValued.length} holdings · ${afterCoveragePct}% of book value.`,
      controller_scoredCount: scoredCount,
      controller_totalCount: totalCount,
      denominator_today: Number(r.totalValue.toFixed(2)),
      denominator_after: Number(afterTotal.toFixed(2)),
      unvalued_share_of_book: Number((unvaluedShareOfBook * 100).toFixed(2)),
      unvalued_exceeds_25pct: unvaluedShareOfBook > 0.25,
    });
  }

  console.log("\n=== PER-USER BASELINE + DEFECT MAGNITUDE ===\n" + j(perUser));

  // ── ROLLUPS ──
  const anyHealthMismatch = perUser.filter((p) => p.snapshot_phs != null && p.live_health !== p.snapshot_phs);
  const withFunds = perUser.filter((p) => p.heldNotScored_value > 0);
  const withZeroValued = perUser.filter((p) => p.counts.zeroValued_stocks > 0);
  const withUnvaluedOver25 = perUser.filter((p) => p.unvalued_exceeds_25pct);

  console.log("\n=== ROLLUP ===\n" + j({
    cohort_size: perUser.length,
    users_where_live_health_differs_from_snapshot: anyHealthMismatch.map((p) => ({ prefix: p.prefix, live: p.live_health, snap: p.snapshot_phs })),
    users_with_heldNotScored_capital_excluded_today: withFunds.map((p) => ({ prefix: p.prefix, hidden: money(p.heldNotScored_value), today_pct: p.coverage_line_today.match(/(\d+)% of/)?.[1] + "%", after_pct: p.coverage_line_after.match(/(\d+)% of/)?.[1] + "%" })),
    users_hit_by_zero_value_fallback: withZeroValued.map((p) => ({ prefix: p.prefix, symbols: p.zeroValued_symbols })),
    users_with_unvalued_over_25pct: withUnvaluedOver25.map((p) => p.prefix),
  }));
}

main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
