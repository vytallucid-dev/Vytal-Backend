// ═══════════════════════════════════════════════════════════════
// FAMILY DERIVATION (Step 16) — read the catalogue, write the grouping. NOTHING ELSE.
//
// THE ONE THING TO KNOW ABOUT THIS JOB: it does not write to `instruments`. Not one column, not
// one row. It reads scheme_code / scheme_name / fund_house / asset_class, and it writes exactly
// two tables — `mf_families` and `mf_family_members`. A family is a LABEL OVER ROWS, not a rewrite
// of them, so a bug in a heuristic that parses 13,704 hand-typed strings cannot move the
// catalogue's NAV, its ISINs, its analytics, or its fingerprint. That containment is the design.
//
// RE-RUNNABLE BY CONSTRUCTION: the derive is a full REPLACE inside one transaction —
// `DELETE FROM mf_families` (which CASCADEs the memberships away) then re-INSERT. There is no
// incremental path to get subtly wrong, and a re-run on an unchanged catalogue reproduces the
// same grouping byte for byte. `instruments` is not named in the transaction.
//
// GRAIN: SCHEME CODES, not ISINs. 17,567 MF catalogue rows collapse to 13,704 codes (one code
// carries up to 2 ISINs — the payout and reinvestment ISINs share a single NAV series). The code
// is the NAV grain and the grain `mf_analytics` is keyed on, so it is the grain a family groups.
// ═══════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { canonicalFor, deriveFamily } from "./mf-family.js";

type Row = { code: string; name: string; house: string | null; cls: string };

export type DeriveReport = {
  schemeCodes: number;
  families: number;
  multiScheme: number;
  groupedCodes: number;
  singletons: number;
  refused: number;
  refusalReasons: Record<string, number>;
  collisions: number;
  byClass: Record<string, number>;
};

export async function deriveFamilies(log = console.log): Promise<DeriveReport> {
  // The scheme-code grain. DISTINCT because a code appears once per ISIN it carries.
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name,
           fund_house AS house, asset_class::text AS cls
    FROM instruments
    WHERE amfi_scheme_code IS NOT NULL AND scheme_name IS NOT NULL
      AND asset_class IN ('mutual_fund','etf')
    ORDER BY amfi_scheme_code
  `);
  log(`  read ${rows.length} distinct scheme codes from the catalogue`);

  type Fam = {
    id: string; key: string; house: string; canonical: string; cls: string;
    reason?: string;
    members: { code: string; name: string; planOption: string; head: string }[];
  };
  const fams = new Map<string, Fam>();
  const refusalReasons: Record<string, number> = {};

  for (const r of rows) {
    const { key, canonicalName, planOption, reason } = deriveFamily(r.name);
    // The house SCOPES the key — two AMCs both publish a "Large Cap Fund", and the house is the one
    // hard, non-derived discriminator we already trust (AMFI's own header, Step 9). It is what makes
    // a cross-AMC merge structurally impossible rather than merely unlikely.
    const house = r.house ?? "";

    if (reason) {
      // HONEST-EMPTY: refused schemes are NOT dropped and NOT force-merged. Each becomes its own
      // singleton family carrying the reason, so an ungrouped fund is visible AS ungrouped.
      // The synthetic key keeps (house, family_key) unique without pretending to be a real key.
      refusalReasons[reason] = (refusalReasons[reason] ?? 0) + 1;
      const id = randomUUID();
      fams.set(`__refused__${r.code}`, {
        id, key: `__ungrouped__:${r.code}`, house, canonical: canonicalName, cls: r.cls, reason,
        members: [{ code: r.code, name: r.name, planOption, head: canonicalName }],
      });
      continue;
    }

    const gid = `${house}||${key}`;
    const f = fams.get(gid) ?? { id: randomUUID(), key, house, canonical: canonicalName, cls: r.cls, members: [] };
    f.members.push({ code: r.code, name: r.name, planOption, head: canonicalName });
    fams.set(gid, f);
  }

  // Display name: chosen from the members' own heads, so it keeps the AMC's casing.
  for (const f of fams.values()) f.canonical = canonicalFor(f.members.map((m) => m.head));

  // ── The over-merge tripwire, computed at WRITE time, not just in a test ──
  // A real fund has exactly ONE "Direct + Growth". Two members claiming one slot is either an AMFI
  // duplicate or a bad merge. We surface the count either way — silence here would be the bug.
  let collisions = 0;
  for (const f of fams.values()) {
    const seen = new Map<string, number>();
    for (const m of f.members) seen.set(m.planOption, (seen.get(m.planOption) ?? 0) + 1);
    for (const n of seen.values()) if (n > 1) collisions++;
  }

  const list = [...fams.values()];
  const multi = list.filter((f) => f.members.length > 1);
  const refused = list.filter((f) => f.reason);
  const byClass: Record<string, number> = {};
  for (const f of list) byClass[f.cls] = (byClass[f.cls] ?? 0) + 1;

  // ── WRITE: full replace, one transaction. `instruments` is not in this block. ──
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM mf_families`); // CASCADEs mf_family_members
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      await tx.mfFamily.createMany({
        data: chunk.map((f) => ({
          id: f.id, familyKey: f.key, fundHouse: f.house, canonicalName: f.canonical,
          assetClass: f.cls as any, schemeCount: f.members.length,
          isSingleton: f.members.length === 1, ungroupedReason: f.reason ?? null,
        })),
      });
      await tx.mfFamilyMember.createMany({
        data: chunk.flatMap((f) =>
          f.members.map((m) => ({
            schemeCode: m.code, familyId: f.id, schemeName: m.name,
            planOption: m.planOption || null,
          })),
        ),
      });
    }
  }, { timeout: 120_000 });

  const report: DeriveReport = {
    schemeCodes: rows.length,
    families: list.length,
    multiScheme: multi.length,
    groupedCodes: multi.reduce((a, f) => a + f.members.length, 0),
    singletons: list.length - multi.length - refused.length,
    refused: refused.length,
    refusalReasons,
    collisions,
    byClass,
  };

  log(`  families        : ${report.families}`);
  log(`  ├─ multi-scheme : ${report.multiScheme}  → grouping ${report.groupedCodes} codes ` +
      `(${((report.groupedCodes / report.schemeCodes) * 100).toFixed(1)}%)`);
  log(`  ├─ singleton    : ${report.singletons}`);
  log(`  └─ REFUSED      : ${report.refused}   ← honest-empty, never force-merged`);
  for (const [r, n] of Object.entries(report.refusalReasons)) log(`        ${String(n).padStart(4)}  ${r}`);
  log(`  colliding slots : ${report.collisions}  (AMFI duplicates, or an over-merge — investigate any rise)`);
  return report;
}
