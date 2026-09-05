// ─────────────────────────────────────────────────────────────
// ONE-OFF REPAIR — restore the scheme names AMFI's 2026-08-19 reshape flattened.
//
// WHAT HAPPENED. AMFI stopped shipping the words that say WHICH FUND a scheme code is, for a
// block of funds it renamed wholesale: 21 Franklin "Short-Term Income Plan (no. of segregated
// portfolios- 3)" codes, 19 ICICI "Floating Interest Rates Fund" codes, and 250 more label
// groups, all arriving as ONE string with an empty Plan and Option column. The first run of the
// fixed ingest took those names — correctly, by the containment rule, since AMFI HAD genuinely
// renamed them — and 272 labels ended up shared by 2+ scheme codes against a measured baseline
// of ZERO.
//
// THE SOURCE-CODE FIX (ingest-amfi.ts, resolveCatalogueName) now refuses an incoming label that
// cannot separate two scheme codes when the stored one can. That protects the catalogue from
// here on. It cannot un-write the names already overwritten — this script does that.
//
// WHERE THE OLD NAMES COME FROM. `mf_family_members.scheme_name` is a snapshot taken from
// `instruments.scheme_name` BEFORE the reshape, and the family derivation has not re-run since,
// so it still holds the pre-reshape name for 14,041 scheme codes. That is a real record of what
// AMFI itself told us, not a reconstruction — which is the only kind of restore worth making.
//
// SCOPE, DELIBERATELY NARROW: only codes inside a COLLIDED label group, and only where the
// snapshot name is itself distinct within that group. A snapshot that would recreate the same
// collision fixes nothing and is left alone.
//   npx tsx src/scripts/repair-amfi-collided-names.ts [--apply]
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";

const APPLY = process.argv.includes("--apply");

type Row = { isin: string; code: string; house: string | null; name: string; snapshot: string | null };

const rows = await prisma.$queryRaw<Row[]>`
  SELECT i.isin, i.amfi_scheme_code AS code, i.fund_house AS house,
         i.scheme_name AS name, m.scheme_name AS snapshot
  FROM instruments i
  LEFT JOIN mf_family_members m ON m.scheme_code = i.amfi_scheme_code
  WHERE i.amfi_scheme_code IS NOT NULL AND i.scheme_name IS NOT NULL`;

// The collided groups: one label carrying more than one scheme code.
const byLabel = new Map<string, Row[]>();
for (const r of rows) {
  const k = `${r.house ?? ""}||${r.name.toLowerCase()}`;
  const g = byLabel.get(k);
  g ? g.push(r) : byLabel.set(k, [r]);
}

let groups = 0, restorable = 0, unrestorable = 0, applied = 0;
const examples: string[] = [];

for (const [, group] of byLabel) {
  const codes = new Set(group.map((r) => r.code));
  if (codes.size < 2) continue;
  groups++;

  // Would the snapshot actually SEPARATE these codes? One name per code, all distinct.
  const nameForCode = new Map<string, string | null>();
  for (const r of group) if (!nameForCode.has(r.code)) nameForCode.set(r.code, r.snapshot);
  const snapshots = [...nameForCode.values()];
  const allPresent = snapshots.every((n) => n && n.trim().length > 0);
  const allDistinct = new Set(snapshots.map((n) => (n ?? "").toLowerCase())).size === snapshots.length;

  if (!allPresent || !allDistinct) {
    unrestorable += codes.size;
    continue;
  }
  restorable += codes.size;
  if (examples.length < 5) {
    examples.push(`"${group[0].name}" (${codes.size} codes) → ${snapshots.map((n) => `"${n}"`).join(" | ")}`);
  }

  if (APPLY) {
    for (const r of group) {
      const snap = nameForCode.get(r.code);
      if (!snap) continue;
      await prisma.instrument.update({
        where: { isin: r.isin },
        data: { name: snap, schemeName: snap },
      });
      applied++;
    }
  }
}

console.log(`collided label groups        : ${groups}`);
console.log(`scheme codes restorable      : ${restorable}   (snapshot present AND distinct per code)`);
console.log(`scheme codes NOT restorable  : ${unrestorable} (no snapshot, or the snapshot collides too)`);
console.log(`\nexamples:`);
examples.forEach((e) => console.log("  " + e));
console.log(APPLY ? `\n✅ restored ${applied} instrument row(s).` : `\n(dry run — pass --apply to write)`);
await prisma.$disconnect();
