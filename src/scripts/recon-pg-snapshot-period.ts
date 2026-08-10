// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECON — PEER-GROUP SNAPSHOT PERIOD (Prompt 31, item 3). READ-ONLY.
//
// Three questions, measured rather than assumed:
//   1 · does the PG health payload carry each member's periodKey / as-of date?
//   2 · how many ponds carry MIXED periods among their members today, and what is the widest spread?
//   3 · is the pond's own composite / ranking computed ACROSS mixed periods?
//
// Question 3 is the gate: if the aggregate crosses periods, the display gap is the smaller finding.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildPeerGroupHealthView } from "../scoring/read/peer-group-view.service.js";

const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(112) + "\n" + s + "\n" + "═".repeat(112));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** "FY26Q4" → an orderable integer, so "spread in quarters" is arithmetic and not a string compare. */
function periodOrdinal(periodKey: string): number | null {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  if (!m) return null;
  return Number(m[1]) * 4 + Number(m[2]);
}

async function main() {
  line(`today (server clock): ${new Date().toISOString()}`);

  // ── The ponds, and the raw quarterly snapshot rows ──────────────────────────────────────────────
  const pgs = await prisma.peerGroup.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, stockCount: true },
  });

  const snaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: {
      id: true,
      peerGroupId: true,
      stockId: true,
      symbol: true,
      periodKey: true,
      version: true,
      asOfDate: true,
    },
  });

  type Lean = (typeof snaps)[number];
  const byPg = new Map<string, Lean[]>();
  for (const s of snaps) {
    const arr = byPg.get(s.peerGroupId) ?? [];
    arr.push(s);
    byPg.set(s.peerGroupId, arr);
  }

  // ── 1 · WHAT THE PAYLOAD CARRIES ────────────────────────────────────────────────────────────────
  rule("1 · WHAT THE PAYLOAD CARRIES — periodKey / as-of, per member");

  const scoredPgIds = pgs.filter((p) => (byPg.get(p.id)?.length ?? 0) > 0).map((p) => p.id);
  const probeId = scoredPgIds[0];
  if (probeId) {
    const view = await buildPeerGroupHealthView(probeId);
    if (view) {
      line(`probe pond: ${view.identity.displayName}`);
      line(`  identity.periodKey = ${view.identity.periodKey}   identity.asOfDate = ${view.identity.asOfDate}`);
      const m0 = view.members[0];
      line(`  members[0] keys: ${m0 ? Object.keys(m0).join(", ") : "(none)"}`);
      line(`  members[0] carries periodKey? ${m0 && "periodKey" in m0 ? "YES" : "NO"}`);
      line(`  members[0] carries asOfDate?  ${m0 && "asOfDate" in m0 ? "YES" : "NO"}`);
      line(`  notAtCurrentPeriod shape: ${JSON.stringify(view.notAtCurrentPeriod.slice(0, 3))}`);
      line(`  notAtCurrentPeriod carries a composite/band? NO (symbol + latestPeriod only)`);
    }
  }

  // ── 2 · MIXED PERIODS PER POND ──────────────────────────────────────────────────────────────────
  rule("2 · MIXED PERIODS — the latest in-force snapshot per roster member, per pond");

  let mixedPonds = 0;
  let scoredPonds = 0;
  let widest = { pond: "", quarters: 0, detail: "" };
  const asOfSpreads: { pond: string; days: number; from: string; to: string; n: number }[] = [];

  for (const pg of pgs) {
    const rows = byPg.get(pg.id) ?? [];
    if (rows.length === 0) continue;
    scoredPonds += 1;

    // in-force per (stock, period): MAX(version), then latest period per stock — the SAME
    // reduction resolveCrossSection runs, replicated here so the recon measures the shipped rule.
    const inForce = new Map<string, Lean>();
    for (const r of rows) {
      const k = `${r.stockId}|${r.periodKey}`;
      const cur = inForce.get(k);
      if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
        inForce.set(k, r);
      }
    }
    const latestPerStock = new Map<string, Lean>();
    for (const r of inForce.values()) {
      const cur = latestPerStock.get(r.stockId);
      if (
        !cur ||
        r.asOfDate > cur.asOfDate ||
        (r.asOfDate.getTime() === cur.asOfDate.getTime() && r.periodKey > cur.periodKey)
      ) {
        latestPerStock.set(r.stockId, r);
      }
    }
    const all = [...latestPerStock.values()];
    const maxAsOf = all.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a)).asOfDate;
    const pondPeriod = all.filter((r) => r.asOfDate.getTime() === maxAsOf.getTime())[0].periodKey;
    const current = all.filter((r) => r.periodKey === pondPeriod);
    const lagging = all.filter((r) => r.periodKey !== pondPeriod);

    const periods = [...new Set(all.map((r) => r.periodKey))].sort();
    const ords = periods.map(periodOrdinal).filter((x): x is number => x !== null);
    const quarters = ords.length >= 2 ? Math.max(...ords) - Math.min(...ords) : 0;

    // ★ Is the pond's period the NEWEST period on the roster, or merely the most recently written?
    const newestPeriod = periods[periods.length - 1];
    const inverted = newestPeriod !== pondPeriod;

    // as-of spread INSIDE the cross-section (same quarter, rescored on different days)
    const asOfs = current.map((r) => r.asOfDate.getTime()).sort((a, b) => a - b);
    const asOfDays = Math.round((asOfs[asOfs.length - 1] - asOfs[0]) / 86_400_000);
    if (asOfDays > 0) {
      asOfSpreads.push({
        pond: pg.displayName,
        days: asOfDays,
        from: ymd(new Date(asOfs[0])),
        to: ymd(new Date(asOfs[asOfs.length - 1])),
        n: current.length,
      });
    }

    if (lagging.length > 0) {
      mixedPonds += 1;
      if (quarters > widest.quarters) {
        widest = {
          pond: pg.displayName,
          quarters,
          detail: periods.join(" / "),
        };
      }
    }

    const tag = lagging.length > 0 ? "MIXED " : "single";
    line(
      `${tag} ${pg.displayName.padEnd(40)} pond=${pondPeriod} @${ymd(maxAsOf)}  ` +
        `cross-section ${String(current.length).padStart(2)}/${String(all.length).padStart(2)} scored ` +
        `(roster ${pg.stockCount})  periods: ${periods.join(",")}${inverted ? "  ⚠ POND PERIOD IS NOT THE NEWEST" : ""}`,
    );
    if (lagging.length > 0) {
      for (const l of lagging.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
        line(`        lagging: ${l.symbol.padEnd(12)} ${l.periodKey} @${ymd(l.asOfDate)}`);
      }
    }
    if (asOfDays > 0) {
      line(`        as-of spread INSIDE the cross-section: ${asOfDays}d (${ymd(new Date(asOfs[0]))} → ${ymd(new Date(asOfs[asOfs.length - 1]))})`);
    }
  }

  line();
  line(`scored ponds: ${scoredPonds}`);
  line(`ponds with MIXED periods among their roster today: ${mixedPonds}`);
  line(
    widest.quarters > 0
      ? `widest spread inside one pond: ${widest.quarters} quarter(s) — ${widest.pond} (${widest.detail})`
      : `widest spread inside one pond: none (every pond is on one period)`,
  );
  line();
  line(`ponds whose CROSS-SECTION members share a period but were rescored on different days: ${asOfSpreads.length}`);
  for (const s of asOfSpreads.sort((a, b) => b.days - a.days)) {
    line(`   ${s.pond.padEnd(40)} ${String(s.days).padStart(3)}d across ${s.n} members (${s.from} → ${s.to})`);
  }

  // ── 3 · IS THE AGGREGATE COMPUTED ACROSS MIXED PERIODS? ─────────────────────────────────────────
  rule("3 · THE AGGREGATE — is the pond's composite / ranking computed across mixed periods?");

  let anyCross = false;
  for (const pgId of scoredPgIds) {
    const view = await buildPeerGroupHealthView(pgId);
    if (!view || !view.aggregate) continue;
    const rows = byPg.get(pgId) ?? [];
    // Every symbol in `members` — the ranked cross-section the aggregate is computed over — must
    // resolve to the identity periodKey. If any does not, the composite crosses periods.
    const periodBySymbol = new Map<string, string[]>();
    for (const r of rows) {
      const arr = periodBySymbol.get(r.symbol) ?? [];
      arr.push(r.periodKey);
      periodBySymbol.set(r.symbol, arr);
    }
    const offPeriod = view.members.filter((m) => {
      const ps = periodBySymbol.get(m.symbol) ?? [];
      return !ps.includes(view.identity.periodKey ?? "");
    });
    if (offPeriod.length > 0) {
      anyCross = true;
      line(
        `⚠ ${view.identity.displayName}: ${offPeriod.length} ranked member(s) with no snapshot at ${view.identity.periodKey}`,
      );
    }
    // And the lagging members must NOT appear in the ranked set.
    const lagInMembers = view.notAtCurrentPeriod.filter((l) =>
      view.members.some((m) => m.symbol === l.symbol),
    );
    if (lagInMembers.length > 0) {
      anyCross = true;
      line(`⚠ ${view.identity.displayName}: lagging member(s) also present in the ranked set: ${lagInMembers.map((l) => l.symbol).join(", ")}`);
    }
    line(
      `  ${view.identity.displayName.padEnd(40)} period=${view.identity.periodKey}  ranked=${view.members.length}  ` +
        `aggregate.scoredCount=${view.aggregate.scoredCount}  lagging=${view.notAtCurrentPeriod.length}  ` +
        `metricDistribution members=${view.metricDistributions[0]?.members.length ?? 0}`,
    );
  }
  line();
  line(
    anyCross
      ? "VERDICT: the aggregate DOES cross periods — STOP and report."
      : "VERDICT: the aggregate does NOT cross periods. Every ranked member sits at identity.periodKey; " +
          "off-period members are excluded from members[], the composites, the band mix, the pathology " +
          "census and the metric distributions, and surface only in notAtCurrentPeriod.",
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
