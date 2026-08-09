// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BUILD GATE — the ANNUAL manifest and its gloss catalogue.
//
// Sibling of verify-quarter-metrics.ts, and the same division of labour: two rules are held by TYPES
// (an annual metric with no gloss; a fetcher that drops one), and this covers what types cannot see —
// the reverse direction, the CONTENT of the copy, and the per-metric rulings the Stage-4 measurements
// bought that a later edit could quietly undo.
//
// ⚠ THE POINT IS THE UNDOABLE ONES, AND THIS STAGE HAS FOUR:
//   · the cross-field guard on every ratio measured against net worth (§5)
//   · `book_value_per_share` absent from every family (§5) — it LOOKS like an obvious metric to add
//   · `total_assets` absent from both insurance families (§5) — the column exists and is a trap
//   · the four annual-only metrics being PRESENT here (§6), which is the mirror of the quarterly
//     gate's §5 promise that they are absent there
//
// PURE. No database. Reads the two modules and asserts. Runs in `npm run verify:copy`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ANNUAL_METRIC_GLOSSES, ANNUAL_METRIC_KEYS, type AnnualMetricKey } from "../catalogue/annual-metrics.js";
import { PARSER_BACKLOG, BACKLOG_MARKER, backlogIds } from "../ingestions/quaterly-results/xbrl/parser-backlog.js";
import { QUARTER_METRIC_GLOSSES } from "../catalogue/quarter-metrics.js";
import {
  ANNUAL_MANIFEST,
  SCALE_SEAMS,
  type AnnualMetricSpec,
  type Family,
} from "../insight/quarter-brief/annual-manifest.js";

/** This checkout's root, resolved from THIS file — never process.cwd(), which the build-gate hygiene
 *  scan treats as an escape shape and which would differ between `npm run` and a direct invocation. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
};
const section = (s: string) => console.log(`\n${s}`);

const FAMILIES = Object.keys(ANNUAL_MANIFEST) as Family[];
const specs = (f: Family): readonly AnnualMetricSpec[] => ANNUAL_MANIFEST[f] as readonly AnnualMetricSpec[];
const allSpecs: { family: Family; spec: AnnualMetricSpec }[] = FAMILIES.flatMap((family) =>
  specs(family).map((spec) => ({ family, spec })),
);

/** Names of columns that are 0% populated on the preferred basis, measured on FY25+FY26. Declaring one
 *  in a manifest would force the fetcher to supply a permanent null the card then has to explain. */
const EMPTY_COLUMNS = [
  "revenue_on_investments",
  "reserve_excl_revaluation",
  "reinsurance_ceded",
  "reinsurance_accepted",
  "change_in_unexpired_risk_reserve",
  "reinsurance_recoveries_on_claims",
  "commission_paid",
  "commission_received_from_reinsurance",
  "rent_rates_and_taxes",
  "legal_and_professional_charges",
];

