// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BSE INLINE-XBRL → XBRL.  One transformer, so that NOTHING downstream changes.
//
// ── WHY A TRANSFORMER AND NOT TEN NEW EXTRACTORS ─────────────────────────────────────────────────
// Every extractor in bse-extract.ts takes an `xml: string` and reads facts with `extractNumber`
// (legacy/parser-legacy-common.ts). The period guard, the ratio gate and all ten cell extractors are
// already proven against that shape. So the cheapest SAFE change is to hand them the same shape:
// turn the inline-XBRL document into the XBRL instance it is already semantically equivalent to, and
// let the proven path do the rest. A parallel parser would double the surface that can be silently
// wrong.
//
// ── WHAT CHANGED AT BSE ──────────────────────────────────────────────────────────────────────────
// MEASURED on ABBOTINDIA (scrip 500488): every filing from MQ2024-2025 onward returns HTTP 404 for
// `FourOneUploadDocument/*.xml`, while `IFIndasDuplicateUploadDocument/*_IFIndAs.html` returns 200.
// That cutover is exactly where our data stops (2024-12-31). The listing carries BOTH entries per
// period; the lane was picking the dead one.
//
// ── THE FIVE DIFFERENCES, EACH OF WHICH BREAKS THE READER IF UNHANDLED ───────────────────────────
//   1. NAMESPACE      `in-capmkt`, not `in-bse-fin`. Already handled — `factNs()` detects it from the
//                     xmlns declaration, so the root emitted here MUST declare it.
//   2. QUOTES         attributes are SINGLE-quoted. `extractNumber` matches `contextRef="..."` with
//                     DOUBLE quotes, so everything emitted here is normalised to double.
//   3. SCALE          values are displayed in crore with `scale='7'`; the readers expect PLAIN RUPEES
//                     (legacy: RevenueFromOperations = 16142800000) and divide by 1e7 themselves.
//   4. SIGN           `sign='-'` is an ATTRIBUTE, not part of the text. Missing it flips a number.
//   5. DATE FORMAT    `30-06-2026` (DD-MM-YYYY), not `2024-12-31` (ISO). `readDateIn` requires ISO and
//                     returns null otherwise, so the guard would refuse the document — loudly, which
//                     is the safe failure, but it still loses the filing.
//
// ⚠ THE DECIMAL SHIFT IS DONE ON THE STRING, NOT WITH FLOATING POINT. `1813.68 * 1e7` is not exactly
//   18136800000 in IEEE754, and the reader divides by 1e7 again — two rounding trips on every number
//   in the corpus. Shifting the decimal point in the digit string is exact.
//
// ⚠ THE DATE CONVERSION IS CROSS-CHECKED, NOT ASSUMED. DD-MM-YYYY and MM-DD-YYYY are
//   indistinguishable for a day ≤ 12, and getting it wrong files a quarter under the wrong period —
//   the one error nothing downstream can catch. Every converted reporting-period date is therefore
//   verified against `<xbrli:startDate>` / `<xbrli:endDate>` on its OWN context, which are already
//   ISO. A disagreement is a refusal, never a guess.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface IxbrlTransform {
  /** The equivalent XBRL instance, ready for bse-extract / bse-period-guard. */
  xml: string;
  factCount: number;
  contextCount: number;
  /** Non-fatal observations worth logging. */
  warnings: string[];
}

export class IxbrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IxbrlError";
  }
}

/** Is this an inline-XBRL document rather than a plain XBRL instance? */
export function isInlineXbrl(body: string): boolean {
  return /<ix:(header|nonFraction|nonNumeric)\b/i.test(body);
}

/** Single-quoted attributes → double-quoted, so the downstream regexes match. */
function normaliseQuotes(fragment: string): string {
  return fragment.replace(/([\w:-]+)\s*=\s*'([^']*)'/g, (_m, name: string, value: string) =>
    `${name}="${value.replace(/"/g, "&quot;")}"`);
}

const attrOf = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:'([^']*)'|"([^"]*)")`, "i"));
  return m ? (m[1] ?? m[2] ?? null) : null;
};

/**
 * Shift a decimal string by `scale` places, EXACTLY — no float arithmetic.
 * "1,813.68" scale 7 → "18136800000".  "31.10" scale 7 → "311000000".
 */
