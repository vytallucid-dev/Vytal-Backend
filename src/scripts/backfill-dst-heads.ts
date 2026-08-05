// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FORCED BACKFILL — RECONCILE THE D/S/T PATTERN ROWS ON EVERY IN-FORCE HEAD.
//
// ── ★ WHY A RESCORE CANNOT DO THIS, AND WHY commit-findings.ts CANNOT EITHER ─────────────────────
// The ordinary rescore path is FINGERPRINT-GATED: a stock whose scoring inputs have not moved writes
// no new snapshot, so it keeps its old fired set indefinitely. Nine stale heads already carry T7/T8
// rows the current rules would not produce (their current Δ is under the 1.0pp movement floor), and
// the Formed-at-68 change makes it worse — D1/D2 now fire on stocks whose inputs have not moved at
// all, so the very stocks that need rewriting are the ones a rescore skips.
//
// `commit-findings.ts` attaches to existing heads and so bypasses the fingerprint gate — but it is
// ADDITIVE ONLY: `persistFindings` skips an existing (snapshotId, key). That is right for a pure
// backfill and wrong here, because this migration must also
//   · REMOVE rows the new rules no longer produce (the stale T7/T8 heads), and
//   · REPLACE rows whose EVIDENCE changed shape (every existing D1/D2 row must now carry `state`).
//
// So this reconciles: for each in-force head, delete the D/S/T pattern rows and re-insert exactly
// what the current rules produce for that head's own period.
//
// ── ⚠ SCOPE IS THE D/S/T FAMILY, PLUS (THIS TURN) NOT-COVERED — AND DELIBERATELY NOTHING ELSE ─────
// Red flags, E-patterns, F/H structural cards and Family N are untouched: nothing in this change
// alters them, and a delete-and-reinsert of rows we are not changing is risk with no upside.
//
// ★ NOT-COVERED, ADDED THIS TURN. Every (PG, head period) pass this script already runs computes
// `m.notCoveredWriteRows` for free (score-pass.ts's withFindings hook builds it alongside `m.findings`
// now) — reconciling it here, in the SAME pass, avoids a second full walk of every head purely to
// backfill a registry that did not exist before. Deleted/reinserted by the `notcovered_` prefix
// (isNotCoveredKey), a completely disjoint namespace from OWNED, so the two reconciliations cannot
// collide or double-count each other's rows.
//
// ── POINT-IN-TIME ────────────────────────────────────────────────────────────────────────────────
// Heads are staggered — most stocks sit at the current period, a few at the one before. Each head is
// recomputed AS OF ITS OWN PERIOD (pointInTime for a historical one), so a stock is never rewritten
// with facts from a quarter it has not reached.
//
//   npx tsx src/scripts/backfill-dst-heads.ts            (DRY — plan only, writes nothing)
//   npx tsx src/scripts/backfill-dst-heads.ts --commit   (DURABLE)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { computePgScores } from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";
import { persistFindings, persistNotCovered, type NotCoveredWriteRow } from "../scoring/findings/persist.js";
import { headOfChainByPeriod, periodOrdinal } from "../scoring/findings/trajectory/load-series.js";
import { PATTERN_KEYS } from "../catalogue/pattern-facts.js";
import { RETIRED_FINDING_KEYS } from "../catalogue/retired-findings.js";
import { isNotCoveredKey } from "../catalogue/not-covered.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const COMMIT = process.argv.includes("--commit");

/** The keys this backfill owns. Live D/S/T keys plus the retired ones, so a stale retired row on a
 *  head is cleared in the same pass rather than lingering behind the read-layer filter forever. */
const OWNED = new Set<string>([
  ...PATTERN_KEYS.filter((k) => k !== "divergence_S1_aligned"),
  ...RETIRED_FINDING_KEYS.filter((k) => k.startsWith("divergence_") || k.startsWith("trajectory_")),
]);

const quarterEnd = (pk: string): Date => {
  const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!;
  const fy = 2000 + +m[1], q = +m[2];
  return q === 1 ? new Date(Date.UTC(fy - 1, 5, 30))
    : q === 2 ? new Date(Date.UTC(fy - 1, 8, 30))
    : q === 3 ? new Date(Date.UTC(fy - 1, 11, 31))
    : new Date(Date.UTC(fy, 2, 31));
};

interface Change { symbol: string; key: string; kind: "added" | "removed" | "rewritten"; note: string }

