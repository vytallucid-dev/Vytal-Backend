// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 5 (READ-ONLY). SEPARATE THE TRUE SPLITS FROM THE FALSE ALARMS.
//
// The naive detector ("key still contains direct/regular") flags 252 families — but it conflates:
//   (a) FALSE ALARM — the fund is genuinely NAMED "Regular": "ICICI Prudential REGULAR SAVINGS
//       Fund" grouped all 10 of its variants correctly. "regular" there is IDENTITY.
//   (b) TRUE SPLIT  — an exotic trailing option the vocabulary can't strip halts the walk early,
//       STRANDING the plan word inside the key: "kotak … - regular plan - idcw - payout".
//       Direct and Regular then land in different families. One fund, shattered.
//
// THE PRECISE DETECTOR: take each family key, delete the plan tokens, and bucket by
// (house, plan-stripped key). A bucket holding >1 family means those families are THE SAME FUND
// separated only by a plan word — a TRUE split. A bucket of 1 is a fund merely named "Regular".
//
// This is a DETECTOR, not a merger. It tells me whether to extend the vocabulary. It never merges.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)?/gi;
const TAIL_PHRASES = [
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  "payout & reinvestment", "payout / reinvestment", "payout and reinvestment",
  "payout of", "reinvestment of", "re-investment of",
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw plan", "idcws option", "idcws", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend plan", "dividend",
  "div payout option", "div reinvestment option", "div option", "div plan", "div",
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative plan", "cumulative",
  "bonus option", "bonus plan", "bonus",
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "re-investment", "reinvest",
  "direct plan", "regular plan", "direct", "regular",
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "half-yearly", "annual", "annually", "yearly", "flexi", "maturity", "periodic",
  "option", "plan",
];
const IDENTITY_TAIL = new Set(["segregated", "portfolio", "institutional", "retail", "eco", "series", "unclaimed"]);
const clean = (s: string) =>
  s.replace(NOISE_PAREN, " ").toLowerCase().replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9&+.\-/ ]+/g, " ").replace(/\//g, " / ")
    .replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();

function familyKey(n: string) {
  if (/\bunclaimed\b/i.test(n)) return { key: "", reason: "unclaimed" };
  let w = clean(n).split(" ").filter(Boolean);
  for (let g = 0; g < 40; g++) {
    if (w.length && ["-", "/", "&", "+"].includes(w[w.length - 1])) { w.pop(); continue; }
    const last = w[w.length - 1];
    if (last && IDENTITY_TAIL.has(last)) break;
    let hit = "";
    for (const p of TAIL_PHRASES) {
      const pw = p.split(" ");
      if (pw.length > w.length) continue;
      if (w.slice(w.length - pw.length).join(" ") === p) { hit = p; break; }
    }
    if (!hit) break;
    w = w.slice(0, w.length - hit.split(" ").length);
  }
  while (w.length && ["-", "&", "/", "+"].includes(w[w.length - 1])) w.pop();
  return { key: w.join(" ") };
}

const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house, plan_type AS plan
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

const fams = new Map<string, { house: string; key: string; m: any[] }>();
for (const r of rows) {
  const { key, reason } = familyKey(r.name);
  if (reason) continue;
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as any[] };
  f.m.push(r); fams.set(id, f);
}

// ── THE PRECISE SPLIT DETECTOR ─────────────────────────────────────────────
const stripPlan = (k: string) =>
  k.split(" ").filter((w) => !["direct", "regular", "plan", "-", "&", "/"].includes(w)).join(" ");

const buckets = new Map<string, typeof fams extends Map<any, infer V> ? V[] : never>();
for (const f of fams.values()) {
  const b = `${f.house}||${stripPlan(f.key)}`;
  const a = (buckets.get(b) ?? []) as any[]; a.push(f); buckets.set(b, a as any);
}

rule("TRUE SPLITS — families in ONE house that collapse to the same key once plan words are gone");
const trueSplits = [...buckets.entries()].filter(([, fs]) => fs.length > 1);
console.log(`  buckets holding >1 family (⇒ SAME fund, split by a plan word): ${trueSplits.length}`);
console.log(`  scheme codes affected: ${trueSplits.reduce((a, [, fs]) => a + fs.reduce((x: number, f: any) => x + f.m.length, 0), 0)}\n`);
for (const [b, fs] of trueSplits.slice(0, 18)) {
  console.log(`  ✗ ${(fs as any)[0].house}  →  "${b.split("||")[1]}"`);
  for (const f of fs as any[]) {
    console.log(`      family "${f.key}"  [${f.m.length}]`);
    f.m.slice(0, 3).forEach((m: any) => console.log(`          ${m.code}  ${m.name}`));
  }
}

rule("FALSE ALARMS — key contains a plan word, but it is the FUND'S NAME (bucket of 1)");
const falseAlarm = [...fams.values()].filter((f) => {
  if (!/\b(direct|regular)\b/.test(f.key)) return false;
  return ((buckets.get(`${f.house}||${stripPlan(f.key)}`) ?? []) as any[]).length === 1;
});
console.log(`  count: ${falseAlarm.length}  — these are CORRECT, no action\n`);
for (const f of falseAlarm.slice(0, 8)) console.log(`  ✓ [${f.m.length}] ${f.house} :: "${f.key}"`);

rule("THE RESIDUAL — what exotic trailing tokens are STRANDING the plan word?");
const stranded = [...fams.values()].filter((f) =>
  /\b(direct|regular)\b/.test(f.key) && ((buckets.get(`${f.house}||${stripPlan(f.key)}`) ?? []) as any[]).length > 1);
const tails = new Map<string, number>();
for (const f of stranded) {
  const after = f.key.split(/\b(?:direct|regular)\b/).pop()!.replace(/^[\s\-&/]+/, "").trim();
  if (after) tails.set(after, (tails.get(after) ?? 0) + 1);
}
console.log("  the text left AFTER the stranded plan word — the vocabulary gaps:\n");
for (const [t, n] of [...tails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`   ${String(n).padStart(3)}  "${t}"`);

await prisma.$disconnect();
