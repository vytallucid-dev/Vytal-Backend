// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-3 — THE BENCHMARK SUBSTRING MIS-MAP. PROVEN, NOT REVIEWED.
//
// THE DEFECT: `norm()` strips spaces, so a held index that is a PREFIX of a fund's true index matches as
// a substring — and longest-match-first only saves it when the longer index is ALSO held. It is not for
// Sensex Next 30/50 or the LargeMidcap "Plus G-Sec" blends → 13 Sensex-Next funds mapped to bare Sensex,
// 5 hybrids to bare LargeMidcap 250. Their beta/alpha/tracking-error were computed against the WRONG
// index; PI4 read the gap between two different indices as a tracking failure — its loudest cases wrong.
//
// THE FIX: a WHOLE-MATCH guard — reject a match whose name continues with an index-extending qualifier.
// THE THRESHOLD IS UNTOUCHED (`PI_TE_NOTABLE = 2%`): a threshold must never do a bug's cleanup.
//
//   npx tsx src/scripts/verify-t3-benchmark.ts   (reads index_prices for the live universe; no writes)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { buildNameMatcher } from "../ingestions/amfi/mf-benchmark.js";
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

async function main() {
  const idxNames = (await prisma.$queryRawUnsafe<any[]>(`SELECT DISTINCT index_name FROM index_prices`)).map((r) => String(r.index_name));
  const match = buildNameMatcher(idxNames);
  console.log(`index universe: ${idxNames.length} distinct index names loaded from index_prices`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★★ THE 13 SENSEX-NEXT FUNDS no longer map to bare Sensex — they go NULL (honest)");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const sensexNext = [
      "SBI BSE Sensex Next 50 ETF", "UTI - BSE Sensex Next 50 Exchange Traded Fund",
      "Nippon India ETF BSE Sensex Next 50", "DSP BSE SENSEX Next 30 ETF",
      "Nippon India BSE Sensex Next 30 Index Fund - Regular Plan-Growth Option",
      "DSP BSE SENSEX Next 30 Index Fund - Direct - Growth",
    ];
    let allNull = true;
    for (const nm of sensexNext) { const m = match(nm); if (m !== null) { allNull = false; console.log(`       ❌ ${nm} → ${m}`); } }
    ok("★★ every Sensex-Next fund → null (NOT 'Sensex')", allNull, `${sensexNext.length} funds, all null`);

    // ★ AND A PLAIN SENSEX FUND STILL MAPS — the guard rejects the EXTENSION, not the base.
    ok("★ a plain 'SBI BSE Sensex ETF' still maps to Sensex", match("SBI BSE Sensex ETF") === "Sensex", `→ ${match("SBI BSE Sensex ETF")}`);
    ok("★ 'HDFC Sensex Index Fund' still maps to Sensex", match("HDFC Sensex Index Fund") === "Sensex");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ THE 5 HYBRIDS (LargeMidcap 250 Plus G-Sec) → NULL; the PURE LargeMidcap 250 funds STAY");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const hybrid = "Edelweiss Nifty LargeMidcap 250 Plus 8-13 yr G-Sec 70-30 Index Fund Direct Plan Growth";
    ok("★★ the 'Plus 8-13yr G-Sec 70-30' hybrid → null (we hold no such blended index)", match(hybrid) === null, `→ ${match(hybrid)}`);
    const pure = "HDFC NIFTY LargeMidcap 250 Index Fund - Growth Option";
    ok("★★ the PURE 'LargeMidcap 250' fund STILL maps — the guard rejects the extension, not the index",
      match(pure) === "NIFTY LargeMidcap 250", `→ ${match(pure)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ THE PREFIX FAMILIES THE TICKET NAMED — Nifty 50 / 500 / Next 50, all resolve correctly");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // These were ALREADY correct (all three indices are held → longest-match-first handles them). The
    // guard must not regress them.
    ok("★ 'Nippon India Nifty 500 ETF' → Nifty 500 (NOT Nifty 50)", match("Nippon India Nifty 500 ETF") === "Nifty 500", `→ ${match("Nippon India Nifty 500 ETF")}`);
    ok("★ 'UTI Nifty 50 ETF' → Nifty 50", match("UTI Nifty 50 ETF") === "Nifty 50", `→ ${match("UTI Nifty 50 ETF")}`);
    ok("★ 'Nifty Next 50' fund → Nifty Next 50 (held → matches its own index)", match("Kotak Nifty Next 50 ETF") === "Nifty Next 50", `→ ${match("Kotak Nifty Next 50 ETF")}`);
    ok("★ 'Nifty 100' fund → Nifty 100", match("ICICI Prudential Nifty 100 ETF") === "Nifty 100");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★★ THE FULL COHORT — how many via='name' funds change, and to what");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // Re-run the matcher over EVERY distinct fund name that currently resolved via='name', and compare
    // the NEW result to the STORED benchmark_index. Only the mis-maps should change (→ null).
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT i.name, a.benchmark_index AS stored
      FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
      WHERE a.benchmark_via = 'name' AND i.name IS NOT NULL`);
    let changed = 0, toNull = 0, toOther = 0;
    const samples: string[] = [];
    for (const r of rows) {
      const now = match(String(r.name));
      if (now !== r.stored) {
        changed++;
        if (now === null) toNull++; else { toOther++; console.log(`       ⚠ ${r.name}: ${r.stored} → ${now} (changed to a DIFFERENT index — inspect)`); }
        if (samples.length < 18) samples.push(`${r.stored}→${now === null ? "null" : now}  ${String(r.name).slice(0, 52)}`);
      }
    }
    console.log(`       cohort: ${rows.length} distinct via='name' fund names`);
    for (const s of samples) console.log(`         ${s}`);
    ok("★★ EVERY change is → null — never re-mapped to another wrong index (the safety property)",
      toOther === 0, `changed=${changed} · toNull=${toNull} · toOther=${toOther}`);
    // ★ STEADY STATE, not a stale pin. Pre-application, the matcher audit over this cohort found 22 distinct
    // mis-maps (13 Sensex-Next + 7 LargeMidcap "Plus G-Sec" hybrids + 2 Smallcap-250 "Momentum Quality" — all
    // naming a qualified index we do not hold; "the 13 are what we found, not what's there"). The re-fold then
    // APPLIED the guard: those 22 now resolve to null and LEAVE the via='name' cohort entirely (1016 → 994).
    // So the live cohort is fully guard-clean, and the invariant is "0 mis-maps SURVIVE" — never "changed===22",
    // which pinned a pre-application delta the fold legitimately drives to 0 (the pin disease: a count the
    // session's own writes change fails on a schedule). The matcher's code-correctness is proven
    // fold-independently in §§1-3 and the §5 negative control; §4 proves the fix is APPLIED in live data.
    ok("★★ the live via='name' cohort is fully guard-clean — 0 mis-maps survive (pre-application: 22)",
      changed === 0, `${changed} mis-maps remain of ${rows.length} via='name' funds (must be 0 once folded)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ★★ NEGATIVE CONTROL — WITHOUT the guard, Sensex-Next mis-maps (proving the guard is load-bearing)");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // Reconstruct the OLD behaviour (plain substring, longest-first, NO qualifier guard) and show it
    // reproduces the bug. If this does NOT mis-map, the guard is not what's fixing it.
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const byLen = idxNames.map((name) => ({ name, key: norm(name) })).filter((x) => x.key.length >= 6).sort((a, b) => b.key.length - a.key.length);
    const oldMatch = (schemeName: string) => { const k = norm(schemeName); for (const { name, key } of byLen) if (k.includes(key)) return name; return null; };
    ok("★★ the OLD matcher maps 'SBI BSE Sensex Next 50 ETF' → Sensex (the bug, reproduced)",
      oldMatch("SBI BSE Sensex Next 50 ETF") === "Sensex", `old → ${oldMatch("SBI BSE Sensex Next 50 ETF")}`);
    ok("★★ …and the NEW matcher maps the same fund → null (the guard is what fixes it)",
      match("SBI BSE Sensex Next 50 ETF") === null);
  }

  console.log("\n" + "═".repeat(96));
  console.log(fail === 0 ? "  ✅ T-3 — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
  console.log("═".repeat(96));
  await prisma.$disconnect();
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
