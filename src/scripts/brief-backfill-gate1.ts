// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BACKFILL GATE 1 — WHAT IS ACTUALLY AVAILABLE. READS ONLY; SPENDS NOTHING.
//
// Answers, in order: how much of today's AI budget is left and who spent the rest of it, how many
// stocks would actually produce a brief, what the run costs in CALLS (not briefs — an attempt is the
// unit the gate meters), and how long it takes at the pacing floor.
//
// ⚠ NO AI CALL IS MADE HERE. peekAiCallQuota is the read-only twin of the gate (it must never
// authorise a call), and buildQuarterBriefFactBlock is pure DB work. The eligibility count is the
// REAL test — the same builder writeQuarterBrief calls — not a proxy count of quarterly rows.
//
//   npx tsx src/scripts/brief-backfill-gate1.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/quota.js";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6);

/** The Pacific calendar date the quota window is keyed on — quota.ts's own boundary, restated for
 *  the report only (never for a decision). */
function pacificToday(): string {
  const tz = process.env.AI_QUOTA_TIMEZONE || "America/Los_Angeles";
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())) if (part.type !== "literal") p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

const hhmm = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

async function main(): Promise<void> {
  const windowKey = pacificToday();

  // ── 1a · THE COUNTER, AND ITS DECOMPOSITION ──────────────────────────────────────────────────────
  console.log("═".repeat(100));
  console.log(`1a · ai_usage_counters — window ${windowKey} (Pacific)`);
  console.log("═".repeat(100));

  const rows = await prisma.aiUsageCounter.findMany({
    where: { windowKey },
    select: { scope: true, callCount: true, tokenCount: true, updatedAt: true },
    orderBy: { callCount: "desc" },
  });
  if (rows.length === 0) console.log("  (no counter rows for today — nothing has spent yet)");
  for (const r of rows) {
    console.log(
      `  ${r.scope.padEnd(46)} calls=${String(r.callCount).padStart(5)}  ` +
        `tokens=${String(r.tokenCount).padStart(9)}  last=${r.updatedAt.toISOString()}`,
    );
  }

  const globalRow = rows.find((r) => r.scope === QUARTER_BRIEF_MODEL);
  const globalUsed = globalRow?.callCount ?? 0;
  // A user actor increments BOTH its own `user:<id>:<model>` row and the global one; a system actor
  // increments the global one ONLY. So the difference attributes the day's spend without guessing.
  const userRows = rows.filter((r) => r.scope.startsWith("user:") && r.scope.endsWith(`:${QUARTER_BRIEF_MODEL}`));
  const userTotal = userRows.reduce((a, r) => a + r.callCount, 0);

  const peek = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  console.log(`\n  model            : ${QUARTER_BRIEF_MODEL}`);
  console.log(`  AI_BUDGET_FLASH_LITE (env) : ${process.env.AI_BUDGET_FLASH_LITE ?? "(unset)"}`);
  console.log(`  effective limit  : ${peek.limit}`);
  console.log(`  consumed today   : ${globalUsed}`);
  console.log(`  remaining today  : ${peek.remaining}   (resets ${peek.resetAt.toISOString()})`);
  console.log(`  attributed       : ${userTotal} by user actors (chat), ${globalUsed - userTotal} by system jobs`);
  for (const r of userRows) console.log(`      · ${r.scope} → ${r.callCount}`);

  // Other models share nothing but the table; shown so "the counter" is not misread as one number.
  const otherRows = await prisma.aiUsageCounter.findMany({
    where: { windowKey, NOT: { scope: { contains: QUARTER_BRIEF_MODEL } } },
    select: { scope: true, callCount: true },
  });
  console.log(`  other model scopes today: ${otherRows.length === 0 ? "none" : otherRows.map((r) => `${r.scope}=${r.callCount}`).join(", ")}`);

  // ── 1b · ELIGIBILITY, BY THE REAL BUILDER ────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(100));
  console.log("1b · eligibility — buildQuarterBriefFactBlock over every stock (the real test)");
  console.log("═".repeat(100));

  const stocks = await prisma.stock.findMany({
    select: { id: true, symbol: true, industryType: true, isActive: true, marketCapCategory: true },
    orderBy: { symbol: "asc" },
  });

  // Universe membership (the Nifty-500 display-only expansion put its firewall exactly here: a stock
  // with no stock_peer_groups row is display-only and is NOT scored).
  const pgRows = await prisma.stockPeerGroup.findMany({ select: { stockId: true } });
  const inUniverse = new Set(pgRows.map((r) => r.stockId));

  interface Row {
    symbol: string; stockId: string; family: string; periodKey: string; quarter: string;
    fiscalYear: string; basis: string; filingDate: string; scored: boolean; inUniverse: boolean;
    verdictKey: string | null; verdictLabel: string | null; hasAnnual: boolean; suppressed: number;
    suppressedMargins: number; hasDriver: boolean; factChars: number; contrasts: number;
  }
  const eligible: Row[] = [];
  const noFacts: string[] = [];

  let done = 0;
  for (const s of stocks) {
    const b = await buildQuarterBriefFactBlock(s.symbol);
    done++;
    if (done % 100 === 0) process.stderr.write(`    …${done}/${stocks.length}\n`);
    if (!b) { noFacts.push(s.symbol); continue; }
    const facts = renderFactText(b);
    eligible.push({
      symbol: s.symbol,
      stockId: s.id,
      family: b.identity.family,
      periodKey: b.identity.periodKey,
      quarter: b.identity.quarter,
      fiscalYear: b.identity.fiscalYear,
      basis: b.identity.basis,
      filingDate: b.identity.filingDate,
      scored: b.healthMovement !== null,
      inUniverse: inUniverse.has(s.id),
      verdictKey: b.verdict?.key ?? null,
      verdictLabel: b.verdict?.label ?? null,
      hasAnnual: b.annual !== null,
      suppressed: b.quarter.suppressed.length,
      suppressedMargins: b.margins?.suppressed.length ?? 0,
      hasDriver: b.driver !== null,
      factChars: facts.length,
      contrasts: b.contrasts.length,
    });
  }

  const by = <K extends keyof Row>(k: K): Map<Row[K], number> => {
    const m = new Map<Row[K], number>();
    for (const r of eligible) m.set(r[k], (m.get(r[k]) ?? 0) + 1);
    return m;
  };
  const show = (label: string, m: Map<unknown, number>): void => {
    const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(k)}=${v}`);
    console.log(`  ${label.padEnd(20)} ${parts.join("  ")}`);
  };

  console.log(`  stocks in table     : ${stocks.length}  (active=${stocks.filter((s) => s.isActive).length})`);
  console.log(`  ELIGIBLE (block builds): ${eligible.length}`);
  console.log(`  no facts (skipped)  : ${noFacts.length}`);
  show("by family", by("family"));
  show("by period", by("periodKey"));
  show("by quarter", by("quarter"));
  show("by basis", by("basis"));
  console.log(`  scored              : ${eligible.filter((r) => r.scored).length}   unscored: ${eligible.filter((r) => !r.scored).length}`);
  console.log(`  in universe (peer-grouped): ${eligible.filter((r) => r.inUniverse).length}   display-only: ${eligible.filter((r) => !r.inUniverse).length}`);
  console.log(`  Q4 with annual section    : ${eligible.filter((r) => r.hasAnnual).length}`);
  console.log(`  with a suppressed metric  : ${eligible.filter((r) => r.suppressed > 0).length}   (suppressed margin series: ${eligible.filter((r) => r.suppressedMargins > 0).length})`);
  console.log(`  with a driver             : ${eligible.filter((r) => r.hasDriver).length}`);
  console.log(`  with a verdict            : ${eligible.filter((r) => r.verdictKey).length}   null badge: ${eligible.filter((r) => !r.verdictKey).length}`);

  const chars = eligible.map((r) => r.factChars).sort((a, b) => a - b);
  const pct = (p: number) => chars[Math.min(chars.length - 1, Math.floor(chars.length * p))];
  console.log(`  fact text chars     : min=${chars[0]} p50=${pct(0.5)} p90=${pct(0.9)} max=${chars[chars.length - 1]}`);

  // ── COST IN CALLS. The metered unit is the ATTEMPT, not the brief. ───────────────────────────────
  const n = eligible.length;
  console.log(`\n  cost, best case (1 attempt each) : ${n} calls`);
  console.log(`  cost, worst case (MAX_ATTEMPTS=2): ${n * 2} calls`);
  console.log(`  remaining budget                 : ${peek.remaining} calls`);
  console.log(`  covers (best case)               : ${Math.min(n, peek.remaining)} of ${n} stocks`);

  // ── 1c · WALL TIME AT THE PACING FLOOR ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(100));
  console.log("1c · pacing");
  console.log("═".repeat(100));
  const SPACING = 4_200;
  const perMin = 60_000 / SPACING;
  console.log(`  MIN_CALL_SPACING_MS = ${SPACING}  ⇒  ${perMin.toFixed(1)} calls/min ceiling`);
  console.log(`  ${n} calls ⇒ ${hhmm(n * SPACING)} of pacing alone (excludes provider latency + block build)`);
  const capped = Math.min(n, peek.remaining);
  console.log(`  budget-capped ${capped} calls ⇒ ${hhmm(capped * SPACING)}`);
  const nowIst = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const endIst = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(Date.now() + capped * SPACING));
  console.log(`  now (IST)   : ${nowIst}`);
  console.log(`  finish (IST): ${endIst}   [pacing only; add provider latency]`);
  console.log(`  quota window resets: ${peek.resetAt.toISOString()} (${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(peek.resetAt)} IST)`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ windowKey, limit: peek.limit, used: globalUsed, remaining: peek.remaining, eligible, noFacts }, null, 2));
    console.log(`\n  wrote ${OUT}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
