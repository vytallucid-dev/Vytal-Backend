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
import { deriveOthersPct } from "./shareholding-derive.js";

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

// ── Dual-vintage context resolution ────────────────────────────
// SEBI Reg-31 XBRL ships in multiple taxonomy vintages whose category context
// IDs differ. The 2025 layouts (2025-05-31, 2025-10-31) use
// "<Category>_ContextI"; the 2022-09-30 layout drops the underscore + "Context"
// → "<Category>I", and changes a couple of tokens' casing (UTI → Uti). For each
// lookup we try the 2025 primary first, then the 2022 fallback — so a 2025 file
// resolves exactly the same context as before, and a 2022 file now resolves too.
// Object candidates with {pattern:true} preserve the original byCtxPattern
// (substring) matching; bare strings use exact contextRef match.
type CtxCand = string | { ref: string; pattern: true };

const VINTAGE_CTX: Record<string, CtxCand[]> = {
  // 2025 primary (_ContextI)                       → 2022 fallback (I-suffix)
  promoter: [
    "ShareholdingOfPromoterAndPromoterGroup_ContextI",
    "ShareholdingOfPromoterAndPromoterGroupI",
  ],
  public: ["PublicShareholding_ContextI", "PublicShareholdingI"],
  fii: ["InstitutionsForeign_ContextI", "InstitutionsForeignI"],
  dii: ["InstitutionsDomestic_ContextI", "InstitutionsDomesticI"],
  mutualFund: ["MutualFundsOrUTI_ContextI", "MutualFundsOrUtiI"], // UTI → Uti
  insurance: ["InsuranceCompanies_ContextI", "InsuranceCompaniesI"],
  // Banks: 2025 keeps the legacy substring match; the 2022 fallback uses EXACT
  // match so "BanksI" does not also hit "IndianFinancialInstitutionsOrBanksI".
  banks: [{ ref: "Banks_ContextI", pattern: true }, "BanksI"],
  // FinancialInstitutions: substring match intentionally catches
  // "OtherFinancialInstitutions(_ContextI|I)" in both vintages.
  financialInstitutions: [
    { ref: "FinancialInstitutions_ContextI", pattern: true },
    { ref: "FinancialInstitutionsI", pattern: true },
  ],
  nonInstitutions: ["NonInstitutions_ContextI", "NonInstitutionsI"],
  total: ["ShareholdingPattern_ContextI", "ShareholdingPatternI"], // totalShares
  // Employee trust is outside the FII/DII scope but resolved the same way; the
  // 2022 "I" variant is added for consistency. Still defaults to 0 when absent.
  employeeTrust: [
    { ref: "EmployeeTrust_ContextI", pattern: true },
    { ref: "EmployeeBenefitTrust", pattern: true },
    { ref: "EmployeeTrustI", pattern: true },
  ],
};

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

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

  /**
   * Vintage-aware lookup: try each candidate context in order, return the first
   * that resolves. String candidates use exact contextRef match (byCtx); object
   * candidates with {pattern:true} use substring match (byCtxPattern). The
   * vintage map (VINTAGE_CTX) keeps all 2025↔2022 context naming in one place.
   */
  function byCtxV(keywords: string[], cands: CtxCand[]): number | null {
    for (const c of cands) {
      const v =
        typeof c === "string"
          ? byCtx(keywords, c)
          : byCtxPattern(keywords, c.ref);
      if (v !== null) return v;
    }
    return null;
  }

  // ── Extract shareholding percentages (dual-vintage + scale-normalised) ──
  // in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares is the primary
  // percentage element. byCtxV resolves the 2025 (_ContextI) context first, then
  // the 2022 (I-suffix) fallback (see VINTAGE_CTX).
  const PCT = ["shareholding", "percentage", "total", "shares"];

  // Raw category percentages, in whatever unit the filing happens to use.
  const promoterPctRaw = byCtxV(PCT, VINTAGE_CTX.promoter) ?? 0;
  const publicPctRaw = byCtxV(PCT, VINTAGE_CTX.public) ?? 0;
  const employeeTrustRaw = byCtxV(PCT, VINTAGE_CTX.employeeTrust) ?? 0;
  const fiiRaw = byCtxV(PCT, VINTAGE_CTX.fii);
  const diiRaw = byCtxV(PCT, VINTAGE_CTX.dii);
  const mutualFundRaw = byCtxV(PCT, VINTAGE_CTX.mutualFund);
  const insuranceRaw = byCtxV(PCT, VINTAGE_CTX.insurance);
  const banksRaw = byCtxV(PCT, VINTAGE_CTX.banks);
  const fiRaw = byCtxV(PCT, VINTAGE_CTX.financialInstitutions);
  const nonInstRaw = byCtxV(PCT, VINTAGE_CTX.nonInstitutions);

  // ── Scale detection → normalise every category % to PERCENT (0–100) ──
  // The 2025-10-31 taxonomy expresses these as FRACTIONS (0–1); 2025-05-31 and
  // 2022-09-30 use PERCENT (0–100). Promoter + Public partition the register, so
  // their raw sum is ≈1 (fraction filing) or ≈100 (percent filing). We use that
  // to rescale, so fiiPct/diiPct/etc. are single-unit across all vintages and
  // the downstream "percentage delta" signals compare like with like.
  const scaleSum = promoterPctRaw + publicPctRaw;
  const toPct = scaleSum > 0 && scaleSum < 1.5 ? 100 : 1;
  const sc = (v: number | null): number | null => (v == null ? null : v * toPct);

  const promoterPct = promoterPctRaw * toPct;
  const publicPct = publicPctRaw * toPct;
  const employeeTrustPct = employeeTrustRaw * toPct;

  // FII: combined foreign institutions aggregate (Cat I + Cat II)
  const fiiPct = sc(fiiRaw);
  // DII: domestic institutions aggregate (MF + AIF + Insurance + Banks/FIs)
  const diiPct = sc(diiRaw);

  // DII sub-breakdown
  const mutualFundPct = sc(mutualFundRaw);
  const insurancePct = sc(insuranceRaw);

  // Banks & FIs may not have their own context in every filing
  const banksPct = sc(banksRaw);
  const fiPct = sc(fiRaw);
  const banksFisPct =
    banksPct != null || fiPct != null
      ? round4((banksPct ?? 0) + (fiPct ?? 0))
      : null;

  // Others / retail = public − FII − DII (non-institutional residual). The
  // residual is the SINGLE path (deriveOthersPct) shared with the raw-field
  // fill; when FII/DII are absent it returns null and we fall back to the
  // non-institutional XBRL context (not a stored column).
  const nonInstPct = sc(nonInstRaw);
  const othersResidual = deriveOthersPct(publicPct, fiiPct, diiPct);
  const othersPct =
    othersResidual != null
      ? othersResidual
      : nonInstPct != null
        ? round4(nonInstPct)
        : null;
  const retailPct = othersPct;

  // ── Share counts (absolute integers — NOT scaled) ──────────
  const SHARES = ["fullypaid", "equity"];
  const totalShares = byCtxV(SHARES, VINTAGE_CTX.total);
  const promoterShares = byCtxV(SHARES, VINTAGE_CTX.promoter);

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
    promoterPct: round4(promoterPct),
    publicPct: round4(publicPct),
    employeeTrustPct: round4(employeeTrustPct),
    fiiPct: fiiPct != null ? round4(fiiPct) : null,
    diiPct: diiPct != null ? round4(diiPct) : null,
    retailPct: retailPct != null ? round4(retailPct) : null,
    othersPct: othersPct != null ? round4(othersPct) : null,
    mutualFundPct: mutualFundPct != null ? round4(mutualFundPct) : null,
    insurancePct: insurancePct != null ? round4(insurancePct) : null,
    banksFisPct,
    // Pledge percentages are deliberately left un-rescaled (out of the FII/DII
    // scope; their unit convention across vintages is unverified).
    promoterPledgedPct,
    promoterPledgedSharesPct,
    totalShares: totalShares ? Math.round(totalShares) : null,
    promoterShares: promoterShares ? Math.round(promoterShares) : null,
    pledgedShares: pledgedShares ? Math.round(pledgedShares) : 0,
  };
}
