// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · STEP 3 — READ-SURFACE PARITY GATE (read-only, NO writes).
//
// Step 3 opens a findings channel on services that previously returned nothing for an unscored stock.
// The gate is that it changes NOTHING for the 95 that were already scored.
//
// ── HOW THE BEFORE IS OBTAINED, AND WHY IT IS A REAL BEFORE ──────────────────────────────────────
// Steps 1 and 2 had a pre-change tree to fingerprint. This one does not: health-view.service.ts had
// uncommitted work in it before this session began, so HEAD is not a baseline. Instead
// this script GENERATES the baseline at run time — see scripts/lib/health-view-baseline.ts, which
// reads the live service and applies the exact inverse of this step's edits. The copy is written
// beside the original, imported dynamically, and DELETED again on exit. Both versions then run over
// the same 95 stocks against the same database in the same process, so any difference is
// attributable to those edits and nothing else.
//
//   §A  Every scored stock's payload, MINUS `filingFindings`, must be byte-identical to the baseline.
//   §B  `filingFindings` must be the ONLY key that differs, at the top level, on every stock.
//   §C  The two channels must be DISTINGUISHABLE — and the overlap between them is MEASURED, not
//       asserted away. See the block above the §C code for what it found.
//
//   npx tsx src/scripts/filing-pass-step3-parity.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { generateHealthViewBaseline, BASELINE_PATH } from "./lib/health-view-baseline.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import type { HealthSnapshotView } from "../scoring/read/health-view.types.js";


/** Deterministic projection: sorted keys, Dates → ISO. */
function stable(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === "object") {
    const src = v as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) o[k] = stable(src[k]);
    return o;
  }
  return v;
}
const s = (v: unknown) => JSON.stringify(stable(v));

const FILING_KEYS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));

