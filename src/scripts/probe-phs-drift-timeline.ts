// ═══════════════════════════════════════════════════════════════════════════════
// PHS DRIFT — THE INVESTIGATION TIMELINE.  (read-only; writes nothing)
//   npx tsx src/scripts/probe-phs-drift-timeline.ts
//
// verify-step10c-sharpe.ts and verify-step9-amfi.ts both assert  arman=66  aman=51.
// The live snapshots read  arman=67  aman=50.  Those assertions are LEFT RED on purpose —
// this script exists to hand the operator the evidence, not to make the red go away.
//
// THE QUESTION THIS ANSWERS, precisely:
//   (a) WHEN was the 66/51 pair written, and WHEN did it become 67/50?
//   (b) WHAT wrote the newer pair?
//   (c) WHICH of the PHS fingerprint's six inputs moved?
//
// WHY THE FINGERPRINT IS THE KEY. persist.ts:fingerprintOf hashes exactly six things:
//     { weights[symbol→marketValue share], healthSnapshotIds[], findingIds[],
//       tierAsOfDate, sectorVersion, CONSTANT_VERSION }
// The stored fingerprint MOVED (056bc16b…→? / 424d5af2…→?), so at least one of those six
// moved. That is a closed set — the drift MUST be attributable to one of them, and this
// script walks all six. Nothing else can change a PHS.
// ═══════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// What the harnesses assert — the Step-9-era baseline, recorded verbatim.
const EXPECTED = [
  { email: "arman.shaikh01082003@gmail.com", phs: 66, band: "Steady", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", phs: 51, band: "Mixed", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
];

rule("1 · THE FULL SNAPSHOT HISTORY — every PHS ever written for these two users");
console.log("  (append-only: a row is written ONLY when the input fingerprint changes — persist.ts)\n");

const userIds: Record<string, string> = {};
for (const e of EXPECTED) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: e.email }, select: { id: true, createdAt: true } });
  userIds[e.email] = u.id;

  const hist = await q(
    `SELECT phs, band, coverage::text cov, total_value::text tv, scored_value::text sv,
            constant_version cv, fingerprint fp, created_at
       FROM portfolio_health_snapshot WHERE user_id = $1 ORDER BY created_at ASC`,
    u.id,
  );

  console.log(`  ── ${e.email}  (${hist.length} snapshots; harness expects phs=${e.phs} ${e.band})`);
  let prev: any = null;
  for (const h of hist) {
    const isBaseline = h.fingerprint === e.fp || h.fp === e.fp;
    const moved = prev && prev.phs !== h.phs;
    const mark = h.fp === e.fp ? " ◀── THE HARNESS BASELINE (66/51)" : moved ? ` ◀── ★ PHS MOVED ${prev.phs} → ${h.phs}` : "";
    void isBaseline;
    console.log(
      `     ${new Date(h.created_at).toISOString()}  phs=${String(h.phs).padStart(3)} ${String(h.band).padEnd(7)}` +
        ` cov=${Number(h.cov).toFixed(3)} totalValue=${Number(h.tv).toFixed(0).padStart(9)}` +
        ` scored=${Number(h.sv).toFixed(0).padStart(9)}  ${h.cv}  fp=${String(h.fp).slice(0, 12)}…${mark}`,
    );
    prev = h;
  }
  if (hist.length === 0) console.log("     (none)");
}

rule("2 · WHAT WROTE THE NEWER PAIR? — the write-triggers, in the drift window");
console.log(`  PHS is written by exactly these paths (grep-proven — persist.computeAndPersistPhs callers):
     · brokers/lifecycle.ts       — a broker SYNC or account sever
     · accounts-controller.ts     — an account LINK
     · transactions-controller.ts — a manual transaction add / edit / delete
     · phs/refresh.ts             — refreshPhsForSymbols(), fired by the NIGHTLY RESCORE
  A PHS row appears ONLY when the fingerprint changed, so whichever path ran, an INPUT moved.\n`);

