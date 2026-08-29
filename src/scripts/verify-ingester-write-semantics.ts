// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ EVERY RESULT INGESTER'S WRITE SEMANTICS ARE DECLARED, AND DECLARED THE SAME WAY — a BUILD GATE,
//   and a pure source scan.
//
// Sibling of verify-bse-writer-parity.ts, same contract: reads files in THIS checkout, touches no
// database, no network, no env var.
//
//   npx tsx src/scripts/verify-ingester-write-semantics.ts
//
// ── WHAT IT ASSERTS, AND WHY EACH ONE IS HERE ────────────────────────────────────────────────────
// Before guarded-write.ts, all ten ingesters ended in `prisma.X.upsert({ create: data, update: data })`
// — a full-row rewrite reachable from the nightly results-scan, with 2,719 rows of hand-entered data
// sitting on keys it could target. The fix is only durable if a regression is caught by the suite
// rather than by a downstream score drop months later, so:
//
//   1. NO INGESTER TALKS TO PRISMA DIRECTLY. Not one `prisma.<model>.upsert/update/create` outside
//      guarded-write.ts. This is the load-bearing assertion: everything else is about HOW the writer
//      behaves, and it is worth nothing if a caller can go around it.
//   2. EVERY INGESTER ROUTES THROUGH guardedWrite, and declares a directive parameter defaulting to
//      FILL_NULL_ONLY. A missing default is how the old behaviour creeps back — silently, at one
//      call site, under a name that still reads as safe.
//   3. THE FENCE IS BELOW THE MODE SWITCH. guarded-write.ts must test protection BEFORE it tests the
//      mode, or full_upsert walks past it. Asserted on the source order, because a comment saying so
//      is not a test.
//   4. LAYER 3 RUNS UNCONDITIONALLY. assertProtectedCellsUnmoved must be called on the update path
//      and must throw — never console.warn. A warning in a nightly log is indistinguishable from
//      silence, which is the failure mode this whole build exists to remove.
//   5. full_upsert IS CONSTRUCTIBLE ONLY VIA fullUpsert(reason), and every construction carries a
//      non-empty literal reason. This is what keeps the opt-in enumerable by grep.
//   6. THE FENCE CANONICALISES FIELD NAMES. MEASURED: raw_field_edits stores `gnpa_absolute` from
//      some editors and `gnpaAbsolute` from others. An exact-string match protects one convention
//      and sails past the other.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "node:fs";

const DIR = "src/ingestions/quaterly-results/ingesters";
const WRITER = `${DIR}/guarded-write.ts`;
const DISPATCH = `${DIR}/dispatch.ts`;

const INGESTERS = [
  "ingest-indas-annual.ts", "ingest-indas-quarterly.ts",
  "ingest-banking-annual.ts", "ingest-banking-quarterly.ts",
  "ingest-nbfc-annual.ts", "ingest-nbfc-quarterly.ts",
  "ingest-li-annual.ts", "ingest-li-quarterly.ts",
  "ingest-gi-annual.ts", "ingest-gi-quarterly.ts",
];

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) { console.log(`  ok    ${label}`); return; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
}

const read = (p: string): string => readFileSync(p, "utf8");

