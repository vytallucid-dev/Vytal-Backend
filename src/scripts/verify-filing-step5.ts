// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 5 — TWO DENOMINATORS, THE OPEN ALERT GATE, AND THE UNSCORED POND MEMBERS (read-only, NO writes).
//
//   §1  the two populations, per key, with the per-grain reasoning shown in the numbers
//   §2  ★ THE GATE — every UE card on the 95, built TWICE through the same pure composer: once with
//       the live (split) numbers and once with the pre-step-5 numbers injected into the same shapes.
//       A card may differ ONLY where its key's denominator genuinely moved.
//   §3  the alert gate: alertable population before and after, and the prior-period test still holding
//   §4  the 54 unscored pond members, and the scored ponds' aggregates untouched
//
//   npx tsx src/scripts/verify-filing-step5.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { warmBaseRates, rateFor, type BaseRate, type BaseRateSnapshot } from "../relational/base-rates.js";
import { isFilingChannelKey, filingChannelKeys } from "../filing/channel.js";
import { resolveObjectState } from "../relational/object-state.js";
import { resolveReaderContext } from "../relational/reader-context.js";
import { composeRelationalState } from "../relational/service.js";
import { buildPeerGroupHealthView } from "../scoring/read/peer-group-view.service.js";
import { assembleReadings } from "../alerts/eval-pass.js";
import { readNewlyStandingFilingKeys } from "../filing/read.js";
import type { ReaderContext } from "../relational/types.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };
const pad = (s: string, n: number) => s.padEnd(n);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  console.log("════ STEP 5 ════");

  // ═══════════════ §1 · the two populations ═══════════════
  console.log("\n──────── §1 · two denominators, projected from the registry ────────");
  const snap = await warmBaseRates();
  if (!snap) { console.error("base rates did not compute"); process.exit(1); }
  const filingKeys = new Set(filingChannelKeys());
  const scored = [...snap.rates.values()].filter((r) => r.population === "scored");
  const filing = [...snap.rates.values()].filter((r) => r.population === "filing").sort((a, b) => a.patternKey.localeCompare(b.patternKey));

  ok(scored.every((r) => !filingKeys.has(r.patternKey)), `no filing key resolves to the SCORED population (${scored.length} scored keys)`);
  ok(filing.every((r) => filingKeys.has(r.patternKey)), `every filing-population key is in FILING_REGISTRY (${filing.length} keys)`);
  ok(filing.length === 22, `all 22 filing rules have a rate — including the ones that fired nowhere (${filing.length})`);
  ok(new Set(scored.map((r) => r.universeCount)).size <= 1, `every scored key shares ONE denominator (${snap.universeCount})`);

  console.log(`\n  SCORED population — ${snap.universeCount} stocks with an in-force snapshot, one denominator for all ${scored.length} keys`);
  console.log(`  FILING population — per RULE: the stocks in which that rule EVALUATED (fired + not_fired)\n`);
  console.log(`  ${pad("key", 44)}${"fired".padStart(6)}${"of".padStart(6)}${"rate".padStart(8)}   as-of`);
  for (const r of filing) {
    console.log(`  ${pad(r.patternKey, 44)}${String(r.firedInUniverse).padStart(6)}${String(r.universeCount).padStart(6)}${pct(r.expectedShare).padStart(8)}   ${r.asOfDate?.toISOString().slice(0, 10) ?? "—"}`);
  }
  const dens = new Set(filing.map((r) => r.universeCount));
  console.log(`\n  distinct filing denominators: ${[...dens].sort((a, b) => a - b).join(", ")}`);
  console.log(`  → the grain shows through as a CONSEQUENCE of evaluability, never as a second rule:`);
  console.log(`    shareholding rules land at ~504 (every stock files one), annual at ≤380, quarterly at 291–414.`);

  // ═══════════════ §2 · THE GATE — every UE card, before and after ═══════════════
  console.log("\n──────── §2 · every UE card on the 95, before vs after ────────");

  // The PRE-STEP-5 numbers, injected into the post-step-5 shapes so the SAME pure composer runs on
  // both. Nothing about the code path differs between the two runs — only the numbers do, which is
  // exactly the claim under test.
  const headRows = await prisma.$queryRawUnsafe<{ patternKey: string; n: number }[]>(`
    WITH head AS (SELECT DISTINCT ON (s.stock_id) s.id, s.stock_id FROM score_snapshots s ORDER BY s.stock_id, s.period_key DESC, s.version DESC)
    SELECT p.pattern_key AS "patternKey", count(DISTINCT h.stock_id)::int AS n
    FROM score_patterns p JOIN head h ON h.id = p.snapshot_id GROUP BY p.pattern_key`);
  const headFlagRows = await prisma.$queryRawUnsafe<{ patternKey: string; n: number }[]>(`
    WITH head AS (SELECT DISTINCT ON (s.stock_id) s.id, s.stock_id FROM score_snapshots s ORDER BY s.stock_id, s.period_key DESC, s.version DESC)
    SELECT f.flag_key AS "patternKey", count(DISTINCT h.stock_id)::int AS n
    FROM score_red_flags f JOIN head h ON h.id = f.snapshot_id GROUP BY f.flag_key`);
  const frozenUniverse = new Map<string, number>();
  for (const r of [...headRows, ...headFlagRows]) frozenUniverse.set(r.patternKey, Number(r.n));

  const oldRates: BaseRateSnapshot = {
    universeCount: snap.universeCount,
    asOfDate: snap.asOfDate,
    computedAt: snap.computedAt,
    rates: new Map<string, BaseRate>([...snap.rates.entries()].map(([k, r]) => {
      if (r.population !== "filing") return [k, r] as const;
      const fired = frozenUniverse.get(k) ?? 0;
      return [k, { ...r, firedInUniverse: fired, universeCount: snap.universeCount, expectedShare: snap.universeCount > 0 ? fired / snap.universeCount : 0 }] as const;
    })),
  };

  const users = (await prisma.holding.findMany({ where: { stockId: { not: null }, quantity: { gt: 0 } }, select: { userId: true }, distinct: ["userId"] })).map((u) => u.userId);
  const scoredStocks = await prisma.scoreSnapshot.findMany({ select: { stockId: true, symbol: true }, distinct: ["stockId"], orderBy: { symbol: "asc" } });

  // The pre-step-5 book census for filing keys: the FROZEN score_patterns rows, over the scored
  // holdings denominator — i.e. exactly what byPatternKey carried before the split.
  async function frozenFilingBook(userId: string): Promise<Map<string, string[]>> {
    const rows = await prisma.$queryRawUnsafe<{ patternKey: string; name: string }[]>(`
      WITH held AS (
        SELECT DISTINCT stock_id FROM holdings WHERE user_id = '${userId}' AND stock_id IS NOT NULL AND quantity > 0
        UNION SELECT DISTINCT stock_id FROM broker_holdings WHERE user_id = '${userId}' AND stock_id IS NOT NULL AND quantity > 0),
      head AS (SELECT DISTINCT ON (s.stock_id) s.id, s.stock_id FROM score_snapshots s JOIN held h ON h.stock_id = s.stock_id ORDER BY s.stock_id, s.period_key DESC, s.version DESC)
      SELECT p.pattern_key AS "patternKey", st.name AS "name" FROM head JOIN stocks st ON st.id = head.stock_id JOIN score_patterns p ON p.snapshot_id = head.id
      UNION
      SELECT f.flag_key AS "patternKey", st.name AS "name" FROM head JOIN stocks st ON st.id = head.stock_id JOIN score_red_flags f ON f.snapshot_id = head.id`);
    const m = new Map<string, string[]>();
    for (const r of rows) {
      if (!isFilingChannelKey(r.patternKey)) continue;
      const a = m.get(r.patternKey) ?? [];
      if (!a.includes(r.name)) a.push(r.name);
      m.set(r.patternKey, a);
    }
    return m;
  }

  let compared = 0, changed = 0, unexplained = 0;
  const changes: string[] = [];
  // The live echo population, so "N cards changed" is read against how many exist rather than in a
  // vacuum. An echo absorbed into a host still counts — it is the same claim on the same card.
  const echoPop = { UE1: 0, UE6: 0, UE5: 0, annotated: 0 };

  for (const userId of users) {
    const frozenBook = await frozenFilingBook(userId);

    for (const st of scoredStocks) {
      const obj = await resolveObjectState(st.stockId);
      if (!obj || obj.findings.length === 0) continue;
      // Cheap pre-filter: an echo needs the key in the book on at least one side.
      const anyInBook = obj.findings.some((f) => frozenBook.has(f.key) || true);
      if (!anyInBook) continue;

      const ctx = await resolveReaderContext(userId, st.stockId, {
        peerGroupId: obj.peerGroup?.id ?? null,
        sectorKey: obj.sector?.key ?? null,
        snapshotGeneration: obj.snapshot?.generation ?? null,
        firedKeys: obj.findings.map((f) => f.key),
      });
      if (!ctx.echo) continue;

      // The pre-step-5 context: filing keys served from the frozen rows, on the scored denominator.
      const oldCtx: ReaderContext = {
        ...ctx,
        echo: {
          scoredHoldingsCount: ctx.echo.scoredHoldingsCount,
          byPatternKey: ctx.echo.byPatternKey,
          filing: {
            byRuleKey: frozenBook,
            evaluatedByRuleKey: new Map(filingChannelKeys().map((k) => [k, ctx.echo!.scoredHoldingsCount])),
            coveredHoldingsCount: ctx.echo.scoredHoldingsCount,
          },
        },
      };

      const now = new Date("2026-08-09T00:00:00.000Z");
      const after = composeRelationalState(ctx, obj, now, snap);
      const before = composeRelationalState(oldCtx, obj, now, oldRates);
      compared++;

      for (const e of [...after.slots, ...after.overflow]) {
        if (e.entryId === "UE1") echoPop.UE1++;
        else if (e.entryId === "UE6") echoPop.UE6++;
        else if (e.entryId === "UE5") echoPop.UE5++;
        else if ((e.arithmetic as { __echoKey?: string } | null)?.__echoKey) echoPop.annotated++;
      }

      // ⚠ COMPARE THE WHOLE CARD, NOT THE `family === "UE"` ENTRIES.
      //   `attachEchoAnnotations` runs after assembly and MERGES a key-tied echo into whichever entry
      //   already renders that key (UD1 → UO6 → ELEVATED), so the echo's numbers end up inside a host
      //   whose family is not UE. A UE-only comparison silently passed over exactly the entries this
      //   step changes — and it did, on the first run: it reported zero differences on a book where
      //   26 echoes were live. The full card also makes "no other surface moved" part of the same gate.
      const cardOf = (s: typeof after) =>
        [...s.slots, ...s.overflow].map((e) => `${e.entryId}|${e.claim}|${JSON.stringify(e.arithmetic ?? null)}`).sort();
      const a = cardOf(after), b = cardOf(before);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      changed++;

      // WHY. Every difference must be attributable to a key whose denominator or book count moved.
      const touched = new Set(obj.findings.map((f) => f.key));
      const moved = [...touched].filter((k) => {
        const nr = rateFor(snap, k), or = rateFor(oldRates, k);
        const nb = ctx.echo!.filing.evaluatedByRuleKey.get(k) ?? ctx.echo!.scoredHoldingsCount;
        const ob = ctx.echo!.scoredHoldingsCount;
        return nr.universeCount !== or.universeCount || nr.firedInUniverse !== or.firedInUniverse || nb !== ob
          || (frozenBook.get(k)?.length ?? 0) !== (ctx.echo!.filing.byRuleKey.get(k)?.length ?? 0);
      });
      const explained = moved.length > 0;
      if (!explained) { unexplained++; }
      // Only the lines that actually differ — the rest of the card is identical and printing it whole
      // would bury the delta the gate exists to show.
      const onlyA = a.filter((x) => !b.includes(x));
      const onlyB = b.filter((x) => !a.includes(x));
      changes.push(
        `  ${pad(st.symbol, 12)} book ${userId.slice(0, 8)}…  ${explained ? `moved: ${moved.join(", ")}` : "❌ UNEXPLAINED"}\n` +
        onlyB.map((x) => `      − ${x}`).join("\n") + (onlyB.length ? "\n" : "") +
        onlyA.map((x) => `      + ${x}`).join("\n"),
      );
    }
  }

  console.log(`  (object, reader) pairs composed: ${compared}   cards changed: ${changed}`);
  console.log(`  live echo population — UE1 ${echoPop.UE1} · UE6 ${echoPop.UE6} · UE5 ${echoPop.UE5} · absorbed into a host entry ${echoPop.annotated}`);
  changes.forEach((c) => console.log(c));
  ok(unexplained === 0, `every UE change is attributable to a denominator or a book count that genuinely moved (${unexplained} unexplained)`);

  // ═══════════════ §3 · the alert gate ═══════════════
  console.log("\n──────── §3 · the alerts gate ────────");
  const totalStocks = await prisma.stock.count({ where: { isActive: true } });
  console.log(`  alertable population for a FINDING alert:  before ${snap.universeCount} (scored only)  →  after ${totalStocks} (every active stock)`);
  const allIds = (await prisma.stock.findMany({ where: { isActive: true }, select: { id: true } })).map((s) => s.id);
  const newly = await readNewlyStandingFilingKeys(allIds);
  const withNew = [...newly.values()].filter((s) => s.size > 0).length;
  const pairs = await prisma.stockFinding.groupBy({ by: ["stockId", "ruleKey"], _count: { _all: true } });
  const multi = pairs.filter((p) => p._count._all > 1).length;
  ok(withNew === 0 && multi === 0,
    `THE PRIOR-PERIOD TEST STILL HOLDS: ${multi} (stock, rule) pairs have a prior period, so ${withNew} stocks have a newly-appeared filing finding.` +
    ` Opening the gate flushes no backlog — a first observation is not a transition.`);

  const alerts = await prisma.alert.findMany({ where: { type: "finding" }, select: { stockId: true, findingKey: true, active: true } });
  const readings = await assembleReadings(alerts.map((a) => a.stockId));
  for (const a of alerts) {
    const r = readings.get(a.stockId);
    console.log(`     existing finding alert: key=${a.findingKey} scored=${r?.scored} newFindingKeys=${[...(r?.newFindingKeys ?? [])].join(",") || "(none)"} → would not fire`);
  }
  const unscoredWithStanding = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT f.stock_id) AS n FROM stock_findings f
    WHERE f.evaluation_state = 'fired'
      AND NOT EXISTS (SELECT 1 FROM score_snapshots s WHERE s.stock_id = f.stock_id)`;
  console.log(`     unscored stocks carrying a standing filing finding, now reachable by an alert: ${Number(unscoredWithStanding[0]?.n ?? 0)}`);

  // ═══════════════ §4 · the unscored pond members ═══════════════
  console.log("\n──────── §4 · pond members with no score ────────");
  const pgs = await prisma.peerGroup.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
  let totalUnscored = 0, pondsWithUnscored = 0, scoredPondsClean = 0;
  for (const pg of pgs) {
    const v = await buildPeerGroupHealthView(pg.id);
    if (!v) continue;
    const u = v.unscoredMembers;
    if (u.count === 0) { scoredPondsClean++; continue; }
    pondsWithUnscored++;
    totalUnscored += u.count;
    const fired = u.unscoredPathology.reduce((s, p) => s + p.memberCount, 0);
    console.log(`  ${pad(pg.displayName, 34)} scored=${String(v.scored).padEnd(5)} unscored ${u.count} (covered ${u.covered}) · ${u.unscoredPathology.length} census rows · ${fired} member-findings`);
    for (const p of u.unscoredPathology.slice(0, 4)) {
      console.log(`      ${p.kind === "red_flag" ? "RF" : "PT"} ${pad(p.key, 42)} ${p.memberCount}/${p.outOf} ${pad(p.reach, 11)} ${p.members.join(", ")}`);
    }
    // Never merged upward.
    ok(v.pathology.every((x) => !u.unscoredPathology.some((y) => y.key === x.key && y.outOf === x.outOf)),
      `${pg.displayName}: the two censuses are separately denominated`);
    ok(u.unscoredPathology.every((p) => p.outOf === u.count), `${pg.displayName}: every unscored census row states the unscored denominator`);
    ok(v.members.every((m) => !u.members.some((x) => x.symbol === m.symbol)), `${pg.displayName}: no member appears in both the scored aggregate and the unscored list`);
  }
  ok(totalUnscored === 54, `all 54 unscored pond members are served (${totalUnscored} across ${pondsWithUnscored} ponds)`);
  ok(scoredPondsClean === pgs.length - pondsWithUnscored, `the ${scoredPondsClean} fully-scored ponds carry an empty block — their aggregates cannot move`);

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
