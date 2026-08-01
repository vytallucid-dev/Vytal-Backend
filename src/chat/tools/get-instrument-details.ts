// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getInstrumentDetails — identity for ANY instrument class, not just equities.
//
// Reuses resolveInstrument (portfolio/resolve-instrument.ts) — the same resolver the transaction path
// uses, so chat and the ledger agree on what an ISIN/ticker means.
//
// ⚠ THE COVERAGE IS DELIBERATELY UNEVEN, AND THE OUTPUT SAYS SO. Mutual funds and ETFs have a rich
// analytics fold behind them (getFundAnalytics). Bonds, G-Secs, SGBs, REITs and InvITs have IDENTITY plus
// whatever `attributes` the ingestion carried — and NOTHING richer, because the rich reads for those
// classes are admin-only ingestion surfaces, not public data. Rendering an empty section without saying
// why would read as "this bond has no coupon"; the tool states the gap in words instead.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { resolveInstrument, InstrumentResolveError } from "../../portfolio/resolve-instrument.js";
import type { ResolvedInstrument } from "../../portfolio/resolve-instrument.js";
import { kvLine, NA } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  identifier?: unknown;
}

const DESCRIPTION =
  "Look up ANY tradeable instrument by ticker or ISIN — not just shares, but also mutual funds, ETFs, " +
  "corporate bonds, government securities, sovereign gold bonds, REITs and InvITs. Returns what the " +
  "instrument IS: its name, ISIN, asset class, and whatever instrument-specific attributes were ingested " +
  "(a bond's coupon, for example). Call this when the reader mentions a holding that is not an ordinary " +
  "share, or when you need to know which asset class an unfamiliar code belongs to. Depth varies honestly " +
  "by class: funds and ETFs have full analytics behind them (call getFundAnalytics next), while bonds, " +
  "G-Secs, SGBs, REITs and InvITs carry identity and basic attributes ONLY — Vytal has no deeper data for " +
  "them, so do not imply otherwise. An ambiguous ticker returns the candidate ISINs to choose between.";

const PARAMETERS = {
  type: "object",
  properties: {
    identifier: { type: "string", description: 'A ticker symbol or a 12-character ISIN, e.g. "NIFTYBEES" or "INE002A01018".' },
  },
  required: ["identifier"],
  additionalProperties: false,
} as const;

/** Classes for which Vytal holds nothing beyond identity + attributes (+ a stored price/NAV series). */
const THIN_CLASSES = new Set(["bond", "gsec", "sgb", "reit", "invit"]);

// ═══ ★ THE ATTRIBUTES BLOB IS ALLOW-LISTED, NEVER DUMPED. ═══════════════════════════════════════════
//
// ⚠ WHAT THIS REPLACED, AND WHY IT WAS THE SAME DEFECT AS THE ₹57 DIVIDEND. This tool used to emit
// `JSON.stringify(attributes)` verbatim — 741 instruments carry a non-empty blob, and it reached the
// model looking like this:
//
//     {"series":"IV","distributionYield":0.08490833333333332,"distributionRecords":4, …}
//
// Three separate violations in one line. (1) These are QUANTITIES arriving in no labelled field, so the
// model reads them out of a raw structure it was never taught to interpret. (2) `distributionYield` is a
// FRACTION and nothing in the blob says so — 0.0849 is 8.49%, but a model seeing a bare `0.0849` beside
// the word "yield" will as readily print "0.08%". (3) 17 significant digits is exactly the false
// precision CONVERSATIONAL_PRECISION exists to forbid, handed over as data rather than prose.
//
// ★ THE UNIT WAS RESOLVED FROM THE INGESTION PATH, NOT GUESSED. ingestions/reits/ingest-reits.ts:675 is
// `const yieldPct = ttm.perUnitTtm / r.close;` — a ratio, despite the variable's name — and that file's
// own error reporter renders it as `${(yieldPct * 100).toFixed(2)}%`. So it is a fraction and ×100 is
// correct. ⚠ THE RULE THIS SETS: a key whose unit cannot be established from the ingestion that writes it
// does NOT get rendered. An unlabelled ratio is worse than an omission, because an omission cannot be
// misread as a percentage.
//
// Anything not named below is dropped silently and the count of dropped keys is stated, so the model
// knows the blob was filtered rather than empty.
type AttrKind = "text" | "fraction_pct" | "pct" | "money" | "count" | "date";
const ATTR_ALLOW: Record<string, { label: string; kind: AttrKind }> = {
  // ── REIT / InvIT distributions (ingest-reits.ts §writeAttributes) ──
  distributionYield: { label: "Trailing-12m distribution yield", kind: "fraction_pct" },
  distributionPerUnitTtm: { label: "Distributions per unit, trailing 12m", kind: "money" },
  distributionRecords: { label: "Distributions counted in that window", kind: "count" },
  distributionWindowFrom: { label: "Distribution window from", kind: "date" },
  distributionWindowTo: { label: "Distribution window to", kind: "date" },
  distributionYieldNullReason: { label: "Why no distribution yield", kind: "text" },
  // ── SGB / G-Sec / bond identity + terms ──
  coupon: { label: "Coupon", kind: "pct" },
  series: { label: "Series", kind: "text" },
  tranche: { label: "Tranche", kind: "text" },
  maturityDate: { label: "Maturity date", kind: "date" },
  maturityYear: { label: "Maturity year", kind: "text" },
  issuerState: { label: "Issuer state", kind: "text" },
  govtType: { label: "Government instrument type", kind: "text" },
};