// Bracket the drift: the newest baseline-matching snapshot, and the oldest one after it.
for (const e of EXPECTED) {
  const uid = userIds[e.email]!;
  const base = (await q(
    `SELECT created_at FROM portfolio_health_snapshot WHERE user_id=$1 AND fingerprint=$2 ORDER BY created_at DESC LIMIT 1`,
    uid, e.fp,
  ))[0];
  const next = base
    ? (await q(
        `SELECT phs, band, created_at, fingerprint FROM portfolio_health_snapshot
          WHERE user_id=$1 AND created_at > $2 ORDER BY created_at ASC LIMIT 1`,
        uid, base.created_at,
      ))[0]
    : null;

  console.log(`  ── ${e.email}`);
  if (!base) {
    console.log(`     ⚠️  NO snapshot in the table carries the harness's expected fingerprint ${e.fp.slice(0, 12)}…`);
    console.log(`         ⇒ the 66/51 baseline was recorded from a snapshot that has since been SUPERSEDED`);
    console.log(`           (append-only ⇒ never deleted) or was taken before this table's current history.`);
    continue;
  }
  console.log(`     baseline (${e.phs}) written : ${new Date(base.created_at).toISOString()}`);
  if (next) {
    console.log(`     next snapshot           : ${new Date(next.created_at).toISOString()}  phs=${next.phs} ${next.band}`);
    const gapMin = (new Date(next.created_at).getTime() - new Date(base.created_at).getTime()) / 60000;
    console.log(`     ⇒ THE DRIFT WINDOW is these two timestamps (${gapMin.toFixed(0)} min apart).`);
  } else {
    console.log(`     next snapshot           : (none — the baseline IS the newest)`);
  }
}

rule("3 · INPUT #1/#2 — the ScoreSnapshot IDs (`health`) and RedFlag IDs (`findings`)");
console.log(`  assemble.ts picks, per held stock, the LATEST ScoreSnapshot (asOfDate desc, version desc)
  and pushes its ID into the fingerprint. So ANY rescore that writes a new snapshot for a held
  stock changes the fingerprint — and, if the composite moved, changes the PHS itself.\n`);

// The stocks these two users actually hold (the union the PHS reads).
const held = await q(
  `SELECT DISTINCT u.email, s.id AS stock_id, s.symbol
     FROM holdings h
     JOIN stocks s ON s.id = h.stock_id
     JOIN users u ON u.id = h.user_id
    WHERE u.email = ANY($1::text[])
    ORDER BY u.email, s.symbol`,
  EXPECTED.map((e) => e.email),
);
console.log(`  held stocks (from \`holdings\`): ${held.length}`);
for (const e of EXPECTED) {
  const mine = held.filter((h) => h.email === e.email);
  console.log(`     ${e.email}: ${mine.map((m) => m.symbol).join(", ") || "(none in `holdings`)"}`);
}

const stockIds = [...new Set(held.map((h) => h.stock_id))];
if (stockIds.length) {
  const snaps = await q(
    `SELECT ss.symbol, ss.id, ss.composite::text comp, ss.label_band, ss.as_of_date::text aod,
            ss.version, ss.created_at, ss.run_id, r.trigger_type::text trig, r.run_type::text rt
       FROM score_snapshots ss
       LEFT JOIN score_runs r ON r.id = ss.run_id
      WHERE ss.stock_id = ANY($1::text[])
      ORDER BY ss.symbol, ss.created_at DESC`,
    stockIds,
  );
  console.log(`\n  ScoreSnapshots for those stocks (newest first per symbol):`);
  let lastSym = "";
  for (const s of snaps) {
    if (s.symbol !== lastSym) { console.log(`   · ${s.symbol}`); lastSym = s.symbol; }
    console.log(
      `       ${new Date(s.created_at).toISOString()}  composite=${String(s.comp).padStart(8)} ${String(s.label_band).padEnd(8)}` +
        ` asOf=${s.aod} v${s.version}  run=${String(s.rt ?? "?")}/${String(s.trig ?? "?")}  id=${String(s.id).slice(0, 8)}…`,
    );
  }
} else {
  console.log(`  ⚠️  no rows in \`holdings\` for these users — their book may be broker-side only`);
  console.log(`      (broker_holdings). The PHS reads the UNION; see listUnifiedPositions.`);
}

rule("4 · INPUT #3 — the weights (marketValue = OUR price × qty).  A PRICE MOVE re-weights the book.");
console.log(`  fingerprintOf() hashes each holding's share of total marketValue, rounded to 1e-6.
  stock_prices is a LIVE, single-row-per-stock table (upserted by the price cron) — so a price
  tick alone re-fingerprints the book and can shift the PHS by a point WITHOUT any rescore.\n`);
