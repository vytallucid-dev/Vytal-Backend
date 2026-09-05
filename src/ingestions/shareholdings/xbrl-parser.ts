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
  /** Promoter group's TOTAL holding (incl. depository receipts) — the pledge denominator. */
  promoterTotalShares: number | null;

  /**
   * PROVENANCE, not data: true when fiiPct/diiPct were DERIVED from the
   * 2020-09-30 vintage's flat Institutions block (InstitutionsI minus the
   * foreign sub-lines) rather than read from a direct InstitutionsForeign/
   * InstitutionsDomestic context. Lets a backfill separate "derived" rows from
   * "directly disclosed" ones without re-fetching the XML.
   */
  legacyInstitutionsDerived: boolean;
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

type Fact = { contextRef: string; value: number | null; raw: string };

// ── Multi-vintage context resolution ───────────────────────────
// SEBI Reg-31 XBRL ships in multiple taxonomy vintages whose category context
// IDs differ. The 2025 layouts (2025-05-31, 2025-10-31) use
// "<Category>_ContextI"; the 2022-09-30 layout drops the underscore + "Context"
// → "<Category>I", and changes a couple of tokens' casing (UTI → Uti). For each
// lookup we try the 2025 primary first, then the 2022 fallback — so a 2025 file
// resolves exactly the same context as before, and a 2022 file now resolves too.
// Object candidates with {pattern:true} preserve the original byCtxPattern
// (substring) matching; bare strings use exact contextRef match.
//
// ── THIRD VINTAGE (shp/2020-09-30) — the FII/DII null cause ──
// Filings up to and including 2022-06-30 use a FAMILY of older taxonomies --
// shp/2018-03-31, shp/2019-06-30 and shp/2020-09-30 -- which share one
// identical layout (verified: 7/7 domestic + 2/2 foreign sub-lines present in
// every sampled file of all three, block closing to <= 0.01pp). None of them
// splits the Institutions block into domestic/foreign at all: there is no
// InstitutionsDomesticI and no InstitutionsForeignI. Instead the block is ONE
// flat list under a single "InstitutionsI" total, e.g. TCS 2022-06-30:
//
//   MutualFundsOrUtiI                     =  3.38
//   VentureCapitalFundsI                  =  0
//   AlternativeInvestmentFundsI           =  0.07
//   ForeignVentureCapitalInvestorsI       =  0      ← FOREIGN
//   InstitutionsForeignPortfolioInvestorI = 13.50   ← FOREIGN
//   FinancialInstitutionOrBanksI          =  0.03
//   InsuranceCompaniesI                   =  4.88
//   ProvidentFundsOrPensionFundsI         =  0
//   OtherInstitutionsI                    =  0
//   ──────────────────────────────────────────────
//   InstitutionsI                         = 21.86
//
// So FII = the two foreign sub-lines and DII = InstitutionsI − FII. That
// subtraction is self-proving: 21.86 − 13.50 = 8.36, and the domestic sub-lines
// sum to 3.38 + 0.07 + 0.03 + 4.88 = 8.36 exactly.
//
// ⚠️ TWO TRAPS, both handled by EXACT (never substring) matching:
//   1. The SAME file carries a PROMOTER-side "ForeignPortfolioInvestorI" = 0
//      (Table II). A substring match on "ForeignPortfolioInvestor" hits that
//      first and silently writes FII = 0 instead of 13.5. The candidate here is
//      the full "InstitutionsForeignPortfolioInvestorI", matched exactly.
//   2. FVCI is classified UNDER InstitutionsForeignI in the 2022+ taxonomy, so
//      it must count as FOREIGN here too or foreign money lands in DII. It is
//      almost always 0, which is exactly why it is easy to get wrong silently.
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
  // The 2020 vintage names the combined line "FinancialInstitutionOrBanksI"
  // (singular "Institution") — added EXACT, and to `banks` ONLY, never also to
  // financialInstitutions, or banksFisPct would double-count it.
  banks: [
    { ref: "Banks_ContextI", pattern: true },
    "BanksI",
    "FinancialInstitutionOrBanksI",
  ],
  // FinancialInstitutions: substring match intentionally catches
  // "OtherFinancialInstitutions(_ContextI|I)" in both vintages.
  financialInstitutions: [
    { ref: "FinancialInstitutions_ContextI", pattern: true },
    { ref: "FinancialInstitutionsI", pattern: true },
  ],
  nonInstitutions: ["NonInstitutions_ContextI", "NonInstitutionsI"],
  total: ["ShareholdingPattern_ContextI", "ShareholdingPatternI"], // totalShares
  // -- LEGACY VINTAGE FAMILY ONLY (2018-03-31 / 2019-06-30 / 2020-09-30) --
  // Inputs to the FII/DII derivation below.
  // All EXACT-match (see trap 1). None of these context IDs exist in the 2025
  // or 2022 taxonomies, so these lookups return null there and the derivation
  // never fires — the direct fii/dii contexts win first regardless.
  institutionsTotal: ["InstitutionsI"],
  legacyForeignFpi: ["InstitutionsForeignPortfolioInvestorI"],
  legacyForeignFvci: ["ForeignVentureCapitalInvestorsI"],
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
      factMap[key].push({ contextRef, value: safeNum(rawVal), raw: String(rawVal ?? "") });
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
  // FII/DII — direct contexts first (2025, then 2022). Both null ⇒ this is the
  // 2020-09-30 vintage, which has no domestic/foreign split; derive it. See the
  // VINTAGE_CTX header for the full worked example and the two traps.
  let fiiRaw = byCtxV(PCT, VINTAGE_CTX.fii);
  let diiRaw = byCtxV(PCT, VINTAGE_CTX.dii);
  /** True when fii/dii came from the 2020-vintage subtraction, not a direct context. */
  let legacyInstitutionsDerived = false;

  if (fiiRaw === null && diiRaw === null) {
    const instTotalRaw = byCtxV(PCT, VINTAGE_CTX.institutionsTotal);
    const fpiRaw = byCtxV(PCT, VINTAGE_CTX.legacyForeignFpi);
    // The FPI line is the anchor: without it there is nothing to split on, and a
    // bare InstitutionsI total tells us nothing about the foreign share. FVCI is
    // additive and optional (absent ⇒ 0), never a reason to abandon the derivation.
    if (instTotalRaw !== null && fpiRaw !== null) {
      const foreign = fpiRaw + (byCtxV(PCT, VINTAGE_CTX.legacyForeignFvci) ?? 0);
      const domestic = round4(instTotalRaw - foreign);
      // A negative domestic residual means the total and the sub-lines disagree —
      // a malformed filing or a context we mis-read. Emit NOTHING rather than a
      // fabricated number; the row stays null and shows up in the null-rate guard.
      // -0.0001 absorbs float noise on an otherwise exact zero.
      if (domestic >= -0.0001) {
        fiiRaw = foreign;
        diiRaw = Math.max(domestic, 0);
        legacyInstitutionsDerived = true;
      }
    }
  }

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
  // THE PLEDGE DENOMINATOR. `SHARES` is ["fullypaid","equity"] and EXCLUDES depository receipts;
  // the filing divides its own pledge percentage by the TOTAL holding. ASHOKLEY files 1,203,500,000
  // as 40.1% = 1.2035bn / 3,001,320,522 (NumberOfShares), not / 2,342,920,242 (fully paid = 51.4%).
  // Its own field so `promoterShares` - read by N6, the guards and the snapshot - is not widened.
  //
  // EXACT ELEMENT MATCH, NOT A KEYWORD. `byCtxV` matches element names by SUBSTRING, and
  // "numberofshares" is a prefix of `NumberOfSharesUnderlyingOutstandingDepositoryReceipts` —
  // which it returned first, giving ASHOKLEY 658,400,280 and a pledge ratio of 182.8%. Caught by
  // checking the parse against the filing's own printed 40.1% instead of trusting the keyword.
  const promoterTotalShares = ((): number | null => {
    const facts = factMap["numberofshares"];
    if (!facts) return null;
    for (const c of VINTAGE_CTX.promoter) {
      const ref = typeof c === "string" ? c : c.ref;
      const hit = facts.find((f) =>
        typeof c === "string" ? f.contextRef === ref : f.contextRef.includes(ref));
      if (hit && hit.value !== null) return hit.value;
    }
    return null;
  })();

  // ── Pledge / encumbrance — RESOLVED BY CONTEXT, like every other field ──────────────────────────
  //
  // ★★ THIS WAS THE ONLY FIELD IN THIS PARSER THAT IGNORED `contextRef`, AND IT COST REAL SCORES.
  //    Every other value resolves through `byCtxV` to an aggregate category context. The pledge block
  //    iterated every fact of every context and took the FIRST one for the count and the MAX for the
  //    percentage. SEBI's SHP taxonomy repeats each pledge fact at the promoter-group aggregate AND
  //    once per promoter sub-entity, so both columns described a SUB-ENTITY — usually whichever the
  //    file happened to list first (`IndividualsOrHinduUndividedFamily_ContextI`).
  //
  //    Verified against the filings themselves, 265 live-pledge stocks read from their stored
  //    `xbrl_url`: 175 matched, 73 were UNDERSTATED, 0 overstated. Zero overstatements is what
  //    "take the first sub-entity" predicts. BAJAJHIND filed 100% of its promoter stake pledged and
  //    was stored at 35%, with no R1 red flag.
  //
  // ⚠ PLEDGE-PROPER, NOT ALL ENCUMBRANCE. `NumberOfSharesEncumberedUnderPledged` is pledge only;
  //   `NumberOfSharesEncumbered` is pledge + NDU + other. They carry equal values in many filings and
  //   are NOT the same field — requiring "pledged" in the element name is what separates them, and
  //   matches the scope `scoring/ownership/pledging.ts` declares.
  //
  // ⚠ THE 2020-09-30 VINTAGE CANNOT MAKE THAT SEPARATION. It ships a single combined element,
  //   `PledgedOrEncumberedNumberOfShares` ("pledged OR otherwise encumbered"), because SEBI's format
  //   had one column before 2022. For those filings the number is combined encumbrance and there is
  //   no pledge-only figure to recover. Recorded here rather than silently treated as pledge-proper.
  const PLEDGE_SHARES = ["numberofshares", "encumb", "pledg"];
  const PLEDGE_PCT = ["encumb", "pledg", "percentage"];

  const pledgedSharesRaw = byCtxV(PLEDGE_SHARES, VINTAGE_CTX.promoter);
  const pledgePctPromoter = byCtxV(PLEDGE_PCT, VINTAGE_CTX.promoter);
  const pledgePctWhole = byCtxV(PLEDGE_PCT, VINTAGE_CTX.total);

  // ★ THE FILING'S OWN "IS ANYTHING PLEDGED?" DECLARATION, WHICH IS WHAT MAKES A ZERO MEAN SOMETHING.
  //   A company with nothing pledged omits the numeric elements entirely and answers the boolean
  //   `false` (measured: SUPREMEIND carries six such booleans and no pledge number). So an absent
  //   number is NOT automatically zero — it is zero when the filing SAID no, and NOT DISCLOSED when
  //   the filing said nothing at all. §3.1: ingest records what the filing said, including that it
  //   said nothing; interpretation happens at read time.
  //
  //   `safeNum` turns "false" into null, which is why `Fact` now carries the raw text.
  //  ⚠ AND "PLEDGE" APPEARS IN THE NAME OF THE ELEMENT THAT MEANS *NOT* A PLEDGE.
  //    `WhetherAnySharesHeldByPromotersAreEncumberedOtherThanByWayOfPledgeOrNDU` declares OTHER
  //    encumbrance, and a `true` there is not a pledge declaration. Matching on "pledg" alone read it
  //    as one and turned 70 filings that plainly said "no pledge" into NOT DISCLOSED — caught by
  //    checking the nulls against their own filings rather than trusting the count.
  let pledgeDeclared: boolean | null = null;
  for (const [key, facts] of Object.entries(factMap)) {
    if (!key.startsWith("whether")) continue;
    if (key.includes("otherthan")) continue;          // "…OtherThanByWayOfPledgeOrNDU" is not a pledge
    if (!key.includes("underpledged") && !key.includes("pledgeorotherwiseencumbered")) continue;
    for (const f of facts) {
      const v = f.raw.trim().toLowerCase();
      if (v === "false" || v === "0") pledgeDeclared = pledgeDeclared ?? false;
      else if (v === "true" || v === "1") pledgeDeclared = true;  // any `true` wins
    }
  }

  // ⚠ THREE STATES, AND `null` IS ONE OF THEM. The old code ended `?? 0` on all three fields, which
  //   is the fabricated-absence defect this build has now hit five times: 21,957 rows carried
  //   `pledged_shares = 0` and not one carried NULL, which is not a column that always knew the
  //   answer. `r1-pledging.ts` already guards for a null and that guard has never been reachable.
  const pledgedShares =
    pledgedSharesRaw !== null ? pledgedSharesRaw
    : pledgeDeclared === false ? 0        // the filing was asked and said no
    : null;                               // the filing did not say — not disclosed

  // ⚠ AND THE VINTAGE SCALE IS NOW HANDLED EXPLICITLY, NOT LEFT "UNVERIFIED". Measured on both
  //   taxonomies at the same context: 2020-09-30 files SUZLON's category share as 14.92 and its
  //   pledge share as 88.54 (both percent); 2025-10-31 files ASHOKLEY's as 0.5151 and 0.401 (both
  //   fractions). The pledge percentage carries the SAME unit as the category percentages in every
  //   filing checked, so it takes the same `toPct` factor those already use.
  const scalePct = (v: number | null): number | null =>
    v === null ? (pledgeDeclared === false ? 0 : null) : v * toPct;
  const promoterPledgedPct = scalePct(pledgePctPromoter);
  const promoterPledgedSharesPct = scalePct(pledgePctWhole);


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
    promoterTotalShares: promoterTotalShares ? Math.round(promoterTotalShares) : null,
    // ⚠ `? : 0` HERE WOULD UNDO THE WHOLE THREE-STATE FIX ABOVE — null must survive to the row.
    pledgedShares: pledgedShares === null ? null : Math.round(pledgedShares),
    legacyInstitutionsDerived,
  };
}
