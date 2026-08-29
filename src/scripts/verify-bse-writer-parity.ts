// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE TWO BSE WRITERS MUST AGREE ON THEIR COLUMNS — a BUILD GATE, and a pure source scan.
//
// There are two BSE write paths, deliberately in separate files with separate guarantees:
//   bse-writer.ts       INSERT … ON CONFLICT DO NOTHING — creates rows, never modifies one.
//   bse-column-fill.ts  UPDATE … AND <col> IS NULL      — modifies rows, never creates one.
//
// The rule that keeps them one system rather than two:
//   IF BSE MAY CREATE A COLUMN'S VALUE IN A NEW ROW, IT MAY FILL THAT COLUMN'S NULL IN AN EXISTING
//   ROW — AND NOTHING ELSE.
//
// So bse-column-fill's BSE_COLUMNS must be EXACTLY the column list bse-writer's INSERT statements
// build, per table. A column in the filler but not the insert is a channel for BSE data to reach a
// place the insert path was already ruled out of. A column in the insert but not the filler is a gap
// that silently never gets backfilled. Both are invisible without this check.
//
// ⚠ THIS IS A BUILD GATE and it is entitled to be one: it reads two files in THIS checkout, touches
//   no database, no network, no sibling repo, no env var. It is wired into `npm run verify:copy`.
//
//   npx tsx src/scripts/verify-bse-writer-parity.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";

const WRITER = "src/ingestions/quaterly-results/bse/bse-writer.ts";
const FILLER = "src/ingestions/quaterly-results/bse/bse-column-fill.ts";
const DERIVER = "src/ingestions/quaterly-results/bse/bse-derive-after-write.ts";