function main(): void {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`VERIFY — result-ingester write semantics`);
  console.log("=".repeat(100));

  // ── 0. the roster is the roster ─────────────────────────────────────────────────────────────
  const onDisk = readdirSync(DIR).filter((f) => f.startsWith("ingest-") && f.endsWith(".ts")).sort();
  const want = [...INGESTERS].sort();
  check(onDisk.length === want.length && onDisk.every((f, i) => f === want[i]),
    `${INGESTERS.length} ingesters, and the list here matches the directory`,
    `on disk: ${onDisk.join(", ")}`);

  // ── 1. nobody writes to Prisma except the writer ────────────────────────────────────────────
  console.log(`\n  ── every write goes through guarded-write.ts ──`);
  const DIRECT = /prisma\.[a-zA-Z]+\.(upsert|update|create|updateMany|createMany|delete|deleteMany)\s*\(/g;
  for (const f of INGESTERS) {
    const hits = [...read(`${DIR}/${f}`).matchAll(DIRECT)].map((m) => m[0]);
    check(hits.length === 0, `${f.padEnd(30)} no direct prisma write`, hits.join(", "));
  }

  // ── 2. each declares its semantics as a parameter, defaulting to the safe one ────────────────
  console.log(`\n  ── declared semantics, defaulting to fill_null_only ──`);
  for (const f of INGESTERS) {
    const s = read(`${DIR}/${f}`);
    check(s.includes("guardedWrite({"), `${f.padEnd(30)} routes through guardedWrite`);
    check(/directive:\s*WriteDirective\s*=\s*FILL_NULL_ONLY/.test(s),
      `${f.padEnd(30)} directive param defaults to FILL_NULL_ONLY`);
    check(/\n\s*directive,\n/.test(s), `${f.padEnd(30)} passes its directive to the writer`);
    check(/modelName:\s*"[A-Z]\w+"/.test(s), `${f.padEnd(30)} declares a Prisma MODEL name for the fence`);
  }

  // ── 3-4-6. the writer's own invariants ──────────────────────────────────────────────────────
  console.log(`\n  ── guarded-write.ts invariants ──`);
  const w = read(WRITER);
  const fenceAt = w.indexOf("isProtected(prot, col)");
  const modeAt = w.indexOf(`mode === "fill_null_only" && held`);
  check(fenceAt > 0 && modeAt > 0 && fenceAt < modeAt,
    "the fence is tested BEFORE the mode (so full_upsert cannot walk past it)",
    `fence@${fenceAt} mode@${modeAt}`);
  check(/assertProtectedCellsUnmoved\(/.test(w) && (w.match(/assertProtectedCellsUnmoved\(/g) ?? []).length >= 2,
    "Layer 3 is defined and called");
  const layer3 = w.slice(w.indexOf("async function assertProtectedCellsUnmoved"));
  check(/throw new ProvenanceViolation/.test(layer3) && !/console\.(warn|log)/.test(layer3),
    "Layer 3 throws — never warns");
  check(/const canon = \(s: string\): string => s\.replace\(\/_\/g, ""\)\.toLowerCase\(\)/.test(w),
    "field names are canonicalised (snake_case and camelCase editors both match)");
  check(/if \(source === "manual_workbook"\) return "all"/.test(w),
    "a manual_workbook row is protected in full");
  check(/mode === "full_upsert" && !directive\.reason/.test(w),
    "a full_upsert directive without a reason is refused");

  // ── 5. full_upsert opt-ins are enumerable, and each carries a reason ─────────────────────────
  console.log(`\n  ── full_upsert opt-in sites ──`);
  const all = readdirSync("src/ingestions/quaterly-results/ingesters").map((f) => `${DIR}/${f}`);
  const sites: string[] = [];
  for (const p of all) {
    if (p.endsWith("guarded-write.ts")) continue;
    for (const m of read(p).matchAll(/fullUpsert\(\s*("(?:[^"\\]|\\.)*")\s*\)/g))
      sites.push(`${p.split("/").pop()}: ${m[1].slice(0, 70)}…`);
  }
  console.log(`  ${sites.length} site(s):`);
  for (const s of sites) console.log(`     ${s}`);
  check(sites.length > 0 && sites.length <= 3,
    `full_upsert opt-in sites are few and named (${sites.length})`,
    "if this grows, the default is wrong — widen deliberately, do not opt call sites in one by one");
  // guarded-write.ts is exempt: it is where fullUpsert() legitimately builds the object.
  check(!/mode:\s*"full_upsert"/.test(all.filter((p) => !p.endsWith("guarded-write.ts")).map(read).join("\n")),
    "nothing outside the writer constructs a full_upsert directive by hand (fullUpsert() is the only route)");

  // ── dispatch derives the directive, and does not accept a bare mode ──────────────────────────
  const d = read(DISPATCH);
  check(/function directiveFor\(/.test(d), "dispatch.ts derives the directive in one place");
  check(/decision === "refresh"/.test(d), "the opt-in is tied to decideIngest's refresh (a restatement)");

  console.log(`\n${"=".repeat(100)}`);
  console.log(failures === 0 ? "  ALL CHECKS PASS" : `  ${failures} CHECK(S) FAILED`);
  console.log("=".repeat(100) + "\n");
  process.exit(failures === 0 ? 0 : 1);
}
main();