export function applyScale(raw: string, scale: number): string | null {
  let s = raw.replace(/[,\s ]/g, "").trim();
  if (s === "" || s === "-" || s === "–") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;

  let [intPart, fracPart = ""] = s.split(".");
  if (scale > 0) {
    if (fracPart.length <= scale) { intPart += fracPart.padEnd(scale, "0"); fracPart = ""; }
    else { intPart += fracPart.slice(0, scale); fracPart = fracPart.slice(scale); }
  } else if (scale < 0) {
    const k = -scale;
    if (intPart.length <= k) { fracPart = intPart.padStart(k, "0") + fracPart; intPart = "0"; }
    else { fracPart = intPart.slice(intPart.length - k) + fracPart; intPart = intPart.slice(0, intPart.length - k); }
  }
  intPart = intPart.replace(/^0+(?=\d)/, "");
  const out = fracPart.replace(/0+$/, "") ? `${intPart}.${fracPart.replace(/0+$/, "")}` : intPart;
  return (neg && /[1-9]/.test(out) ? "-" : "") + out;
}

/** "30-06-2026" → "2026-06-30". Returns null for anything not that shape. */
export function ddmmyyyyToIso(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d), mon = Number(mo);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const REPORTING_START = "DateOfStartOfReportingPeriod";
const REPORTING_END = "DateOfEndOfReportingPeriod";

