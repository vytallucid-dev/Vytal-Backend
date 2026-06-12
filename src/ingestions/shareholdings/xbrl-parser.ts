// ─────────────────────────────────────────────────────────────────────────────
// Parses BSE/NSE XBRL shareholding pattern XML files (SEBI LODR Regulation 31).
//
// The XBRL format is FLAT — all facts are direct children of the root
// <xbrli:xbrl> element, each carrying a contextRef attribute that links to an
// <xbrli:context> definition identifying the shareholder category.
//
// Context naming convention (BSE XBRL taxonomy):
//   {CategoryMember}_ContextI  — aggregate % for a shareholder category
//   {Category}_Context{N}      — individual top-holder row within a category
//
// Strategy:
//   1. Parse contexts → build contextId → member-name map
//   2. Collect all numeric facts into factMap[elementName] = [{contextRef, value}]
//   3. Look up aggregate values using the known category context IDs
// ─────────────────────────────────────────────────────────────────────────────

import { XMLParser } from "fast-xml-parser";

// ── Parsed result ──────────────────────────────────────────────

export interface ParsedShareholding {
  // Top-level (always present)
  promoterPct: number;
  publicPct: number;
  employeeTrustPct: number;

  // Public breakdown
  fiiPct: number | null; // Foreign Portfolio Investors (Cat I + II)
  diiPct: number | null; // MF + Insurance + Banks + FIs combined
  retailPct: number | null; // Calculated: public - fii - dii
  othersPct: number | null; // NBFCs, trusts, HNIs, NRIs, etc.

  // DII sub-breakdown
  mutualFundPct: number | null;
  insurancePct: number | null;
  banksFisPct: number | null; // Banks + Financial Institutions

  // Pledging (from Table II — promoter encumbrance)
  promoterPledgedPct: number | null; // % of promoter shares pledged
  promoterPledgedSharesPct: number | null; // % of total shares pledged by promoters

  // Share counts (for validation)
  totalShares: number | null;
  promoterShares: number | null;
  pledgedShares: number | null;
}

// ── XML Parser setup ──────────────────────────────────────────
// isArray: () => true is critical for XBRL — the same element name (e.g.
// ShareholdingAsAPercentageOfTotalNumberOfShares) appears dozens of times
// with different contextRef values. Without this flag, fast-xml-parser keeps
// only the last occurrence, losing all earlier data.

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  textNodeName: "#text",
  isArray: () => true,
});

