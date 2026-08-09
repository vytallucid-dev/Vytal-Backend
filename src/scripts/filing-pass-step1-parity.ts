// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING-PASS STEP 1 · SCORING-PARITY FINGERPRINT (read-only, NO writes).
//
// The load-bearing check for step 1: moving the rule-evaluation context onto an industry-aware
// resolver must move NOTHING for the 95 scored stocks.
//
// It cannot be an in-process A/B (the change is to the code, not to a flag), so it is a BEFORE/AFTER
// snapshot instead: run this on the pre-change tree, run it again on the post-change tree, diff the
// two files byte-for-byte.
//
//   npx tsx src/scripts/filing-pass-step1-parity.ts <out.json>
//
// ★ THE FINGERPRINT IS DELIBERATELY WIDER THAN "THE SCORE". It covers the composite, the band, all
// four pillar subtotals AND states, every scored metric's three lenses, the ownership result, the
// fired findings (key + severity + direction + magnitude + displayState + full evidence), the
// declined set, the not-covered set, and the evaluation stamp. A change that moved a finding's
// evidence but not its score would still be caught.
//
// ⚠ VOLATILE FIELDS ARE STRIPPED, NOT COMPARED. `asOf`/`asOfDate`/`evaluatedAt` are `new Date()` in a
// live pass, so they differ between ANY two runs and would drown the diff. Every other Date is
// rendered as an ISO string and compared. Run this twice on the SAME tree first: two identical
// outputs is the proof that the fingerprint is stable run-to-run and that a later diff means
// something.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { computePgScores } from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: filing-pass-step1-parity.ts <out.json>");
  process.exit(1);
}

/** Keys whose value is `new Date()` at pass time — different on every run, by design. */
const VOLATILE = new Set(["asOf", "asOfDate", "evaluatedAt"]);

/** Deterministic projection: sorted keys, Dates → ISO, volatile keys dropped. */
function stable(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === "object") {
    const src = v as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (VOLATILE.has(k)) continue;
      o[k] = stable(src[k]);
    }
    return o;
  }
  return v;
}
const s = (v: unknown) => JSON.stringify(stable(v));

// ★ BOTH GATE MODES. The live pass runs with the guardrail OFF, but the gate reads the SAME annual
// rows the findings context does (score-pass hands it `fRows`), and an O2 suppression removes a value
// from the peer cross-section — i.e. the one path by which a change to the raw-row loading could move
// a SCORE rather than a finding. Fingerprinting both modes proves the untouched-`fRows` claim instead
// of asserting it.
const MODES: { label: string; withGuardrail: boolean }[] = [
  { label: "gate_off", withGuardrail: false },
  { label: "gate_on", withGuardrail: true },
];

async function main() {
  const doc: Record<string, unknown> = {};
  for (const mode of MODES) {
  for (const ref of SCORED_PGS) {
    const pg = await computePgScores(ref, { withFindings: true, withGuardrail: mode.withGuardrail });
    const members: Record<string, unknown> = {};
    for (const m of [...pg.members].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      members[m.symbol] = {
        composite: s({
          state: m.composite.state,
          composite: m.composite.composite,
          rounded: m.composite.compositeRounded,
          band: m.composite.labelBand,
          labelText: m.composite.labelText,
          weights: m.composite.appliedWeights,
          redistribution: m.composite.redistributionReason,
          surviving: m.composite.survivingPillars,
          unavailable: m.composite.unavailablePillars,
          divergence: m.composite.divergence,
          unavailableReason: m.composite.unavailableReason,
          flags: m.composite.flags,
          pillars: m.composite.pillars.map((p) => [p.pillar, p.subtotal, p.state, p.sourcePeriod]),
        }),
        pillars: s({
          f: [m.fPillar.subtotal, m.fPillar.pillarState],
          m: [m.mPillar.subtotal, m.mPillar.pillarState],
          market: m.market ? [m.market.state, m.market.state === "scored" ? m.market.subtotal : null] : null,
          own: m.own ? [m.own.finalOwnership, m.own.snapshot.periodKey] : null,
        }),
        metrics: s(
          [...m.fMetrics, ...m.mMetrics]
            .map((x) => [
              x.pillar, x.metricKey, x.rawValue, x.scoreState, x.unavailableReason,
              x.l1Score, x.l1Band, x.l2Score, x.l2Z, x.l3Score, x.l3Z, x.metricScore, x.lensFallbackApplied,
            ])
            .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
        ),
        findings: s(
          (m.findings ?? [])
            .map((f) => ({
              kind: f.kind, key: f.key, severity: f.severity, direction: f.direction ?? null,
              magnitude: f.magnitude ?? null, displayState: f.displayState ?? "active",
              polarity: f.polarity ?? null, metricRefs: f.metricRefs ?? null, evidence: f.evidence,
            }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        ),
        notEvaluable: s([...(m.notEvaluable ?? [])].map((d) => `${d.ruleRef}:${d.reason}`).sort()),
        notCovered: s([...(m.notCoveredWriteRows ?? [])].map((r) => ({ id: r.id, key: r.patternKey, ev: r.evidence })).sort((a, b) => a.id.localeCompare(b.id))),
        eval: s(m.findingsEval),
        lensAudit: s([...(m.lensAudit ?? [])].map((r) => s(r)).sort()),
      };
    }
    doc[`${mode.label}/${ref.pgId}`] = {
      periodKey: pg.periodKey,
      industry: pg.industry,
      // The gate's own verdict + every suppression it applied — the score-moving surface.
      guardrail: s(pg.guardrail.ran
        ? { ran: true, summary: pg.guardrail.summary, results: pg.guardrail.results }
        : { ran: false, reason: pg.guardrail.reason }),
      dampen: s(pg.dampenReport ?? null),
      peerStats: s([...pg.peerStats].sort((a, b) => `${a.pillar}${a.metricKey}`.localeCompare(`${b.pillar}${b.metricKey}`))),
      members,
    };
  }
  }
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  const memberCount = Object.values(doc).reduce<number>((n, pg) => n + Object.keys((pg as { members: object }).members).length, 0);
  console.log(`✅ wrote ${out} — ${Object.keys(doc).length} PG×mode blocks, ${memberCount} member rows`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