export function ixbrlToXbrl(html: string): IxbrlTransform {
  const warnings: string[] = [];
  if (!isInlineXbrl(html)) throw new IxbrlError("not an inline-XBRL document (no ix: elements)");

  // ── namespaces, from the root element ────────────────────────────────────────────────────────
  const root = html.match(/<html\b([^>]*)>/i);
  if (!root) throw new IxbrlError("inline-XBRL document has no <html> root");
  const nsDecls = [...root[1].matchAll(/xmlns(?::([\w-]+))?\s*=\s*(?:'([^']*)'|"([^"]*)")/g)]
    .map((m) => ({ prefix: m[1] ?? null, uri: m[2] ?? m[3] ?? "" }))
    // the default xhtml namespace has no place on an XBRL instance
    .filter((n) => n.prefix !== null && n.uri && n.prefix !== "ix" && n.prefix !== "ixt3");
  if (!nsDecls.some((n) => n.prefix === "in-capmkt" || n.prefix === "in-bse-fin"))
    throw new IxbrlError("inline-XBRL document declares neither in-capmkt nor in-bse-fin");
  if (!nsDecls.some((n) => n.prefix === "xbrli"))
    nsDecls.push({ prefix: "xbrli", uri: "http://www.xbrl.org/2003/instance" });
  const factNs = nsDecls.some((n) => n.prefix === "in-capmkt") ? "in-capmkt" : "in-bse-fin";

  // ── contexts + units, which are already valid XBRL inside ix:resources ───────────────────────
  const resources = html.match(/<ix:resources\b[^>]*>([\s\S]*?)<\/ix:resources>/i);
  if (!resources) throw new IxbrlError("inline-XBRL document has no <ix:resources>");
  const resourceXml = normaliseQuotes(resources[1]);
  const contexts = [...resourceXml.matchAll(/<xbrli:context\b[^>]*id="([^"]+)"[\s\S]*?<\/xbrli:context>/g)];
  if (contexts.length === 0) throw new IxbrlError("inline-XBRL document declares no contexts");

  /** context id → its ISO period, for cross-checking the converted dates. */
  const ctxPeriod = new Map<string, { start: string | null; end: string | null }>();
  for (const c of contexts) {
    const block = c[0];
    ctxPeriod.set(c[1], {
      start: block.match(/<xbrli:startDate>([^<]+)<\/xbrli:startDate>/)?.[1]?.trim() ?? null,
      end: (block.match(/<xbrli:endDate>([^<]+)<\/xbrli:endDate>/)?.[1]
        ?? block.match(/<xbrli:instant>([^<]+)<\/xbrli:instant>/)?.[1])?.trim() ?? null,
    });
  }

  const schemaRef = html.match(/<link:schemaRef\b[^>]*>[\s\S]*?<\/link:schemaRef>/i)?.[0]
    ?? html.match(/<link:schemaRef\b[^>]*\/>/i)?.[0] ?? "";

  // ── facts ────────────────────────────────────────────────────────────────────────────────────
  const out: string[] = [];
  let factCount = 0;
  let synthesised = 0;
  /** "<localTag>|<ctx>" for every reporting-period date the DOCUMENT states itself. */
  const declaredPeriodFacts = new Set<string>();

  const textOf = (inner: string): string =>
    inner.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();

  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const [tag, inner] = [m[1], m[2]];
    const name = attrOf(tag, "name");
    const ctx = attrOf(tag, "contextRef");
    if (!name || !ctx) { warnings.push(`nonFraction without name/contextRef skipped`); continue; }
    const scale = Number(attrOf(tag, "scale") ?? "0");
    if (!Number.isFinite(scale)) { warnings.push(`${name}: unreadable scale, skipped`); continue; }
    const value = applyScale(textOf(inner), scale);
    if (value === null) continue;                       // an empty cell is absence, not zero
    const signed = attrOf(tag, "sign") === "-"
      ? (value.startsWith("-") ? value.slice(1) : `-${value}`)
      : value;
    const unit = attrOf(tag, "unitRef");
    const dec = attrOf(tag, "decimals");
    out.push(`<${name} contextRef="${ctx}"${unit ? ` unitRef="${unit}"` : ""}${dec ? ` decimals="${dec}"` : ""}>${signed}</${name}>`);
    factCount++;
  }

  for (const m of html.matchAll(/<ix:nonNumeric\b([^>]*)>([\s\S]*?)<\/ix:nonNumeric>/gi)) {
    const [tag, inner] = [m[1], m[2]];
    const name = attrOf(tag, "name");
    const ctx = attrOf(tag, "contextRef");
    if (!name || !ctx) continue;
    let text = textOf(inner);
    if (!text) continue;

    // ⚠ dates: convert, then PROVE the conversion against the context's own ISO period.
    const iso = ddmmyyyyToIso(text);
    if (iso) {
      const local = name.replace(/^[\w-]+:/, "");
      if (local === REPORTING_START || local === REPORTING_END) {
        const want = local === REPORTING_START ? ctxPeriod.get(ctx)?.start : ctxPeriod.get(ctx)?.end;
        if (want && want !== iso) {
          throw new IxbrlError(
            `date conversion disagrees with the context: ${local}[${ctx}] read "${text}" as ${iso}, ` +
            `but context ${ctx} declares ${want}. Refusing rather than filing a period on a guess.`,
          );
        }
        if (!want) warnings.push(`${local}[${ctx}]: context carries no period to cross-check ${iso}`);
        declaredPeriodFacts.add(`${local}|${ctx}`);
      }
      text = iso;
    }
    out.push(`<${name} contextRef="${ctx}">${text.replace(/&(?!(amp|lt|gt|quot|apos);)/g, "&amp;").replace(/</g, "&lt;")}</${name}>`);
    factCount++;
  }

  // ⚠ THE EMPTINESS CHECK RUNS ON *REAL* FACTS, BEFORE ANY SYNTHESIS BELOW. Otherwise a document
  //   containing no data at all would be rescued by its own synthesised date facts and look valid.
  //   The gate caught exactly that regression when synthesis was first added.
  if (factCount === 0) throw new IxbrlError("inline-XBRL document yielded no facts");

  // ── the EARLY inline vintage declares no reporting-period facts at all ──────────────────────
  // MEASURED on ABBOTINDIA MQ2024-2025 (2025-03-31) and the Jun-2025 filings: 313 ix:nonNumeric
  // facts, of which the only period-ish one is TypeOfReportingPeriod="Quarterly". There is no
  // DateOfStartOfReportingPeriod / DateOfEndOfReportingPeriod, so bse-period-guard refuses the
  // document — 9 units across three stocks, and the same shape on every stock at that cutover.
  //
  // ⚠ THIS IS NOT AN INVENTED FACT. The <xbrli:context> period IS the canonical XBRL declaration of
  //   what a fact covers; a DateOf*ReportingPeriod fact is a convenience restatement of it. Reading
  //   the period from the context is reading it from its proper home, and MORE authoritative than a
  //   company-typed duplicate. Verified on the same document: OneD 2025-01-01..2025-03-31 (90d, Q4)
  //   and FourD 2024-04-01..2025-03-31 (365d, full year) — exactly the spans the guard asserts.
  //
  // ⚠ ONLY WHEN ABSENT. Where the document states the dates itself, those are used and cross-checked
  //   against the context above; a stated date is never overwritten by a synthesised one.
  for (const [ctxId, period] of ctxPeriod) {
    if (!period.start || !period.end) continue;
    for (const [tag, value] of [[REPORTING_START, period.start], [REPORTING_END, period.end]] as [string, string][]) {
      if (declaredPeriodFacts.has(`${tag}|${ctxId}`)) continue;
      out.push(`<${factNs}:${tag} contextRef="${ctxId}">${value}</${factNs}:${tag}>`);
      factCount++;
      synthesised++;
    }
  }
  if (synthesised) warnings.push(`synthesised ${synthesised} reporting-period date fact(s) from context periods`);

  const xmlns = nsDecls.map((n) => `xmlns:${n.prefix}="${n.uri}"`).join(" ");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xbrli:xbrl ${xmlns}>\n` +
    (schemaRef ? normaliseQuotes(schemaRef) + "\n" : "") +
    resourceXml.trim() + "\n" +
    out.join("\n") + "\n" +
    `</xbrli:xbrl>\n`;

  return { xml, factCount, contextCount: contexts.length, warnings };
}
