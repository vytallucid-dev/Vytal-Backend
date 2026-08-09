// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LIVE RENDER — THE PEER-GROUP TABLES: reader exposure, and the snapshot period.
//
// Reads the DATABASE, so it is NOT a build gate (verify-build-gate-hygiene.ts would fail it into
// `build`). It is the evidence run for the two table-level facts:
//
//   A · EXPOSURE — the marks every table wears, resolved by the SAME function the results-season
//       banner uses. Asserted: symbol-keyed, whole-roster, anonymous is empty, and the banner and the
//       table agree member-for-member on every pond where both are present.
//   B · THE SNAPSHOT PERIOD — every ranked member's own periodKey / as-of, the uniformity the table's
//       one-line note rests on, and the two DISTINCT excluded states (an older reading vs no reading).
//
//   npx tsx src/scripts/verify-pg-tables-live.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildPeerGroupHealthView } from "../scoring/read/peer-group-view.service.js";
import { buildPeerGroupExposure } from "../scoring/read/peer-group-exposure.service.js";
import { resolvePeerGroupResultsSeason } from "../results-season/group-service.js";

const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(112) + "\n" + s + "\n" + "═".repeat(112));
const MARK = { none: "", held: "●", watching: "○", both: "●○" } as const;

let violations = 0;
const bad = (s: string) => {
  line(`     ✗ ${s}`);
  violations++;
};