async function main() {
  console.log(`════ BACKFILL D/S/T HEADS — ${COMMIT ? "DURABLE (--commit)" : "DRY (plan only)"} ════\n`);
  const before = await prisma.scorePattern.count();

  // ── every stock's IN-FORCE head, and its period ──────────────────────────────────────────────
  const snapRows = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: { id: true, stockId: true, symbol: true, periodKey: true, version: true, asOfDate: true },
  });
  const byStock = new Map<string, typeof snapRows>();
  for (const r of snapRows) {
    if (!byStock.has(r.stockId)) byStock.set(r.stockId, []);
    byStock.get(r.stockId)!.push(r);
  }
  /** stockId → its in-force head row. */
  const headOf = new Map<string, (typeof snapRows)[number]>();
  for (const [sid, rs] of byStock) {
    const heads = headOfChainByPeriod(rs);
    const newest = [...heads.keys()].sort((a, b) => periodOrdinal(a) - periodOrdinal(b)).pop();
    if (newest) headOf.set(sid, heads.get(newest)!);
  }

  // what is persisted on those heads today, restricted to the keys we own
  const headIds = [...headOf.values()].map((h) => h.id);
  const existing = await prisma.scorePattern.findMany({
    where: { snapshotId: { in: headIds }, patternKey: { in: [...OWNED] } },
    select: { id: true, snapshotId: true, patternKey: true, evidence: true },
  });
  const existingBySnap = new Map<string, typeof existing>();
  for (const e of existing) {
    if (!existingBySnap.has(e.snapshotId)) existingBySnap.set(e.snapshotId, []);
    existingBySnap.get(e.snapshotId)!.push(e);
  }
  // ★ NOT-COVERED, existing — same shape, different namespace (prefix, not a fixed key list).
  const existingNC = await prisma.scorePattern.findMany({
    where: { snapshotId: { in: headIds } },
    select: { id: true, snapshotId: true, patternKey: true, evidence: true },
  }).then((rows) => rows.filter((r) => isNotCoveredKey(r.patternKey)));
  const existingNCBySnap = new Map<string, typeof existingNC>();
  for (const e of existingNC) {
    if (!existingNCBySnap.has(e.snapshotId)) existingNCBySnap.set(e.snapshotId, []);
    existingNCBySnap.get(e.snapshotId)!.push(e);
  }
  console.log(`  in-force heads: ${headOf.size}   D/S/T rows on them today: ${existing.length}   not-covered rows on them today: ${existingNC.length}\n`);

  // ── recompute per (PG, head period) ──────────────────────────────────────────────────────────
  const fresh = new Map<string, FiredFinding[]>(); // stockId → the D/S/T set the rules produce now
  const freshNC = new Map<string, NotCoveredWriteRow[]>(); // stockId → the not-covered set now
  let passes = 0, errs = 0;
  for (const ref of SCORED_PGS) {
    // the distinct head periods among this PG's members
    const pg = await prisma.peerGroup.findFirst({ where: { name: ref.pgName }, select: { stocks: { select: { stockId: true } } } });
    if (!pg) continue;
    const memberIds = new Set(pg.stocks.map((s) => s.stockId));
    const periods = [...new Set([...headOf.values()].filter((h) => memberIds.has(h.stockId)).map((h) => h.periodKey))];
    for (const pk of periods) {
      let computed;
      try {
        // The CURRENT period scores live; an older head scores point-in-time at its own quarter-end,
        // so a stock is never rewritten with facts from a quarter it has not reached.
        const isCurrent = pk === [...new Set([...headOf.values()].map((h) => h.periodKey))].sort((a, b) => periodOrdinal(a) - periodOrdinal(b)).pop();
        computed = await computePgScores(ref, isCurrent
          ? { withFindings: true }
          : { withFindings: true, pointInTime: { quarterEnd: quarterEnd(pk), expectPeriodKey: pk } });
      } catch { errs++; continue; }
      passes++;
      for (const m of computed.members) {
        const head = headOf.get(m.stockId);
        if (!head || head.periodKey !== pk) continue; // this member's head is a different period
        fresh.set(m.stockId, (m.findings ?? []).filter((f) => OWNED.has(f.key)));
        freshNC.set(m.stockId, m.notCoveredWriteRows ?? []);
      }
    }
  }

  // ── the diff ─────────────────────────────────────────────────────────────────────────────────
  const changes: Change[] = [];
  for (const [sid, head] of headOf) {
    const now = fresh.get(sid);
    if (now === undefined) continue; // no pass covered this stock — leave it alone rather than wipe it
    const had = existingBySnap.get(head.id) ?? [];
    const hadKeys = new Map(had.map((e) => [e.patternKey, e]));
    const nowKeys = new Map<string, FiredFinding>(now.map((f) => [f.key as string, f]));

    for (const [k, f] of nowKeys) {
      const prev = hadKeys.get(k);
      const st = (f.evidence as { state?: unknown })?.state;
      const stateNote = st === "formed" || st === "building" ? ` [${st}]` : "";
      if (!prev) changes.push({ symbol: head.symbol, key: k, kind: "added", note: `newly firing${stateNote}` });
      else {
        const prevSt = (prev.evidence as { state?: unknown } | null)?.state;
        if (JSON.stringify(prev.evidence) !== JSON.stringify(f.evidence)) {
          changes.push({
            symbol: head.symbol, key: k, kind: "rewritten",
            note: prevSt !== st ? `state ${prevSt ?? "(none)"} → ${st ?? "(none)"}` : "evidence refreshed",
          });
        }
      }
    }
    for (const [k] of hadKeys) if (!nowKeys.has(k)) changes.push({ symbol: head.symbol, key: k, kind: "removed", note: "rules no longer produce it" });
  }

  const by = (kind: Change["kind"]) => changes.filter((c) => c.kind === kind);
  for (const kind of ["added", "removed", "rewritten"] as const) {
    const rows = by(kind);
    console.log(`  ── ${kind.toUpperCase()} (${rows.length}) ──`);
    for (const c of rows.sort((a, b) => a.key.localeCompare(b.key) || a.symbol.localeCompare(b.symbol))) {
      console.log(`     ${c.symbol.padEnd(12)} ${c.key.padEnd(52)} ${c.note}`);
    }
    console.log("");
  }

  // ── the not-covered diff — SEPARATE from the D/S/T diff above, own namespace, own report ────────
  const ncChanges: Change[] = [];
  for (const [sid, head] of headOf) {
    const now = freshNC.get(sid);
    if (now === undefined) continue;
    const had = existingNCBySnap.get(head.id) ?? [];
    const hadKeys = new Map(had.map((e) => [e.patternKey, e]));
    const nowKeys = new Map(now.map((r) => [r.patternKey, r]));
    for (const [k] of nowKeys) if (!hadKeys.has(k)) ncChanges.push({ symbol: head.symbol, key: k, kind: "added", note: "newly matched" });
    for (const [k] of hadKeys) if (!nowKeys.has(k)) ncChanges.push({ symbol: head.symbol, key: k, kind: "removed", note: "no longer matches" });
  }
  const ncAdded = ncChanges.filter((c) => c.kind === "added").length;
  const ncRemoved = ncChanges.filter((c) => c.kind === "removed").length;
  console.log(`  ── NOT-COVERED — ADDED (${ncAdded}) / REMOVED (${ncRemoved}) ──`);
  for (const c of ncChanges.sort((a, b) => a.key.localeCompare(b.key) || a.symbol.localeCompare(b.symbol))) {
    console.log(`     ${c.symbol.padEnd(12)} ${c.key.padEnd(20)} ${c.kind} — ${c.note}`);
  }
  console.log("");

  // ── write ────────────────────────────────────────────────────────────────────────────────────
  if (COMMIT) {
    let deleted = 0, inserted = 0;
    for (const [sid, head] of headOf) {
      const now = fresh.get(sid);
      if (now === undefined) continue;
      const nowNC = freshNC.get(sid) ?? [];
      await prisma.$transaction(async (tx) => {
        const del = await tx.scorePattern.deleteMany({ where: { snapshotId: head.id, patternKey: { in: [...OWNED] } } });
        deleted += del.count;
        if (now.length) {
          const res = await persistFindings(tx as never, head.id, head.symbol, head.asOfDate, now);
          inserted += res.patterns;
        }
        // ★ NOT-COVERED — same delete-then-reinsert reconcile, own namespace (prefix match, so this
        //   can never touch a D/S/T row above or vice versa).
        const delNC = await tx.scorePattern.deleteMany({ where: { snapshotId: head.id, patternKey: { startsWith: "notcovered_" } } });
        deleted += delNC.count;
        if (nowNC.length) {
          const resNC = await persistNotCovered(tx as never, head.id, head.symbol, head.asOfDate, nowNC);
          inserted += resNC.written;
        }
      }, { timeout: 120000, maxWait: 30000 });
    }
    console.log(`  DELETED ${deleted} · INSERTED ${inserted} (D/S/T + not-covered combined)`);
  }

  const after = await prisma.scorePattern.count();
  console.log(`\n  ${passes} (PG,period) passes, ${errs} errors`);
  console.log(`  score_patterns: ${before} → ${after}${COMMIT ? "" : "  (unchanged — dry)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
