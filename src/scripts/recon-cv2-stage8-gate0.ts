// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 8 — GATE 0 RECON (READ-ONLY. Writes nothing.)
//
//   1. The 15 regexes → OUR `Sector` rows. Which map honestly, which have NO clean counterpart?
//   2. THE COVERAGE AUDIT (§14's ratification gate) — the share of sectoral funds the matcher resolves.
//   5. Does the LIVE cohort hold any sectoral/thematic fund? (Is the re-rating real or synthetic-only?)
//   6. Example D — does the matcher resolve "Pharma sectoral fund" → Pharma?
//   7. The not_applicable → unknown gate risk.
//   8. Baselines.
//
//   node_modules/.bin/tsx src/scripts/recon-cv2-stage8-gate0.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { SECTOR_ALLOWLIST } from "../ingestions/amfi/mf-benchmark.js";

const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

async function main() {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · THE 15 REGEXES → OUR `Sector` TABLE. A Nifty index is not automatically a sector.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const sectors = await prisma.sector.findMany({ select: { name: true, displayName: true, stockCount: true }, orderBy: { name: "asc" } });
  console.log(`  OUR sector vocabulary (${sectors.length} rows):`);
  console.log(`    ${sectors.map((s) => `${s.name}(${s.stockCount})`).join(" · ")}\n`);
  console.log(`  The allowlist (${SECTOR_ALLOWLIST.length} rows) targets NIFTY INDEX names:`);
  for (const s of SECTOR_ALLOWLIST) console.log(`    ${String(s.pattern).padEnd(46)} → ${s.index}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · THE COVERAGE AUDIT — §14's ratification gate. The number that decides whether the fund arm ships.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const totalFunds = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM instruments WHERE asset_class IN ('mutual_fund','etf')`);
  console.log(`  fund-class instruments (mutual_fund + etf): ${totalFunds[0].n}`);
  const catRoll = await q<{ category: string | null; n: number }>(
    `SELECT category, COUNT(*)::int AS n FROM instruments WHERE asset_class IN ('mutual_fund','etf') GROUP BY category ORDER BY COUNT(*) DESC LIMIT 14`);
  console.log(`\n  top AMFI category leaves:`);
  for (const c of catRoll) console.log(`    ${String(c.n).padStart(6)}  ${c.category ?? "(null)"}`);

  // The sectoral population — by CATEGORY, which is AMFI-authoritative.
  const sectoral = await q<{ id: string; name: string; category: string | null }>(
    `SELECT id, name, category FROM instruments
     WHERE asset_class IN ('mutual_fund','etf') AND category ILIKE '%sectoral%'`);
  console.log(`\n  funds whose CATEGORY says sectoral/thematic: ${sectoral.length}  (spec said 1,449)`);

  const match = (name: string) => SECTOR_ALLOWLIST.find((s) => s.pattern.test(name)) ?? null;
  const resolved = sectoral.filter((f) => match(f.name) != null);
  const unresolved = sectoral.filter((f) => match(f.name) == null);
  const share = sectoral.length > 0 ? (resolved.length / sectoral.length) * 100 : 0;
  console.log(`\n  ★ THE RATIFICATION NUMBER — matcher resolves ${resolved.length}/${sectoral.length} = ${share.toFixed(1)}% of the sectoral population`);
  console.log(`    unresolved: ${unresolved.length} (${(100 - share).toFixed(1)}%) → these would pool into unknownSectorValue`);

  const byIndex = new Map<string, number>();
  for (const f of resolved) { const i = match(f.name)!.index; byIndex.set(i, (byIndex.get(i) ?? 0) + 1); }
  console.log(`\n  resolved, by Nifty target:`);
  for (const [i, n] of [...byIndex.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${i}`);

  // Top unresolved — genuinely un-sectorable, or a gap in the 15?
  const unresNames = new Map<string, number>();
  for (const f of unresolved) {
    // strip the plan/option noise so the THEME is visible
    const theme = f.name.replace(/\b(direct|regular|growth|idcw|payout|reinvestment|plan|option|fund|scheme)\b/gi, "").replace(/\s+/g, " ").trim();
    unresNames.set(theme, (unresNames.get(theme) ?? 0) + 1);
  }
  console.log(`\n  TOP UNRESOLVED themes (is this a gap in the 15, or genuinely un-sectorable?):`);
  for (const [t, n] of [...unresNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`    ${String(n).padStart(4)}  ${t.slice(0, 78)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · THE RE-RATING'S REAL SHAPE — does the LIVE cohort hold any sectoral/thematic fund?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const held = await q<{ uid: string; symbol: string; name: string; category: string | null; asset_class: string }>(
    `SELECT DISTINCT h.user_id AS uid, i.symbol, i.name, i.category, i.asset_class
     FROM holdings h JOIN instruments i ON i.id = h.instrument_id
     WHERE h.quantity > 0 AND i.asset_class IN ('mutual_fund','etf')`);
  console.log(`  fund products held across the whole cohort: ${held.length}`);
  for (const f of held) {
    const m = match(f.name);
    console.log(`    ${f.uid.slice(0, 8)} · ${f.symbol} · ${f.asset_class} · category=${f.category ?? "(null)"}`);
    console.log(`        name="${f.name}"  → matcher: ${m ? m.index : "no match"} · sectoral-by-category? ${/sectoral/i.test(f.category ?? "") ? "YES" : "no"}`);
  }
  const heldSectoral = held.filter((f) => /sectoral/i.test(f.category ?? ""));
  console.log(`\n  ⇒ cohort books holding a SECTORAL fund: ${heldSectoral.length} — ${heldSectoral.length === 0 ? "the re-rating is SYNTHETIC-ONLY today; Gate 3's assertions carry the entire proof" : "REAL re-rating on live books"}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · EXAMPLE D — the acceptance test. Does the matcher resolve the §10 pharma fund?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const probe of ["Pharma sectoral fund", "SBI Healthcare Opportunities Fund - Direct Growth", "ICICI Prudential Pharma Healthcare and Diagnostics (P.H.D) Fund"]) {
    const m = match(probe);
    console.log(`    "${probe.slice(0, 62)}" → ${m ? m.index : "NO MATCH"}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · BASELINE — the 5 served rows.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const users = (await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();
  for (const uid of users) {
    const s = await prisma.portfolioHealthSnapshot.findFirst({
      where: { userId: uid }, orderBy: { createdAt: "desc" },
      select: { phs: true, structure: true, constantVersion: true, constructionData: true },
    });
    const cd = s?.constructionData as { net?: number } | null;
    console.log(`  ${uid.slice(0, 8)} · cv=${s?.constantVersion} · phs=${s?.phs} · Construction ${Number(s?.structure).toFixed(2)} · cd=${cd == null ? "NULL" : "present"}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; }).finally(() => prisma.$disconnect());
