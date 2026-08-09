// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECON — THREE-LENS SEPARATION (Prompt 32, Part 0). READ-ONLY.
//
// Four questions, measured rather than assumed:
//   1 · what a lens finding CARRIES on the PG payload — face, metric, pillar, stock, DIRECTION
//   2 · VOLUME across the scored ponds — findings, distinct metrics per pond, members per metric
//   3 · WHERE they render today (pathology vs lensPathology) and what re-partitioning costs
//   4 · the metric's DISPLAY NAME and PILLAR — where they come from, and whether the key is enough
//
// Question 2 is the gate: if lens volume is near-zero on most ponds the section is near-empty.
//
// §7 prints the COMPOSED payload the section renders, so the recon and the shipped shape can be read
// against each other after any rescore.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildPeerGroupHealthView } from "../scoring/read/peer-group-view.service.js";
import { faceIdOfLensKey, LENS_FACES } from "../catalogue/lens-faces.js";

const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(112) + "\n" + s + "\n" + "═".repeat(112));

async function main() {
  const pgs = await prisma.peerGroup.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, stockCount: true },
  });

  type Row = {
    pg: string;
    scored: number;
    lensItems: {
      key: string;
      face: string;
      suffix: string;
      scope: "metric" | "pillar";
      pillar: string | null;
      severity: string | null;
      n: number;
      outOf: number;
      members: string[];
      displayState: string;
    }[];
    nonLensPathology: number;
    // the per-member LM projection census (metricDistributions → members[].lensPattern)
    projection: Map<string, { face: string; metricKey: string; pillar: string; members: string[] }>;
    distPillar: Map<string, string>;
  };

  const rows: Row[] = [];

  for (const pg of pgs) {
    const view = await buildPeerGroupHealthView(pg.id);
    if (!view || !view.scored) continue;

    const distPillar = new Map<string, string>();
    for (const d of view.metricDistributions) distPillar.set(d.metricKey, d.pillar);

    const lensItems = view.pathology
      .filter((p) => faceIdOfLensKey(p.key) !== null)
      .map((p) => {
        const face = faceIdOfLensKey(p.key)!;
        const suffix = p.key.slice(`lens_${face.toLowerCase()}_`.length);
        const scope = face.startsWith("LM") ? ("metric" as const) : ("pillar" as const);
        return {
          key: p.key,
          face,
          suffix,
          scope,
          pillar: scope === "metric" ? (distPillar.get(suffix) ?? null) : suffix,
          severity: p.severity,
          n: p.memberCount,
          outOf: p.outOf,
          members: p.members,
          displayState: p.displayState ?? "active",
        };
      });

    // The per-member LM projection — every face, including the QUIET ones (LM1 = top on all three).
    const projection = new Map<string, { face: string; metricKey: string; pillar: string; members: string[] }>();
    for (const d of view.metricDistributions) {
      for (const m of d.members) {
        const lp = m.lensPattern;
        if (!lp) continue;
        const k = `${lp.id}:${d.metricKey}`;
        const e = projection.get(k) ?? { face: lp.id, metricKey: d.metricKey, pillar: d.pillar, members: [] };
        e.members.push(m.symbol);
        projection.set(k, e);
      }
    }

    rows.push({
      pg: pg.displayName,
      scored: view.members.length,
      lensItems,
      nonLensPathology: view.pathology.length - lensItems.length,
      projection,
      distPillar,
    });
  }

  // ── 1 · WHAT A LENS FINDING CARRIES ─────────────────────────────────────────────────────────────
  rule("1 · WHAT THE LENS PAYLOAD CARRIES — one raw census item, verbatim");
  const sample = rows.find((r) => r.lensItems.length > 0);
  if (!sample) line("NO LENS FINDING FIRES ON ANY SCORED POND.");
  else {
    const s = sample.lensItems[0];
    line(`pond: ${sample.pg}`);
    line(JSON.stringify(s, null, 2));
    line("");
    line("FACE RESOLUTION (catalogue, keyed on the face id — NOT the composed key):");
    const f = LENS_FACES[s.face as keyof typeof LENS_FACES];
    line(`  ${s.face} → name="${f.name}"  tone="${f.tone}"  fieldVerdict=${f.fieldVerdict}  escalates=${f.escalates}`);
  }

  // ── 2 · VOLUME ──────────────────────────────────────────────────────────────────────────────────
  rule("2 · VOLUME — per pond (findings = census rows, not member-firings)");
  line(
    "pond".padEnd(34) +
      "M".padStart(4) +
      "lensRows".padStart(10) +
      "metricRows".padStart(12) +
      "pillarRows".padStart(12) +
      "distinctMetrics".padStart(17) +
      "memberFirings".padStart(15) +
      "  nonLensPathology",
  );
  for (const r of rows) {
    const metricRows = r.lensItems.filter((x) => x.scope === "metric");
    const pillarRows = r.lensItems.filter((x) => x.scope === "pillar");
    const distinct = new Set(metricRows.map((x) => x.suffix)).size;
    const firings = r.lensItems.reduce((a, x) => a + x.n, 0);
    line(
      r.pg.slice(0, 33).padEnd(34) +
        String(r.scored).padStart(4) +
        String(r.lensItems.length).padStart(10) +
        String(metricRows.length).padStart(12) +
        String(pillarRows.length).padStart(12) +
        String(distinct).padStart(17) +
        String(firings).padStart(15) +
        "  " +
        r.nonLensPathology,
    );
  }

  rule("2b · DISTRIBUTION — how many ponds have K lens rows / K distinct metrics");
  const histo = (vals: number[], label: string) => {
    const m = new Map<number, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    line(label);
    for (const k of [...m.keys()].sort((a, b) => a - b)) line(`   ${String(k).padStart(3)} → ${m.get(k)} pond(s)`);
  };
  histo(rows.map((r) => r.lensItems.length), "lens census rows per pond:");
  histo(rows.map((r) => new Set(r.lensItems.filter((x) => x.scope === "metric").map((x) => x.suffix)).size),
    "distinct METRICS with a metric-level lens row, per pond:");
  histo(rows.flatMap((r) => r.lensItems.filter((x) => x.scope === "metric").map((x) => x.n)),
    "members caught per metric-level lens row (across all ponds):");

  rule("2c · EVERY METRIC-LEVEL LENS ROW, POND BY POND");
  for (const r of rows) {
    const metricRows = r.lensItems.filter((x) => x.scope === "metric");
    if (metricRows.length === 0) {
      line(`${r.pg} (M=${r.scored}) — none`);
      continue;
    }
    line(`${r.pg} (M=${r.scored})`);
    for (const x of metricRows.sort((a, b) => b.n - a.n)) {
      line(
        `    ${x.face}  ${x.suffix.padEnd(10)} ${String(x.pillar).padEnd(11)} ${x.n}/${x.outOf}  ${x.members.join(" · ")}`,
      );
    }
    for (const x of r.lensItems.filter((y) => y.scope === "pillar")) {
      line(`    ${x.face}  (pillar ${x.suffix})  ${x.n}/${x.outOf}  ${x.members.join(" · ")}`);
    }
  }

  // ── 3 · FACE MIX ────────────────────────────────────────────────────────────────────────────────
  rule("3 · FACE MIX — which of the four escalating faces actually fire");
  const faceMix = new Map<string, { rows: number; firings: number }>();
  for (const r of rows)
    for (const x of r.lensItems) {
      const e = faceMix.get(x.face) ?? { rows: 0, firings: 0 };
      e.rows += 1;
      e.firings += x.n;
      faceMix.set(x.face, e);
    }
  for (const [k, v] of [...faceMix.entries()].sort()) line(`  ${k}  rows=${v.rows}  memberFirings=${v.firings}`);

  // ── 4 · DIRECTION — is the OTHER pole served anywhere? ───────────────────────────────────────────
  rule("4 · DIRECTION — the per-member LM projection (metricDistributions[].members[].lensPattern)");
  line("This is the SAME lens primitive, projected per member per metric, carrying all 14 faces —");
  line("including the QUIET poles the finding stream never escalates (LM1 = top on all three).");
  line("");
  const projMix = new Map<string, { rows: number; firings: number; ponds: Set<string> }>();
  for (const r of rows)
    for (const [, e] of r.projection) {
      const m = projMix.get(e.face) ?? { rows: 0, firings: 0, ponds: new Set<string>() };
      m.rows += 1;
      m.firings += e.members.length;
      m.ponds.add(r.pg);
      projMix.set(e.face, m);
    }
  for (const [k, v] of [...projMix.entries()].sort())
    line(`  ${k}  metricRows=${String(v.rows).padStart(3)}  memberFirings=${String(v.firings).padStart(4)}  ponds=${v.ponds.size}`);

  rule("4b · POLE FACES ONLY (LM1 top-on-all-three · LM7 bottom-on-all-three), per pond");
  line(
    "pond".padEnd(34) +
      "M".padStart(4) +
      "LM1rows".padStart(9) +
      "LM7rows".padStart(9) +
      "bothPoleMetrics".padStart(17) +
      "  metrics(LM1|LM7) n=members",
  );
  for (const r of rows) {
    const lm1 = [...r.projection.values()].filter((e) => e.face === "LM1");
    const lm7 = [...r.projection.values()].filter((e) => e.face === "LM7");
    const both = new Set(lm1.map((e) => e.metricKey)).size
      ? [...new Set(lm1.map((e) => e.metricKey))].filter((k) => lm7.some((e) => e.metricKey === k))
      : [];
    const detail = [
      ...lm1.map((e) => `LM1:${e.metricKey}=${e.members.length}`),
      ...lm7.map((e) => `LM7:${e.metricKey}=${e.members.length}`),
    ].join(" ");
    line(
      r.pg.slice(0, 33).padEnd(34) +
        String(r.scored).padStart(4) +
        String(lm1.length).padStart(9) +
        String(lm7.length).padStart(9) +
        String(both.length).padStart(17) +
        "  " +
        detail,
    );
  }

  rule("4c · ALL POLE + NEAR-POLE FACES BY METRIC, per pond (the section's candidate substrate)");
  for (const r of rows) {
    const poles = [...r.projection.values()].filter((e) => e.face === "LM1" || e.face === "LM7");
    if (!poles.length) {
      line(`${r.pg} (M=${r.scored}) — NO POLE`);
      continue;
    }
    const byMetric = new Map<string, typeof poles>();
    for (const p of poles) {
      const a = byMetric.get(p.metricKey) ?? [];
      a.push(p);
      byMetric.set(p.metricKey, a);
    }
    line(`${r.pg} (M=${r.scored}) — ${byMetric.size} metric block(s)`);
    for (const [mk, arr] of [...byMetric.entries()].sort(
      (a, b) => b[1].reduce((x, y) => x + y.members.length, 0) - a[1].reduce((x, y) => x + y.members.length, 0),
    )) {
      for (const e of arr)
        line(
          `    ${mk.padEnd(10)} ${e.pillar.padEnd(11)} ${e.face === "LM1" ? "TOP   " : "BOTTOM"} ${e.members.length}/${r.scored}  ${e.members.join(" · ")}`,
        );
    }
  }

  // ── 5 · THE EMPTY PONDS — why nothing fired ─────────────────────────────────────────────────────
  rule("5 · THE ZERO-LENS PONDS — is it 'everyone clears the bar' or 'below together'?");
  line(
    "pond".padEnd(34) +
      "M".padStart(4) +
      "cells".padStart(8) +
      "belowBar".padStart(10) +
      "atField".padStart(9) +
      "aboveField".padStart(12) +
      "belowField".padStart(12) +
      "  lensRows",
  );
  for (const r of rows) {
    const view = await buildPeerGroupHealthView(
      (await prisma.peerGroup.findFirst({ where: { displayName: r.pg }, select: { id: true } }))!.id,
    );
    let cells = 0;
    let below = 0;
    let atF = 0;
    let aboveF = 0;
    let belowF = 0;
    for (const d of view!.metricDistributions)
      for (const m of d.members) {
        if (!m.lens) continue;
        cells += 1;
        if (m.lens.l1.state === "below_bar") {
          below += 1;
          if (m.lens.l2.state === "above_peer") aboveF += 1;
          else if (m.lens.l2.state === "below_peer") belowF += 1;
          else if (m.lens.l2.state === "near_peer") atF += 1;
        }
      }
    line(
      r.pg.slice(0, 33).padEnd(34) +
        String(r.scored).padStart(4) +
        String(cells).padStart(8) +
        String(below).padStart(10) +
        String(atF).padStart(9) +
        String(aboveF).padStart(12) +
        String(belowF).padStart(12) +
        "  " +
        r.lensItems.length,
    );
  }

  rule("6 · BLOCK SHAPE UNDER THE SHIPPING DEFINITION (metric-level lens findings, grouped by metric)");
  line(
    "pond".padEnd(34) +
      "M".padStart(4) +
      "metricGroups".padStart(14) +
      "poleRows".padStart(10) +
      "bothPoles".padStart(11) +
      "maxMembers".padStart(12) +
      "  groups (metric dir n)",
  );
  const groupCounts: number[] = [];
  for (const r of rows) {
    const metricRows = r.lensItems.filter((x) => x.scope === "metric");
    const byMetric = new Map<string, typeof metricRows>();
    for (const x of metricRows) {
      const a = byMetric.get(x.suffix) ?? [];
      a.push(x);
      byMetric.set(x.suffix, a);
    }
    const both = [...byMetric.values()].filter(
      (a) => a.some((x) => x.face === "LM3") && a.some((x) => x.face === "LM7"),
    ).length;
    const maxMembers = metricRows.length ? Math.max(...metricRows.map((x) => x.n)) : 0;
    groupCounts.push(byMetric.size);
    const detail = [...byMetric.entries()]
      .map(([k, a]) => `${k}(${a.map((x) => `${x.face === "LM7" ? "bottom" : "top"}:${x.n}`).join("+")})`)
      .join(" ");
    line(
      r.pg.slice(0, 33).padEnd(34) +
        String(r.scored).padStart(4) +
        String(byMetric.size).padStart(14) +
        String(metricRows.length).padStart(10) +
        String(both).padStart(11) +
        String(maxMembers).padStart(12) +
        "  " +
        detail,
    );
  }
  histo(groupCounts, "metric GROUPS (= blocks) per pond:");

  rule("4d · BLOCK-COUNT DISTRIBUTION under the pole-face definition");
  const blockCounts = rows.map(
    (r) => new Set([...r.projection.values()].filter((e) => e.face === "LM1" || e.face === "LM7").map((e) => `${e.face}:${e.metricKey}`)).size,
  );
  histo(blockCounts, "blocks (metric × direction) per pond:");
  const metricCounts = rows.map(
    (r) => new Set([...r.projection.values()].filter((e) => e.face === "LM1" || e.face === "LM7").map((e) => e.metricKey)).size,
  );
  histo(metricCounts, "distinct METRICS with a pole, per pond:");

  // ── 7 · THE COMPOSED PAYLOAD, AS SHIPPED ────────────────────────────────────────────────────────
  rule("7 · THE COMPOSED `lensSeparation` PAYLOAD — what the section actually renders");
  for (const pg of pgs) {
    const v = await buildPeerGroupHealthView(pg.id);
    if (!v || !v.scored) continue;
    const sep = v.lensSeparation;
    const lensLeft = v.pathology.filter((p) => faceIdOfLensKey(p.key));
    line("");
    line(`${pg.displayName}  (M=${v.members.length})  blocks=${sep.blocks.length}  lensRowsKeptInPathology=${lensLeft.length}`);
    if (sep.emptySentence) line(`    EMPTY → ${sep.emptySentence}`);
    for (const b of sep.blocks) {
      line(`    ${b.metricKey} · ${b.pillar}   (${b.memberCount}/${b.outOf} caught, ${b.poles.length} pole)`);
      for (const p of b.poles) {
        line(`        [${p.side}] ${p.face}  ${p.sentence}`);
        line(`                 ${p.members.join(" · ")}`);
      }
    }
    for (const p of lensLeft) line(`    (kept) ${p.key} — ${p.memberCount}/${p.outOf} ${p.members.join(" · ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