/** Columns the INSERT statements name, minus identity/provenance/state — those are not data cells. */
const NOT_A_DATA_CELL = new Set([
  "id", "stock_id", "quarter", "fiscal_year", "report_date", "filing_date",
  "result_type", "xbrl_url", "source", "xbrl_taxonomy", "audit_pending",
  "created_at", "updated_at",
]);

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? "\n       " + detail : ""}`);
}

/**
 * ⚠ COMMENTS ARE NOT CODE, and this scan learned it the hard way. The structural check below
 *   looks for `DO UPDATE` in bse-writer.ts — and found it, in the header prose that says
 *   "Do not 'improve' this into an upsert, a DO UPDATE, or a findFirst-then-insert." The warning
 *   AGAINST the thing read as the thing. Line-based on purpose: it drops whole-line comments and
 *   block-comment bodies, and deliberately does not try to parse strings, because a scan that
 *   half-understands syntax is worse than one with a stated limit.
 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
      return line;
    })
    .join("\n");
}

/** Pull `INSERT INTO <table> ( … )` column lists straight out of the writer's source. */
function insertColumns(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /INSERT INTO\s+([a-z_]+)\s*\(([\s\S]*?)\)\s*VALUES/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const cols = m[2]
      .split(",")
      .map((c) => c.trim())
      // ⚠ MUST allow digits. `/^[a-z_]+$/` silently dropped cet1_ratio, additional_tier1_ratio
      // and tier1_ratio from the INSERT side, which read as "the filler has three extra columns".
      .filter((c) => c.length > 0 && /^[a-z0-9_]+$/.test(c))
      .filter((c) => !NOT_A_DATA_CELL.has(c));
    out.set(m[1], cols);
  }
  return out;
}

/** Pull BSE_COLUMNS out of the filler's source, without importing it (a scan, not a load). */
function fillerColumns(src: string): Map<string, string[]> {
  const start = src.indexOf("export const BSE_COLUMNS");
  if (start < 0) throw new Error(`BSE_COLUMNS not found in ${FILLER}`);
  const end = src.indexOf("\n};", start);
  if (end < 0) throw new Error(`BSE_COLUMNS block is not terminated in ${FILLER}`);
  const block = src.slice(start, end);
  const out = new Map<string, string[]>();
  const tableRe = /^\s{2}([a-z_]+):\s*\[([\s\S]*?)\n\s{2}\],/gm;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(block)) !== null) {
    const pairs = [...m[2].matchAll(/\[\s*"([A-Za-z0-9]+)"\s*,\s*"([a-z_0-9]+)"\s*\]/g)];
    out.set(m[1], pairs.map((p) => p[2]));
  }
  return out;
}

function main(): void {
  const writerSrc = readFileSync(WRITER, "utf8");
  const fillerSrc = readFileSync(FILLER, "utf8");
  const ins = insertColumns(writerSrc);
  const fil = fillerColumns(fillerSrc);

  console.log("\n══ BSE WRITER PARITY — the insert set and the fill set must be identical ══\n");

  // TEN tables since 2026-08-25: non_financial, banking, nbfc, life_insurance and
  // quarterly + annual. The number is asserted (not just "more than zero") so that
  // a table silently DISAPPEARING from either writer still fails here.
  const EXPECTED_TABLES = 10;
  // ── INSERT ARITY — the check this file was missing ──
  // Everything below compares the two writers' COLUMN NAMES. Nothing compared an
  // INSERT's own column list against its own VALUES list, so a statement could name
  // 33 columns and supply 37 expressions and still pass every assertion here. That
  // exact bug (life_insurance_fundamentals, a duplicated tail) survived to a LIVE
  // run on 2026-08-25 and failed at Postgres with "INSERT has more expressions than
  // target columns" — after 49 rows had already been written by earlier statements.
  {
    const src = readFileSync(WRITER, "utf8");
    const re = /INSERT INTO (\w+) \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)\s*ON CONFLICT/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = re.exec(src)) !== null) {
      const table = m[1];
      const cols = m[2].split(",").map((x) => x.trim()).filter(Boolean).length;
      // Split on commas that are NOT inside a ${...} interpolation.
      const vals = m[3].split(/,(?![^{]*\})/).map((x) => x.trim()).filter(Boolean).length;
      checked++;
      check(cols === vals, `${table} — INSERT names ${cols} columns and supplies ${cols} values`,
        cols === vals ? "" : `column list has ${cols}, VALUES has ${vals}`);
    }
    check(checked === EXPECTED_TABLES, `arity checked on all ${EXPECTED_TABLES} INSERTs`, `checked ${checked}`);
  }

  check(ins.size === EXPECTED_TABLES, `the writer builds ${EXPECTED_TABLES} INSERT statements`, `found ${ins.size}: ${[...ins.keys()].join(", ")}`);
  check(fil.size === EXPECTED_TABLES, `the filler declares ${EXPECTED_TABLES} tables`, `found ${fil.size}: ${[...fil.keys()].join(", ")}`);

  // Positive control: the scan must be finding real columns, not empty lists.
  const totalIns = [...ins.values()].reduce((a, b) => a + b.length, 0);
  check(totalIns > 50, `the INSERT scan actually found columns — ${totalIns} across 4 tables`);
  check(
    ins.get("banking_fundamentals")?.includes("advances") === true,
    "…and it finds a column we know is there — banking_fundamentals.advances",
  );

  for (const table of [...ins.keys()].sort()) {
    const a = new Set(ins.get(table) ?? []);
    const b = new Set(fil.get(table) ?? []);
    const onlyInsert = [...a].filter((c) => !b.has(c));
    const onlyFiller = [...b].filter((c) => !a.has(c));
    check(
      onlyInsert.length === 0 && onlyFiller.length === 0,
      `${table} — ${a.size} columns, identical in both writers`,
      onlyInsert.length || onlyFiller.length
        ? `INSERT-only: [${onlyInsert.join(", ")}]  ·  FILLER-only: [${onlyFiller.join(", ")}]`
        : "",
    );
  }

  // ── the separation itself, asserted from source ────────────────────────────
  console.log("\n── and the two paths stay structurally what they claim to be ──");
  const writerCode = stripComments(writerSrc);
  const fillerCode = stripComments(fillerSrc);
  const writerMutates = /\b(UPDATE\s+[a-z_"]+\s+SET|DO\s+UPDATE|\.update\(|\.upsert\(|DELETE\s+FROM)/i.exec(writerCode);
  check(
    writerMutates === null,
    "bse-writer.ts contains NO statement that can modify or delete an existing row",
    writerMutates ? `found: ${writerMutates[0]}` : "",
  );
  const fillerInserts = /INSERT INTO\s+(?!raw_field_edits)/i.exec(fillerCode);
  check(
    fillerInserts === null,
    "bse-column-fill.ts INSERTs nothing but its own audit rows",
    fillerInserts ? `found: ${fillerInserts[0]}` : "",
  );
  // The two mechanisms that together make the fill null-only, asserted in CODE (the comments
  // explaining them are stripped, so this counts implementations, not intentions).
  check(/IS NULL/.test(fillerCode), "the filler builds an `IS NULL` guard into the UPDATE itself");
  check(/FOR UPDATE/.test(fillerCode), "…and takes the row FOR UPDATE first, so the guard cannot be raced");
  check(
    /ON CONFLICT\s*\([^)]*\)\s*DO NOTHING/i.test(writerCode),
    "the insert path still ends in ON CONFLICT … DO NOTHING",
  );

  // ── EVERY TABLE THE LANE WRITES MUST BE DERIVABLE ──────────────────────────────────────
  // A BSE row is committed with RAW CELLS AND NO RATIOS; `deriveAfterBseWrite` is what puts them on
  // it. If a table is added to BSE_COLUMNS and not to that map, the lane silently starts producing
  // underived rows again — the exact failure that left every BSE quarterly row without a margin
  // until 2026-08-28. Read from SOURCE like everything else here, so the map is COUNTED, not merely
  // intended.
  const deriverCode = stripComments(readFileSync(DERIVER, "utf8"));
  const mapBody = deriverCode.slice(deriverCode.indexOf("DERIVE_KEY"));
  const derivable = new Set(
    [...mapBody.slice(0, mapBody.indexOf("};")).matchAll(/^\s*([a-z_]+)\s*:\s*"/gm)].map((m) => m[1]),
  );
  const notDerivable = [...fil.keys()].filter((t) => !derivable.has(t));
  check(
    notDerivable.length === 0,
    "every table the BSE lane writes is wired into deriveAfterBseWrite",
    notDerivable.length ? `not derivable: ${notDerivable.join(", ")}` : "",
  );

  console.log(
    `\n${failures === 0 ? "✅ BSE WRITER PARITY PASSES — two writers, one column set, neither able to do the other's job" : `❌ ${failures} FAILURE(S)`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
