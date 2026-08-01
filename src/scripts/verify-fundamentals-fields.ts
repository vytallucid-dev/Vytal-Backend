// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-fundamentals-fields.ts — THE RUNTIME HALF OF THE FIELD-TABLE CHECK.
//
// The COMPILER now proves that every key in ANNUAL_FIELDS / QUARTER_FIELDS exists on its family's view
// TYPE (get-stock-fundamentals.ts §COLUMN 2). That is the important half, and it is the half that could
// never have been asserted at runtime — a table row for a family with no live stock is unreachable.
//
// This gate proves the OTHER half, which the type system cannot: that the type and the PAYLOAD agree.
// An interface says what the service promises to build; if a branch constructs its object by spread or
// by partial assignment, a declared key can still be absent at runtime — and `fmt` would render it as
// "not available", the exact silent failure the type check exists to end. So for one live stock per
// family it walks every table row against the real payload and separates the three outcomes:
//
//     ABSENT key   → a false "not available". A DEFECT. Zero tolerated.
//     null value   → an honest "not available" (undisclosed / guarded at source).
//     a value      → rendered.
//
// It also prints the rendered block per family, which is what makes the persistency ladder's arrival
// visible rather than asserted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import { ANNUAL_FIELDS, QUARTER_FIELDS, familyPayload, renderFundamentals } from "../chat/tools/get-stock-fundamentals.js";
import type { IndustryFamily } from "../scoring/read/fundamentals-view.types.js";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const tok = (s: string) => Math.ceil(s.length / 4); // the same rough estimator the fleet harness uses

const FAMILIES: IndustryFamily[] = ["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"];

// One live stock per family. Chosen from the DB rather than hardcoded, so a universe change is visible.
const stocks = await prisma.stock.findMany({ select: { symbol: true, industryType: true } });
const byFamily = new Map<string, string[]>();
for (const s of stocks) {
  if (!s.industryType) continue;
  const a = byFamily.get(s.industryType) ?? [];
  a.push(s.symbol);
  byFamily.set(s.industryType, a);
}

console.log("\n══ COVERAGE ══════════════════════════════════════════════════════════════════════");
for (const f of FAMILIES) console.log(`  ${f.padEnd(18)} ${String(byFamily.get(f)?.length ?? 0).padStart(3)} stocks`);

let totalAbsent = 0;
const perFamily: { family: string; symbol: string; annual: number; quarter: number; absent: string[]; nulls: string[]; tokens: number }[] = [];

for (const family of FAMILIES) {
  const symbols = byFamily.get(family) ?? [];
  console.log(`\n══ ${family.toUpperCase()} ═══════════════════════════════════════════════════════════`);
  if (symbols.length === 0) {
    console.log("  no stock in this family — table unreachable at runtime (the COMPILER still checks it)");
    continue;
  }

  // Prefer a stock whose view actually builds with both an annual and a quarter on file.
  let chosen: { symbol: string; view: Awaited<ReturnType<typeof buildFundamentalsView>> } | null = null;
  for (const sym of symbols) {
    const v = await buildFundamentalsView(sym);
    if (!v || !v.built) continue;
    const p = familyPayload(v);
    if (p?.annual && p.quarters.length) { chosen = { symbol: sym, view: v }; break; }
    if (!chosen && p) chosen = { symbol: sym, view: v };
  }
  if (!chosen?.view) {
    console.log(`  no buildable view across ${symbols.length} symbols — skipped`);
    continue;
  }

  const p = familyPayload(chosen.view)!;
  const absent: string[] = [];
  const nulls: string[] = [];
  const walk = (rows: readonly (readonly [string, unknown, string])[], obj: Record<string, unknown> | null, where: string) => {
    if (!obj) return;
    for (const [label, ref] of rows) {
      if (typeof ref === "function") {
        // Accessor form — "absent" means it threw or the container it walks is missing entirely.
        let v: unknown;
        try { v = (ref as (r: unknown) => unknown)(obj); } catch { absent.push(`${where}/${label} (accessor threw)`); continue; }
        if (v == null) nulls.push(`${where}/${label}`);
        continue;
      }
      const key = ref as string;
      if (!(key in obj)) { absent.push(`${where}/${label} → "${key}" NOT ON THE PAYLOAD`); continue; }
      if (obj[key] == null) nulls.push(`${where}/${label}`);
    }
  };
  walk(ANNUAL_FIELDS[family] as never, p.annual, "annual");
  walk(QUARTER_FIELDS[family] as never, (p.quarters.at(-1) ?? null) as Record<string, unknown> | null, "quarter");

  const block = renderFundamentals(chosen.view);
  perFamily.push({
    family,
    symbol: chosen.symbol,
    annual: ANNUAL_FIELDS[family].length,
    quarter: QUARTER_FIELDS[family].length,
    absent,
    nulls,
    tokens: tok(block),
  });
  totalAbsent += absent.length;

  console.log(`  probe ${chosen.symbol} · ${ANNUAL_FIELDS[family].length} annual rows · ${QUARTER_FIELDS[family].length} quarter rows · block ≈ ${tok(block)} tokens`);
  ok(`${family} — ZERO false "not available" (every table key exists on the live payload)`, absent.length === 0, absent.join(" · ") || `${ANNUAL_FIELDS[family].length + QUARTER_FIELDS[family].length} keys resolved`);
  if (nulls.length) console.log(`     honestly null (undisclosed or source-guarded): ${nulls.join(", ")}`);
  console.log("  ┌─ RENDERED BLOCK");
  console.log(block.split("\n").map((l) => "  │ " + l).join("\n"));
  console.log("  └─");
}

