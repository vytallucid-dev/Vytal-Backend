// ═══════════════════════════════════════════════════════════════════════════
// S3.3b — THE PERIOD TRAP.
//
// A context id is a NAME, not a promise. Probing CHOLAFIN's Q2 FY22 filing with
// the ANNUAL parser returned 58 of 62 fields — every one of them plausible, and
// every one of them drawn from a HALF-YEAR window, because that document's
// year-to-date context covers Apr–Sep, not Apr–Mar.
//
// Nothing in the parser objected, because the parser only asked "did a context
// called FourD exist?" — never "does it span a year?".
//
// So: read the DURATION out of the context declaration and assert it matches the
// grain of the row being written. A fallback that reaches a wrong-duration
// context is worse than one that finds nothing, because a null is visible and a
// plausible wrong number is not.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContextPeriod {
  id: string;
  start: Date | null;
  end: Date | null;
  instant: Date | null;
  days: number | null;
}

/** Every declared context in the document, with its period. */
export function readContextPeriods(xml: string): Map<string, ContextPeriod> {
  const out = new Map<string, ContextPeriod>();
  const re = /<xbrli:context\s+id="([^"]+)"[\s\S]*?<\/xbrli:context>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const id = m[1], blk = m[0];
    const sd = /<xbrli:startDate>([^<]+)<\/xbrli:startDate>/.exec(blk)?.[1] ?? null;
    const ed = /<xbrli:endDate>([^<]+)<\/xbrli:endDate>/.exec(blk)?.[1] ?? null;
    const inst = /<xbrli:instant>([^<]+)<\/xbrli:instant>/.exec(blk)?.[1] ?? null;
    const start = sd ? new Date(sd) : null;
    const end = ed ? new Date(ed) : null;
    out.set(id, {
      id, start, end,
      instant: inst ? new Date(inst) : null,
      days: start && end ? Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1 : null,
    });
  }
  return out;
}

/**
 * ⚠ THE LEGACY DOCUMENTS DO NOT DECLARE THEIR PRIMARY CONTEXTS.
 *
 * Measured on CHOLAFIN's FY22 annual filing: 41 `<xbrli:context>` declarations,
 * every one of them a segment/dimension context — and `id="FourD"` appears
 * NOWHERE, even though facts throughout the document carry
 * `contextRef="FourD"`. The primary contexts are referenced but never declared.
 *
 * So the declaration is not a reliable source of the period. Every document
 * does, however, carry the period as ordinary FACTS inside the context itself:
 *     <in-bse-fin:DateOfStartOfReportingPeriod contextRef="FourD">2021-04-01</…>
 *     <in-bse-fin:DateOfEndOfReportingPeriod   contextRef="FourD">2022-03-31</…>
 * That works on both eras and both prefixes, so it is the fallback.
 */
export function periodFromDateFacts(xml: string, contextId: string): ContextPeriod | null {
  const grab = (tag: string): string | null => {
    const re = new RegExp(
      `<(?:[\\w-]+:)?${tag}\\s+[^>]*contextRef="${contextId}"[^>]*>\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\\s*<`,
      "i",
    );
    return re.exec(xml)?.[1] ?? null;
  };
  const sd = grab("DateOfStartOfReportingPeriod");
  const ed = grab("DateOfEndOfReportingPeriod");
  if (!sd || !ed) return null;
  const start = new Date(sd), end = new Date(ed);
  return {
    id: contextId, start, end, instant: null,
    days: Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  };
}

// A quarter is 90±10 days; a year is 365±15. The gap between them is wide, and
// the half-year (183) and nine-month (273) windows that cause the trap fall
// squarely outside both.
export const GRAIN_DAYS = {
  quarterly: { min: 80, max: 100, label: "a quarter (~90d)" },
  annual: { min: 350, max: 380, label: "a year (~365d)" },
} as const;

export type Grain = keyof typeof GRAIN_DAYS;

export interface DurationVerdict {
  ok: boolean;
  reason: string;
  days: number | null;
}

/**
 * Does `contextId` in this document span the duration `grain` requires?
 *
 * `ok: false` is returned — never thrown — so the caller decides whether a
 * wrong-duration context is fatal or merely disqualifies one fallback candidate.
 */
export function checkContextDuration(
  xml: string,
  contextId: string,
  grain: Grain,
  periods?: Map<string, ContextPeriod>,
): DurationVerdict {
  const map = periods ?? readContextPeriods(xml);
  const p = map.get(contextId) ?? periodFromDateFacts(xml, contextId);
  if (!p) return { ok: false, reason: `context "${contextId}" is not declared in this document, and it carries no reporting-period date facts`, days: null };
  if (p.instant && p.days === null)
    return { ok: false, reason: `context "${contextId}" is an INSTANT (${p.instant.toISOString().slice(0, 10)}), not a duration`, days: null };
  if (p.days === null) return { ok: false, reason: `context "${contextId}" declares no period`, days: null };
  const want = GRAIN_DAYS[grain];
  if (p.days < want.min || p.days > want.max)
    return {
      ok: false,
      days: p.days,
      reason: `context "${contextId}" spans ${p.days} days (${p.start?.toISOString().slice(0, 10)} to ${p.end?.toISOString().slice(0, 10)}) — ${grain} rows require ${want.label}`,
    };
  return { ok: true, reason: `context "${contextId}" spans ${p.days} days, consistent with ${want.label}`, days: p.days };
}

/**
 * Pick the first candidate context that BOTH exists and spans the right
 * duration. This is the 3b fallback: the duration-aware version of "try OneD,
 * then OneI". Returns null rather than a wrong-duration context.
 */
export function pickDurationContext(
  xml: string,
  candidates: string[],
  grain: Grain,
): { contextId: string | null; tried: DurationVerdict[] } {
  const map = readContextPeriods(xml);
  const tried: DurationVerdict[] = [];
  for (const c of candidates) {
    const v = checkContextDuration(xml, c, grain, map);
    tried.push(v);
    if (v.ok) return { contextId: c, tried };
  }
  return { contextId: null, tried };
}
