// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PRESS DEDUPE KEY — one implementation, shared by the ingest and the backfill.
//
// ★ THE DEFECT. `@@unique([stockId, sourceId])` never collides on a repeat of the same article, because
// Google News REISSUES THE GUID. Verified on the reported case: two rows for CUMMINSIND, same publisher
// (moneycontrol.com), same published_at to the second (2026-08-05T19:35:04Z), same headline except one
// is truncated — and TWO DIFFERENT GUIDs. So the unique constraint saw two distinct items and stored
// both, and they rendered as the top two entries on the card.
//
// The frontend's normalised-headline check cannot catch this class: measured over the post-screen list
// it catches 297 exact-headline duplicates and MISSES 117 truncation/normalisation variants (1.8% of
// what renders), because the variants differ in trailing truncation and in currency rendering
// ("₹2,380 crore" vs "Rs 2,380 crore").
//
// ── ⚠⚠ WHY THE KEY IS TIME-BOUND AND NOT JUST A LONGER PREFIX ────────────────────────────────────
// A prefix alone is unsafe, and the corpus names the counterexample. LICI's registered name is "Life
// Insurance Corporation of India" — 35 characters. Its publisher emits a daily "Stock Update", so:
//     2026-08-04  "Life Insurance Corporation of India Stock Update: LICI Rises as Re…"
//     2026-08-06  "Life Insurance Corporation of India Stock Update: LICI Jumps 1.7% …"
// share the first 49 characters. ANY prefix short enough to be useful merges every LICI story from that
// publisher — two days apart, genuinely different stories. Measured across the whole corpus, a bare
// prefix produced 497 merges spanning MORE THAN 24 HOURS at N=40, and still 214 at N=120.
//
// Binding the key to the EXACT published_at removes that entire failure mode by construction: measured
// >24h-apart merges drop to ZERO at every prefix length. It is safe because the defect class shares the
// timestamp exactly — a reissued GUID is the same article, reported at the same moment.
//
// ── THE NUMBERS THAT PICKED N = 60 ───────────────────────────────────────────────────────────────
// Merges under (stockId, exact ts, prefix N):  N=40 → 697 · N=60 → 681 · N=80 → 678.
// Past the knee at 60, so a longer prefix buys ~nothing, and 60 comfortably exceeds the longest
// covered company name plus a few words — the key can never be the company name alone.
// Cross-publisher merges at N=60: 88 (one wire story carried by two outlets at the same second, which
// is the same story to a reader).
//
// ⚠ ERRS TOWARD KEEPING. A false merge at ingest means the second row is NEVER STORED, which is data
// loss; a missed duplicate is one repeated row. So the bound is the exact timestamp rather than the
// looser "same hour" (which would have merged 974 — 293 more, none of them verified).
//
// PURE — no network, no DB, no clock. FILINGS GET NO KEY: they are bound by NSE's seq_id, which does
// not drift, and a null dedupe_key is exempt from the unique index (Postgres treats NULLs as distinct).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Characters past which a headline stops discriminating. See the note above — 60 is past the knee. */
export const DEDUPE_PREFIX_CHARS = 60;

/**
 * Normalise a headline for comparison. Every transform here is answering an OBSERVED variant, not a
 * hypothetical one:
 *   · case            — "Rs" vs "rs"
 *   · ₹ / Rs. / INR   → " rs "   the currency variant seen live ("₹2,380 crore" vs "Rs 2,380 crore")
 *   · HTML entities   — Google emits `&#8377;` for ₹ in some items
 *   · punctuation     — "Cummins, PB" vs "Cummins PB" after a truncation ellipsis
 *   · whitespace      — collapsed last, so every substitution above can leave loose spaces
 */
export function normaliseHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/&#8377;|&#x20b9;/g, " rs ")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/₹/g, " rs ")
    .replace(/\brs\.?\b/g, " rs ")
    .replace(/\binr\b/g, " rs ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The stored key. Scoped per stock by the unique index (`@@unique([stockId, dedupeKey])`), so the key
 * itself carries only the moment and the opening of the headline.
 *
 * Returns null when there is nothing to key on — an empty headline. Null is exempt from the constraint,
 * which is the right failure mode: an unkeyable row is stored rather than silently dropped.
 */
export function pressDedupeKey(headline: string, publishedAt: Date): string | null {
  const norm = normaliseHeadline(headline);
  if (!norm) return null;
  return `${publishedAt.getTime()}|${norm.slice(0, DEDUPE_PREFIX_CHARS)}`;
}
