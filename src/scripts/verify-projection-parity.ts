// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROJECTION-PARITY GATE — a lean load must serve the SAME payload, minus what was omitted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── ★ WHAT THIS GUARDS, AND WHY IT NEEDED ITS OWN GATE ──────────────────────────────────────────
// `buildHealthSnapshotView` now loads TWO DIFFERENT SHAPES of the head snapshot. With `pillars`
// omitted it takes the lean shape — the four pillar rows and nothing under them — which removes a
// three-level relation walk from the read. Every other block on the payload (identity, verdict,
// divergence, trajectory, findings, regime) is built from the snapshot's own columns and must come
// out byte-for-byte identical either way.
//
// That is exactly the kind of change whose failure mode is SILENT and PARTIAL: a mapper that quietly
// reads a relation only the full shape carries would not crash — it would produce a subtly different
// verdict on the tool pages and nowhere else, on some stocks and not others. The type system makes the
// metric graph unreachable from a lean load (see `ProjectedSnapshot`), but the type system cannot say
// that the two loads AGREE about everything else. This does, on real rows, over the whole universe.
//
// ── ★ WHAT IS COMPARED ──────────────────────────────────────────────────────────────────────────
// Every top-level key of the response except the three the projection is ALLOWED to change:
//   pillars       null on a pillars-omitted read, an array on a full one — the omission itself
//   peerStanding  the same, for the other omittable section
//   omitted       the declaration of what was dropped, which is the point of the request
// Every other key is compared by its exact JSON serialisation, which catches ordering, precision and
// null-vs-absent differences that a shallow equality would not.
//
// ── ★ AND THE RUNTIME SHADOW OF THE TYPE GUARANTEE ──────────────────────────────────────────────
// The lean pillar rows are asserted to carry NO metric graph at runtime — not an empty one. An empty
// array here would mean the loader had started fabricating "this pillar scored no metrics" for rows
// it simply did not fetch, which is the substitution this fork exists to refuse.
//
// ── ⚠ NOT A BUILD GATE. IT READS THE DATABASE. ──────────────────────────────────────────────────
// `npm run build` is asserted DB-free by verify-build-gate-hygiene.ts, and correctly so — a build
// must not need a live database. This runs in `verify:all` alongside the cross-repo gates, which are
// out of the build for the same class of reason.
//
//   npx tsx src/scripts/verify-projection-parity.ts            # whole universe
//   npx tsx src/scripts/verify-projection-parity.ts --scored   # scored stocks only (faster)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import { loadSnapshotLeanById } from "../scoring/read/scoring-read.service.js";
import type { HealthSnapshotView } from "../scoring/read/health-view.types.js";

/** The keys a projection is ALLOWED to differ on. Everything else must be identical. */
const PROJECTION_KEYS = new Set(["pillars", "peerStanding", "omitted"]);

/** How many stocks are built at once. The pool is 5 connections and one view uses several in
 *  parallel, so this is deliberately modest — the gate is a correctness check, not a load test. */
const CONCURRENCY = 4;

let fail = 0;
const failures: string[] = [];

function ok(label: string, pass: boolean, detail: string): void {
  if (!pass) {
    fail++;
    failures.push(`${label} — ${detail}`);
  }
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function rule(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(Math.min(100, title.length + 8)));
}

/**
 * Every leaf path at which two payloads differ, with array indices collapsed to `[]` so a difference
 * on metric 7 of pillar 0 reports as the FIELD that differs rather than as one stock's coordinates.
 * Returning all of them — not the first — is what lets the caller assert that a KNOWN difference is
 * the only difference.
 */
function divergentPaths(a: unknown, b: unknown, path = "", out = new Set<string>()): Set<string> {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) out.add(`${path}.length`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) divergentPaths(a[i], b[i], `${path}[]`, out);
      return out;
    }
    if (!Array.isArray(a) && !Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        divergentPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
      }
      return out;
    }
  }
  out.add(path || "(root)");
  return out;
}

/** The top-level keys of two payloads that differ, ignoring the ones a projection may change. */
function divergentSections(a: HealthSnapshotView, b: HealthSnapshotView): Set<string> {
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (PROJECTION_KEYS.has(k)) continue;
    for (const p of divergentPaths(
      (a as unknown as Record<string, unknown>)[k],
      (b as unknown as Record<string, unknown>)[k],
      k,
    )) {
      out.add(p);
    }
  }
  return out;
}

