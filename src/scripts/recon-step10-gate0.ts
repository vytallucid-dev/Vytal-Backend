// STEP 10 GATE 0 — READ-ONLY. DB state for Layer C (NAV history).
// npx tsx src/scripts/recon-step10-gate0.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// ── 1. BASELINE — the thing Step 10 must not move ──
hdr("BASELINE (must be byte-identical after Step 10)");
const stocks = await prisma.instrument.count({ where: { assetClass: "stock" } });
const mfs = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
console.log(`  instruments: stock=${stocks}  mutual_fund=${mfs}`);
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp, count(*) AS n
  FROM instruments WHERE asset_class='stock'`);
console.log(`  stock fingerprint: ${fp[0].fp} (n=${fp[0].n})`);
for (const e of [
  { email: "arman.shaikh01082003@gmail.com", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
]) {
  const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
  const p = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u!.id }, orderBy: { createdAt: "desc" },
    select: { phs: true, band: true, fingerprint: true },
  });
  console.log(`  ${p?.fingerprint === e.fp ? "✅" : "❌"} ${e.email.padEnd(34)} phs=${p?.phs} ${p?.band}`);
}

// ── 2. THE JOIN KEY — how many scheme codes must Layer C carry? ──
hdr("SCHEME CODES — the Layer-C keyspace");
const codes = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(DISTINCT amfi_scheme_code) AS codes, count(*) AS isins
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL`);
console.log(`  distinct scheme codes: ${codes[0].codes}   (ISIN rows: ${codes[0].isins})`);
const perCode = await prisma.$queryRawUnsafe<any[]>(`
  SELECT n_isins, count(*) AS n_codes FROM (
    SELECT amfi_scheme_code, count(*) AS n_isins FROM instruments
    WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL GROUP BY 1
  ) t GROUP BY 1 ORDER BY 1`);
console.log(`  ISINs per scheme code: ${perCode.map((r) => `${r.n_isins}→${r.n_codes} codes`).join(", ")}`);
console.log(`  ⇒ a scheme code groups ≤2 ISINs (growth/payout + div-reinvest) — confirms the per-plan key.`);

const active = await prisma.$queryRawUnsafe<any[]>(`
  SELECT is_active, count(DISTINCT amfi_scheme_code) AS codes
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL
  GROUP BY 1 ORDER BY 1`);
for (const a of active) console.log(`  is_active=${a.is_active}: ${a.codes} scheme codes`);

// ── 3. STALENESS DISTRIBUTION — the dormancy-threshold evidence ──
hdr("STALENESS — days since nav_date (per scheme code). The threshold decision.");
const maxNav = await prisma.$queryRawUnsafe<any[]>(`
  SELECT max(nav_date) AS newest FROM instruments WHERE asset_class='mutual_fund'`);
const newest = maxNav[0].newest;
console.log(`  newest NAV in the catalogue: ${newest?.toISOString?.().slice(0, 10) ?? newest}`);
const buckets = await prisma.$queryRawUnsafe<any[]>(`
  WITH s AS (
    SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code,
           (SELECT max(nav_date) FROM instruments WHERE asset_class='mutual_fund') - nav_date AS age
    FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL AND nav_date IS NOT NULL
  )
  SELECT CASE
    WHEN age <= 3   THEN 'a. 0–3 d   (fresh)'
    WHEN age <= 7   THEN 'b. 4–7 d   (weekend/holiday)'
    WHEN age <= 14  THEN 'c. 8–14 d  (transient miss?)'
    WHEN age <= 30  THEN 'd. 15–30 d (lapsing)'
    WHEN age <= 90  THEN 'e. 31–90 d (probably dormant)'
    WHEN age <= 365 THEN 'f. 91–365 d(dormant)'
    ELSE                 'g. >1 yr   (long dead)'
  END AS bucket, count(*) AS codes
  FROM s GROUP BY 1 ORDER BY 1`);
let cum = 0;
const total = buckets.reduce((a, b) => a + Number(b.codes), 0);
for (const b of buckets) {
  cum += Number(b.codes);
  console.log(`  ${String(b.bucket).padEnd(28)} ${String(b.codes).padStart(6)}   cum ${String(cum).padStart(6)} (${((cum / total) * 100).toFixed(1)}%)`);
}
console.log(`  total scheme codes with a NAV date: ${total}`);

// The gap between "fresh" and "clearly dead" — is there a clean valley to cut at?
const fine = await prisma.$queryRawUnsafe<any[]>(`
  WITH s AS (
    SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code,
           (SELECT max(nav_date) FROM instruments WHERE asset_class='mutual_fund') - nav_date AS age
    FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL AND nav_date IS NOT NULL
  )
  SELECT age, count(*) AS codes FROM s WHERE age BETWEEN 0 AND 45 GROUP BY 1 ORDER BY 1`);
console.log(`\n  day-by-day, 0–45 d (looking for the VALLEY to cut at):`);
for (const r of fine) console.log(`    ${String(r.age).padStart(3)} d: ${String(r.codes).padStart(6)} ${"█".repeat(Math.min(60, Math.ceil(Number(r.codes) / 40)))}`);

// ── 4. RECURRING FAULTS — the Step-9 deferred question ──
hdr("RECURRING FAULTS — open AMFI IngestionErrors (the 'Redeemed' family)");
const errs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT guard_type, resolution_path, severity, status, count(*) AS n, max(occurrences) AS max_occ, sum(occurrences) AS tot_occ
  FROM ingestion_errors WHERE source='amfi_navall' GROUP BY 1,2,3,4 ORDER BY n DESC`);
if (!errs.length) console.log(`  (none — has the Step-9 ingest run against this DB?)`);
for (const e of errs) {
  console.log(`  ${e.guard_type}/${e.resolution_path}/${e.severity}/${e.status}: ${e.n} rows, occurrences max=${e.max_occ} total=${e.tot_occ}`);
}
const sample = await prisma.$queryRawUnsafe<any[]>(`
  SELECT target_field, target_entity, observed, occurrences, status
  FROM ingestion_errors WHERE source='amfi_navall' ORDER BY occurrences DESC, id LIMIT 15`);
console.log(`\n  the actual rows:`);
for (const s of sample) {
  console.log(`    [${s.status}] ${String(s.target_field ?? "-").padEnd(11)} ${String(s.target_entity ?? "-").padEnd(14)} observed=${String(s.observed).slice(0, 42).padEnd(44)} occ=${s.occurrences}`);
}
console.log(`\n  ⇒ these RECUR every load (AMFI reships the same junk). Dedup already collapses them to`);
console.log(`    ONE row each with occurrences bumped — so a nightly job does NOT multiply rows.`);
console.log(`    The open question is whether a KNOWN, un-actionable quirk should stay 'open' forever.`);

// ── 5. WHAT'S ALREADY THERE — no NAV-history table yet? ──
hdr("Layer C — does a NAV-history table already exist?");
const tabs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name LIKE '%nav%' OR table_name LIKE '%scheme%') ORDER BY 1`);
console.log(tabs.length ? tabs.map((t) => `  ${t.table_name}`).join("\n") : `  none — Layer C is greenfield ✅`);

await prisma.$disconnect();
