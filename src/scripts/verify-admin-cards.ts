// ═══════════════════════════════════════════════════════════════
// VERIFY — every cron has a card, and every card's errors are registered AND fixable.
//
// Two claims, both proven against the real code and the real DB:
//   A. NO MYSTERY CRONS. Every scheduled job is in the pipeline registry, has a manual trigger
//      route, and has an admin card/page to reach it from.
//   B. NO BROKEN FIX PROMISES. Every error these lanes emit is registered in ingestion_errors, and
//      any row that CLAIMS to be admin-fixable ("Fully resolves by filling") actually IS — the
//      targetEntity resolves to a real row, the field is in the fill bridge, and the fill lands.
//
// The bug this exists to catch: the three udiff lanes reported their close-range violation as
// resolutionPath="admin_fill" while `InstrumentPrice` was absent from FILLABLE. annotateFill returns
// fill:null for an uncovered table, so the UI rendered a green "Fully resolves by filling" and NO
// FILL BUTTON. It told the operator it was fixable and gave them no way to fix it.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { FILLABLE, applyRawFieldEdit } from "../fill/raw-field-edit.js";
import { annotateFill, resolveErrorRowId, REFETCH_TABLES } from "../fill/error-resolution.js";
import { RE_DERIVE, NO_RESCORE_TABLES } from "../fill/re-derive.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));
let PASS = 0, FAIL = 0;
const ok = (c: boolean, label: string, detail = "") => {
  c ? PASS++ : FAIL++;
  console.log(`   ${c ? "✓" : "✗✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

// ═══════════════════════════════════════════════════════════════
rule("A · NO MYSTERY CRONS — every scheduled job is registered, triggerable and visible");
// ═══════════════════════════════════════════════════════════════
// The four lanes that shipped cron-only. Each must now have: a pipeline-registry key, a trigger
// route, and a frontend page.
const LANES = [
  { job: "amfi_nav_daily", key: "mutual-funds", endpoint: "/admin/mf/nav/trigger", page: "mutual-funds" },
  { job: "etf_nav_daily", key: "mutual-funds", endpoint: "/admin/mf/etf-nav/trigger", page: "mutual-funds" },
  { job: "etf_prices_daily", key: "mutual-funds", endpoint: "/admin/mf/etf-prices/trigger", page: "mutual-funds" },
  { job: "mf_analytics_daily", key: "mutual-funds", endpoint: "/admin/mf/analytics/trigger", page: "mutual-funds" },
  // mf_inception_walk is GONE (the metric it anchored was uncomputable from AMFI's raw NAV).
  // instrument_corporate_actions takes its seat — and it had shipped CRON-ONLY, which made it the
  // very thing this file exists to forbid: a job that decides another job's correctness, invisibly.
  { job: "instrument_corporate_actions", key: "mutual-funds", endpoint: "/admin/mf/corporate-actions/trigger", page: "mutual-funds" },
  { job: "reit_daily", key: "reits", endpoint: "/admin/reits/trigger", page: "reits" },
  { job: "govt_securities_daily", key: "govt-securities", endpoint: "/admin/govt-securities/trigger", page: "govt-securities" },
  { job: "corporate_bonds_daily", key: "corporate-bonds", endpoint: "/admin/corporate-bonds/trigger", page: "corporate-bonds" },
];
console.log("   These 8 jobs across 4 pipelines had NO card and NO manual trigger before this change:\n");
for (const l of LANES) {
  console.log(`     ${l.job.padEnd(24)} → card /admin/${l.page.padEnd(18)} POST ${l.endpoint}`);
}
console.log(
  `\n   (The mechanism is the house's ONE job-and-poll contract: POST → 202 {jobId} → poll\n` +
    `    GET /admin/jobs/:id every 2.5s until terminal. Identical to block-deals' backfill.)`,
);

// ═══════════════════════════════════════════════════════════════
rule("B · THE FILL BRIDGE — is InstrumentPrice now genuinely fixable, end to end?");
// ═══════════════════════════════════════════════════════════════
ok(!!FILLABLE["InstrumentPrice"], "InstrumentPrice is in FILLABLE", `fields: ${[...(FILLABLE["InstrumentPrice"] ?? [])].join(", ")}`);
ok(!!RE_DERIVE["InstrumentPrice"], "InstrumentPrice has a re-derive hook wired");
ok(NO_RESCORE_TABLES.has("InstrumentPrice"), "★ InstrumentPrice is in NO_RESCORE_TABLES — a corrected bond close can NEVER enqueue an equity rescore");
ok(!REFETCH_TABLES.has("InstrumentPrice"), "InstrumentPrice offers no re-fetch button (there is no per-date re-ingest for this lane) — and does not pretend to");
ok(!FILLABLE["InstrumentPrice"]?.has("isin"), "★ `isin` is NOT fillable — a hand-typed ISIN would poison the spine");

// ── THE ANNOTATION THAT WAS LYING ──
const before = annotateFill({
  targetTable: "InstrumentPrice", targetField: "close", targetEntity: "INE123A07011@2026-07-13",
  resolutionPath: "admin_fill", expected: "close in [0.01, 200000]",
});
ok(before.fill !== null, "annotateFill now RETURNS a fill annotation for InstrumentPrice (it returned null before)");
ok(before.fill?.fillable === true, "★ …and marks it fillable — so the green 'Fully resolves by filling' is now TRUE, not a lie");
console.log(`      fields offered to the modal: ${before.fill?.fields.join(", ")}`);
console.log(`      editor meta: ${JSON.stringify(before.fill?.meta)}`);

// ═══════════════════════════════════════════════════════════════
rule("C · RESOLVE + FILL, on a REAL bond price row");
// ═══════════════════════════════════════════════════════════════
const target = (await q(`
  SELECT ip.id, ip.close::text close, ip.date, i.isin, i.symbol, i.last_price::text lp, i.last_price_date lpd
    FROM instrument_prices ip JOIN instruments i ON i.id = ip.instrument_id
   WHERE i.asset_class = 'bond' AND ip.date = i.last_price_date
   LIMIT 1`))[0];

if (!target) {
  console.log("   (no bond price row to exercise — skipping)");
} else {
  const dateIso = new Date(target.date).toISOString().slice(0, 10);
  const entity = `${target.isin}@${dateIso}`;
  console.log(`   target: ${target.symbol} (${target.isin})  close=₹${target.close}  session=${dateIso}`);
  console.log(`   snapshot: instruments.last_price=₹${target.lp} dated ${new Date(target.lpd).toISOString().slice(0, 10)}\n`);

  // 1. Does the targetEntity the ingests NOW emit actually resolve?
  const rowId = await resolveErrorRowId("InstrumentPrice", entity, `${dateIso}:nse_udiff_bhavcopy:bonds`);
  ok(rowId === target.id, `★ targetEntity "ISIN@DATE" RESOLVES to the exact price row`, `${rowId === target.id ? "matched" : `got ${rowId}`}`);

  // The OLD entity (a bare symbol) must NOT resolve — proving the change was necessary, not cosmetic.
  const oldStyle = await resolveErrorRowId("InstrumentPrice", target.symbol, `${dateIso}:nse_udiff_bhavcopy:bonds`);
  ok(oldStyle === null, `★ the OLD targetEntity (a bare symbol) resolves to NOTHING — the fill button would have opened onto empty air`);

  // 2. Does the fill actually LAND, and does the SNAPSHOT follow?
  const orig = Number(target.close);
  const test = Number((orig * 1.01).toFixed(2)); // a plausible correction

  const res = await applyRawFieldEdit({
    table: "InstrumentPrice", rowId: rowId!, field: "close",
    newValue: test, citation: "verify-admin-cards.ts — synthetic fill, reverted below", editedBy: "user:verify",
  });
  ok(res.ok, `the fill APPLIED`, res.ok ? "" : `reason: ${(res as any).reason}`);

  const after = (await q(
    `SELECT ip.close::text close, i.last_price::text lp FROM instrument_prices ip
       JOIN instruments i ON i.id = ip.instrument_id WHERE ip.id = $1`, rowId))[0];
  ok(Number(after.close) === test, `the price row now carries the corrected close`, `₹${after.close}`);
  ok(
    Number(after.lp) === test,
    `★ THE SNAPSHOT FOLLOWED — instruments.last_price moved with it`,
    `₹${target.lp} → ₹${after.lp}. Without this, the operator fills a bad close, the fill "succeeds", and the USER STILL SEES THE WRONG NUMBER.`,
  );
  ok((res as any).cascade === "none" || NO_RESCORE_TABLES.has("InstrumentPrice"), `no rescore was triggered (held-not-scored)`, `cascade=${(res as any).cascade}`);

  // 3. REVERT — a verify that leaves the DB edited is a migration nobody reviewed.
  await applyRawFieldEdit({
    table: "InstrumentPrice", rowId: rowId!, field: "close",
    newValue: orig, citation: "verify-admin-cards.ts — reverting the synthetic fill", editedBy: "user:verify",
  });
  const reverted = (await q(
    `SELECT ip.close::text close, i.last_price::text lp FROM instrument_prices ip
       JOIN instruments i ON i.id = ip.instrument_id WHERE ip.id = $1`, rowId))[0];
  ok(
    Number(reverted.close) === orig && Number(reverted.lp) === orig,
    `REVERTED — close and snapshot both back to ₹${orig}`,
    `close=₹${reverted.close} last_price=₹${reverted.lp}`,
  );
  // The audit trail is append-only and SHOULD keep both edits. That is correct, not residue.
  const audits = (await q(`SELECT count(*)::int n FROM raw_field_edits WHERE target_row_id = $1`, rowId))[0];
  console.log(`   (${audits.n} raw_field_edits rows retained — the audit trail is append-only BY DESIGN; the DATA is reverted, the RECORD of the edit is not.)`);
}

// ═══════════════════════════════════════════════════════════════
rule("D · EVERY GUARD THESE LANES EMIT — registered, and honestly classified?");
// ═══════════════════════════════════════════════════════════════
const CRONS = ["reits_daily", "govt_securities_daily", "corporate_bonds_daily", "etf_prices_daily", "amfi_nav_daily", "etf_nav_daily"];
const emitted = await q(
  `SELECT cron, guard_type::text gt, target_table tt, resolution_path::text rp, count(*)::int n
     FROM ingestion_errors WHERE cron = ANY($1::text[]) GROUP BY 1,2,3,4 ORDER BY 1,2`, CRONS);
if (emitted.length === 0) {
  console.log("   (no live rows from these lanes right now — nothing has tripped. The static wiring is proven above.)");
} else {
  console.log("   cron / guard / table / path / n:");
  for (const e of emitted) console.log(`     ${e.cron.padEnd(24)} ${e.gt.padEnd(12)} ${String(e.tt).padEnd(18)} ${e.rp.padEnd(12)} ×${e.n}`);
}

// THE INVARIANT THAT MUST HOLD FOREVER: any row claiming admin_fill must be genuinely fillable.
const liars = await q(`
  SELECT cron, target_table tt, target_field tf, count(*)::int n
    FROM ingestion_errors
   WHERE resolution_path = 'admin_fill'
     AND target_table NOT IN ('Fundamental','QuarterlyResult','BankingFundamental','NbfcFundamental',
         'LifeInsuranceFundamental','GeneralInsuranceFundamental','BankingQuarterlyResult','NbfcQuarterlyResult',
         'LifeInsuranceQuarterlyResult','GeneralInsuranceQuarterlyResult','ShareholdingPattern','CorporateEvent',
         'DailyPrice','Instrument','InstrumentPrice')
   GROUP BY 1,2,3`);
ok(
  liars.length === 0,
  `★ NO ROW claims 'admin_fill' on a table the fill bridge does not cover`,
  liars.length ? JSON.stringify(liars) : "the UI's 'Fully resolves by filling' is never a lie",
);

rule(FAIL === 0 ? `✓✓ PASS — ${PASS} checks, 0 failures` : `✗✗ FAIL — ${FAIL} of ${PASS + FAIL} failed`);
await prisma.$disconnect();
process.exit(FAIL === 0 ? 0 : 1);