/**
 * ★ A KNOWN, PRE-EXISTING COUPLING BETWEEN TWO SUPPOSEDLY INDEPENDENT OMITTABLE SECTIONS.
 *
 * Omitting `peerStanding` also blanks the S3.5 standing stamp inside `pillars[]`. The stamp is
 * applied AFTER the pillars are built, from `peerStanding.perPillarRank` — so with peer standing not
 * fetched there is no rank to reconcile the lens wording against, and `standingContext` comes back
 * null with `verdict` composed from a null band. That is honest (nothing is invented from data that
 * was not read) but it is a real payload difference between two projections, and it predates this
 * pass — the loader fork does not touch this path at all, which requests the FULL shape either way.
 *
 * It is pinned rather than waved through: these four paths may differ, and NOTHING ELSE may. If the
 * coupling ever spreads to a fifth field this gate fails, which is the whole point of naming it.
 *
 * ⚠ NOT FIXED HERE. The fix is to fetch peer siblings whenever `pillars` is requested, which changes
 * what `omit=peerStanding` costs — a scope decision, not a parity one. No shipped consumer renders
 * these fields today (the Ownership tool omits peerStanding and reads only Foundation's subtotal).
 */
const PEER_STANDING_STAMP_PATHS = new Set([
  "pillars[].lensPillarPatterns[].standingContext",
  "pillars[].lensPillarPatterns[].verdict",
  "pillars[].metrics[].lensPattern.standingContext",
  "pillars[].metrics[].lensPattern.verdict",
]);

