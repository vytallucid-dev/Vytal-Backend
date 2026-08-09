// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · STEP 2 — SCORING-PARITY GATE (read-only, NO writes).
//
// Step 1's fingerprint could be diffed whole, because step 1 moved no rules. Step 2 moves 21 rules OUT
// of computePgScores, so a whole-file diff CANNOT be zero and a script that demanded one would be
// asserting something false. The fingerprint therefore splits in two, and the two halves are held to
// different standards:
//
//   §A  THE SCORE — composite, band, applied weights, all four pillar subtotals AND states, every
//       scored metric's three lenses, ownership, peer μ/σ, the guardrail's applied suppressions, the
//       dampen report. ★ THIS MUST BE BYTE-IDENTICAL. It is the gate. If any of it moves, stop.
//
//   §B  THE FINDINGS DELTA — every finding, decline and not-covered row that left the scoring pass
//       must belong to one of the 21 departing rules, and every one that REMAINS must be
//       byte-identical including its evidence. "21 rules left" is the intended change; anything else
//       moving is a defect wearing the same clothes.
//
//   npx tsx src/scripts/filing-pass-step2-parity.ts <before.json>
//
// <before.json> is the artefact written by filing-pass-step1-parity.ts on the PRE-CHANGE tree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { computePgScores } from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";
import { FILING_REGISTRY } from "../filing/registry.js";

const beforePath = process.argv[2];
if (!beforePath) {
  console.error("usage: filing-pass-step2-parity.ts <before.json>");
  process.exit(1);
}
const before = JSON.parse(fs.readFileSync(beforePath, "utf8")) as Record<string, any>;

/** The 22 keys that left (R1 was never in the scoring rule set — it was written by the ownership
 *  persist path — so its RedFlag row is untouched here and is not part of this delta). */
const DEPARTED_KEYS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));
const DEPARTED_REFS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleRef));

const VOLATILE = new Set(["asOf", "asOfDate", "evaluatedAt"]);
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

const MODES = [
  { label: "gate_off", withGuardrail: false },
  { label: "gate_on", withGuardrail: true },
];

let scoreMoved = 0, scoreSame = 0;
let findingsClean = 0, findingsDirty = 0;
const problems: string[] = [];
const departedFired = new Map<string, number>();
const departedDeclined = new Map<string, number>();

