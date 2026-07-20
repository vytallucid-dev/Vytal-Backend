// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 TRIPWIRE (throwaway) — the gate that cannot be waved through.
//
// Step 4 changes what the UNION reads (frozen holdings are no longer filtered out). The two
// REAL users are manual-only and there are zero broker connections in the DB, so their PHS
// inputs MUST be untouched. If a fingerprint moves by one hex digit, the union change leaked
// into a book it had no business touching — stop and find out why before calling anything green.
//
// The recompute is fingerprint-gated, so `skipped: true` is itself the proof: it means the
// assembled INPUTS were identical, not merely that the output score happened to land the same.
//
// Compare NUMERICALLY, never as strings: the baseline comes from raw SQL (`::text` → "55.0000")
// while Prisma's Decimal stringifies as "55". Same number, different spelling — a string compare
// here reports a false FAIL (it did, in Step 3).
//
//   npx tsx src/scripts/s4-tripwire.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";

// Captured at GATE 0, BEFORE any Step-4 code existed.
const BASELINE = [
  { userId: "108fd2a6-ff59-4024-ada1-c6ea7792ada4", fp: "424d5af22e0ea3d5", phs: 51, band: "Mixed", quality: 59.9317, structure: 55.0, signals: 53.4186 },
  { userId: "7985d813-e3fa-4f6f-b23d-715a9a36ee01", fp: "056bc16b8552a88e", phs: 66, band: "Steady", quality: 66.2522, structure: 91.8007, signals: 100.0 },
];

let failures = 0;
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.0001;

const rowsBefore = await prisma.portfolioHealthSnapshot.count();

for (const b of BASELINE) {
  const out = await computeAndPersistPhs(b.userId);
  const snap = await prisma.portfolioHealthSnapshot.findFirstOrThrow({
    where: { userId: b.userId },
    orderBy: { createdAt: "desc" },
    select: { fingerprint: true, phs: true, band: true, quality: true, structure: true, signals: true },
  });

  const fpOk = out.fingerprint.startsWith(b.fp);
  const ok =
    fpOk &&
    out.skipped === true && // ⇐ the fingerprint gate held: the INPUTS were identical
    snap.phs === b.phs &&
    snap.band === b.band &&
    near(snap.quality == null ? null : Number(snap.quality), b.quality) &&
    near(Number(snap.structure), b.structure) &&
    near(Number(snap.signals), b.signals);

  if (!ok) failures++;
  console.log(
    `  ${ok ? "✅ PASS" : "❌ FAIL"}  ${b.userId.slice(0, 8)}…  ` +
      `fp ${fpOk ? "IDENTICAL" : `MOVED → ${out.fingerprint.slice(0, 16)} (was ${b.fp})`}  ` +
      `phs ${b.phs}→${snap.phs}  ${b.band}→${snap.band}  ` +
      `Q${Number(snap.quality)} S${Number(snap.structure)} Sig${Number(snap.signals)}  skipped=${out.skipped}`,
  );
}

const rowsAfter = await prisma.portfolioHealthSnapshot.count();
const noWrite = rowsAfter === rowsBefore;
if (!noWrite) failures++;
console.log(`  ${noWrite ? "✅" : "❌"} no new snapshot rows written — ${rowsBefore} → ${rowsAfter}`);

console.log(failures === 0 ? "\n✅ TRIPWIRE HELD" : `\n❌ TRIPWIRE BROKEN (${failures})`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