async function main() {
  const ponds = await prisma.peerGroup.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, stockCount: true },
  });
  const readers = await prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("A1 · EXPOSURE — anonymous readers get an empty map on every pond (no marks, no legend)");
  for (const p of ponds) {
    const v = await buildPeerGroupExposure(null, p.id);
    const n = Object.keys(v.exposure).length;
    if (n !== 0 || v.counts.held !== 0 || v.counts.watching !== 0) {
      bad(`${p.displayName}: anonymous resolved ${n} marks / ${v.counts.held}/${v.counts.watching}`);
    }
    if (v.memberCount !== p.stockCount) {
      bad(`${p.displayName}: roster ${v.memberCount} ≠ stockCount ${p.stockCount}`);
    }
  }
  line(`  ✓ ${ponds.length} ponds — anonymous: 0 marks, roster size preserved`);

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("A2 · EXPOSURE — every signed-in reader, every pond they touch");
  for (const u of readers) {
    let any = false;
    for (const p of ponds) {
      const v = await buildPeerGroupExposure(u.id, p.id);
      const marks = Object.entries(v.exposure);
      if (marks.length === 0) continue;
      any = true;
      line(
        `\n  ── ${p.displayName} · ${u.email} ──\n     roster ${v.memberCount}  ·  held ${v.counts.held}  watchlist ${v.counts.watching}\n     ` +
          marks.map(([sym, e]) => `${sym} ${MARK[e]}`).join("   "),
      );

      // ★ THE COUNTS COUNT MARKS, NOT MEMBERS — a "both" member is in both, exactly as the banner's
      //   `exposureCounts` does it. Checked here so the page's one legend cannot disagree with the row.
      const held = marks.filter(([, e]) => e === "held" || e === "both").length;
      const watching = marks.filter(([, e]) => e === "watching" || e === "both").length;
      if (held !== v.counts.held || watching !== v.counts.watching) {
        bad(`counts ${v.counts.held}/${v.counts.watching} vs marks ${held}/${watching}`);
      }
      // "none" must never be shipped — an absent symbol IS none, and a wall of them carries nothing.
      if (marks.some(([, e]) => e === "none")) bad(`a "none" entry was shipped`);

      // ★★ THE BANNER AND THE TABLE MUST AGREE, MEMBER FOR MEMBER. Two surfaces, one resolver — this
      //    is where a divergence would show up on real rows.
      const banner = (await resolvePeerGroupResultsSeason(u.id, p.id)).banner;
      if (banner) {
        for (const c of [...banner.reported, ...banner.pending]) {
          const table = v.exposure[c.symbol] ?? "none";
          if (table !== c.exposure) {
            bad(`${c.symbol}: banner says "${c.exposure}", table says "${table}"`);
          }
        }
        line(`     banner ↔ table agree on all ${banner.reported.length + banner.pending.length} season members`);
      }
    }
    if (!any) line(`\n  ── ${u.email}: no exposure to any pond`);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("B1 · THE SNAPSHOT PERIOD — every ranked member's own quarter, on every scored pond");
  let mixedPonds = 0;
  let withOlder = 0;
  let withUnscored = 0;
  for (const p of ponds) {
    const view = await buildPeerGroupHealthView(p.id);
    if (!view || !view.scored) continue;

    const periods = [...new Set(view.members.map((m) => m.periodKey))];
    const asOfs = [...new Set(view.members.map((m) => m.asOfDate))];
    const uniform = periods.length === 1;
    if (!uniform) mixedPonds++;
    if (view.notAtCurrentPeriod.length > 0) withOlder++;
    if (view.rosterNotScored.length > 0) withUnscored++;

    line(
      `\n  ── ${p.displayName} ──\n     identity ${view.identity.periodKey} @${view.identity.asOfDate}  ·  ` +
        `ranked ${view.members.length}/${view.identity.memberCount}  ·  row periods: ${periods.join(",")}  ·  as-of: ${asOfs.join(",")}`,
    );
    line(
      `     → the table says: ${
        uniform
          ? `"Every reading below is ${periods[0]}, scored ${asOfs.sort().reverse()[0]}."`
          : `"These rows are not all of the same quarter" + a chip on each older row`
      }`,
    );

    // ★ EVERY RANKED ROW MUST SIT AT identity.periodKey. This is the correctness guarantee the
    //   one-line note rests on: if it ever fails, the note is a false claim about a mixed table.
    for (const m of view.members) {
      if (m.periodKey !== view.identity.periodKey) {
        bad(`${m.symbol} is ranked at ${m.periodKey} but identity says ${view.identity.periodKey}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.asOfDate)) bad(`${m.symbol}: asOfDate "${m.asOfDate}" is not YYYY-MM-DD`);
    }

    // ── THE TWO EXCLUDED STATES, WHICH MUST NOT RENDER THE SAME ─────────────────────────────────
    for (const l of view.notAtCurrentPeriod) {
      line(
        `     ON AN OLDER READING ▸ ${l.symbol} "${l.name}"  ${l.latestPeriod} @${l.asOfDate}` +
          `  — excluded from the comparison; it has not taken in the latest results`,
      );
      if (view.members.some((m) => m.symbol === l.symbol)) {
        bad(`${l.symbol} is BOTH ranked and listed as on an older reading`);
      }
      if (l.latestPeriod === view.identity.periodKey) bad(`${l.symbol}: "older" period equals the current one`);
      if (view.rosterNotScored.some((r) => r.symbol === l.symbol)) {
        bad(`${l.symbol} is in BOTH excluded states — they must be disjoint`);
      }
    }
    for (const r of view.rosterNotScored) {
      line(`     NO READING AT ALL ▸ ${r.symbol} "${r.name}"`);
    }

    // ★ THE COUNT RECONCILES. ranked + older + unscored must be the roster; if it does not, some
    //   member is invisible on this page and the reader has no way to know it exists.
    const accounted = view.members.length + view.notAtCurrentPeriod.length + view.rosterNotScored.length;
    if (accounted !== view.identity.memberCount) {
      bad(
        `${accounted} accounted (${view.members.length} ranked + ${view.notAtCurrentPeriod.length} older + ` +
          `${view.rosterNotScored.length} unscored) ≠ roster ${view.identity.memberCount}`,
      );
    }

    // The metric distributions draw from the same cross-section, so the note the raw floor prints is
    // the same claim — assert the member sets match rather than trusting the shared origin.
    const rankedSet = new Set(view.members.map((m) => m.symbol));
    for (const d of view.metricDistributions) {
      for (const pt of d.members) {
        if (!rankedSet.has(pt.symbol)) bad(`${d.metricKey}: distribution carries ${pt.symbol}, not in the ranked set`);
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("B2 · THE CENSUS");
  const scored = (await Promise.all(ponds.map((p) => buildPeerGroupHealthView(p.id)))).filter(
    (v): v is NonNullable<typeof v> => Boolean(v?.scored),
  );
  line(`  scored ponds:                                    ${scored.length}`);
  line(`  ponds whose RANKED ROWS mix periods:             ${mixedPonds}   (the note's mixed branch)`);
  line(`  ponds with a member ON AN OLDER READING:         ${withOlder}`);
  line(`  ponds with a member with NO READING AT ALL:      ${withUnscored}`);
  line(
    `  the widest gap inside one pond:                  ` +
      (scored
        .flatMap((v) =>
          v.notAtCurrentPeriod.map((l) => ({
            pond: v.identity.displayName,
            from: l.latestPeriod,
            to: v.identity.periodKey,
            sym: l.symbol,
          })),
        )
        .map((x) => `${x.pond}: ${x.sym} ${x.from} → pond at ${x.to}`)
        .join(" · ") || "none — every pond is on one period"),
  );

  line("\n" + "─".repeat(112));
  if (violations > 0) {
    console.error(`FAILED — ${violations} violation${violations === 1 ? "" : "s"}.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  line("PASSED — exposure agrees across surfaces, and every ranked row sits at the pond's period.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("verify-pg-tables-live crashed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
