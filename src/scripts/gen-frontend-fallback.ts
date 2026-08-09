// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FALLBACK GENERATOR — reads the backend catalogue, emits the frontend's bundled fallback copy.
//
// ── ⚠ WHY THE FALLBACK IS GENERATED AND NOT DELETED ───────────────────────────────────────────────
// The original plan was to delete the frontend constants once the endpoint held. That would make
// /api/v1/catalogue a SINGLE POINT OF FAILURE for every finding name, description and boundary in the
// product — and the failure mode is title-only cards, which reads as a styling glitch rather than an
// outage. Nobody reports a styling glitch. It would sit there.
//
// But KEEPING them hand-maintained restores exactly the drift this whole build exists to kill: two
// homes for one sentence, and the wrong one ships.
//
// So: neither. The constants stay, and they are MACHINE-GENERATED from the catalogue. There is still
// one authoring home; the frontend copy is a build artefact of it, and CI fails if it is stale
// (verify-fallback-fresh.ts). A fallback that cannot drift is not a second source of truth — it is a
// cached copy of the first one.
//
// ── WHAT THIS GENERATES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────
//   GENERATED   every STATIC string: names, descriptions, families, concerns, resolved boundaries,
//               the family + lens boundary maps, and the fourteen three-lens faces.
//
//   NOT         the VERDICT RENDERERS. They are (evidence) => string FUNCTIONS, not constants;
//               emitting function bodies from a module would be a source-to-source transform, which
//               is a far more fragile thing than a JSON dump. They stay a mirrored module and are
//               proved character-identical against the backend by the verdict-identity harness.
//
//   NOT         the Family-N verdict TEMPLATES, for the same reason. `lib/n-family-copy.ts` keeps
//               them and nothing else; its three STATIC fields are generated here now.
//
//   npx tsx src/scripts/gen-frontend-fallback.ts            # write
//   npx tsx src/scripts/gen-frontend-fallback.ts --check    # exit 1 if the committed file differs
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import {
  CATALOGUE_DOCUMENT,
} from "../catalogue/serialise.js";
import {
  FAMILY_DOESNT_MEAN,
  LENS_DOESNT_MEAN,
  LENS_FACES,
  LENS_FACE_IDS,
  STOCK_FINDINGS,
  STOCK_FINDING_KEYS,
} from "../catalogue/index.js";

/**
 * WHERE THE FRONTEND LIVES. Defaults to the sibling checkout — the layout both of the operator's
 * machines use — and is overridable so a CI runner that lays the repos out differently can say so
 * rather than silently skipping. It NEVER skips: an unresolvable path is a failure, because a
 * staleness gate that quietly does nothing is worse than no gate at all.
 */
const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "../Vytal-Frontend");
const OUT = resolve(FRONTEND_DIR, "lib/findings/generated/copy.generated.ts");

/** JSON.stringify with stable key order, so a reordering in the source can never produce a diff. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  }, 2);
}

function build(): string {
  // ── the finding descriptions map, in the frontend's own shape ──
  const descriptions: Record<string, { description: string; family: string; concern: string; doesntMean: string }> = {};
  const names: Record<string, string> = {};
  for (const key of [...STOCK_FINDING_KEYS].sort()) {
    const e = STOCK_FINDINGS[key];
    names[key] = e.name;
    descriptions[key] = {
      description: e.description,
      family: e.family,
      concern: e.concern,
      // The catalogue already RESOLVED this (own line → family line). Emitting the resolved value
      // means the frontend resolver has nothing left to resolve and cannot resolve it differently.
      doesntMean: e.doesntMean,
    };
  }

  // ── the three-lens faces, in the frontend's LensCatalogFace shape ──
  const lm: Record<string, unknown> = {};
  const lp: Record<string, unknown> = {};
  for (const id of LENS_FACE_IDS) {
    const f = LENS_FACES[id];
    const face = { id: f.key, label: f.name, tone: f.tone, fieldVerdict: f.fieldVerdict, read: f.description, doesntMean: f.doesntMean };
    if (id.startsWith("LM")) lm[id] = face;
    else lp[id] = face;
  }

  return `// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ MACHINE-GENERATED. DO NOT EDIT. ⚠⚠
//
// Generated from the backend copy catalogue by Vytal-Backend/src/scripts/gen-frontend-fallback.ts.
// Every string below is a copy of a string authored in src/catalogue/ — that is the ONE home. Editing
// this file edits a cache, not a source: the next regeneration silently reverts you, and CI fails in
// the meantime (verify-fallback-fresh.ts).
//
// ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────────────────────────────────
// It is the BUNDLED FALLBACK. When GET /api/v1/catalogue is cold, slow or down, the four resolvers
// (findingName / findingDescription / doesntMean / lensCatalogFace) read these constants instead, so
// a reader sees the complete copy they always saw rather than title-only cards. The catalogue endpoint
// is therefore not a single point of failure for the product's vocabulary.
//
// ── TO CHANGE ANY STRING HERE ─────────────────────────────────────────────────────────────────────
//   1. edit it in Vytal-Backend/src/catalogue/
//   2. npx tsx src/scripts/gen-frontend-fallback.ts
//   3. commit BOTH repos
//
// catalogue version at generation: ${CATALOGUE_DOCUMENT.version}
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The catalogue document version these constants were generated from. Compared against the SERVED
 *  version at runtime — a mismatch means a deploy shipped a frontend built against different copy,
 *  which the provider reports loudly rather than rendering two vocabularies at once. */
