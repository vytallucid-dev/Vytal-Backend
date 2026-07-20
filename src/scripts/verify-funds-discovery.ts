// ═══════════════════════════════════════════════════════════════
// FUND DISCOVERY — PAGING + REPRESENTATIVE-AGREEMENT VERIFY.
//
// Two claims this build hangs on, both PROVEN here rather than asserted in a comment:
//
//   1. Paging GET /api/v1/funds to the end, for every sort order, surfaces every family
//      EXACTLY ONCE — no duplicates, no omissions — verified by walking the real cursor to
//      exhaustion and diffing the collected set against a direct COUNT(*) on mf_families.
//
//   2. `representativeSchemeCode` on a /funds row and GET /mf/:schemeCode/family's own
//      `representativeSchemeCode` NEVER disagree — checked by hitting the REAL family endpoint
//      (over HTTP, the same call the frontend makes) keyed on a DIFFERENT member of the family
//      than the one /funds names, for one example of every representative plan/option combo the
//      live catalogue actually contains. This is the exact contradiction ("+18.4% in the list,
//      +17.1% when opened") the whole build exists to prevent.
//
// Requires the API server running on API_BASE (default http://localhost:4000) for check 2.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { browseFunds, _forceRebuildForVerification, FUNDS_MAX_LIMIT, type FamilyRow, type SortKey } from "../discovery/fund-discovery.js";

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

let PASS = 0;
let FAIL = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  cond ? PASS++ : FAIL++;
  console.log(`   ${cond ? "✓" : "✗✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

async function pageToExhaustion(sort: SortKey): Promise<FamilyRow[]> {
  const rows: FamilyRow[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const res = await browseFunds({ includeDormant: true, sort, cursor, limit: FUNDS_MAX_LIMIT });
    rows.push(...res.results);
    pages++;
    if (!res.hasMore) {
      ok(rows.length === res.total, `sort=${sort}: page count matches reported total`, `${rows.length} rows over ${pages} pages, total=${res.total}`);
      break;
    }
    cursor = res.cursor!;
    if (pages > 500) throw new Error(`sort=${sort}: runaway paging — cursor never terminated`);
  }
  return rows;
}

async function main() {
  rule("FUND DISCOVERY — building a fresh cache snapshot for this run");
  await _forceRebuildForVerification();

  rule("1. PAGING: no duplicates, no omissions, every sort order");
  const [{ count: dbCount }] = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM mf_families WHERE ungrouped_reason IS NULL`,
  );
  console.log(`   direct DB count of real (non-refused) families: ${dbCount}`);

  let full: FamilyRow[] = [];
  for (const sort of ["name", "ret1y", "ret3y", "ret5y"] as const) {
    const rows = await pageToExhaustion(sort);
    const uniqueIds = new Set(rows.map((r) => r.familyId));
    ok(uniqueIds.size === rows.length, `sort=${sort}: no duplicate families across pages`, `${rows.length - uniqueIds.size} dupes`);
    ok(rows.length === dbCount, `sort=${sort}: no omissions vs direct DB count`, `${rows.length} vs ${dbCount}`);
    if (sort === "name") full = rows;
  }

  const declinedRow = full.find((r) => r.declined);
  ok(!!declinedRow, "a declined family's row still appears in the list", declinedRow ? `"${declinedRow.canonicalName}" (${declinedRow.declinedReason})` : "NONE FOUND");

  rule("2. REPRESENTATIVE AGREEMENT: /funds vs GET /mf/:schemeCode/family (real HTTP, cross-member)");
  const combosWanted: { tier: string; optionLabel: string }[] = [
    { tier: "direct", optionLabel: "growth" },
    { tier: "regular", optionLabel: "growth" },
    { tier: "direct", optionLabel: "idcw" },
    { tier: "regular", optionLabel: "idcw" },
  ];
  for (const want of combosWanted) {
    const row = full.find(
      (r) => r.representativePlan.tier === want.tier && r.representativePlan.optionLabel === want.optionLabel,
    );
    if (!row) {
      ok(false, `[${want.tier}|${want.optionLabel}] no family in the live catalogue has this representative combo`);
      continue;
    }
    const members = await prisma.mfFamilyMember.findMany({ where: { familyId: row.familyId } });
    const other = members.find((m) => m.schemeCode !== row.representativeSchemeCode) ?? members[0]!;
    let familyResp: { data?: { representativeSchemeCode?: string } };
    try {
      const res = await fetch(`${API_BASE}/api/v1/mf/${other.schemeCode}/family`);
      familyResp = await res.json();
    } catch (err) {
      ok(false, `[${want.tier}|${want.optionLabel}] could not reach ${API_BASE} — is the server running?`, String(err));
      continue;
    }
    ok(
      familyResp.data?.representativeSchemeCode === row.representativeSchemeCode,
      `[${want.tier}|${want.optionLabel}] "${row.canonicalName}" — /funds and /family agree`,
      `queried by member ${other.schemeCode} (not the representative itself): ` +
        `/funds=${row.representativeSchemeCode} /family=${familyResp.data?.representativeSchemeCode}`,
    );
  }

  rule(FAIL === 0 ? `✓✓ FUND DISCOVERY VERIFY PASS — ${PASS} checks, 0 failures` : `✗✗ FUND DISCOVERY VERIFY FAIL — ${FAIL} of ${PASS + FAIL} checks failed`);
  await prisma.$disconnect();
  process.exit(FAIL === 0 ? 0 : 1);
}
main();
