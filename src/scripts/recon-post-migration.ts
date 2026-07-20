// Post-migration byte-identical check: the 'zerodha' backfill is a LABEL. If a fingerprint
// moved, something reads broker that must not.  npx tsx src/scripts/recon-post-migration.ts
import { prisma } from "../db/prisma.js";

const EXPECTED = [
  { email: "arman.shaikh01082003@gmail.com", phs: 66, band: "Steady", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b" },
  { email: "amankamaljain@gmail.com", phs: 51, band: "Mixed", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846" },
];

let fail = 0;
const ok = (c: boolean, msg: string) => { console.log(`  ${c ? "✅" : "❌"} ${msg}`); if (!c) fail++; };

console.log("═══ broker column: NOT NULL + backfilled ═══");
const col = await prisma.$queryRawUnsafe<any[]>(`
  SELECT is_nullable FROM information_schema.columns
  WHERE table_name='portfolio_accounts' AND column_name='broker'`);
ok(col[0].is_nullable === "NO", `portfolio_accounts.broker is_nullable = ${col[0].is_nullable} (want NO)`);

const enums = await prisma.$queryRawUnsafe<any[]>(`
  SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
  WHERE t.typname='BrokerId' ORDER BY e.enumsortorder`);
const labels = enums.map((e) => e.enumlabel);
ok(labels.length === 17, `BrokerId has ${labels.length} members (want 17): ${labels.join(", ")}`);
ok(!labels.includes("other"), `no 'other' member (ruling 2: catalog is comprehensive)`);

const accts = await prisma.portfolioAccount.findMany({ select: { name: true, broker: true, state: true, user: { select: { email: true } } } });
console.log("\n═══ every account now carries a broker ═══");
for (const a of accts) console.log(`  ${a.user.email.padEnd(34)} ${a.name.padEnd(14)} broker=${a.broker} state=${a.state}`);
ok(accts.every((a) => a.broker !== null), `all ${accts.length} accounts have a non-null broker`);

console.log("\n═══ BYTE-IDENTICAL: holdings + PHS must not have moved ═══");
for (const exp of EXPECTED) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: exp.email }, select: { id: true } });
  const phs = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u.id }, orderBy: { createdAt: "desc" },
    select: { phs: true, band: true, fingerprint: true },
  });
  const h = await prisma.holding.findMany({
    where: { userId: u.id }, orderBy: { instrumentId: "asc" },
    select: { quantity: true, avgCost: true, investedValue: true, realizedPnl: true, instrument: { select: { symbol: true } } },
  });
  console.log(`\n  ${exp.email}`);
  console.log(`    ${h.map((x) => `${x.instrument.symbol}:${x.quantity}@${x.avgCost}/r${x.realizedPnl}`).join("  ")}`);
  ok(phs?.phs === exp.phs, `PHS = ${phs?.phs} (want ${exp.phs})`);
  ok(phs?.band === exp.band, `band = ${phs?.band} (want ${exp.band})`);
  ok(phs?.fingerprint === exp.fp, `fingerprint = ${phs?.fingerprint?.slice(0, 16)}… (want ${exp.fp.slice(0, 16)}…)`);
}

console.log(fail === 0 ? "\n✅ MIGRATION IS A LABEL — nothing rescored." : `\n❌ ${fail} FAILURE(S)`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