if (stockIds.length) {
  const px = await q(
    `SELECT s.symbol, p.price::text price, p.updated_at
       FROM stock_prices p JOIN stocks s ON s.id = p.stock_id
      WHERE p.stock_id = ANY($1::text[]) ORDER BY p.updated_at DESC`,
    stockIds,
  );
  for (const p of px) {
    console.log(`     ${String(p.symbol).padEnd(14)} price=${String(p.price).padStart(10)}  updated ${new Date(p.updated_at).toISOString()}`);
  }
}

rule("5 · INPUT #4/#5/#6 — tierAsOfDate · sectorVersion · CONSTANT_VERSION");
const tiers = await q(`SELECT max(as_of_date)::text mx, count(DISTINCT as_of_date)::int n FROM market_cap_tier_snapshot`);
console.log(`  market_cap_tier_snapshot: newest as_of_date = ${tiers[0].mx}  (${tiers[0].n} distinct as-of dates)`);
console.log(`     ⇒ a tier REBUILD bumps tierAsOfDate ⇒ new fingerprint (even if no score moved).`);
console.log(`  sectorVersion  : hard-coded "nse-sector-v1" (assemble.ts) — cannot drift.`);
console.log(`  CONSTANT_VERSION: "portfolio-spec 1.2" (constants.ts).`);
const cvs = await q(`SELECT constant_version cv, count(*)::int n, min(created_at) mn, max(created_at) mx
                       FROM portfolio_health_snapshot GROUP BY 1 ORDER BY 3`);
console.log(`\n  constant_version across ALL ${cvs.reduce((a, c) => a + c.n, 0)} snapshots in the table:`);
for (const c of cvs) {
  console.log(`     ${String(c.cv).padEnd(20)} ${String(c.n).padStart(4)} rows   ${new Date(c.mn).toISOString()} → ${new Date(c.mx).toISOString()}`);
}
console.log(`     ⇒ IF the version changed between the baseline and now, THAT re-fingerprinted every`);
console.log(`       book by itself — a spec bump, not a data regression.`);

rule("6 · THE JOB / RUN LEDGER around the drift");
const runs = await q(
  `SELECT run_type::text rt, trigger_type::text trig, status::text st, as_of_date::text aod,
          created_at, finished_at
     FROM score_runs ORDER BY created_at DESC LIMIT 12`,
);
console.log(`  score_runs (newest 12):`);
for (const r of runs) {
  console.log(
    `     ${new Date(r.created_at).toISOString()}  ${String(r.rt).padEnd(10)} ${String(r.trig).padEnd(12)} ${String(r.st).padEnd(10)} asOf=${r.aod}`,
  );
}
// NB: `triggeredBy` / `progressNote` carry no @map in schema.prisma — the columns are
// quoted camelCase, not snake_case. (The rest of the model IS snake-cased. Easy trap.)
const jobs = await q(
  `SELECT type, status, "triggeredBy" AS trg, created_at, finished_at, "progressNote" AS note
     FROM background_jobs ORDER BY created_at DESC LIMIT 12`,
);
console.log(`\n  background_jobs (newest 12):`);
for (const j of jobs) {
  console.log(
    `     ${new Date(j.created_at).toISOString()}  ${String(j.type).padEnd(26)} ${String(j.status).padEnd(10)} by=${String(j.trg).padEnd(14)} ${j.note ?? ""}`,
  );
}

rule("7 · THE VERDICT SURFACE — what a PHS CANNOT see (so what is exonerated)");
console.log(`  Grepped, not assumed (src/portfolio/phs/ — all 6 files):
     mf_analytics · mfAnalytics · beta · alpha · tracking_error · investedValue  →  ZERO hits.
  So NO fund-analytics work can reach a PHS:
     Step 17 wrote instruments + instrument_prices (356 bonds)  — not a PHS input.
     Step 18 wrote mf_analytics COLUMNS (Group-3: beta/alpha/TE) — not a PHS input.
     The ETF / REIT / G-Sec loads wrote catalogue rows          — not a PHS input.
  A PHS moves ONLY via: holdings · OUR stock price · a ScoreSnapshot · a RedFlag · the tier
  as-of date · the spec constant. THAT is the list to investigate above — and it is complete.`);

await prisma.$disconnect();
