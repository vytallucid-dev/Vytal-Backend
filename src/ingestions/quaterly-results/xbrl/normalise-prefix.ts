// ═══════════════════════════════════════════════════════════════════════════
// S3.3c — THE PREFIX, NORMALISED AT THE BOUNDARY.
//
// The v3 family parsers call extractNumber(xml, tag, ctx) and take the default
// prefix `in-capmkt`. The older NSE documents and every BSE document use
// `in-bse-fin` for the same concepts, so those parsers return null on them —
// silently, field by field.
//
// TWO WAYS TO FIX IT:
//   (a) thread a `prefix` argument through ~120 call sites in parser-nbfc /
//       parser-li / parser-gi / parser-common.
//   (b) rewrite the prefix ONCE, at the point the document enters the parser.
//
// (b) chosen. Not because it is less work — because of what the two do when they
// are wrong. A threaded prefix is 120 opportunities to mistype a concept name or
// miss a call site, and every one of those failures is a SILENT NULL: the field
// simply does not appear, the row still writes, and nothing objects. Option (b)
// has exactly one site to get right, and if it is wrong it is wrong for every
// field at once — which is loud, and shows up in the first regression.
//
// ⚠ EQUIVALENCE. Rewriting `in-bse-fin:` -> `in-capmkt:` is equivalent to
// threading the prefix ONLY IF the two taxonomies name the same concepts the
// same way. That is the same assumption threading makes — a threaded
// extractNumber(xml, "InterestIncome", ctx, "in-bse-fin") also assumes the
// concept is called InterestIncome in both. The difference is that this
// assumption now lives in one commented place instead of being implicit at 120.
// verify-prefix-normalisation proves the equality on real documents of both eras.
// ═══════════════════════════════════════════════════════════════════════════

// ── RELATIONSHIP TO detectTaxonomy() ──────────────────────────────────────
// This function rewrites ELEMENT prefixes (`<in-bse-fin:Foo>`). detectTaxonomy()
// keys on a different thing entirely — the `xmlns:in-capmkt-ent` namespace
// ATTRIBUTE, or an `INTEGRATED_FILING_*` filename — so normalising neither helps
// nor hurts it. Verified both ways in S8.4c.
//
// ⚠ WHAT 4c DID FIND: detectTaxonomy() cannot classify a LEGACY document at all.
//   Legacy filings carry `in-bse-fin` and are named `NBFC_INDAS_*` / `INDAS_*`,
//   matching neither signal, so the detector throws on every one of them:
//       "Unable to detect taxonomy from XBRL. Namespace pattern not found and
//        filename hint absent."
//   That is the strongest argument for S8.4b: for the entire legacy corpus the
//   document cannot name its own family even in principle. Stock.industryType is
//   not merely the more reliable router — it is the only one that exists.

/** Prefixes seen in the wild for the same concept set. */
export const ALIAS_PREFIXES = ["in-bse-fin", "in-nse-fin"] as const;
export const CANONICAL_PREFIX = "in-capmkt";

/**
 * Rewrite every aliased element prefix to the canonical one, so a parser written
 * against `in-capmkt` reads any era's document unchanged.
 *
 * Touches element names and their closing tags only — attribute VALUES that
 * merely contain the string (a scheme URL, an explicitMember like
 * `in-bse-fin:OneOperatingExpenses01Member`) are left alone, because rewriting a
 * dimension member would change what a context means.
 */
export function normaliseXbrlPrefix(xml: string): string {
  let out = xml;
  for (const alias of ALIAS_PREFIXES) {
    // opening + self-closing tags:  <in-bse-fin:Foo …>
    out = out.replace(new RegExp(`<${alias}:`, "g"), `<${CANONICAL_PREFIX}:`);
    // closing tags:                 </in-bse-fin:Foo>
    out = out.replace(new RegExp(`</${alias}:`, "g"), `</${CANONICAL_PREFIX}:`);
  }
  return out;
}

/** Which prefix does this document actually use for its facts? */
export function detectPrefix(xml: string): string {
  for (const alias of ALIAS_PREFIXES) if (new RegExp(`<${alias}:`).test(xml)) return alias;
  return CANONICAL_PREFIX;
}

/** True when the document needs normalising before a v3 parser can read it. */
export function needsNormalising(xml: string): boolean {
  return detectPrefix(xml) !== CANONICAL_PREFIX;
}