function main(): void {
  // ── §1 · COVERAGE, BOTH DIRECTIONS ──────────────────────────────────────────────────────────────
  section("§1 · Coverage");
  const used = new Set<AnnualMetricKey>(allSpecs.map(({ spec }) => spec.key));
  const orphans = ANNUAL_METRIC_KEYS.filter((k) => !used.has(k));
  ok(
    "every annual gloss is used by at least one manifest (no orphan copy)",
    orphans.length === 0,
    orphans.length ? `orphans: ${orphans.join(", ")}` : `${used.size} glosses, all used`,
  );
  ok(
    "every annual manifest metric resolves to a gloss (compiler-enforced; re-asserted at runtime)",
    allSpecs.every(({ spec }) => spec.key in ANNUAL_METRIC_GLOSSES),
    `${allSpecs.length} manifest slots across ${FAMILIES.length} families`,
  );
  for (const f of FAMILIES) {
    const keys = specs(f).map((s) => s.key);
    ok(`${f}: no duplicate metric within the family`, new Set(keys).size === keys.length);
    ok(`${f}: declares at least one metric`, keys.length > 0, `${keys.length} metrics`);
    // ★ GATE 4 CANNOT WORK IF A FAMILY DECLARES NO BALANCE-SHEET LINE — it would suppress every card
    // in that family, silently and forever. This is the assertion that makes the gate safe to have.
    const bs = specs(f).filter((s) => s.balanceSheet);
    ok(`${f}: declares at least one balance-sheet line (annual-section.ts gate 4)`, bs.length > 0, `${bs.length} of ${keys.length}`);
    ok(`${f}: every balance-sheet line is a money line`, bs.every((s) => s.scale === "money"), bs.map((s) => s.key).join(", "));
  }

  // ★ THE TWO CATALOGUES MUST NOT SHARE A KEY. A key in both would mean the split between "this
  // quarter" and "this year" was drawn through the middle of one concept, and the two glosses would
  // then be two definitions of one word on one card.
  const collisions = ANNUAL_METRIC_KEYS.filter((k) => k in QUARTER_METRIC_GLOSSES);
  ok(
    "no key exists in BOTH the quarterly and annual gloss catalogues",
    collisions.length === 0,
    collisions.length ? `collides: ${collisions.join(", ")}` : `${ANNUAL_METRIC_KEYS.length} annual keys, all distinct`,
  );

  // ── §2 · COPY CONTENT — the same house rules the quarterly catalogue is held to ─────────────────
  section("§2 · Copy content");
  const before = fail;
  for (const key of ANNUAL_METRIC_KEYS) {
    const g = ANNUAL_METRIC_GLOSSES[key];
    if (!g.label.trim() || !g.meaning.trim() || !g.doesntMean.trim()) {
      ok(`${key}: label, meaning and doesntMean all present`, false, "empty field");
      continue;
    }
    if (g.doesntMean.length < 40) ok(`${key}: doesntMean is a sentence, not a stub`, false, `${g.doesntMean.length} chars`);
    // ⚠ PROSE, NOT "≠". Inherited from quarter-metrics.ts; see the annual catalogue's header.
    if (/≠/.test(g.meaning) || /≠/.test(g.doesntMean)) ok(`${key}: no "≠" glyph`, false, "uses ≠");
    if (/\.\s+[A-Z]/.test(g.meaning)) ok(`${key}: meaning is one sentence`, false, g.meaning.slice(0, 60));
    if (g.label.length > 48) ok(`${key}: label is short enough to be a heading`, false, `${g.label.length} chars`);
  }
  ok(
    "all annual glosses: three fields present, prose not glyphs, meaning is one sentence",
    fail === before,
    `${ANNUAL_METRIC_KEYS.length} entries checked`,
  );
  // NEGATIVE CONTROLS — a gate nobody can see fail is not evidence.
  ok("negative control: the ≠ scan detects a glyph when one is present", /≠/.test("≠ this is the PHS form"));
  ok("negative control: the one-sentence scan detects a second sentence", /\.\s+[A-Z]/.test("One thing. Another thing."));

  // ── §3 · SCALE AND BOUNDS ───────────────────────────────────────────────────────────────────────
  section("§3 · Scale and bounds");
  for (const { family, spec } of allSpecs) {
    const at = `${family}.${spec.key}`;
    if (!spec.source.trim()) ok(`${at}: declares a source column`, false);
    ok(
      `${at}: bounds and outOfRangeReason are both set or both absent`,
      (spec.bounds === null) === (spec.outOfRangeReason === null),
      spec.bounds === null ? "unbounded" : "bounded",
    );
    if (spec.scale === "money") {
      // Money lines use MONEY_STEADY_PCT — the SAME threshold the quarter and the verdict use. A
      // per-metric band here would be a second answer to "did a rupee line move".
      ok(`${at}: money line carries no per-metric steady band`, spec.steadyBand === null);
      // ★ EVERY money line declares what a NEGATIVE amount on it means. Without this a new cash-flow
      // line silently inherits the quarter's "a loss of" wording — the eighteenth degenerate case.
      ok(`${at}: declares a moneySense`, Boolean(spec.moneySense), spec.moneySense ?? "MISSING");
    } else {
      ok(`${at}: non-money line declares no moneySense`, spec.moneySense === undefined);
    }
    // `comparable: false` and its reason travel together, exactly as bounds and their reason do.
    ok(
      `${at}: comparable:false and comparabilityReason are both set or both absent`,
      (spec.comparable === false) === Boolean(spec.comparabilityReason),
    );
    if (spec.scale !== "money") {
      ok(`${at}: non-money metric has a steady band`, spec.steadyBand !== null && spec.steadyBand > 0);
      ok(`${at}: steady band records what it was fitted on`, Boolean(spec.steadyBandBasis?.trim()));
    }
    // A guard and its reason travel together, and it must read something the family actually reports.
    if (spec.guard) {
      ok(`${at}: cross-field guard carries a reader-facing reason`, Boolean(spec.guard.reason.trim()));
      const familyKeys = new Set(specs(family).map((s) => s.key));
      ok(
        `${at}: cross-field guard only reads metrics this family reports`,
        spec.guard.reads.every((k) => familyKeys.has(k)),
        spec.guard.reads.join(", "),
      );
    }
  }
  // A source column that is 0% populated must never be declared.
  for (const { family, spec } of allSpecs) {
    const col = spec.source.split(".").pop() ?? "";
    if (EMPTY_COLUMNS.includes(col)) {
      ok(`${family}.${spec.key}: does not read a 0%-populated column`, false, col);
    }
  }
  ok("no manifest reads a column measured 0% populated", true, `${EMPTY_COLUMNS.length} empty columns checked`);

  // ★ A shared gloss must carry ONE scale, unless the divergence is DECLARED with its evidence.
  const scaleByKey = new Map<AnnualMetricKey, { family: Family; scale: string }>();
  const seams = new Set<string>();
  for (const { family, spec } of allSpecs) {
    const seen = scaleByKey.get(spec.key);
    if (seen && seen.scale !== spec.scale) {
      seams.add(spec.key);
      ok(
        `${spec.key}: scale divergence is declared in SCALE_SEAMS`,
        Boolean(SCALE_SEAMS[spec.key]?.trim()),
        `${seen.family}=${seen.scale} vs ${family}=${spec.scale}`,
      );
    }
    if (!seen) scaleByKey.set(spec.key, { family, scale: spec.scale });
  }
  // And the reverse: a declaration that no longer describes a real divergence is stale documentation.
  for (const k of Object.keys(SCALE_SEAMS)) {
    ok(`SCALE_SEAMS.${k} describes a divergence that still exists`, seams.has(k), seams.has(k) ? "" : "no divergence found");
  }
  ok("every scale divergence is declared, and every declaration is real", true, `${scaleByKey.size} distinct keys, ${seams.size} seam(s)`);

  // ── §4 · THE ANNUAL SECTION HAS NO DRIVER, AND CANNOT GROW ONE BY ACCIDENT ──────────────────────
  section("§4 · No annual attribution");
  // The spec type has no `driver` field at all; this asserts nobody has added one back as loose data.
  ok(
    "no annual metric carries a driver role (there is no annual bridge — see the manifest header)",
    allSpecs.every(({ spec }) => !("driver" in spec)),
  );

  // ── §5 · THE STAGE-4 RULINGS. These are the undoable ones. ─────────────────────────────────────
  section("§5 · Stage-4 rulings");

  // ★ EVERY RATIO MEASURED AGAINST NET WORTH IS GUARDED. This is the ruling most likely to be
  // reversed by someone adding a new ratio and not knowing why the old ones have a guard.
  const AGAINST_NET_WORTH: AnnualMetricKey[] = ["returnOnEquity", "debtToEquity"];
  for (const { family, spec } of allSpecs) {
    if (!AGAINST_NET_WORTH.includes(spec.key)) continue;
    ok(
      `${family}.${spec.key} is guarded against a non-positive net worth`,
      Boolean(spec.guard) && spec.guard!.reads.includes("netWorth"),
      spec.guard ? "guarded" : "UNGUARDED — a loss divided by negative equity reads as a positive return",
    );
  }
  // Prove the guard actually fires, on the shape of the live IDEA row. A guard nobody has watched fire
  // is a guard nobody knows works.
  const guarded = allSpecs.find(({ spec }) => spec.key === "returnOnEquity" && spec.guard);
  ok(
    "negative control: the guard SUPPRESSES on a negative net worth",
    guarded!.spec.guard!.suppress((k) => (k === "netWorth" ? -35758 : null)),
  );
  ok(
    "negative control: the guard PASSES on a positive net worth",
    !guarded!.spec.guard!.suppress((k) => (k === "netWorth" ? 6217 : null)),
  );
  ok(
    "negative control: the guard SUPPRESSES when net worth is absent (unknown is not positive)",
    guarded!.spec.guard!.suppress(() => null),
  );

  // ★ NO PER-SHARE FIGURE IS EVER COMPARED YEAR ON YEAR. 29.7% of annual pairs sit across a
  // share-count change these tables do not record — see PER_SHARE_NOT_COMPARABLE in the manifest.
  for (const { family, spec } of allSpecs) {
    if (spec.scale !== "perShare") continue;
    ok(
      `${family}.${spec.key} is reported as a level only, never compared year on year`,
      spec.comparable === false,
      spec.comparable === false ? "" : "COMPARED — a bonus issue would read as an earnings collapse",
    );
    ok(
      `${family}.${spec.key} names the share count as the reason`,
      /bonus shares or splits/.test(spec.comparabilityReason ?? ""),
    );
  }

  // ★ book_value_per_share is absent EVERYWHERE, on evidence. The KOTAKBANK row is the reason.
  ok(
    "no manifest declares a per-share book value (the KOTAKBANK face-value parse — see banking.basicEps)",
    !allSpecs.some(({ spec }) => /bookValuePerShare|book_value_per_share/.test(`${spec.key}${spec.source}`)),
  );
  const bankEps = specs("banking").find((s) => s.key === "basicEps");
  ok(
    "banking.basicEps records WHY the per-share book value is absent (so nobody re-adds it)",
    /117,239\.89/.test(bankEps?.note ?? "") && /face_value_share/.test(bankEps?.note ?? ""),
  );

  // ★ total_assets is absent from BOTH insurance families. The column exists, and it is not what its
  // name says — GICRE's equals its net worth while its investments alone are 1.6x larger.
  for (const f of ["life_insurance", "general_insurance"] as const) {
    ok(
      `${f}: does not declare total_assets (the insurer application-of-funds trap)`,
      !specs(f).some((s) => s.key === "totalAssets" || /total_assets/.test(s.source)),
    );
  }
  const lifeAnchor = specs("life_insurance").find((s) => s.key === "policyholdersFunds");
  ok(
    "life_insurance records WHY total_assets is a trap on the insurance tables",
    /application of funds/i.test(lifeAnchor?.note ?? "") && /GICRE/.test(lifeAnchor?.note ?? ""),
  );

  // ★ C31 — the population test is in the header, and the two worked cases stay on file.
  const bankDeposits = specs("banking").find((s) => s.key === "deposits");
  ok(
    "C31 · banking.deposits records that deposits >= advances is NOT asserted despite holding 51/51",
    /NOT ASSERTED/i.test(bankDeposits?.note ?? "") && /different populations/i.test(bankDeposits?.note ?? ""),
  );
  const lifeSurplus = specs("life_insurance").find((s) => s.key === "surplusFromRevenueAccount");
  ok(
    "C31 · life_insurance.surplusFromRevenueAccount records the same-population candidate the DATA refused",
    /C31/.test(lifeSurplus?.note ?? "") && /6 of 8/.test(lifeSurplus?.note ?? ""),
  );

  // ★ The quarterly manifest's claim about the life bridge is CORRECTED here, not silently left.
  const transfer = specs("life_insurance").find((s) => s.key === "transferFromPolicyholders");
  ok(
    "life_insurance.transferFromPolicyholders corrects manifest.ts's claim that the annual lines close the bridge",
    /0 of 8/.test(transfer?.note ?? ""),
  );

  // ── §6 · THE MIRROR OF THE QUARTERLY GATE'S §5 ─────────────────────────────────────────────────
  section("§6 · What the quarterly card promises not to promise, this one delivers");
  // verify-quarter-metrics.ts §5 asserts these are ABSENT from the quarterly catalogue, because each
  // needs an average over a year that a quarter does not have. This is the other half of that sentence:
  // they exist HERE, which is the only place they are computable.
  const MUST_EXIST: AnnualMetricKey[] = ["netInterestMargin", "creditCost", "loanBook", "borrowingsToEquity"];
  for (const k of MUST_EXIST) {
    ok(`annual catalogue carries "${k}" (absent from the quarterly one by ruling 1e)`, used.has(k));
  }

  // ── §7 · C33 · EVERY "BELONGS IN THE PARSER" CLAIM HAS A REGISTER ENTRY ────────────────────────
  // ⚠ A MANIFEST NOTE SAYING "the fix belongs upstream" IS A COMMENT WITH NOWHERE TO GO. Three of
  // them existed, in three files, and nobody working on the parser had any reason to read any of
  // them. This asserts that each such claim resolves to an entry in xbrl/parser-backlog.ts — which is
  // beside the parser, names its own containment, and cannot be quietly dropped.
  section("§7 · The parser backlog (C33)");
  const manifestSrc = [
    readFileSync(resolve(ROOT, "src/insight/quarter-brief/manifest.ts"), "utf8"),
    readFileSync(resolve(ROOT, "src/insight/quarter-brief/annual-manifest.ts"), "utf8"),
  ].join("\n");
  const claims = [...manifestSrc.matchAll(new RegExp(`${BACKLOG_MARKER}[^)]*\\((PB-\\d+)`, "g"))].map((m) => m[1]);
  const ids = new Set(backlogIds());
  ok(
    "every manifest containment names a backlog entry",
    claims.length > 0 && claims.every((id) => ids.has(id)),
    claims.length ? `claims: ${claims.join(", ")}` : "NO claims found — the marker phrase moved",
  );
  ok(
    "every backlog entry is referenced by the manifest containment it describes",
    backlogIds().every((id) => claims.includes(id)),
    `register: ${backlogIds().join(", ")}`,
  );
  for (const e of PARSER_BACKLOG) {
    ok(`${e.id}: names its columns, its origin, its containment and its fix`,
      e.columns.length > 0 && Boolean(e.origin.trim()) && Boolean(e.containedBy.trim()) && Boolean(e.fix.trim()),
      e.columns[0]);
  }

  // ── §8 · THE STORED SCHEMA — NO NUMERIC FIELD, NO `personal` KEY ──────────────────────────────
  section("§8 · The stored schema (Stage 5)");
  const schemaSrc = readFileSync(resolve(ROOT, "src/insight/quarter-brief/schema.ts"), "utf8");
  const ifaces = [...schemaSrc.matchAll(/export interface (Brief\w+) \{([\s\S]*?)\n\}/g)];
  ok("the payload interfaces were found", ifaces.length >= 5, ifaces.map((m) => m[1]).join(", "));
  for (const [, name, body] of ifaces) {
    // ⚠ EVERY NUMBER IS A STRING. A numeric field was never a display string in the fact text, so the
    // verbatim guard would refuse any brief carrying one — correctly. The fix is the schema.
    const numeric = [...body.matchAll(/^\s*(\w+)\??:\s*number/gm)].map((m) => m[1]);
    ok(`${name}: carries no numeric field`, numeric.length === 0, numeric.join(", ") || "all strings");
  }
  const payloadDecl = /export interface BriefPayload \{[\s\S]*?\n\}/.exec(schemaSrc);
  ok(
    "BriefPayload carries no `personal` key (section 3 is per-reader and never stored)",
    Boolean(payloadDecl) && !/\bpersonal\b/.test(payloadDecl![0]),
  );
  ok(
    "schema.ts does not import personal.ts (the stored shape cannot reach a reader's position)",
    !/from "\.\/personal\.js"/.test(schemaSrc),
  );

  console.log(
    `\n${fail === 0 ? `✅ ANNUAL-METRIC GATES PASS — ${ANNUAL_METRIC_KEYS.length} glosses, ${allSpecs.length} manifest slots, ${PARSER_BACKLOG.length} backlog entries, every ruling held` : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main();