interface StockRow { symbol: string; scored: boolean }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const scoredOnly = process.argv.includes("--scored");

  const stocks: StockRow[] = (
    await prisma.stock.findMany({
      select: { symbol: true, _count: { select: { scoreSnapshots: true } } },
      orderBy: { symbol: "asc" },
    })
  )
    .map((s) => ({ symbol: s.symbol, scored: s._count.scoreSnapshots > 0 }))
    .filter((s) => !scoredOnly || s.scored);

  const scoredCount = stocks.filter((s) => s.scored).length;
  console.log(
    `PROJECTION PARITY — ${stocks.length} stocks (${scoredCount} with snapshots)` +
      `${scoredOnly ? " · --scored" : " · full universe"}`,
  );

  // ── 1 · the payload diff, per stock ──────────────────────────────────────────────────────────
  rule("1 · TOOL_OMIT (pillars + peerStanding) serves the same payload as the full read");

  const started = Date.now();
  const results = await mapLimit(stocks, CONCURRENCY, async (s) => {
    const [full, lean] = await Promise.all([
      buildHealthSnapshotView(s.symbol, 12),
      buildHealthSnapshotView(s.symbol, 12, { omit: ["pillars", "peerStanding"] }),
    ]);
    if (!full || !lean) return { symbol: s.symbol, scored: s.scored, problem: "one side returned null" };
    const diff = [...divergentSections(full, lean)];
    if (diff.length) return { symbol: s.symbol, scored: s.scored, problem: diff.join(" · ") };

    // ── the omission itself, asserted rather than assumed ──
    //
    // ★ AND THIS IS WHERE `[]` AND `null` HAVE TO BE TOLD APART, which is the distinction the whole
    //   projection rests on. `null` means "you did not ask for them". `[]` means "this stock has no
    //   pillars" — the NOT-SCORED branch, which returns a real empty and is not an omission at all.
    //   A gate that demanded `null` everywhere would be asserting that an unscored stock's honest
    //   empty is a projection artefact. It is not, and the two must not be collapsed.
    if (full.scored !== lean.scored) {
      return { symbol: s.symbol, scored: s.scored, problem: `scored differs: ${full.scored} vs ${lean.scored}` };
    }
    if (lean.scored) {
      if (lean.pillars !== null) return { symbol: s.symbol, scored: s.scored, problem: "lean.pillars is not null on a scored stock" };
      if (!Array.isArray(full.pillars)) return { symbol: s.symbol, scored: s.scored, problem: "full.pillars is not an array on a scored stock" };
    } else if (JSON.stringify(lean.pillars) !== JSON.stringify(full.pillars)) {
      return { symbol: s.symbol, scored: s.scored, problem: "not-scored branch: pillars differ between the two loads" };
    }
    if (lean.peerStanding !== null) return { symbol: s.symbol, scored: s.scored, problem: "lean.peerStanding is not null" };
    const declared = [...(lean.omitted ?? [])].sort().join(",");
    if (declared !== "peerStanding,pillars") {
      return { symbol: s.symbol, scored: s.scored, problem: `lean.omitted declares "${declared}"` };
    }
    return { symbol: s.symbol, scored: s.scored, problem: null as string | null };
  });

  const bad = results.filter((r) => r.problem);
  const scoredChecked = results.filter((r) => r.scored).length;
  ok(
    "every stock's non-omitted payload is byte-identical between the full and lean loads",
    bad.length === 0,
    bad.length === 0
      ? `${results.length} stocks (${scoredChecked} scored · ${results.length - scoredChecked} not scored) in ${((Date.now() - started) / 1000).toFixed(0)}s`
      : `${bad.length} differ`,
  );
  for (const b of bad.slice(0, 5)) console.log(`      ${b.symbol}: ${b.problem}`);
  if (bad.length > 5) console.log(`      …and ${bad.length - 5} more`);
  ok(
    "the scored universe is actually exercised (a gate that only saw unscored stocks would prove nothing)",
    scoredChecked > 0,
    `${scoredChecked} scored stocks built both ways`,
  );

  // ── 2 · the other shipped projection ─────────────────────────────────────────────────────────
  rule("2 · OWNERSHIP_OMIT (peerStanding only) keeps the pillar block — bar the pinned stamp");

  const sample = stocks.filter((s) => s.scored).slice(0, 12);
  const ownBad: string[] = [];
  const seenStampPaths = new Set<string>();
  await mapLimit(sample, CONCURRENCY, async (s) => {
    const [full, own] = await Promise.all([
      buildHealthSnapshotView(s.symbol, 12),
      buildHealthSnapshotView(s.symbol, 12, { omit: ["peerStanding"] }),
    ]);
    if (!full || !own) {
      ownBad.push(`${s.symbol}: null view`);
      return;
    }
    if (own.peerStanding !== null) ownBad.push(`${s.symbol}: peerStanding not dropped`);
    if (own.pillars === null) ownBad.push(`${s.symbol}: pillars dropped by a peerStanding-only omission`);
    // Everything outside `pillars` must match exactly; inside it, only the pinned stamp may move.
    for (const p of divergentSections(full, own)) ownBad.push(`${s.symbol}: ${p}`);
    for (const p of divergentPaths(full.pillars, own.pillars, "pillars")) {
      if (PEER_STANDING_STAMP_PATHS.has(p)) seenStampPaths.add(p);
      else ownBad.push(`${s.symbol}: unpinned pillar difference at ${p}`);
    }
  });
  ok(
    "a peerStanding-only omission changes NOTHING outside the pinned S3.5 standing stamp",
    ownBad.length === 0,
    ownBad.length === 0
      ? `${sample.length} scored stocks · stamp paths observed: ${seenStampPaths.size}/${PEER_STANDING_STAMP_PATHS.size}`
      : ownBad.slice(0, 3).join(" · "),
  );
  ok(
    "…and the pinned stamp is a KNOWN pre-existing coupling, not a regression of this pass",
    true,
    "peerStanding feeds the S3.5 rank reconciliation applied after pillars are built — see the constant's note",
  );

  // ── 3 · the runtime shadow of the type guarantee ─────────────────────────────────────────────
  rule("3 · the lean load carries NO metric graph — absent, never an empty one");

  const probe = await prisma.scoreSnapshot.findFirst({
    where: { snapshotType: "quarterly" },
    orderBy: { asOfDate: "desc" },
    select: { id: true, symbol: true },
  });
  if (!probe) {
    ok("a quarterly snapshot exists to probe", false, "none found");
  } else {
    const leanRow = await loadSnapshotLeanById(probe.id);
    const pillars = leanRow
      ? [leanRow.foundationPillar, leanRow.momentumPillar, leanRow.marketPillar, leanRow.ownershipPillar]
      : [];
    const rel = ["metricScores", "marketSubScores", "ownershipScore"];
    const present = pillars.flatMap((p) =>
      rel.filter((k) => k in (p as unknown as Record<string, unknown>)).map((k) => `${p?.pillar}.${k}`),
    );
    ok(
      "no pillar row on a lean load carries metricScores / marketSubScores / ownershipScore",
      leanRow !== null && present.length === 0,
      present.length ? `present: ${present.join(", ")}` : `${probe.symbol} · 4 pillar rows, scalars only`,
    );
    ok(
      // `redFlags` was asserted here too until 2026-08-11; the relation went with score_red_flags and
      // the score channel has no red flags on either shape.
      "the lean load still carries the findings block and the band mapping (not pillar detail)",
      !!leanRow && Array.isArray(leanRow.patterns) && !!leanRow.bandMappingVersion,
      leanRow ? `${leanRow.patterns.length} patterns` : "missing",
    );
  }

  console.log(
    `\n${fail === 0 ? "✅ PROJECTION PARITY PASSES — the lean read serves the same payload, minus exactly what was omitted" : `❌ ${fail} FAILURE(S)`}`,
  );
  for (const f of failures) console.log(`   ${f}`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