export const GENERATED_FROM_VERSION = ${JSON.stringify(CATALOGUE_DOCUMENT.version)};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE CLOSED KEY VOCABULARY, AS A TYPE — the frontend mirror of the backend's \`StockFindingKey\`.
//
// ── WHY A TYPE AND NOT JUST THE MAPS ABOVE ────────────────────────────────────────────────────────
// The frontend does not only LOOK UP keys, it NAMES them: prefix tests in classify.ts, one renderer
// per key in verdicts.ts, hand-written key lists on screener and briefing surfaces. Every one of
// those was a bare \`string\`, so retiring a rule backend-side left the frontend still naming it —
// and a name that matches nothing fails SILENTLY. It does not throw, it just never fires: a mask
// that never masks, a caveat that never appears, a screener row nobody can select. Exactly the
// class that shipped \`divergence_C1_price_ahead\` (retired in the C/G rebuild) as a live constant in
// the hot-pond mask, where it sat unreachable and unnoticed.
//
// Annotating those references \`StockFindingKey\` converts that silence into a compile error the next
// time this file regenerates without the key. Retirement becomes a build break in the repo that
// still names it — which is the only moment anyone is actually looking.
//
// ⚠ THIS IS THE VOCABULARY, NOT THE LOOKUP TYPE. The resolvers keep taking \`string\`: they must stay
// callable with keys that are legitimately outside this union — the runtime-composed \`lens_*\` keys
// (unbounded by construction, see catalogue/lens-faces.ts) and any key from a backend newer than
// this bundle. Narrowing the lookups would trade a silent miss for a false compile error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export type StockFindingKey =
${[...STOCK_FINDING_KEYS].sort().map((k) => `  | ${JSON.stringify(k)}`).join("\n")};

/** key → display name. */
export const GEN_FINDING_NAMES: Record<string, string> = ${stable(names)};

/** key → { description, family, concern, doesntMean }. \`doesntMean\` is already RESOLVED. */
export const GEN_FINDING_DESCRIPTIONS: Record<
  string,
  { description: string; family: string; concern: string; doesntMean: string }
> = ${stable(descriptions)};

/** Family letter → the mandatory interpretive boundary. Total over A–I + N. */
export const GEN_FAMILY_DOESNT_MEAN: Record<string, string> = ${stable({ ...FAMILY_DOESNT_MEAN })};

/** Lowercase escalating face id → the lens boundary. */
export const GEN_LENS_DOESNT_MEAN: Record<string, string> = ${stable({ ...LENS_DOESNT_MEAN })};

/** Metric-level three-lens faces (LM1–LM8). */
export const GEN_LM_CATALOG = ${stable(lm)} as const;

/** Pillar-level three-lens faces (LP1–LP6). */
export const GEN_LP_CATALOG = ${stable(lp)} as const;
`;
}

function main() {
  const check = process.argv.includes("--check");
  const next = build();

  if (!existsSync(FRONTEND_DIR)) {
    console.error(`❌ frontend not found at ${FRONTEND_DIR}`);
    console.error(`   Set VYTAL_FRONTEND_DIR to the checkout path, or place the repos side by side.`);
    console.error(`   This gate FAILS rather than skips — a staleness check that quietly does nothing`);
    console.error(`   is how the fallback drifts back to being a second source of truth.`);
    process.exit(1);
  }

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current === next) {
      console.log(`✅ frontend fallback is FRESH — ${OUT}`);
      console.log(`   catalogue version ${CATALOGUE_DOCUMENT.version}`);
      process.exit(0);
    }
    console.error(`❌ frontend fallback is STALE — ${OUT}`);
    console.error(`   The committed constants no longer match the catalogue they are generated from.`);
    console.error(`   Fix: npx tsx src/scripts/gen-frontend-fallback.ts   (then commit both repos)`);
    // Show the first difference so the failure is diagnosable from the log alone.
    const a = current.split("\n");
    const b = next.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`\n   first difference at line ${i + 1}:`);
        console.error(`     committed: ${(a[i] ?? "(missing)").slice(0, 150)}`);
        console.error(`     generated: ${(b[i] ?? "(missing)").slice(0, 150)}`);
        break;
      }
    }
    process.exit(1);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, next, "utf8");
  console.log(`✅ wrote ${OUT}`);
  console.log(`   ${STOCK_FINDING_KEYS.length} findings · ${LENS_FACE_IDS.length} lens faces · catalogue version ${CATALOGUE_DOCUMENT.version}`);
}

main();
