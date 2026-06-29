// File: src/scoring/lens-patterns/catalog.ts
//
// THE CLOSED CATALOG — verbatim faces for LM1–8 (metric) and LP1–6 (pillar).
//
// Every Label / Read / Doesn't-mean / Tone / Field-verdict string is transcribed
// VERBATIM from Vytal_Three_Lens_Pattern_Library_v1.md. Labels + tones + field-
// verdicts are taken from the §4 "engine-ready summary" faces table (the canonical
// engine strings); Read + Doesn't-mean are from the §2/§3 full faces. Where §2's
// label prose differs slightly from §4's table (e.g. §2 "Below bar — but leads a
// weak field" vs §4 "Below bar — leads a weak field"), the §4 TABLE wins per the
// briefing ("per the databank §4 faces table EXACTLY"); the §2 variant is noted.
//
// DO NOT paraphrase or edit these strings. The no-forward-language guard
// (no-forward-guard.ts) scans label + read + fieldVerdict on every build.

import type { FieldVerdict } from "./types.js";

export interface CatalogFace {
  id: string;
  /** §4 faces-table label (VERBATIM). */
  label: string;
  /** §4 tone token (VERBATIM). */
  tone: string;
  fieldVerdict: FieldVerdict;
  /** §2/§3 "Read" face (VERBATIM). */
  read: string;
  /** §2/§3 "Doesn't mean" face (VERBATIM). NOTE: this face is the disclaimer that
   *  NEGATES forward language by design ("not a forecast…", "not a buy"); it is
   *  intentionally OUT OF SCOPE for the no-forward guard (which protects the
   *  ASSERTIVE faces — label/read/verdict). */
  doesntMean: string;
}

// ── Metric-level catalog (LM1–8) ─────────────────────────────────────────────────
export const LM_CATALOG: Record<string, CatalogFace> = {
  LM1: {
    id: "LM1",
    label: "Strong & still climbing",
    tone: "Constructive",
    fieldVerdict: null,
    read: "This metric clears its bar, leads the peer field, and is improving against its own history — strength on all three lenses.",
    doesntMean:
      "a sound, improving metric — not a forecast that it continues, and not a buy signal. Already-strong metrics are already priced.",
  },
  LM2: {
    id: "LM2",
    label: "Best-in-class, but flattening",
    tone: "Neutral→Caution",
    fieldVerdict: null,
    read: "Still clears its bar and leads the peer field — but it has stopped improving against its own history. A peak-and-hold (or a peak-and-ease), not a deterioration.",
    doesntMean:
      "the leader is faltering or that decline is coming — only that this metric is no longer *outpacing itself*. A flattening at the top is not a fall.",
  },
  LM3: {
    id: "LM3",
    label: "Below bar — leads a weak field", // §2 prose: "Below bar — but leads a weak field"
    tone: "Caution (field)",
    fieldVerdict: "PG_WEAK",
    read: "This metric sits below its absolute bar — sub-par in universal terms — yet it is *above* the peer-group average. The read is about the field: this peer group is weak on this metric right now, and the stock is simply the strongest of a struggling set.",
    doesntMean:
      "the stock is fine on this metric — it is below the universal bar. And being best-of-a-weak-field is not a forecast that the field recovers. It is a statement about *where the weakness lives* — in the field, not uniquely in this name.",
  },
  LM4: {
    id: "LM4",
    label: "Clears bar — in an elite field", // §2 prose: "Clears the bar — in an elite field"
    tone: "Neutral (field)",
    fieldVerdict: "PG_STRONG",
    read: "This metric clears its absolute bar — sound in universal terms — but sits *below* the peer-group average. The read is about the field: this is an exceptional peer group, and the stock lags not because it is weak, but because the company it keeps is elite.",
    doesntMean:
      "the stock is weak on this metric — it clears the universal bar. Trailing an elite field is not a flaw; it is context. Do not read 'below peer mean' as 'bad' here.",
  },
  LM5: {
    id: "LM5",
    label: "Weak & behind — but turning up",
    tone: "Constructive/Caution",
    fieldVerdict: null,
    read: "Below its bar and below the peer field — weak on both absolute and competitive lenses — but it is *improving against its own history*. A low-base turn, visible only because the trend lens is read separately.",
    doesntMean:
      "a recovery that will complete, or a buy. Improvement off a weak base is a real, observed change in *this metric's own arc* — not a prediction it reaches the bar or the field. The Source of Truth's recovery findings live at the pillar level and carry their own evidence; this is the metric-level echo, descriptive only.",
  },
  LM6: {
    id: "LM6",
    label: "Lead eroding — converging to field", // §2 prose: "converging to the field"
    tone: "Caution",
    fieldVerdict: null,
    read: "Still above its absolute bar, but its edge over the peer field has narrowed to roughly the field average, and it is declining against its own history. The competitive separation is eroding.",
    doesntMean:
      "the stock is now weak — it still clears the bar. Converging to the field average is a loss of *relative* lead, not a fall into weakness.",
  },
  LM7: {
    id: "LM7",
    label: "Weak on every lens",
    tone: "Concern",
    fieldVerdict: null,
    read: "Below its absolute bar, below the peer field, and declining against its own history. Weak on all three lenses simultaneously — no offsetting read.",
    doesntMean:
      "a prediction the stock falls — it is a hard quality/risk read on *this metric*, not a price call. Weak-on-all-three is a reason to investigate the metric, not a sell.",
  },
  LM8: {
    id: "LM8",
    label: "Quiet weak spot",
    tone: "Caution",
    fieldVerdict: null,
    read: "This metric is below its bar and below the peer field and not improving — but its pillar reads acceptable because other metrics carry it. Flagged so the weak spot is visible, not buried in the average.",
    doesntMean:
      "the pillar's score is wrong — the aggregate is honest. This simply surfaces *which* component is the soft one inside an otherwise-acceptable pillar.",
  },
};

