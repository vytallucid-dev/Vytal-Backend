// File: src/ingestions/quaterly-results/xbrl/extract.ts (NEW — replaces v2 §2.1)

/**
 * Extract a numeric XBRL value matching all three of:
 *   - element name (e.g., "RevenueFromOperations")
 *   - contextRef (e.g., "OneD" — current quarter)
 *
 * The default namespace prefix is `in-capmkt:` (SEBI Integrated Filing).
 *
 * Critical: respects the unit reference, NOT the `decimals` attribute.
 *   - unitRef="INR"    → divide by 1e7 → ₹ Crore
 *   - unitRef="pure"   → return as-is → ratio (0.0142 = 1.42%)
 *   - unitRef="shares" → return as-is → share count
 */
export function extractNumber(
  xml: string,
  tagName: string,
  contextRef: string,
  prefix: string = "in-capmkt",
): number | null {
  // Match a single self-contained element with both contextRef and unitRef
  const re = new RegExp(
    `<${prefix}:${tagName}\\s+[^>]*` +
      `contextRef="${contextRef}"[^>]*` +
      `unitRef="(INR|pure|shares|[A-Za-z]+)"[^>]*>` +
      `\\s*([\\-\\d.eE]+)\\s*` +
      `</${prefix}:${tagName}>`,
    "i",
  );

  const match = re.exec(xml);
  if (!match) {
    // Try the other order (unitRef before contextRef)
    const re2 = new RegExp(
      `<${prefix}:${tagName}\\s+[^>]*` +
        `unitRef="(INR|pure|shares|[A-Za-z]+)"[^>]*` +
        `contextRef="${contextRef}"[^>]*>` +
        `\\s*([\\-\\d.eE]+)\\s*` +
        `</${prefix}:${tagName}>`,
      "i",
    );
    const match2 = re2.exec(xml);
    if (!match2) return null;
    return scaleByUnit(parseFloat(match2[2]), match2[1]);
  }

  return scaleByUnit(parseFloat(match[2]), match[1]);
}

/**
 * Apply unit-based scaling.
 * Decimal(18,2) safe range: ±9.99 quadrillion. Wider numbers are rejected.
 */
function scaleByUnit(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  let scaled: number;
  if (unit === "INR") {
    scaled = value / 1e7; // raw paise → ₹ Crore
  } else {
    scaled = value; // pure / shares / other
  }
  if (Math.abs(scaled) > 1e15) return null;
  return scaled;
}

/**
 * Extract a string value (no unit scaling, no contextRef ambiguity for date fields).
 * Used for DateOf*, Symbol, ISIN, etc.
 */
export function extractString(
  xml: string,
  tagName: string,
  contextRef: string,
  prefix: string = "in-capmkt",
): string | null {
  const re = new RegExp(
    `<${prefix}:${tagName}\\s+[^>]*` +
      `contextRef="${contextRef}"[^>]*>` +
      `([\\s\\S]*?)` +
      `</${prefix}:${tagName}>`,
    "i",
  );
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * Extract a date in "YYYY-MM-DD" format from a Date* tag and return a Date.
 */
export function extractDate(
  xml: string,
  tagName: string,
  contextRef: string,
  prefix: string = "in-capmkt",
): Date | null {
  const s = extractString(xml, tagName, contextRef, prefix);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
