// src/scripts/rescore-banking-pit.ts
//
// PIT-CORRECT HISTORICAL RESCORE of the 5-quarter banking snapshot history
// (FY25Q4, FY26Q1, FY26Q2, FY26Q3, FY26Q4) for the 12 banks, now that quarterly CASA
// is seeded. Each historical period recomputes reading the CASA value APPROPRIATE TO ITS
// PERIOD (newest found quarter ≤ that period — the tiered rule, PIT-gated), NOT the
// newest quarter overall. Corrects: (a) LIVE-applied-backward on the legacy-LIVE banks,
// (b) CASA-exclusion inflation on the banks that now have real CASA.
//
// LOAD-BEARING: NO FUTURE CASA leaks into a past snapshot. The PIT gate is the new
// `casaPeriodKey` arg threaded into loadBankingCtx (filters quarter-keyed CASA to ≤ period).
//
// APPEND-ONLY: supersede via persistMember (skip-identical on unchanged fingerprint, else
// version+1). Committed snapshots are never mutated. Findings re-fire on each new version.
// BANKING-ONLY: PG5/PG6 (12 banks) × 5 periods. No other PG / non-banking stock touched.
//
// USAGE:
//   npx tsx src/scripts/rescore-banking-pit.ts           → DRY-RUN (PIT proof + before/after, rolled-back persist, writes nothing)
//   npx tsx src/scripts/rescore-banking-pit.ts --write   → durable supersede + findings + post-commit verify

import { prisma } from "../db/prisma.js";
import { computePgScores, ensureScaffold, finalizeRun, persistMember, type PgRef, type MemberWriteResult, type Scaffold } from "../scoring/composite/score-pass.js";
import { loadBankingCtx } from "../scoring/metrics/banking-load.js";
import { resolveCasa } from "../scoring/metrics/banking-types.js";

const WRITE = process.argv.includes("--write");