// ── Pillar-level catalog (LP1–6) ─────────────────────────────────────────────────
// Labels + tones + field-verdicts from §4; "read" from the §3.2 Meaning column (VERBATIM).
export const LP_CATALOG: Record<string, CatalogFace> = {
  LP1: {
    id: "LP1",
    label: "Broad strength",
    tone: "Constructive",
    fieldVerdict: null,
    read: "The pillar is strong on most metrics, absolutely *and* vs the field. Genuine breadth.",
    doesntMean: "",
  },
  LP2: {
    id: "LP2",
    label: "Field-lifted",
    tone: "Caution (field)",
    fieldVerdict: "PG_WEAK",
    read: "Most metrics trail their bars but beat the field — **the pillar's relative strength is a weak-field artifact** (the LM3 story, aggregated). The pillar leads the pond, but the pond is low.",
    doesntMean: "",
  },
  LP3: {
    id: "LP3",
    label: "Field-suppressed (elite field)",
    tone: "Neutral (field)",
    fieldVerdict: "PG_STRONG",
    read: "Most metrics clear their bars but trail the field — **an elite peer group** (the LM4 story, aggregated). The pillar is sound; the field is exceptional.",
    doesntMean: "",
  },
  LP4: {
    id: "LP4",
    label: "Improving breadth",
    tone: "Constructive",
    fieldVerdict: null,
    read: "A *majority* of the pillar's metrics are improving against their own history — broad self-improvement, regardless of absolute/peer level.",
    doesntMean: "",
  },
  LP5: {
    id: "LP5",
    label: "Eroding breadth",
    tone: "Caution→Concern",
    fieldVerdict: null,
    read: "A majority of the pillar's metrics are sliding against their own history — broad self-deterioration. The early, breadth-based read of a pillar losing altitude.",
    doesntMean: "",
  },
  LP6: {
    id: "LP6",
    label: "Hollow pillar (strong but fading)",
    tone: "Caution",
    fieldVerdict: null,
    read: "Most metrics still clear their bars, but most are *declining* — the pillar's absolute standing is intact but its momentum-within-itself is broadly negative. A strong-but-fading pillar.",
    doesntMean: "",
  },
};