// ── Helpers ───────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/** Strip XML namespace prefix: "ns:TagName" → "TagName" */
function stripNs(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

type Fact = { contextRef: string; value: number | null };

// ── Main parser ────────────────────────────────────────────────

export function parseXbrlShareholding(xmlText: string): ParsedShareholding {
  let parsed: Record<string, unknown>;

  try {
    parsed = xmlParser.parse(xmlText) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`XBRL parse failed: ${(e as Error).message}`);
  }

  // ── Navigate to xbrl root ──────────────────────────────────
  // With isArray:()=>true, every value is an array; root keys are length-1 arrays.
  let xbrl: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (key.toLowerCase().includes("xbrl")) {
      xbrl = ((val as unknown[])[0] ?? {}) as Record<string, unknown>;
      break;
    }
  }

  // ── Build contextId → member-name map ─────────────────────
  // Each <xbrli:context> has an optional <xbrli:scenario> with an
  // <xbrldi:explicitMember> that names the shareholder category dimension.
  const ctxMap: Record<string, string> = {};
  const ctxElements = xbrl["xbrli:context"] as
    | Record<string, unknown>[]
    | undefined;
  for (const ctx of ctxElements ?? []) {
    const id = ctx["@_id"] as string;
    if (!id) continue;

    // Navigate: context → scenario (array[0]) → explicitMember (array)
    for (const [ck, cv] of Object.entries(ctx)) {
      if (!stripNs(ck).toLowerCase().includes("scenario")) continue;
      const scenario = (cv as Record<string, unknown>[])[0];
      if (!scenario) continue;

      for (const [sk, sv] of Object.entries(scenario)) {
        if (!stripNs(sk).toLowerCase().includes("explicitmember")) continue;
        const memberArr = sv as Record<string, unknown>[];
        const names = memberArr
          .map(
            (m) =>
              String((m["#text"] ?? m) || "")
                .split(":")
                .pop() || "",
          )
          .filter(Boolean);
        if (names.length > 0) ctxMap[id] = names.join("|");
      }
    }
  }

  // ── Build fact map ─────────────────────────────────────────
  // factMap: lowercased-stripped-element-name → [{contextRef, value}]
  // Skips structural XBRL (xbrli:*) and linkbase (link:*) elements.
  const factMap: Record<string, Fact[]> = {};

  for (const [rawKey, val] of Object.entries(xbrl)) {
    if (
      rawKey.startsWith("@_") ||
      rawKey.startsWith("xbrli:") ||
      rawKey.startsWith("link:")
    )
      continue;
    const key = stripNs(rawKey).toLowerCase();
    const entries = val as unknown[];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const contextRef = String(obj["@_contextRef"] ?? "");
      if (!contextRef) continue;
      const rawVal = obj["#text"] ?? null;
      if (!factMap[key]) factMap[key] = [];
      factMap[key].push({ contextRef, value: safeNum(rawVal) });
    }
  }

  // ── Lookup helpers ─────────────────────────────────────────

  /** Value where element name contains ALL keywords AND contextRef exactly matches */
  function byCtx(keywords: string[], ctxRef: string): number | null {
    for (const [key, facts] of Object.entries(factMap)) {
      if (!keywords.every((kw) => key.includes(kw.toLowerCase()))) continue;
      const fact = facts.find((f) => String(f.contextRef) === ctxRef);
      if (fact) return fact.value;
    }
    return null;
  }

  /** Value where element name contains ALL keywords AND contextRef contains pattern */
  function byCtxPattern(keywords: string[], ctxPattern: string): number | null {
    const pat = ctxPattern.toLowerCase();
    for (const [key, facts] of Object.entries(factMap)) {
      if (!keywords.every((kw) => key.includes(kw.toLowerCase()))) continue;
      const fact = facts.find((f) =>
        String(f.contextRef).toLowerCase().includes(pat),
      );
      if (fact) return fact.value;
    }
    return null;
  }

  // ── Extract shareholding percentages ───────────────────────
  // in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares is the primary
  // percentage element. Category aggregates use context IDs ending in _ContextI.
  const PCT = ["shareholding", "percentage", "total", "shares"];

  const promoterPct =
    byCtx(PCT, "ShareholdingOfPromoterAndPromoterGroup_ContextI") ?? 0;
  const publicPct = byCtx(PCT, "PublicShareholding_ContextI") ?? 0;

  // Employee benefit trust — present only in some filings
  const employeeTrustPct =
    byCtxPattern(PCT, "EmployeeTrust_ContextI") ??
    byCtxPattern(PCT, "EmployeeBenefitTrust") ??
    0;

  // FII: use combined foreign institutions aggregate (Cat I + Cat II)
  const fiiPct = byCtx(PCT, "InstitutionsForeign_ContextI");

  // DII: domestic institutions aggregate (MF + AIF + Insurance + Banks/FIs)
  const diiPct = byCtx(PCT, "InstitutionsDomestic_ContextI");

  // DII sub-breakdown
  const mutualFundPct = byCtx(PCT, "MutualFundsOrUTI_ContextI");
  const insurancePct = byCtx(PCT, "InsuranceCompanies_ContextI");

  // Banks & FIs may not have their own context in every filing
  const banksPct = byCtxPattern(PCT, "Banks_ContextI");
  const fiPct = byCtxPattern(PCT, "FinancialInstitutions_ContextI");
  const banksFisPct =
    banksPct != null || fiPct != null
      ? Math.round(((banksPct ?? 0) + (fiPct ?? 0)) * 10000) / 10000
      : null;

  // Others / retail = public − FII − DII (non-institutional residual)
  const nonInstPct = byCtx(PCT, "NonInstitutions_ContextI");
  const othersPct =
    fiiPct != null && diiPct != null
      ? Math.max(0, Math.round((publicPct - fiiPct - diiPct) * 10000) / 10000)
      : nonInstPct != null
        ? Math.round(nonInstPct * 10000) / 10000
        : null;
  const retailPct = othersPct;

  // ── Share counts ───────────────────────────────────────────
  const SHARES = ["fullypaid", "equity"];
  const totalShares = byCtx(SHARES, "ShareholdingPattern_ContextI");
  const promoterShares = byCtx(
    SHARES,
    "ShareholdingOfPromoterAndPromoterGroup_ContextI",
  );

  // ── Pledge / encumbrance ───────────────────────────────────
  // When no shares are pledged, these elements may be absent or zero.
  let promoterPledgedPct: number | null = null;
  let promoterPledgedSharesPct: number | null = null;
  let pledgedShares: number | null = null;

  for (const [key, facts] of Object.entries(factMap)) {
    if (!key.includes("pledge") && !key.includes("encumb")) continue;

    for (const fact of facts) {
      if (fact.value == null) continue; // null only — allow 0 through

      if (key.includes("percent")) {
        if (key.includes("held") || key.includes("promoter")) {
          // % of promoter's own shares that are pledged
          if (promoterPledgedPct === null || fact.value > promoterPledgedPct) {
            promoterPledgedPct = fact.value;
          }
        } else if (key.includes("total")) {
          // % of total company shares pledged by promoters
          if (
            promoterPledgedSharesPct === null ||
            fact.value > promoterPledgedSharesPct
          ) {
            promoterPledgedSharesPct = fact.value;
          }
        }
      } else if (key.includes("noshare") || key.includes("numberofshare")) {
        if (pledgedShares === null) pledgedShares = fact.value;
      }
    }
  }

  // Default to 0 when elements are absent — absence means no pledging declared
  // This is the correct interpretation per SEBI LODR filing norms.
  promoterPledgedPct = promoterPledgedPct ?? 0;
  promoterPledgedSharesPct = promoterPledgedSharesPct ?? 0;
  pledgedShares = pledgedShares ?? 0;

  return {
    promoterPct: Math.round(promoterPct * 10000) / 10000,
    publicPct: Math.round(publicPct * 10000) / 10000,
    employeeTrustPct: Math.round(employeeTrustPct * 10000) / 10000,
    fiiPct,
    diiPct,
    retailPct: retailPct != null ? Math.round(retailPct * 10000) / 10000 : null,
    othersPct: othersPct != null ? Math.round(othersPct * 10000) / 10000 : null,
    mutualFundPct,
    insurancePct,
    banksFisPct,
    promoterPledgedPct,
    promoterPledgedSharesPct,
    totalShares: totalShares ? Math.round(totalShares) : null,
    promoterShares: promoterShares ? Math.round(promoterShares) : null,
    pledgedShares: pledgedShares ? Math.round(pledgedShares) : 0,
  };
}