console.log("\n══ 9b · THE PERSISTENCY LADDER ═══════════════════════════════════════════════════");
{
  const liSymbols = byFamily.get("life_insurance") ?? [];
  console.log(`  life insurers covered: ${liSymbols.length} — ${liSymbols.join(", ")}`);
  const rows = ANNUAL_FIELDS.life_insurance;
  const ladder = rows.filter(([label]) => /Persistency/.test(label));
  ok("all five legs are declared on the annual table", ladder.length === 5, ladder.map(([l]) => l).join(" · "));
  ok("every leg is the ACCESSOR form (the key form cannot reach a nested object)", ladder.every(([, ref]) => typeof ref === "function"));

  for (const sym of liSymbols) {
    const v = await buildFundamentalsView(sym);
    const p = v ? familyPayload(v) : null;
    const a = p?.annual as { persistency?: Record<string, unknown> } | null;
    const legs = a?.persistency
      ? ["m13", "m25", "m37", "m49", "m61"].map((k) => (a.persistency![k] == null ? "—" : String(a.persistency![k])))
      : null;
    console.log(`     ${sym.padEnd(12)} ${legs ? legs.join("  ") : "no annual persistency object on file"}`);
  }

  // Token cost of the ladder: the five rows, rendered.
  const liProbe = perFamily.find((r) => r.family === "life_insurance");
  if (liProbe) {
    const v = await buildFundamentalsView(liProbe.symbol);
    const block = v ? renderFundamentals(v) : "";
    const ladderLines = block.split("\n").filter((l) => /Persistency/.test(l));
    console.log(`\n  rendered ladder lines (${liProbe.symbol}):`);
    for (const l of ladderLines) console.log(`     ${l}`);
    console.log(`  token cost of the ladder: ≈ ${tok(ladderLines.join("\n"))} tokens, paid only on a life-insurance call`);
  }
}

console.log("\n══ 9c · THE OTHER FOUR FAMILIES ══════════════════════════════════════════════════");
// Asserted against the RENDERED block, not against the table — a family picking up the ladder by
// accident (a copied row, a shared table) would show up here and nowhere else.
for (const r of perFamily) {
  if (r.family === "life_insurance") continue;
  const v = await buildFundamentalsView(r.symbol);
  const block = v ? renderFundamentals(v) : "";
  ok(
    `${r.family} renders no Persistency line (the ladder is life-only)`,
    !/persistency/i.test(block),
    `${r.symbol}: ${r.annual}+${r.quarter} rows, ≈${r.tokens} tok`,
  );
}

console.log("\n══ SUMMARY ═══════════════════════════════════════════════════════════════════════");
for (const r of perFamily) {
  console.log(`  ${r.family.padEnd(18)} ${r.symbol.padEnd(12)} ${String(r.annual + r.quarter).padStart(3)} rows · ${String(r.absent.length).padStart(2)} absent · ${String(r.nulls.length).padStart(2)} honestly null · ≈${r.tokens} tok`);
}
ok("★ ZERO false 'not available' lines across every family", totalAbsent === 0, `${totalAbsent} absent keys`);

console.log(fail === 0 ? `\n✅ FIELD-TABLE GATE PASSES — ${pass} assertions\n` : `\n❌ ${fail} FAILED (${pass} passed)\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
