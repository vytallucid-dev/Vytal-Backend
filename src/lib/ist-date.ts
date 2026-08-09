// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE IST CALENDAR DAY — one definition, zero dependencies.
//
// Lifted OUT of portfolio/phs/score-history.ts (which re-exports it, so every existing caller and
// import path is unchanged) so a second consumer can use it without dragging the DB client along.
//
// ⚠ THAT IS NOT A STYLE PREFERENCE — IT IS A BUILD GATE. score-history.ts imports `prisma`, so any
// module reaching this helper through it inherits a DB-client import; a `verify:copy` gate that does
// so trips verify-build-gate-hygiene.ts, which requires every build gate touching the env module or
// the DB client to be explicitly declared with a reason. The results-season window is pure date
// arithmetic and has no business declaring a database dependency to get four lines of offset maths.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Today's calendar date in IST (Asia/Kolkata, UTC+5:30) as a `@db.Date`-ready Date at UTC midnight.
 *  India observes no DST, so the fixed offset is exact. Using the raw UTC date instead would misfile
 *  anything computed between 00:00 UTC and 05:30 IST onto the previous day. */
export function istDateOnly(now: Date = new Date()): Date {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}
