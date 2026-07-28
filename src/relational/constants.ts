// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — DECLARED CONSTANTS (Overview Pattern Library, Part XII).
//
// Following the PHS convention: these are declared DISPLAY / ELIGIBILITY thresholds. NONE of them
// changes any score — the relational layer reads scores, it never computes one. All are tunable without
// model implications. Only the constants the in-scope slice (families UO + UH, modes M1 / M3 / M9) can
// reach are given a live home here; the out-of-slice ones (UN / UD / UE thresholds) are recorded in
// comments so the full table is auditable in one place and the next slice imports rather than re-declares.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// ── Attention axis (§2.1) ────────────────────────────────────────────────────────────────────────────
export const RECURRING_MIN_VIEWS_30D = 4; // viewCountTrailing30d ≥ this ⇒ RECURRING
export const DORMANT_GAP_DAYS = 90; //          now − lastViewedAt ≥ this ⇒ DORMANT

// ── UH — Holding (§3.2) ──────────────────────────────────────────────────────────────────────────────
export const UH_LARGE_POSITION_PCT = 10; //   UH3 heavy single name
export const UH_TOP_N = 3; //                 UH3 ordinal naming ("your 2nd-largest position")
export const UH_SLIVER_PCT = 1; //            UH9 sliver (weight)
export const UH_SLIVER_VALUE = 25_000; //     UH9 sliver (₹ value)
export const UH_TYPICAL_MULT = 2.0; //        UH4 larger/smaller-than-typical multiple
export const UH_TYPICAL_MIN_HOLDINGS = 5; //  UH4 eligibility (need enough positions for a "typical")
export const UH_TXN_HORIZON_DAYS = 90; //     UH7/UH8 horizon — out of this slice (position-delta path)

// ── UO — Orientation (§3.1) ──────────────────────────────────────────────────────────────────────────
// UO6 minimum unbroken run before strength may be stated with duration. Governs the POINT-IN-TIME path
// (a finding dated only by `standing_since`), which is absent this slice. A SELF-DATING Family N finding
// carries its own run length in evidence and clears its own rule-enforced minimum, so it resolves UO6
// without waiting on this floor (§3.1 duration-source precedence; Amendment §2.4). Declared for the
// degraded path and for the next slice.
export const UO_STRENGTH_MIN_SNAPSHOTS = 4;

// ── UG — Gap (§3.6) ──────────────────────────────────────────────────────────────────────────────────
export const STALE_PRICE_DAYS = 5; // UG3 — out of this slice; declared for completeness

// ── Card shape (§2.3 / §4.2) ─────────────────────────────────────────────────────────────────────────
export const CARD_CAP_DEFAULT = 3; // fallback slot cap
export const OVERFLOW_ENABLED = true; // expand-to-full-standing-set

// ── Out-of-slice thresholds (declared in the spec Part XII; NOT reachable by UO/UH · M1/M3/M9).
//    Recorded here so the table is complete and the UN/UD/UE slices import from one place:
//      UN_PG_NOTABLE_PCT 25 · UN_PG_HEAVY_PCT 40 · UN_SECTOR_NOTABLE_PCT 30 · UN_POND_SHARED_MIN 2
//      UE_MIN_BOOK 4 · UE_MIN_LIFT 2.0 · UE_MIN_COUNT 2 · UE_HIGH_BOOK_SHARE 0.50 · UE_SHARE_MIN_COUNT 3
//      UE_ENVIRONMENTAL_BASE_RATE 0.30 · UE_FAMILY_MIN_COUNT 3
//      UD_NEWS_HORIZON_DAYS 14 · UD_MIN_GAP_FOR_FUNDAMENTAL_DELTA 1 · UD_EVENT_HORIZON_DAYS 90
