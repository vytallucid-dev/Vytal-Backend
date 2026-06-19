// Parses an NSE PIT V2.0 XBRL filing into one or more disclosure rows.
//
// Structure of a filing (BSE "in-bse-co" taxonomy):
//   - A "MainI" context carries company-level header facts.
//   - Each transaction is a separate "DisclosureN" context (Disclosure1,
//     Disclosure2, …). All per-transaction facts (person, quantities,
//     holdings, dates, mode) reference that context.
//
// We group every fact by its contextRef, then emit one PitXbrlRow per
// transaction context. Header facts fall back to the non-row contexts.

import { XMLParser } from "fast-xml-parser";
import type { PitXbrlRow } from "./insider-types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

// Tags that mark a context as a genuine EQUITY transaction row.
// A filing's XBRL also contains "Derivative" contexts (TypeOfInstrument=
// "Derivative") that carry a person name + dates but no equity quantities —
// those are futures/options contract disclosures, out of scope for the
// equity-centric insider_trades table. Keying on the quantity tags (which only
// equity rows carry) excludes derivative contexts cleanly rather than treating
// them as parse failures.
const ROW_MARKER_TAGS = [
  "SecuritiesAcquiredOrDisposedNumberOfSecurity",
  "SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity", // NSE's spelling
];

type FactMap = Map<string, string>;

/** Walk the parsed XBRL root and bucket every fact value by its contextRef. */
function bucketFactsByContext(root: Record<string, unknown>): Map<string, FactMap> {
  const byContext = new Map<string, FactMap>();

  const record = (ctxRef: string, tag: string, value: string) => {
    let m = byContext.get(ctxRef);
    if (!m) {
      m = new Map();
      byContext.set(ctxRef, m);
    }
    // First non-empty value wins (filings don't repeat a tag within one context).
    if (!m.has(tag) || m.get(tag) === "") m.set(tag, value);
  };

  for (const [tag, raw] of Object.entries(root)) {
    if (tag === "context" || tag === "unit" || tag === "schemaRef" || tag.startsWith("@_")) {
      continue;
    }
    const items = Array.isArray(raw) ? raw : [raw];
    for (const it of items) {
      if (it == null) continue;
      if (typeof it === "object") {
        const ctxRef = (it as Record<string, string>)["@_contextRef"];
        if (!ctxRef) continue;
        const text = (it as Record<string, unknown>)["#text"];
        record(ctxRef, tag, text == null ? "" : String(text));
      }
      // primitives (no contextRef) are not disclosure facts — ignore
    }
  }

  return byContext;
}

function ctxOrder(id: string): number {
  const m = id.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

export function parseFilingXbrlRows(xml: string): PitXbrlRow[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc["xbrl"] ?? Object.values(doc)[0]) as Record<string, unknown>;
  if (!root || typeof root !== "object") return [];

  const byContext = bucketFactsByContext(root);

  // Contexts that carry an actual transaction row.
  const rowCtxIds = [...byContext.keys()].filter((id) => {
    const f = byContext.get(id)!;
    return ROW_MARKER_TAGS.some((t) => f.has(t));
  });
  if (rowCtxIds.length === 0) return [];

  // Header fallback = union of all non-row contexts (e.g. MainI).
  const header: FactMap = new Map();
  for (const [id, f] of byContext) {
    if (rowCtxIds.includes(id)) continue;
    for (const [k, v] of f) if (!header.has(k)) header.set(k, v);
  }

  rowCtxIds.sort((a, b) => ctxOrder(a) - ctxOrder(b));

  return rowCtxIds.map((id) => {
    const f = byContext.get(id)!;
    const get = (tag: string): string | null => {
      const v = f.get(tag) ?? header.get(tag);
      return v != null && v !== "" ? v : null;
    };
    // Remarks can appear under a few tag names; grab the first present.
    const remarks =
      get("Remark") ??
      get("Remarks") ??
      get("RevisionRemark") ??
      get("ReasonForRevisionOfDisclosure");

    return {
      personName: get("NameOfThePerson"),
      personCategory: get("CategoryOfPerson"),
      securityType: get("TypeOfInstrument"),
      transactionType: get("SecuritiesAcquiredOrDisposedTransactionType"),
      acquisitionMode: get("ModeOfAcquisitionOrDisposal"),
      tradeFromDate: get("DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate"),
      tradeToDate: get("DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate"),
      securitiesPre: get("SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity"),
      securitiesTraded: get("SecuritiesAcquiredOrDisposedNumberOfSecurity"),
      securitiesPost: get("SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity"),
      holdingPctPre: get("SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding"),
      holdingPctPost: get("SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding"),
      valueOfSecurity: get("SecuritiesAcquiredOrDisposedValueOfSecurity"),
      remarks,
    };
  });
}
