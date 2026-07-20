// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE REFRESH'S OWN TEST. Does the refreshed verify-step9 still BITE?
//
// A harness that was "fixed" until it went green is worthless if it now goes green on ANYTHING.
// The refresh re-expressed 6 assertions; the obligation is to prove each re-expression still fails
// on a REAL regression — the thing it was written to catch — and not merely on a legitimate load.
//
// So: MUTATE, observe RED, RESTORE. Every mutation below is rolled back in a `finally`, and the
// MF identity hash is re-checked at the end to prove the restore was complete.
//
//   npx tsx src/scripts/verify-step9-mutation-test.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { checkPhsStructural, PHS_TEST_USERS } from "./phs-structural.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const SPINE = `
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(amfi_scheme_code,'~') || '|' || coalesce(scheme_name,'~') || '|' ||
    coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' || coalesce(plan_type,'~') || '|' ||
    name || '|' || coalesce(symbol,'~') || '|' || coalesce(stock_id,'~'),
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`;
const WANT = "9ac2bbdf4761f99406fe8622bfec5f25";
const SUBSET = `SELECT count(*)::int n FROM instruments WHERE asset_class IN ('stock','mutual_fund')`;
const TRESPASS = `SELECT count(*)::int n FROM instruments
  WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`;

let pass = 0, miss = 0;
const bites = (name: string, red: boolean, detail: string) => {
  console.log(`  ${red ? "✅ BITES" : "❌ DID NOT BITE"}  ${name}\n       ${detail}`);
  red ? pass++ : miss++;
};

const clean = (await q(SPINE))[0];
console.log(`baseline MF identity spine: ${clean.n} rows  ${clean.fp}  (=== 9ac2bbdf…: ${clean.fp === WANT})\n`);
if (clean.fp !== WANT) { console.log("REFUSING TO MUTATE — the spine is already off-baseline."); process.exit(1); }

// A victim MF row, and a victim non-fund row, captured for exact restore.
const victim = (await q(`SELECT id, isin, scheme_name, amfi_scheme_code, symbol FROM instruments
  WHERE asset_class='mutual_fund' ORDER BY isin LIMIT 1`))[0];
const bond = (await q(`SELECT id, isin FROM instruments WHERE asset_class='bond' ORDER BY isin LIMIT 1`))[0];

try {
  // ── M1. A REWRITTEN SCHEME CODE — the Layer-C join key silently changed. ─────────────────────
  //    THE OLD HARNESS WOULD NOT HAVE CAUGHT THIS AT ALL: it only asserted the code was NON-NULL.
  await prisma.$executeRawUnsafe(`UPDATE instruments SET amfi_scheme_code='999999' WHERE id=$1`, victim.id);
  const m1 = (await q(SPINE))[0];
  bites("§1 MF IDENTITY SPINE — a rewritten amfi_scheme_code",
    m1.fp !== WANT, `spine md5 → ${m1.fp} ≠ 9ac2bbdf… (old harness: only checked NOT NULL — would have stayed GREEN)`);
  await prisma.$executeRawUnsafe(`UPDATE instruments SET amfi_scheme_code=$2 WHERE id=$1`, victim.id, victim.amfi_scheme_code);

  // ── M2. A FABRICATED TICKER on a fund — the exact contamination §2's FENCE guards. ───────────
  await prisma.$executeRawUnsafe(`UPDATE instruments SET symbol='FAKEMF' WHERE id=$1`, victim.id);
  const fence = (await q(`SELECT count(*)::int n FROM instruments
    WHERE asset_class='mutual_fund' AND (symbol IS NOT NULL OR stock_id IS NOT NULL)`))[0];
  const m2 = (await q(SPINE))[0];
  bites("§2 THE FENCE + §1 spine — a fabricated ticker on an MF",
    fence.n > 0 && m2.fp !== WANT, `fence caught ${fence.n} contaminated MF row(s); spine md5 also moved → ${m2.fp}`);
  await prisma.$executeRawUnsafe(`UPDATE instruments SET symbol=$2 WHERE id=$1`, victim.id, victim.symbol);

  // ── M3. A LOST MF ROW — the count refresh must still notice a DELETION, not just a load. ─────
  //    This is the one that matters most: §9 was re-scoped from "catalogue total" to "the Step-9
  //    subset". If that re-scoping had been sloppy, a DELETED fund would now slip through.
  await prisma.$executeRawUnsafe(`UPDATE instruments SET asset_class='etf' WHERE id=$1`, victim.id);
  const m3sub = (await q(SUBSET))[0];
  const m3fp = (await q(SPINE))[0];
  bites("§9 STEP-9 SUBSET + §1 spine — an MF row vanishing out of the class",
    m3sub.n !== 18071 && m3fp.fp !== WANT,
    `subset → ${m3sub.n} ≠ 18,071 AND spine md5 → ${m3fp.fp}. The re-scope did NOT blind it to a loss.`);
  await prisma.$executeRawUnsafe(`UPDATE instruments SET asset_class='mutual_fund' WHERE id=$1`, victim.id);

  // ── M4. A FUND ISIN TRESPASSING under a non-fund class — the WIDENED production guard. ───────
  const realIsin = bond.isin;
  await prisma.$executeRawUnsafe(`UPDATE instruments SET isin='INF999Z01ZZ9' WHERE id=$1`, bond.id);
  const m4 = (await q(TRESPASS))[0];
  bites("§9 WIDENED TRESPASS GUARD — an INF (fund) ISIN wearing asset_class='bond'",
    m4.n > 0, `widened predicate caught ${m4.n} trespasser — the ETFs it used to false-flag are correctly ignored`);
  await prisma.$executeRawUnsafe(`UPDATE instruments SET isin=$2 WHERE id=$1`, bond.id, realIsin);

  // ── M5. A DELETED FAULT — §6's census must notice the audit trail being destroyed. ───────────
  //    (The old harness asserted OPEN faults, so an admin resolving them emptied it out and three
  //    assertions passed VACUOUSLY. The census is status-agnostic precisely so it cannot be emptied.)
  const one = (await q(`SELECT id, guard_type::text gt FROM ingestion_errors
    WHERE cron='daily_amfi_nav' AND guard_type='validity' LIMIT 1`))[0];
  await prisma.$executeRawUnsafe(`UPDATE ingestion_errors SET guard_type='shape' WHERE id=$1`, one.id);
  const m5 = (await q(`SELECT count(*)::int n FROM ingestion_errors
    WHERE cron='daily_amfi_nav' AND guard_type='validity'`))[0];
  bites("§6 FAULT CENSUS — a recorded validity fault losing its guard type",
    m5.n !== 10, `validity census → ${m5.n} ≠ 10. A resolved-away or rewritten fault still goes RED.`);
  await prisma.$executeRawUnsafe(`UPDATE ingestion_errors SET guard_type=$2::"GuardType" WHERE id=$1`, one.id, one.gt);

  // ── M6. A BROKEN PHS COMPUTATION — the structural check must still bite. ─────────────────────
  //    The PHS value pins were REMOVED (they pinned a live market-driven number and were red on
  //    every price tick). The obligation that comes with removing them: prove the replacement is
  //    not toothless. A moved VALUE must NOT go red — that was the whole point — but a BROKEN
  //    PIPELINE still must.
  //
  //    So break it for real, at the input: zero the prices of every stock the fixture users hold.
  //    assemblePortfolio() then values the whole book at 0 → totalValue 0 → sumWScored 0 →
  //    evaluable=false → health NULL. A null score with no band is a broken pipeline, and the
  //    structural check must say so.
  const heldIds = (await q(
    `SELECT DISTINCT h.stock_id FROM holdings h JOIN users u ON u.id = h.user_id
      WHERE u.email = ANY($1::text[])`,
    PHS_TEST_USERS,
  )).map((r) => r.stock_id);
  const priceBefore = await q(
    `SELECT stock_id, price::text price FROM stock_prices WHERE stock_id = ANY($1::text[])`,
    heldIds,
  );
  // Sanity: the check must be GREEN before we break it, or the mutation proves nothing.
  const healthy = await Promise.all(PHS_TEST_USERS.map((e) => checkPhsStructural(e)));
  console.log(`  (pre-mutation: structural check is ${healthy.every((h) => h.ok) ? "GREEN" : "ALREADY RED — mutation would prove nothing"})`);

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE stock_prices SET price = 0 WHERE stock_id = ANY($1::text[])`, heldIds,
    );
    const broken = await Promise.all(PHS_TEST_USERS.map((e) => checkPhsStructural(e)));
    bites("§0 PHS STRUCTURAL CHECK — the price feed collapses, so the PHS cannot compute",
      healthy.every((h) => h.ok) && broken.every((b) => !b.ok),
      `${broken.map((b) => `${b.email.split("@")[0]}: health=${b.health} band=${b.band}`).join(" · ")} ` +
      `⇒ RED. A moved value would NOT trip this (by design); a BROKEN pipeline does.`);
  } finally {
    for (const p of priceBefore) {
      await prisma.$executeRawUnsafe(`UPDATE stock_prices SET price=$2::numeric WHERE stock_id=$1`, p.stock_id, p.price);
    }
  }

  // And the counterpart claim, asserted rather than assumed: a MOVED VALUE must stay GREEN.
  // (This is what the old pinned assertion got wrong, so it is worth proving explicitly.)
  const recovered = await Promise.all(PHS_TEST_USERS.map((e) => checkPhsStructural(e)));
  bites("…and the check is GREEN again once prices are restored (it tracks the PIPELINE, not the value)",
    recovered.every((r) => r.ok),
    recovered.map((r) => `${r.email.split("@")[0]}: health=${r.health} ${r.band}`).join(" · "));
} finally {
  // Belt and braces: restore everything unconditionally, then PROVE the restore.
  await prisma.$executeRawUnsafe(
    `UPDATE instruments SET asset_class='mutual_fund', amfi_scheme_code=$2, symbol=$3 WHERE id=$1`,
    victim.id, victim.amfi_scheme_code, victim.symbol,
  );
  await prisma.$executeRawUnsafe(`UPDATE instruments SET isin=$2 WHERE id=$1`, bond.id, bond.isin);
}