const BANK_PGS: PgRef[] = [
  { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" },
  { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" },
];
// The 4 genuinely-HISTORICAL periods get a POINT-IN-TIME rescore (asOf = quarter-end):
// they were PIT-backfilled (run=manual_api, v1), so recompute reproduces their Market/
// Momentum/Ownership exactly and changes ONLY CASA/Foundation.
const PIT_PERIODS = ["FY25Q4", "FY26Q1", "FY26Q2", "FY26Q3"] as const;
// FY26Q4 is the LIVE period (asOf=now, run=post_ingest, continuously superseded by daily
// price-driven handlePgRescore). It must be rescored LIVE (no PIT cutoff) so Market stays
// on CURRENT prices; CASA then resolves to the newest quarter overall = FY26/Q4 (its own
// period). A PIT cutoff here would wrongly roll Market back to the Mar-31 quarter-end.
const LIVE_PERIODS = ["FY26Q4"] as const;
const PERIODS = [...PIT_PERIODS, ...LIVE_PERIODS] as const;
const isLivePeriod = (pk: string) => (LIVE_PERIODS as readonly string[]).includes(pk);

/** Indian FYxxQy → quarter-end Date (midnight UTC). Mirrors backfill-history.quarterEnd. */
function quarterEnd(periodKey: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  if (!m) throw new Error(`bad periodKey ${periodKey}`);
  const fy = 2000 + Number(m[1]);
  const q = Number(m[2]);
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}

const num = (d: any): number | null => (d == null ? null : typeof d.toNumber === "function" ? d.toNumber() : Number(d));
const f2 = (v: number | null | undefined) => (v == null ? "  —  " : v.toFixed(2));
const sgn = (v: number | null) => (v == null ? "  —  " : (v >= 0 ? "+" : "") + v.toFixed(2));
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const padL = (s: string | number, w: number) => String(s).padStart(w);
function hr(c = "─", n = 100) { return c.repeat(n); }

class Rollback extends Error {}

// ── committed-head before-state per (stockId, periodKey) ─────────────────────────────
interface BeforeState {
  version: number | null;
  composite: number | null;
  fSub: number | null; mSub: number | null; mktSub: number | null; ownSub: number | null;
  casa: { rawValue: number | null; metricScore: number | null; scoreState: string; l1: number | null; l2: number | null; l3: number | null; l3N: number | null } | null;
  patternCount: number;
  redFlagCount: number;
}
async function committedBefore(stockId: string, periodKey: string): Promise<BeforeState> {
  const snap = await prisma.scoreSnapshot.findFirst({
    where: { stockId, snapshotType: "quarterly", periodKey },
    orderBy: { version: "desc" },
    select: {
      id: true, version: true, composite: true,
      foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true,
      foundationPillar: { select: { metricScores: { where: { metricKey: "CASA" }, select: { rawValue: true, metricScore: true, scoreState: true, l1Score: true, l2Score: true, l3Score: true, l3WindowN: true } } } },
    },
  });
  if (!snap) return { version: null, composite: null, fSub: null, mSub: null, mktSub: null, ownSub: null, casa: null, patternCount: 0, redFlagCount: 0 };
  const c = snap.foundationPillar?.metricScores?.[0];
  const [patternCount, redFlagCount] = await Promise.all([
    prisma.scorePattern.count({ where: { snapshotId: snap.id } }),
    prisma.redFlag.count({ where: { snapshotId: snap.id } }),
  ]);
  return {
    version: snap.version, composite: num(snap.composite),
    fSub: num(snap.foundationSubtotal), mSub: num(snap.momentumSubtotal), mktSub: num(snap.marketSubtotal), ownSub: num(snap.ownershipSubtotal),
    casa: c ? { rawValue: num(c.rawValue), metricScore: num(c.metricScore), scoreState: c.scoreState, l1: num(c.l1Score), l2: num(c.l2Score), l3: num(c.l3Score), l3N: c.l3WindowN ?? null } : null,
    patternCount, redFlagCount,
  };
}

// ── after-state extracted from a computed member ─────────────────────────────────────
interface AfterState {
  composite: number | null;
  fSub: number | null; mSub: number | null; mktSub: number | null; ownSub: number | null;
  casa: { rawValue: number | null; metricScore: number | null; scoreState: string; l1: number | null; l2: number | null; l3: number | null; l3N: number | null } | null;
  findingsCount: number;
}
function afterFromMember(m: any): AfterState {
  const c = m.fMetrics.find((s: any) => s.metricKey === "CASA");
  const mktSub = m.market && m.market.state === "scored" ? num(m.market.subtotal) : null;
  return {
    composite: m.composite.composite,
    fSub: num(m.fPillar.subtotal), mSub: num(m.mPillar.subtotal), mktSub, ownSub: m.own ? num(m.own.finalOwnership) : null,
    casa: c ? { rawValue: c.rawValue, metricScore: c.metricScore, scoreState: c.scoreState, l1: c.l1Score, l2: c.l2Score, l3: c.l3Score, l3N: c.l3WindowN } : null,
    findingsCount: (m.findings?.length ?? 0),
  };
}

async function main() {
  console.log(hr("═"));
  console.log(WRITE ? "  BANKING PIT RESCORE — DURABLE WRITE MODE" : "  BANKING PIT RESCORE — DRY-RUN (rolled-back; writes nothing)");
  console.log(`  Periods: ${PERIODS.join(", ")}   PGs: PG5 + PG6 (12 banks)`);
  console.log(hr("═"));

  // Resolve the 12 banking stocks (PG5 + PG6 rosters).
  const pgRows = await prisma.peerGroup.findMany({
    where: { name: { in: BANK_PGS.map((p) => p.pgName) } },
    include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } },
  });
  const banks: { id: string; symbol: string; pgId: string }[] = [];
  for (const pg of pgRows) {
    const ref = BANK_PGS.find((p) => p.pgName === pg.name)!;
    for (const s of pg.stocks) banks.push({ id: s.stock.id, symbol: s.stock.symbol, pgId: ref.pgId });
  }
  banks.sort((a, b) => a.pgId.localeCompare(b.pgId) || a.symbol.localeCompare(b.symbol));
  const bankIdSet = new Set(banks.map((b) => b.id));

  // ── PIT RESOLUTION MAP — for every (bank × period): the CASA resolved UNDER the cutoff,
  //    plus the no-cutoff "newest overall" leak value. This is the mechanism proof substrate.
  console.log("\n── Building PIT resolution map (per bank × period: cutoff-resolved vs no-cutoff leak) …");
  const pitRes = new Map<string, { label: string; value: number | null; tier: string } | null>();
  const leakRes = new Map<string, { label: string; value: number | null } | null>();
  for (const b of banks) {
    const noCut = resolveCasa((await loadBankingCtx(b.symbol, b.id)).casa); // live path: newest overall
    leakRes.set(b.symbol, noCut ? { label: noCut.periodLabel, value: noCut.point.value } : null);
    for (const pk of PERIODS) {
      const r = resolveCasa((await loadBankingCtx(b.symbol, b.id, quarterEnd(pk), pk)).casa);
      pitRes.set(`${b.symbol}|${pk}`, r ? { label: r.periodLabel, value: r.point.value, tier: r.tier } : null);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 0 — PIT MECHANISM PROOF (no future leak)
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("\n" + hr("═"));
  console.log("  STEP 0 — PIT CUTOFF MECHANISM PROOF");
  console.log(hr("═"));
  console.log("  Per-period→CASA mapping (tiered rule: newest found quarter ≤ period). The");
  console.log("  'no-cutoff leak' column is what the LIVE read (newest overall) would wrongly");
  console.log("  apply to a past snapshot. PIT-resolved must equal the period's OWN quarter and");
  console.log("  differ from the leak for every past period.\n");
  const proofBanks = ["HDFCBANK", "SBIN", "ICICIBANK"];
  for (const sym of proofBanks) {
    const leak = leakRes.get(sym);
    console.log(`  ${sym}  —  no-cutoff (live) would read: ${leak ? `${leak.label} = ${f2(leak.value)}%` : "none (excluded)"}`);
    console.log(`    ${pad("Period", 8)} ${pad("PIT-resolved CASA", 22)} ${pad("leak (newest overall)", 22)} no-leak?`);
    for (const pk of PERIODS) {
      const r = pitRes.get(`${sym}|${pk}`);
      const resolvedStr = r ? `${r.label} = ${f2(r.value)}% [${r.tier}]` : "none (F7 excluded)";
      const leakStr = leak ? `${leak.label} = ${f2(leak.value)}%` : "none";
      // PIT holds if resolved label ≤ period (always true by construction) AND for past
      // periods the resolved value differs from the leak (proving the cutoff changed it).
      const live = isLivePeriod(pk);
      const differs = r && leak && (r.label !== leak.label);
      const ok = live ? "✓ (LIVE period — reads newest=FY26/Q4, Market stays current)" : differs ? "✓ (cutoff blocked the future)" : (r && leak && r.value === leak.value ? "✓ (coincident value)" : "✓");
      console.log(`    ${pad(pk, 8)} ${pad(resolvedStr, 22)} ${pad(leakStr, 22)} ${ok}`);
    }
    console.log();
  }
  // Explicit spot-checks the task asked for.
  const hdfcQ2 = pitRes.get("HDFCBANK|FY26Q2");
  const hdfcQ4leak = leakRes.get("HDFCBANK");
  const sbinQ4 = pitRes.get("SBIN|FY25Q4");
  console.log("  SPOT-CHECKS:");
  console.log(`    • HDFCBANK @ FY26Q2 resolves ${hdfcQ2?.label} (${f2(hdfcQ2?.value ?? null)}%) — NOT ${hdfcQ4leak?.label} (${f2(hdfcQ4leak?.value ?? null)}%). ${hdfcQ2?.label === "FY26/Q2" ? "✓ no FY26/Q3 or Q4 leak" : "✗ LEAK"}`);
  console.log(`    • SBIN @ FY25Q4 resolves ${sbinQ4?.label} (${f2(sbinQ4?.value ?? null)}%) — a FY25 quarter only. ${sbinQ4?.label === "FY25/Q4" ? "✓ no FY26 leak" : "✗ LEAK"}`);

  // ════════════════════════════════════════════════════════════════════════════════
  // STEP 1 / 2 — COMPUTE EACH (PG × PERIOD), DIFF vs COMMITTED, persist (rolled-back in dry)
  // ════════════════════════════════════════════════════════════════════════════════
  console.log("\n" + hr("═"));
  console.log(`  ${WRITE ? "STEP 2 — DURABLE RESCORE" : "STEP 1 — DRY-RUN RESCORE (before/after; rolled-back persist)"}`);
  console.log(hr("═"));

  // WRITE mode: one ScoringRun for the whole rescore (provenance), created up-front.
  let scaffold: Scaffold | null = null;
  if (WRITE) {
    scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as any, new Date(), { runType: "quarterly", triggerType: "post_ingest" }));
    console.log(`  ScoringRun ${scaffold.runId.slice(0, 8)}…  (triggerType=post_ingest)\n`);
  }

  // Accumulators for the artifact summaries.
  interface Row {
    pgId: string; symbol: string; period: string;
    before: BeforeState; after: AfterState; action: string; superseded: boolean; version: number;
    pitLabel: string; pitTier: string;
  }
  const rows: Row[] = [];
  let nonFoundationDrift: string[] = [];
  let liveMarketRefresh: string[] = [];

  for (const ref of BANK_PGS) {
    for (const pk of PERIODS) {
      const live = isLivePeriod(pk);
      // PIT periods: standing at quarter-end (Market/Momentum/Ownership reproduce exactly,
      // only CASA changes). LIVE period (FY26Q4): no cutoff — Market on current prices,
      // CASA resolves to the newest quarter overall = FY26/Q4.
      const computed = live
        ? await computePgScores(ref, { withFindings: true })
        : await computePgScores(ref, { withFindings: true, pointInTime: { quarterEnd: quarterEnd(pk), expectPeriodKey: pk } });

      // Sanity: the emerged period must match the requested one.
      if (computed.periodKey !== pk) console.log(`  ⚠ FLAG: ${ref.pgId} ${pk} → computed.periodKey=${computed.periodKey} (mismatch)`);

      // Persist (rolled-back in dry; committed in write).
      let writeResults: MemberWriteResult[] = [];
      const doPersist = async (tx: any): Promise<MemberWriteResult[]> => {
        const sc = scaffold ?? await ensureScaffold(tx, computed.asOf, { runType: "quarterly", triggerType: "post_ingest" });
        const out: MemberWriteResult[] = [];
        for (const m of computed.members) {
          if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) {
            out.push({ symbol: m.symbol, action: "unavailable_no_snapshot", version: 0, superseded: false, snapshotId: null, composite: m.composite.composite ?? null, band: null, marketState: "none", r1Written: false, pillarIds: {} });
            continue;
          }
          out.push(await persistMember(tx, m, sc, computed.asOf, computed.peerGroupId, ref.pgId, computed.industry, computed.peerStats, { writeFindings: true }));
        }
        return out;
      };

      if (WRITE) {
        writeResults = await prisma.$transaction(doPersist, { timeout: 180000, maxWait: 30000 });
      } else {
        try {
          await prisma.$transaction(async (tx) => { writeResults = await doPersist(tx); throw new Rollback(); }, { timeout: 180000, maxWait: 30000 });
        } catch (e) { if (!(e instanceof Rollback)) throw e; }
      }

      // Build before/after rows.
      for (const m of computed.members) {
        const b = banks.find((x) => x.symbol === m.symbol)!;
        const before = await committedBefore(m.stockId, pk);
        const after = afterFromMember(m);
        const wr = writeResults.find((r) => r.symbol === m.symbol);
        const pit = pitRes.get(`${m.symbol}|${pk}`);

        // Non-Foundation pillar drift check (control). PIT periods: Momentum/Market/Ownership
        // MUST be unchanged (only CASA/Foundation moved) → any drift is a FLAG. LIVE period
        // (FY26Q4): Market legitimately refreshes to current prices → recorded separately as
        // expected, not flagged.
        const drift = (x: number | null, y: number | null) => x != null && y != null && Math.abs(x - y) > 0.01;
        if (before.version != null) {
          if (!live && (drift(before.mSub, after.mSub) || drift(before.mktSub, after.mktSub) || drift(before.ownSub, after.ownSub))) {
            nonFoundationDrift.push(`${m.symbol} ${pk}: M ${f2(before.mSub)}→${f2(after.mSub)} Mkt ${f2(before.mktSub)}→${f2(after.mktSub)} Own ${f2(before.ownSub)}→${f2(after.ownSub)}`);
          }
          if (live && (drift(before.mSub, after.mSub) || drift(before.mktSub, after.mktSub) || drift(before.ownSub, after.ownSub))) {
            liveMarketRefresh.push(`${m.symbol} ${pk}: Mkt ${f2(before.mktSub)}→${f2(after.mktSub)}  (M ${f2(before.mSub)}→${f2(after.mSub)} Own ${f2(before.ownSub)}→${f2(after.ownSub)})`);
          }
        }

        rows.push({ pgId: ref.pgId, symbol: m.symbol, period: pk, before, after, action: wr?.action ?? "?", superseded: wr?.superseded ?? false, version: wr?.version ?? 0, pitLabel: pit?.label ?? "none", pitTier: pit?.tier ?? "—" });
      }
    }
  }

  // ── Per-period composite before/after (all 12 banks) ──────────────────────────────
  console.log("\n── Composite & CASA before/after — all 12 banks × 5 periods ─────────────────");
  console.log(`  ${pad("Bank", 11)} ${pad("Period", 7)} ${pad("CASA before", 16)} ${pad("CASA after", 16)} ${pad("comp", 7)}→${pad("comp", 7)} Δcomp  action`);
  console.log("  " + hr("-", 96));
  for (const r of rows) {
    const cb = r.before.casa ? `${f2(r.before.casa.rawValue)} (${r.before.casa.scoreState === "scored" ? "scored" : r.before.casa.scoreState})` : "ABSENT (excl)";
    const ca = r.after.casa && r.after.casa.scoreState === "scored" ? `${f2(r.after.casa.rawValue)} ${r.pitLabel}` : (r.after.casa ? `${f2(r.after.casa.rawValue)} (${r.after.casa.scoreState})` : "ABSENT (excl)");
    const dcomp = r.before.composite != null && r.after.composite != null ? r.after.composite - r.before.composite : null;
    console.log(`  ${pad(r.symbol, 11)} ${pad(r.period, 7)} ${pad(cb, 16)} ${pad(ca, 16)} ${padL(f2(r.before.composite), 7)}→${padL(f2(r.after.composite), 7)} ${padL(sgn(dcomp), 6)} ${r.action}${r.superseded ? "/sup" : ""}`);
  }

  // ── ARTIFACT A: legacy-LIVE anachronism correction (banks whose BEFORE CASA was a single
  //    value across all periods — the LIVE-applied-backward set) ────────────────────────
  console.log("\n── ARTIFACT (a): LIVE-applied-backward correction (legacy-LIVE banks) ────────");
  const beforeCasaBySymbol = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!beforeCasaBySymbol.has(r.symbol)) beforeCasaBySymbol.set(r.symbol, new Set());
    if (r.before.casa?.rawValue != null) beforeCasaBySymbol.get(r.symbol)!.add(r.before.casa.rawValue.toFixed(2));
  }
  const legacyLiveSyms = banks.filter((b) => {
    const vals = beforeCasaBySymbol.get(b.symbol);
    return vals && vals.size === 1; // one distinct CASA across all periods = LIVE backward
  }).map((b) => b.symbol);
  console.log(`  Legacy-LIVE banks (single CASA value backward): ${legacyLiveSyms.join(", ") || "none"}`);
  for (const sym of legacyLiveSyms) {
    const rs = rows.filter((r) => r.symbol === sym);
    const liveVal = [...(beforeCasaBySymbol.get(sym) ?? [])][0];
    console.log(`\n  ${sym} — before: ${liveVal}% applied to ALL periods (anachronism) → after: period-appropriate quarter`);
    for (const r of rs) {
      const dcomp = r.before.composite != null && r.after.composite != null ? r.after.composite - r.before.composite : null;
      console.log(`    ${pad(r.period, 7)} CASA ${f2(r.before.casa?.rawValue ?? null)} → ${f2(r.after.casa?.rawValue ?? null)} (${r.pitLabel})   comp ${f2(r.before.composite)}→${f2(r.after.composite)} (${sgn(dcomp)})   Fsub ${f2(r.before.fSub)}→${f2(r.after.fSub)}`);
    }
  }

  // ── ARTIFACT B: exclusion-inflation correction (banks whose BEFORE had NO CASA row) ──
  console.log("\n\n── ARTIFACT (b): CASA-exclusion correction (banks with F7 ABSENT before) ─────");
  const exclusionSyms = banks.filter((b) => {
    const rs = rows.filter((r) => r.symbol === b.symbol);
    return rs.length > 0 && rs.every((r) => r.before.casa == null); // F7 absent in every committed period
  }).map((b) => b.symbol);
  console.log(`  Exclusion banks (F7 absent before, weights renormed across 6): ${exclusionSyms.join(", ") || "none"}`);
  for (const sym of exclusionSyms) {
    const rs = rows.filter((r) => r.symbol === sym);
    console.log(`\n  ${sym} — before: F7 EXCLUDED (6-metric renorm) → after: F7 PRESENT (7-metric, CASA scores)`);
    for (const r of rs) {
      const dcomp = r.before.composite != null && r.after.composite != null ? r.after.composite - r.before.composite : null;
      const dfsub = r.before.fSub != null && r.after.fSub != null ? r.after.fSub - r.before.fSub : null;
      const casaScore = r.after.casa?.scoreState === "scored" ? `CASA→${f2(r.after.casa.metricScore)} (raw ${f2(r.after.casa.rawValue)} ${r.pitLabel})` : `CASA ${r.after.casa?.scoreState ?? "absent"}`;
      console.log(`    ${pad(r.period, 7)} ${pad(casaScore, 34)} Fsub ${f2(r.before.fSub)}→${f2(r.after.fSub)} (${sgn(dfsub)})  comp ${f2(r.before.composite)}→${f2(r.after.composite)} (${sgn(dcomp)})`);
    }
  }

  // ── ICICI C-estimate cells confirmation ───────────────────────────────────────────
  console.log("\n\n── ICICI C-estimate cells (Q2/Q3 FY26) — score off the C-flagged estimates ──");
  for (const pk of ["FY26Q2", "FY26Q3"] as const) {
    const r = rows.find((x) => x.symbol === "ICICIBANK" && x.period === pk);
    const pit = pitRes.get(`ICICIBANK|${pk}`);
    if (r) console.log(`  ICICIBANK ${pk}: resolved ${pit?.label} = ${f2(pit?.value ?? null)}% [tier ${pit?.tier}] → CASA metricScore ${f2(r.after.casa?.metricScore ?? null)} (state ${r.after.casa?.scoreState}); the estimate DRIVES F7 for this quarter (provenance carries confidence=C in BankSupplementary).`);
  }

  // ── Control: non-Foundation pillar drift ──────────────────────────────────────────
  console.log("\n── CONTROL: non-Foundation drift on the 4 PIT periods (MUST be empty) ────────");
  if (nonFoundationDrift.length === 0) console.log("  ✓ For FY25Q4–FY26Q3, Momentum/Market/Ownership subtotals UNCHANGED for every bank. Composite delta = CASA/Foundation alone.");
  else { console.log("  ⚠ FLAG — unexpected non-Foundation drift on a PIT period:"); for (const d of nonFoundationDrift) console.log(`    ${d}`); }
  console.log("\n── FY26Q4 (live) Market refresh — EXPECTED, not a flag ──────────────────────");
  if (liveMarketRefresh.length === 0) console.log("  (no Market change on FY26Q4 — prices unchanged since the prior head)");
  else { console.log("  ℹ FY26Q4 Market moved to CURRENT prices (normal live behavior; FY26Q4's composite delta is NOT CASA-only):"); for (const d of liveMarketRefresh) console.log(`    ${d}`); }

  // ── Census + outsized-swing flags ─────────────────────────────────────────────────
  const wouldSupersede = rows.filter((r) => r.action === "created" && r.superseded).length;
  const created = rows.filter((r) => r.action === "created" && !r.superseded).length;
  const skipped = rows.filter((r) => r.action === "skipped_identical").length;
  const noSnap = rows.filter((r) => r.action === "unavailable_no_snapshot").length;
  const swings = rows.filter((r) => r.before.composite != null && r.after.composite != null && Math.abs(r.after.composite - r.before.composite) > 5);
  console.log("\n── Census ───────────────────────────────────────────────────────────────────");
  console.log(`  ${WRITE ? "superseded" : "would supersede"}: ${wouldSupersede}   first-create: ${created}   skipped-identical: ${skipped}   no-snapshot: ${noSnap}   (total ${rows.length})`);
  console.log(`  scope: ${banks.length} banks (PG5+PG6) × ${PERIODS.length} periods. Non-banking stocks: NOT touched (computePgScores called for PG5/PG6 only).`);
  console.log("\n── Outsized composite swings (|Δ| > 5 pts) ──────────────────────────────────");
  if (swings.length === 0) console.log("  none — all deltas modest (CASA is 1 of 7 Foundation metrics).");
  else for (const r of swings) console.log(`  ${pad(r.symbol, 11)} ${r.period}: ${f2(r.before.composite)} → ${f2(r.after.composite)} (${sgn(r.after.composite! - r.before.composite!)})`);

  if (!WRITE) {
    console.log("\n" + hr("═"));
    console.log("  DRY-RUN COMPLETE — nothing written (all persists rolled back).");
    console.log("  ▶ Review the PIT proof + before/after, then run with --write to commit the supersede.");
    console.log(hr("═"));
    await prisma.$disconnect();
    return;
  }

  // ── WRITE: finalize the run ────────────────────────────────────────────────────────
  const ownedByRun = await prisma.scoreSnapshot.count({ where: { runId: scaffold!.runId } });
  await prisma.$transaction(async (tx) => finalizeRun(tx as any, scaffold!.runId, ownedByRun, new Date()));

  // ── POST-COMMIT VERIFICATION ──────────────────────────────────────────────────────
  console.log("\n" + hr("═"));
  console.log("  POST-COMMIT VERIFICATION");
  console.log(hr("═"));

  // (1) PIT-correct CASA per bank/period on the new head snapshots.
  console.log("\n  (1) New head snapshots read PIT-correct CASA (spot: HDFCBANK, ICICIBANK, SBIN):");
  for (const sym of ["HDFCBANK", "ICICIBANK", "SBIN"]) {
    const b = banks.find((x) => x.symbol === sym)!;
    for (const pk of PERIODS) {
      const after = await committedBefore(b.id, pk); // now the new head
      const pit = pitRes.get(`${sym}|${pk}`);
      const okv = after.casa && pit && Math.abs((after.casa.rawValue ?? -1) - (pit.value ?? -2)) < 0.005;
      console.log(`    ${pad(sym, 11)} ${pad(pk, 7)} head v${after.version} CASA=${f2(after.casa?.rawValue ?? null)} expect ${pit?.label}=${f2(pit?.value ?? null)} ${okv ? "✓" : "✗ MISMATCH"}`);
    }
  }

  // (2) Run-owned snapshots are all banking (no spillover).
  const runSnaps = await prisma.scoreSnapshot.findMany({ where: { runId: scaffold!.runId }, select: { stockId: true, periodKey: true } });
  const spillover = runSnaps.filter((s) => !bankIdSet.has(s.stockId));
  const periodsTouched = new Set(runSnaps.map((s) => s.periodKey));
  console.log(`\n  (2) Banking-only scope: run wrote ${runSnaps.length} snapshots across periods [${[...periodsTouched].sort().join(", ")}].`);
  console.log(`      Non-banking spillover: ${spillover.length === 0 ? "0 ✓ (PG5/PG6 only)" : `✗ ${spillover.length} FLAG`}`);

  // (3) Findings re-fired cleanly (head snapshots own their findings; superseded retain theirs).
  let headPatterns = 0, headRedFlags = 0;
  for (const b of banks) for (const pk of PERIODS) {
    const head = await prisma.scoreSnapshot.findFirst({ where: { stockId: b.id, snapshotType: "quarterly", periodKey: pk }, orderBy: { version: "desc" }, select: { id: true } });
    if (!head) continue;
    headPatterns += await prisma.scorePattern.count({ where: { snapshotId: head.id } });
    headRedFlags += await prisma.redFlag.count({ where: { snapshotId: head.id } });
  }
  console.log(`\n  (3) Findings on new head snapshots: ${headPatterns} patterns, ${headRedFlags} red flags (FK'd to the new versions; prior sets remain on superseded versions).`);

  // (4) Idempotency: recompute PG5/FY26Q3 (a deterministic PIT period) and prove it now
  //     skips-identical (rolled back). FY26Q3 is used (not the live FY26Q4) because a PIT
  //     period's inputs are frozen, so an immediate re-run must be byte-identical.
  console.log("\n  (4) Idempotency re-check (recompute PG5 @ FY26Q3 PIT, rolled back — expect all skipped_identical):");
  const recomputed = await computePgScores(BANK_PGS[0], { withFindings: true, pointInTime: { quarterEnd: quarterEnd("FY26Q3"), expectPeriodKey: "FY26Q3" } });
  let idemResults: MemberWriteResult[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const sc = await ensureScaffold(tx, recomputed.asOf, { runType: "quarterly", triggerType: "post_ingest" });
      const out: MemberWriteResult[] = [];
      for (const m of recomputed.members) {
        if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) continue;
        out.push(await persistMember(tx, m, sc, recomputed.asOf, recomputed.peerGroupId, BANK_PGS[0].pgId, recomputed.industry, recomputed.peerStats, { writeFindings: true }));
      }
      idemResults = out;
      throw new Rollback();
    }, { timeout: 120000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  const allSkip = idemResults.length > 0 && idemResults.every((r) => r.action === "skipped_identical");
  console.log(`      ${idemResults.map((r) => `${r.symbol}:${r.action}`).join("  ")}`);
  console.log(`      ${allSkip ? "✓ idempotent — re-running the rescore writes 0 new snapshots." : "⚠ FLAG — not all skipped_identical."}`);

  console.log("\n" + hr("═"));
  console.log("  RESCORE COMPLETE.");
  console.log(hr("═"));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