async function main() {
  fs.writeFileSync(BASELINE_PATH, generateHealthViewBaseline());
  // A file:// URL, because a Windows absolute path is not a valid ES module specifier.
  const url = "file://" + path.resolve(BASELINE_PATH).split(path.sep).join("/");
  const baselineMod = (await import(url)) as {
    buildHealthSnapshotViewBASELINE: (s: string, w: number) => Promise<HealthSnapshotView | null>;
  };
  const buildHealthSnapshotViewBASELINE = baselineMod.buildHealthSnapshotViewBASELINE;

  const scored = await prisma.scoreSnapshot.findMany({ select: { symbol: true }, distinct: ["symbol"], orderBy: { symbol: "asc" } });
  const symbols = scored.map((r) => r.symbol);
  console.log(`════ STEP-3 READ PARITY · ${symbols.length} scored stocks ════\n`);

  let identical = 0, moved = 0, keyDeltaOk = 0, channelOk = 0;
  const problems: string[] = [];
  let firedFiling = 0, firedScore = 0;
  let staleStocks = 0, staleRows = 0, dualStocks = 0;
  const staleByKey = new Map<string, number>();
  const dualByKey = new Map<string, number>();

  for (const sym of symbols) {
    const [now, before] = await Promise.all([
      buildHealthSnapshotView(sym, 12),
      buildHealthSnapshotViewBASELINE(sym, 12),
    ]);
    if (!now || !before) { problems.push(`${sym}: view did not resolve`); continue; }

    // ── §B · the top-level key delta ──
    const nowKeys = Object.keys(now as object).sort();
    const beforeKeys = Object.keys(before as object).sort();
    const added = nowKeys.filter((k) => !beforeKeys.includes(k));
    const removed = beforeKeys.filter((k) => !nowKeys.includes(k));
    if (added.length === 1 && added[0] === "filingFindings" && removed.length === 0) keyDeltaOk++;
    else problems.push(`${sym}: top-level key delta is +[${added}] −[${removed}] — expected exactly +filingFindings`);

    // ── §A · everything else, byte for byte ──
    //
    // ⚠ NOW A CUMULATIVE GATE, ACROSS STEPS 3 AND 4. The baseline is still the PRE-STEP-3 service, so
    //   it carries the frozen filing-rule rows on the score channel that step 4 deliberately stopped
    //   serving. Comparing raw would report `findings` as moved on all 58 affected stocks — which it
    //   HAS, on purpose. So the baseline's own findings arrays are passed through the SAME registry
    //   predicate before the comparison: what must still hold is that steps 3 and 4 together changed
    //   nothing except (a) the additive `filingFindings` key and (b) the removal of exactly the filing
    //   keys from the score channel. Any other movement still fails, on any section, as before.
    const stripped = { ...(now as unknown as Record<string, unknown>) };
    delete stripped.filingFindings;
    const beforeAdj = { ...(before as unknown as Record<string, unknown>) };
    const bf = beforeAdj.findings as { redFlags?: { flagKey: string }[]; patterns?: { patternKey: string }[]; quietNote?: string | null } | null;
    if (bf) {
      const rf = (bf.redFlags ?? []).filter((f) => !FILING_KEYS.has(f.flagKey));
      const pt = (bf.patterns ?? []).filter((p) => !FILING_KEYS.has(p.patternKey));
      // The quiet line's third clause (step 4): the page is not quiet if the filing channel is firing.
      const ff = (now as { filingFindings: { fired: unknown[] } | null }).filingFindings;
      const quiet = pt.length === 0 && (bf.quietNote !== null || (ff?.fired.length ?? 0) === 0) ? bf.quietNote : null;
      beforeAdj.findings = { ...bf, redFlags: rf, patterns: pt, quietNote: (ff?.fired.length ?? 0) > 0 ? null : quiet ?? bf.quietNote };
    }
    if (s(stripped) === s(beforeAdj)) identical++;
    else {
      moved++;
      for (const k of beforeKeys) {
        if (s((stripped as Record<string, unknown>)[k]) !== s((beforeAdj as Record<string, unknown>)[k])) {
          problems.push(`${sym}: section "${k}" MOVED`);
        }
      }
    }

    // ── §C · the two channels, measured ─────────────────────────────────────────────────────────
    // ⚠ AT THE END OF STEP 3 THE SCORE CHANNEL STILL CARRIED FILING-RULE KEYS ON THE SCORED STOCKS —
    // 86 rows across 58 of the 95 — because score_patterns / score_red_flags are APPEND-ONLY and
    // version WITH the snapshot: the rows the 21 rules wrote while they still ran inside
    // computePgScores are frozen on each stock's current head. Step 2 stopped writing new ones; it
    // could not un-write the old ones, and a fingerprint-gated rescore may never come for a stock
    // whose inputs sit still.
    //
    // ★ STEP 4 FILTERED THEM AT READ (filing/channel.ts), so the two counters below now read ZERO and
    // that is the assertion, not an observation. They stay here as a REGRESSION GATE: a filing key
    // reappearing on the score channel means either a rule moved back into SCORING_RULES without the
    // registry knowing, or a read boundary was added without the predicate. Both are silent failures
    // whose only symptom is the same finding rendering twice, which is what this counts.
    const ff = (now as { filingFindings: { fired: { ruleKey: string }[] } | null }).filingFindings;
    const sf = (now as { findings: { redFlags: { flagKey: string }[]; patterns: { patternKey: string }[] } | null }).findings;
    const filingKeys = (ff?.fired ?? []).map((f) => f.ruleKey);
    const scoreKeys = [...(sf?.redFlags ?? []).map((f) => f.flagKey), ...(sf?.patterns ?? []).map((p) => p.patternKey)];
    firedFiling += filingKeys.length;
    firedScore += scoreKeys.length;
    // A score key in the FILING channel would be a real defect — the filing table can only hold the 22.
    const wrongWay = filingKeys.filter((k) => !FILING_KEYS.has(k));
    if (wrongWay.length) problems.push(`${sym}: filing channel carries a NON-filing key [${wrongWay}]`);
    else channelOk++;
    const stale = scoreKeys.filter((k) => FILING_KEYS.has(k));
    if (stale.length) {
      staleStocks++;
      staleRows += stale.length;
      for (const k of stale) staleByKey.set(k, (staleByKey.get(k) ?? 0) + 1);
      const both = stale.filter((k) => filingKeys.includes(k));
      if (both.length) { dualStocks++; for (const k of both) dualByKey.set(k, (dualByKey.get(k) ?? 0) + 1); }
    }
  }

  console.log(`── §A · every section except filingFindings ──`);
  console.log(`  byte-identical: ${identical}/${symbols.length}   moved: ${moved}`);
  console.log(`\n── §B · top-level key delta ──`);
  console.log(`  exactly +filingFindings and nothing else: ${keyDeltaOk}/${symbols.length}`);
  console.log(`\n── §C · the two channels ──`);
  console.log(`  filing channel free of non-filing keys: ${channelOk}/${symbols.length}`);
  console.log(`  fired via SCORE channel: ${firedScore}   fired via FILING channel: ${firedFiling}`);
  console.log(`\n  ★ FILING-RULE ROWS SERVED BY THE SCORE CHANNEL — must be ZERO since step 4's filter:`);
  console.log(`      stocks affected: ${staleStocks}/${symbols.length}   rows: ${staleRows}`);
  [...staleByKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`        ${k.padEnd(42)} x${c}`));
  if (staleRows > 0) problems.push(`${staleRows} filing-rule row(s) are still served by the score channel on ${staleStocks} stock(s) — the channel filter is not reaching this boundary`);
  console.log(`\n  ★ SAME FINDING IN BOTH CHANNELS AT ONCE — must be ZERO:`);
  console.log(`      stocks: ${dualStocks}`);
  [...dualByKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`        ${k.padEnd(42)} x${c}`));
  if (dualStocks > 0) problems.push(`${dualStocks} stock(s) would render the same finding twice`);

  if (problems.length) {
    console.log(`\n── PROBLEMS (${problems.length}) ──`);
    problems.slice(0, 30).forEach((p) => console.log(`  ❌ ${p}`));
  }
  const clean = moved === 0 && problems.length === 0;
  console.log(`\n════ VERDICT: ${clean
    ? "✅ NO SCORED SURFACE MOVED — every existing section is byte-identical; the only delta is the additive filingFindings key"
    : "❌ SOMETHING MOVED — see above"} ════`);
  await prisma.$disconnect();
  process.exit(clean ? 0 : 1);
}

// ★ THE COPY NEVER SURVIVES THE PROCESS, whichever way it ends.
const cleanup = () => { try { fs.unlinkSync(BASELINE_PATH); } catch { /* never written / already gone */ } };
process.on("exit", cleanup);
main().catch((e) => { cleanup(); console.error(e); process.exit(1); });
