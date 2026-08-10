// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ALERT VOCABULARY COMPLETENESS (read-only). The gate finding-catalog.ts's header names.
//
// A finding key missing from `loadFindingKeys()` cannot have an alert written against it: the chat
// tool refuses it as unknown and the UI never offers it. That failure is SILENT and permanent, and it
// is exactly what step 4 could have caused — the 22 filing rules stopped writing to score_patterns /
// score_red_flags, which were the only two tables the LIVE half of the vocabulary scanned.
//
//   §1  every one of the 22 FILING keys is in the vocabulary
//   §2  every one of them is in the STATIC half too (so it is alertable before it ever fires anywhere)
//   §3  the LIVE half sees stock_findings — proven by the live table, not by reading the code
//   §4  retired keys are still excluded, and still RECOGNISED as retired rather than unknown
//
//   npx tsx src/scripts/verify-alert-vocabulary.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { loadFindingKeys, STATIC_FINDING_KEYS, RETIRED_FINDING_KEYS } from "../alerts/finding-catalog.js";
import { FILING_REGISTRY } from "../filing/registry.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };

async function main() {
  console.log("════ ALERT VOCABULARY ════\n");
  const vocab = await loadFindingKeys();
  const staticSet = new Set<string>(STATIC_FINDING_KEYS);
  const filingKeys = FILING_REGISTRY.map((e) => e.ruleKey);

  console.log(`── §1 · the 22 filing keys ──`);
  const missing = filingKeys.filter((k) => !vocab.has(k));
  ok(missing.length === 0, `all ${filingKeys.length} filing keys are alertable${missing.length ? ` — MISSING: ${missing.join(", ")}` : ""}`);

  console.log(`\n── §2 · the STATIC half ──`);
  const staticMissing = filingKeys.filter((k) => !staticSet.has(k));
  ok(staticMissing.length === 0,
    `all ${filingKeys.length} carry catalogue copy, so each is alertable BEFORE it has fired anywhere` +
    `${staticMissing.length ? ` — MISSING: ${staticMissing.join(", ")}` : ""}`);

  console.log(`\n── §3 · the LIVE half reaches stock_findings ──`);
  const live = await prisma.stockFinding.findMany({ distinct: ["ruleKey"], select: { ruleKey: true } });
  console.log(`     stock_findings holds ${live.length} distinct rule keys`);
  ok(live.length > 0 && live.every((r) => vocab.has(r.ruleKey)),
    `every distinct key in stock_findings is in the vocabulary`);
  // The load-bearing half: a key present ONLY in stock_findings (never in the two score tables) must
  // still be alertable. R3/R4 fire on nothing scored today, so they are exactly that case.
  const scoreKeys = new Set<string>([
    ...(await prisma.scorePattern.findMany({ distinct: ["patternKey"], select: { patternKey: true } })).map((r) => r.patternKey),
    // score_red_flags dropped 2026-08-11 — its four keys were all catalogued filing rules and are
    // carried by STATIC and by the stock_findings scan, so the vocabulary is unchanged.
  ]);
  const onlyFiling = live.map((r) => r.ruleKey).filter((k) => !scoreKeys.has(k));
  console.log(`     keys present ONLY in stock_findings (invisible to the old two-table scan): ${onlyFiling.length}`);
  onlyFiling.forEach((k) => console.log(`       ${k}`));
  ok(onlyFiling.every((k) => vocab.has(k)), `all ${onlyFiling.length} of them are alertable`);

  console.log(`\n── §4 · retired keys ──`);
  const leaked = RETIRED_FINDING_KEYS.filter((k) => vocab.has(k));
  ok(leaked.length === 0, `no retired key is alertable${leaked.length ? ` — LEAKED: ${leaked.join(", ")}` : ""}`);
  ok(RETIRED_FINDING_KEYS.length > 0, `${RETIRED_FINDING_KEYS.length} retired keys remain RECOGNISED, so a refusal can say "retired" rather than "unknown"`);

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
