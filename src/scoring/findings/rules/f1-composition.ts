// File: src/scoring/findings/rules/f1-composition.ts
//
// F1 — Composition: atypical-for-band (File 1 §5F · severity Low). POINT-IN-TIME. The stock's
// 4-pillar profile deviates from the TYPICAL profile FOR ITS COMPOSITE BAND — e.g. a Healthy
// stock that is Healthy via Market while Foundation lags (a different shape than the typical
// Healthy name). Compares against the band-typical medians injected into the context.
//
// BAND-typical, NOT class-typical: File 1 §5F specifies "the typical profile for its composite
// BAND." (A class-typical refinement — an IT vs a Commodity profile — is NOT in File 1; FLAG.)
//
// SINGLE-SIGNAL vs F2 (Stage D): F1 = atypical vs the BAND-TYPICAL cross-section (a point read);
// F2 = mix SHIFTED vs the LAST snapshot (a trajectory read). Different references — distinct.

import type { FireRule } from "../types.js";
import type { Pillar } from "../../composite/types.js";

export const F1_DEVIATION_PP = 25; // a pillar ≥ 25pp off its band-typical ⇒ genuinely atypical. 15pp
// fired on ~half the universe (a 15pp deviation off a median is common); 25pp isolates the truly
// unusual shapes. FLAG: provisional + see the band-vs-class note above (band-typical pools sectors,
// so a sector-characteristic shape — IT's low Market — can read atypical for the band).
const PILLARS: Pillar[] = ["foundation", "momentum", "market", "ownership"];

export const ruleF1: FireRule = (ctx) => {
  const typical = ctx.bandTypicalProfiles?.[ctx.current.labelBand];
  if (!typical) return null;

  const devs = PILLARS.map((k) => {
    const cur = ctx.current.pillars[k];
    const t = typical[k];
    if (cur.state !== "scored" || cur.subtotal === null || t === null || t === undefined) return null;
    return { pillar: k, cur: cur.subtotal, typical: t, dev: cur.subtotal - t };
  }).filter((d): d is { pillar: Pillar; cur: number; typical: number; dev: number } => d !== null);
  if (devs.length < 3) return null; // need most pillars to judge the shape

  const maxAbs = Math.max(...devs.map((d) => Math.abs(d.dev)));
  if (maxAbs < F1_DEVIATION_PP) return null; // profile is typical for its band

  const high = [...devs].sort((a, b) => b.dev - a.dev)[0]; // most ABOVE typical — the masking pillar
  const low = [...devs].sort((a, b) => a.dev - b.dev)[0];  // most BELOW typical — the lagging pillar
  const r0 = (x: number) => Math.round(x);
  const bandLabel = ctx.current.labelBand.replace("_", "-");
  return {
    kind: "pattern",
    key: "composition_F1_atypical",
    severity: "low", // §5F
    direction: null, // contextual
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "F1", name: "Composition (atypical-for-band)",
      band: ctx.current.labelBand, composite: r0(ctx.current.composite),
      maskingPillar: high.pillar, maskingDevPp: r0(high.dev),
      laggingPillar: low.pillar, laggingDevPp: r0(low.dev),
      profile: devs.map((d) => ({ pillar: d.pillar, value: r0(d.cur), bandTypical: r0(d.typical), devPp: r0(d.dev) })),
      verdict:
        `A ${r0(ctx.current.composite)} that isn't a typical ${bandLabel} — ` +
        `${high.pillar} runs ${r0(high.dev)}pp above its band-typical (masking) while ${low.pillar} sits ${r0(-low.dev)}pp below.`,
    },
    metricRefs: [high.pillar, low.pillar],
  };
};