/** Render one allow-listed attribute, or null when the value is absent. Units are made explicit here —
 *  that is the whole job. `tenorDays` and friends are absent from the allow-list deliberately: they were
 *  null on every row inspected, and a key whose meaning is unconfirmed is not rendered at all. */
function attrLine(key: string, value: unknown): string | null {
  const spec = ATTR_ALLOW[key];
  if (!spec || value === null || value === undefined || value === "") return null;
  switch (spec.kind) {
    case "fraction_pct":
      return typeof value === "number" ? kvLine(spec.label, `${(value * 100).toFixed(2)}%`) : null;
    case "pct":
      return typeof value === "number" ? kvLine(spec.label, `${Number(value.toFixed(2))}%`) : null;
    case "money":
      return typeof value === "number" ? kvLine(spec.label, `₹${Number(value.toFixed(2))}`) : null;
    case "count":
      return typeof value === "number" ? kvLine(spec.label, String(Math.round(value))) : null;
    default:
      return kvLine(spec.label, String(value));
  }
}

function render(inst: ResolvedInstrument, schemeCode: string | null): string {
  const L: string[] = [`=== VYTAL INSTRUMENT: ${inst.symbol ?? inst.isin} (${inst.name}) ===`];
  L.push(kvLine("Name", inst.name));
  L.push(kvLine("Asset class", inst.assetClass));
  L.push(kvLine("ISIN", inst.isin));
  L.push(kvLine("Exchange ticker", inst.symbol)); // a mutual fund legitimately has none → "not available"
  L.push(kvLine("Is an equity Vytal scores", inst.stockId ? "yes — call getStockFacts with its ticker for the health read" : "no"));

  const attrs = inst.attributes;
  const entries = attrs && typeof attrs === "object" && !Array.isArray(attrs) ? Object.entries(attrs as Record<string, unknown>) : [];
  const lines = entries.map(([k, v]) => attrLine(k, v)).filter((s): s is string => s !== null);
  const dropped = entries.filter(([k, v]) => v !== null && v !== undefined && v !== "" && !ATTR_ALLOW[k]).length;
  if (lines.length) {
    L.push("Instrument attributes (as ingested):");
    for (const l of lines) L.push(`  ${l}`);
    // ⚠ SAY THAT THE BLOB WAS FILTERED. Silence here would read as "there is nothing else", which is a
    //   claim; "N further fields are not shown" is the truth and costs one line.
    if (dropped > 0) L.push(`  (${dropped} further ingested field${dropped === 1 ? "" : "s"} not shown — Vytal does not publish ${dropped === 1 ? "it" : "them"} for this instrument class.)`);
  } else {
    L.push(kvLine("Instrument attributes", null));
  }

  if (inst.assetClass === "mutual_fund" || inst.assetClass === "etf") {
    L.push(
      kvLine(
        "Fund analytics available",
        schemeCode ? `yes — call getFundAnalytics with schemeCode ${schemeCode}` : "no AMFI scheme code is on file for this instrument",
      ),
    );
  } else if (THIN_CLASSES.has(inst.assetClass)) {
    L.push(
      `Depth note: for ${inst.assetClass} instruments Vytal stores identity and the attributes above ONLY — there is ` +
        `no health score, no fundamentals, and no analytics fold. Anything beyond the fields listed here is ${NA}. ` +
        `Say so plainly rather than implying richer data exists.`,
    );
  }
  return L.join("\n");
}

export const getInstrumentDetailsTool: ChatTool<Args> = {
  name: "getInstrumentDetails",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const identifier = typeof args.identifier === "string" ? args.identifier.trim() : "";
    if (!identifier) return { ok: false, error: "getInstrumentDetails requires a non-empty 'identifier' (a ticker or an ISIN)." };
    try {
      const inst = await resolveInstrument(prisma, identifier);
      // The AMFI scheme code is what getFundAnalytics keys on — surface it so the model can chain.
      let schemeCode: string | null = null;
      if (inst.assetClass === "mutual_fund" || inst.assetClass === "etf") {
        const row = await prisma.instrument.findUnique({ where: { id: inst.id }, select: { amfiSchemeCode: true } });
        schemeCode = row?.amfiSchemeCode ?? null;
      }
      return { ok: true, content: render(inst, schemeCode) };
    } catch (e) {
      if (e instanceof InstrumentResolveError) {
        // An honest, MODELLED miss — not a crash. Ambiguity hands back the candidates to choose between.
        if (e.code === "ambiguous_symbol" && e.candidates?.length) {
          const list = e.candidates.map((c) => `${c.isin} — ${c.name} (${c.assetClass})`).join("; ");
          return { ok: true, content: `AMBIGUOUS: "${identifier}" matches more than one instrument. Ask the reader which they mean, using these candidates: ${list}. Do not pick one for them.` };
        }
        return { ok: true, content: `NOT FOUND: "${identifier}" does not match any instrument in Vytal's catalogue. This is a coverage boundary, not a claim the instrument does not exist — say so plainly and state no figures for it.` };
      }
      return { ok: false, error: `Could not look up "${identifier}": ${(e as Error).message}` };
    }
  },
};