async function main() {
  console.log("════ STEP-2 SCORING PARITY ════\n");

  for (const mode of MODES) {
    for (const ref of SCORED_PGS) {
      const pg = await computePgScores(ref, { withFindings: true, withGuardrail: mode.withGuardrail });
      const key = `${mode.label}/${ref.pgId}`;
      const bPg = before[key];
      if (!bPg) { problems.push(`${key}: absent from the baseline`); continue; }

      // ── §A · PG-LEVEL SCORE SURFACE ──
      const guardrail = s(pg.guardrail.ran
        ? { ran: true, summary: pg.guardrail.summary, results: pg.guardrail.results }
        : { ran: false, reason: pg.guardrail.reason });
      const peerStats = s([...pg.peerStats].sort((a, b) => `${a.pillar}${a.metricKey}`.localeCompare(`${b.pillar}${b.metricKey}`)));
      if (guardrail !== bPg.guardrail) { scoreMoved++; problems.push(`${key}: GUARDRAIL moved`); }
      if (peerStats !== bPg.peerStats) { scoreMoved++; problems.push(`${key}: PEER STATS moved`); }

      // ── THE DAMPENER ──────────────────────────────────────────────────────────────────────────
      // applyPgDampening is key-agnostic: its denominator is the number of SCORED members (unchanged
      // — every scored member still produces a finding set, possibly empty) and its decisions are
      // per-pattern-key and independent across keys. Removing 21 rules therefore cannot change what
      // it does to the 21 that remain. Asserted rather than argued: the report must be identical, and
      // its one live decision (S2 on PG6) belongs to a rule that stays.
      const dampen = s(pg.dampenReport ?? null);
      if (dampen !== bPg.dampen) { scoreMoved++; problems.push(`${key}: DAMPEN REPORT moved — was ${bPg.dampen}, now ${dampen}`); }

      for (const m of pg.members) {
        const b = bPg.members[m.symbol];
        if (!b) { problems.push(`${key}/${m.symbol}: absent from the baseline`); continue; }

        // ── §A · MEMBER SCORE SURFACE (the gate) ──
        const composite = s({
          state: m.composite.state, composite: m.composite.composite, rounded: m.composite.compositeRounded,
          band: m.composite.labelBand, labelText: m.composite.labelText, weights: m.composite.appliedWeights,
          redistribution: m.composite.redistributionReason, surviving: m.composite.survivingPillars,
          unavailable: m.composite.unavailablePillars, divergence: m.composite.divergence,
          unavailableReason: m.composite.unavailableReason, flags: m.composite.flags,
          pillars: m.composite.pillars.map((p) => [p.pillar, p.subtotal, p.state, p.sourcePeriod]),
        });
        const pillars = s({
          f: [m.fPillar.subtotal, m.fPillar.pillarState],
          m: [m.mPillar.subtotal, m.mPillar.pillarState],
          market: m.market ? [m.market.state, m.market.state === "scored" ? m.market.subtotal : null] : null,
          own: m.own ? [m.own.finalOwnership, m.own.snapshot.periodKey] : null,
        });
        const metrics = s(
          [...m.fMetrics, ...m.mMetrics]
            .map((x) => [x.pillar, x.metricKey, x.rawValue, x.scoreState, x.unavailableReason,
              x.l1Score, x.l1Band, x.l2Score, x.l2Z, x.l3Score, x.l3Z, x.metricScore, x.lensFallbackApplied])
            .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
        );
        let moved = false;
        if (composite !== b.composite) { moved = true; problems.push(`${key}/${m.symbol}: COMPOSITE moved`); }
        if (pillars !== b.pillars) { moved = true; problems.push(`${key}/${m.symbol}: PILLARS moved`); }
        if (metrics !== b.metrics) { moved = true; problems.push(`${key}/${m.symbol}: METRICS moved`); }
        if (moved) scoreMoved++; else scoreSame++;

        // ── §B · FINDINGS DELTA (must be exactly the departing rules) ──
        const bFind = JSON.parse(b.findings) as { key: string }[];
        const nowFind = JSON.parse(s(
          (m.findings ?? []).map((f) => ({
            kind: f.kind, key: f.key, severity: f.severity, direction: f.direction ?? null,
            magnitude: f.magnitude ?? null, displayState: f.displayState ?? "active",
            polarity: f.polarity ?? null, metricRefs: f.metricRefs ?? null, evidence: f.evidence,
          })).sort((a, z) => a.key.localeCompare(z.key)),
        )) as { key: string }[];

        const nowByKey = new Map(nowFind.map((f) => [f.key, JSON.stringify(f)]));
        let dirty = false;
        for (const f of bFind) {
          const still = nowByKey.get(f.key);
          if (still === undefined) {
            // Gone. It must be a departing rule.
            if (DEPARTED_KEYS.has(f.key)) departedFired.set(f.key, (departedFired.get(f.key) ?? 0) + 1);
            else { dirty = true; problems.push(`${key}/${m.symbol}: finding ${f.key} DISAPPEARED and is not one of the 21`); }
          } else if (still !== JSON.stringify(f)) {
            dirty = true; problems.push(`${key}/${m.symbol}: finding ${f.key} CHANGED (evidence/severity/magnitude)`);
          }
        }
        for (const f of nowFind) {
          if (!bFind.some((x) => x.key === f.key)) { dirty = true; problems.push(`${key}/${m.symbol}: finding ${f.key} APPEARED — nothing should be added`); }
          if (DEPARTED_KEYS.has(f.key)) { dirty = true; problems.push(`${key}/${m.symbol}: departing rule ${f.key} STILL FIRES in the scoring pass`); }
        }

        // Declines: same test, keyed on ruleRef.
        const bDecl = JSON.parse(b.notEvaluable) as string[];
        const nowDecl = JSON.parse(s([...(m.notEvaluable ?? [])].map((d) => `${d.ruleRef}:${d.reason}`).sort())) as string[];
        for (const d of bDecl) {
          if (nowDecl.includes(d)) continue;
          const ref2 = d.split(":")[0];
          if (DEPARTED_REFS.has(ref2)) departedDeclined.set(d, (departedDeclined.get(d) ?? 0) + 1);
          else { dirty = true; problems.push(`${key}/${m.symbol}: decline ${d} DISAPPEARED and is not one of the 21`); }
        }
        for (const d of nowDecl) {
          if (!bDecl.includes(d)) { dirty = true; problems.push(`${key}/${m.symbol}: decline ${d} APPEARED`); }
          if (DEPARTED_REFS.has(d.split(":")[0])) { dirty = true; problems.push(`${key}/${m.symbol}: departing rule ${d} STILL DECLINES in the scoring pass`); }
        }

        // Not-covered rows are a separate stream and must not move at all.
        const nowNc = s([...(m.notCoveredWriteRows ?? [])].map((r) => ({ id: r.id, key: r.patternKey, ev: r.evidence })).sort((a, z) => a.id.localeCompare(z.id)));
        if (nowNc !== b.notCovered) { dirty = true; problems.push(`${key}/${m.symbol}: NOT-COVERED rows moved`); }

        if (dirty) findingsDirty++; else findingsClean++;
      }
    }
  }

  console.log("── §A · THE SCORE (the gate) ──");
  console.log(`  byte-identical: ${scoreSame}   moved: ${scoreMoved}`);
  console.log("\n── §B · THE FINDINGS DELTA (must be exactly the 21) ──");
  console.log(`  member finding-sets clean: ${findingsClean}   dirty: ${findingsDirty}`);
  console.log(`\n  fired findings that LEFT the scoring pass (all belong to the 21):`);
  [...departedFired.entries()].sort().forEach(([k, c]) => console.log(`     ${k.padEnd(42)} ×${c}`));
  console.log(`\n  declines that LEFT the scoring pass:`);
  [...departedDeclined.entries()].sort().forEach(([k, c]) => console.log(`     ${k.padEnd(42)} ×${c}`));

  if (problems.length) {
    console.log(`\n── PROBLEMS (${problems.length}) ──`);
    problems.slice(0, 40).forEach((p) => console.log(`  ❌ ${p}`));
    if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
  }

  const clean = scoreMoved === 0 && findingsDirty === 0 && problems.length === 0;
  console.log(`\n════ VERDICT: ${clean
    ? "✅ NO SCORE MOVED — composite, pillars, metrics, peer stats and guardrail are byte-identical; the ONLY change to the findings stream is the departure of the 21"
    : "❌ SOMETHING MOVED — see above"} ════`);
  await prisma.$disconnect();
  process.exit(clean ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