const restored = (await q(SPINE))[0];
const faults = (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE cron='daily_amfi_nav' AND guard_type='validity'`))[0];
const subset = (await q(SUBSET))[0];
// M6 touched stock_prices — a LIVE table. Prove every price is back, and that no price is 0.
const zeroPrices = (await q(`SELECT count(*)::int n FROM stock_prices WHERE price = 0`))[0];
const phsBack = await Promise.all(PHS_TEST_USERS.map((e) => checkPhsStructural(e)));
console.log(`\nRESTORE PROOF — the mutation test must leave ZERO trace:`);
console.log(`  MF identity spine : ${restored.n} rows  ${restored.fp}  ${restored.fp === WANT ? "✅ back to 9ac2bbdf…" : "❌ NOT RESTORED"}`);
console.log(`  Step-9 subset     : ${subset.n} ${subset.n === 18071 ? "✅" : "❌"}`);
console.log(`  validity faults   : ${faults.n} ${faults.n === 10 ? "✅" : "❌"}`);
console.log(`  stock_prices @ 0  : ${zeroPrices.n} ${zeroPrices.n === 0 ? "✅ every price restored" : "❌ A ZEROED PRICE SURVIVED — INVESTIGATE"}`);
console.log(`  PHS recomputes    : ${phsBack.map((p) => `${p.email.split("@")[0]}=${p.health} ${p.band}`).join(" · ")} ${phsBack.every((p) => p.ok) ? "✅" : "❌"}`);

const restoredOk = restored.fp === WANT && subset.n === 18071 && faults.n === 10
  && zeroPrices.n === 0 && phsBack.every((p) => p.ok);
console.log(
  `\n${miss === 0 ? `✅ ALL ${pass} MUTATIONS BIT` : `❌ ${miss} MUTATION(S) SLIPPED THROUGH — the refresh blinded the harness`}` +
    `  ·  ${restoredOk ? "✅ fully restored" : "❌ RESTORE FAILED — INVESTIGATE"}`,
);
await prisma.$disconnect();
process.exit(miss === 0 && restoredOk ? 0 : 1);
