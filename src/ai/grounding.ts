// ═══════════════════════════════════════════════════════════════════════
// AI GROUNDING — the retrieval half of the AI stack. It reads the REAL computed health
// snapshot (stock or portfolio) via the EXISTING read services and renders a closed-world
// "fact block" for injection into a prompt. There is NO AI call here and NO direct model
// query — grounding wraps the read SERVICES only, so the AI reads byte-identically what the
// UI shows (same supersede-aware latest snapshot, same read-time lens patterns / trajectory /
// peer standing, never display-vs-internal mixing).
//
// HALLUCINATION IS PREVENTED BY CONSTRUCTION, not instruction: the fact block enumerates EVERY
// citable number, labeled and explicit, with a null rendered as "not available" (never omitted
// — an omission reads as license to guess). There is nothing left for the model to invent.
//
// This module supplies FACTS ONLY. It does not call the model, apply tone, or write prose. The
// caller combines tone.systemDirective (how to speak + the non-advisory spine) with this
// factBlock (what is true, closed-world) → provider.generate(...).
// ═══════════════════════════════════════════════════════════════════════
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import type { HealthSnapshotView } from "../scoring/read/health-view.types.js";
import { buildPortfolioHealthView, type PortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";

// ── The closed-world instruction — IDENTICAL in every fact block, never varies, never dropped ──
// One named constant (like tone.ts's NON_ADVISORY_SPINE) so the "only these facts" contract is
// structural: it heads every block a caller injects.
export const CLOSED_WORLD_HEADER =
  "The following are the ONLY facts available. Every number you state must appear verbatim below. " +
  "Do not compute, estimate, convert, infer, or introduce any number not present here. If a value " +
  'is marked "not available", say so plainly — never fill it in.';

export interface GroundingSources {
  asOfDate: string | null;
  periodKey?: string;
  snapshotType?: string;
  constantVersion?: string;
}

export interface StockGrounding {
  data: HealthSnapshotView; // the exact read-service view — structured, typed, honest-empty
  factBlock: string; // closed-world text for the prompt
  sources: GroundingSources;
}

export interface PortfolioGrounding {
  data: PortfolioHealthView;
  factBlock: string;
  sources: GroundingSources;
}

// ── Render helpers ───────────────────────────────────────────────────────────────────────────
const NA = "not available";
/** A value → its string, or the explicit "not available" for null/undefined. NEVER omit. */
const val = (x: unknown): string => (x == null ? NA : String(x));
/** A JSON-ish value (evidence / triggeringValues) → compact JSON, or "not available". */
const jsonOr = (x: unknown): string => (x == null ? NA : JSON.stringify(x));
/** `label: value` (or `label: not available`). */
const kv = (label: string, value: unknown, unit = ""): string =>
  value == null ? `${label}: ${NA}` : `${label}: ${value}${unit}`;

/** A scalar renders as itself; an OBJECT renders as compact JSON. Never "[object Object]" — an
 *  opaque token in a closed-world block is worse than a missing one (it invites invention). */
const scalarOrJson = (x: unknown): string =>
  x == null ? NA : typeof x === "object" ? JSON.stringify(x) : String(x);

// ── PRECISION — one convention, and it is the APP'S OWN, not one invented here ────────────────
//
// ★ WHY A CLOSED-WORLD BLOCK MUST CARRY THE ROUNDED NUMBER. This block is the only place the model
// may take a figure from, and CLOSED_WORLD_HEADER forbids it to "compute, estimate, convert or
// infer" one. So a block carrying only `83.61741` leaves it two options: say "83.61741", which no
// human says aloud, or round it — and ROUNDING IS COMPUTING, the exact thing the header bans. The
// instruction is only obeyable if the number it should speak is already present verbatim. Handing
// it the integer is therefore not a formatting nicety; it is what closes the loophole.
//
// ⚠ AND THE ROUNDING IS NOT OURS TO CHOOSE. It mirrors what the page itself renders — the FE's
// `r0 = Math.round(v)` for scores and `pct0 = Math.round(w * 100)%` for shares — so the AI and the
// UI can never state two different numbers for one fact. If the UI's convention ever moves, this
// moves with it; the failure mode of inventing a third convention here is a user reading "84" on
// the page while the assistant says "83.6", with nothing to tell them which is Vytal.
//
// The RAW always rides along beside the rounded value. Rounding for speech must not destroy
// provenance: the approximate figure is what to say, the raw is what it came from.

/** Float-noise-free decimal string: 0.30000000000000004 → "0.3", 83.61741 → "83.61741". */
const trim = (x: number): string => String(Number(x.toFixed(6)));

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A SCORE (0–100 scale): the citable value is the INTEGER, exactly as the page shows it. The raw
 *  appears only when it genuinely differs — 84.0000001 is a float artifact, not a second fact. */
const scoreStr = (x: number): string => {
  const r = Math.round(x);
  return Math.abs(x - r) < 0.005 ? String(r) : `${r} (raw ${trim(x)})`;
};
/** `label: <score>` — null-safe, honest-empty. */
const scoreKv = (label: string, x: unknown): string => `${label}: ${isNum(x) ? scoreStr(x) : NA}`;

/** A FRACTION (0–1): an approximate WHOLE percent to speak + the raw fraction for provenance.
 *  Whole-number percent is deliberate and uniform — "roughly 8%" is what a person says; a
 *  conversational figure with two decimals is a false claim of precision.
 *
 *  ⚠ A NONZERO SHARE THAT ROUNDS TO ZERO RENDERS "<1%", NEVER "~0%". Whole-number rounding is
 *  right for speech and wrong at exactly one place: the bottom. `INFY: weight=~0%` is a false
 *  statement about a real ₹10,735 position — and because the model is instructed to speak the
 *  rounded figure, it would faithfully repeat "0% of the book" about capital the user owns. The
 *  floor keeps the sentence sayable AND true. A genuine zero still says "0%": the distinction
 *  between "too small to round" and "absent" is exactly the one worth preserving. Raw is retained
 *  either way, so nothing is lost. */
const pctStr = (f: number): string => {
  const pct = Math.round(f * 100);
  const shown = pct === 0 && f > 0 ? "<1%" : `~${pct}%`;
  return `${shown} (raw fraction ${trim(f)})`;
};
const pctKv = (label: string, f: unknown): string => `${label}: ${isNum(f) ? pctStr(f) : NA}`;

/** An ALREADY-0–100 scalar (e.g. a percentile) — same speech rule, no ×100. */
const pctPointStr = (x: number): string => {
  const r = Math.round(x);
  return Math.abs(x - r) < 0.005 ? `~${r}%` : `~${r}% (raw ${trim(x)})`;
};

/**
 * ⚠ THE ENTITY LEDGER IS PRUNED OUT OF EVERY FINDING BIND — because it now has a real home.
 *
 * PA3 binds the WHOLE entity ledger under `bind.entities`, and until `constructionRead.entities`
 * existed that bind was the only structured carrier of the held company names, so this block had to
 * scavenge it. That was never sound: PA3 is a DUPLICATE-ISSUER detector (it fires only when some
 * issuer is held through 2+ instruments), so the names appeared on some books and vanished on
 * others with no signal — a closed-world block that silently omits the companies reads as "this
 * person holds no companies", which is the precise class of lie this module exists to prevent.
 *
 * Now the ledger is served first-class and rendered once, in [HELD COMPANIES]. Leaving the copy
 * inside the bind would put ONE fact in TWO places in a block whose entire claim is that each fact
 * appears once, authoritatively — and would spend a large amount of the token budget restating it.
 * The COUNTS PA3 binds (entityCount / nameRiskInstrumentCount) are its actual subject and stay.
 */
const pruneBind = (bind: unknown): unknown => {
  if (!bind || typeof bind !== "object" || Array.isArray(bind)) return bind;
  const { entities: _dropped, ...rest } = bind as Record<string, unknown>;
  return "entities" in (bind as Record<string, unknown>) ? rest : bind;
};

/** One portfolio finding, rendered FACTUALLY (code + family + label + its bound evidence). Bare
 *  ids are not enough: four instruments can fire the same code (e.g. PI5 ×4) and the model must be
 *  able to tell them apart from the facts alone. No prose is invented here. */
const pfLine = (f: { id?: string; family?: string; label?: string; tone?: string; bind?: unknown }): string =>
  `    - ${val(f.id)} (${val(f.family)}) ${val(f.label)} — tone=${val(f.tone)}, bind=${scalarOrJson(pruneBind(f.bind))}`;

// ── Stock fact block ───────────────────────────────────────────────────────────────────────
function renderStockFactBlock(view: HealthSnapshotView): string {
  const id = view.identity;
  const L: string[] = [];
  L.push(`=== FACTS: ${id.symbol} (${id.name}) — stock health ===`);
  L.push(CLOSED_WORLD_HEADER);
  L.push("");

  L.push("[IDENTITY]");
  L.push(kv("Symbol", id.symbol));
  L.push(kv("Name", id.name));
  L.push(kv("Sector", id.sector ? `${id.sector.displayName} (${id.sector.key})` : null));
  L.push(kv("Sector archetype", id.sectorClass));
  L.push(kv("Industry path", id.industryPath));
  L.push(kv("Peer group", id.peerGroup ? `${id.peerGroup.displayName} — ${id.peerGroup.memberCount} members` : null));
  L.push(kv("Coverage state", id.coverageState));
  if (id.coverageReason) L.push(kv("Coverage reason", id.coverageReason));
  L.push(kv("As-of date", id.asOfDate));
  L.push(kv("Period", id.periodKey));
  L.push("");

  if (!view.scored) {
    L.push(
      `[HEALTH SNAPSHOT] ${NA} — this stock is not scored (coverageState=${val(id.coverageState)}). ` +
        `No composite, pillars, findings, trajectory, or peer standing exist for it.`,
    );
    return L.join("\n");
  }

  // VERDICT
  L.push("[VERDICT]");
  const vd = view.verdict;
  if (!vd) {
    L.push(NA);
  } else {
    L.push(scoreKv("Composite health score", vd.composite));
    L.push(kv("Band", `${vd.label.band} (${vd.label.label})`));
    L.push(kv("Band cut range", vd.label.range ? `[${val(vd.label.range[0])}, ${val(vd.label.range[1])}]` : null));
    L.push(kv("Trajectory marker", vd.trajectoryMarker));
    L.push(scoreKv("Trajectory delta (score points)", vd.trajectoryDelta));
    L.push(kv("Divergence flag", vd.divergence.flag));
    L.push(scoreKv("Divergence gap (max−min pillar subtotal)", vd.divergence.gap));
    L.push(kv("Divergence highest pillar", vd.divergence.high ? `${vd.divergence.high.pillar}=${scoreStr(vd.divergence.high.subtotal)}` : null));
    L.push(kv("Divergence lowest pillar", vd.divergence.low ? `${vd.divergence.low.pillar}=${scoreStr(vd.divergence.low.subtotal)}` : null));
    L.push(kv("Divergence stored scalar", vd.divergence.storedScalar));
    L.push(
      kv(
        "Pond mask",
        vd.pondMask ? `heat=${vd.pondMask.heat}, isHot=${vd.pondMask.isHot}, trailingMovePct=${val(vd.pondMask.trailingMovePct)}` : null,
      ),
    );
  }
  L.push("");

  // PILLARS
  L.push("[PILLARS] (nominal weights 0.35/0.25/0.20/0.20; appliedWeight is post-redistribution)");
  for (const p of view.pillars) {
    L.push(
      `- ${p.pillar.toUpperCase()}: subtotal=${isNum(p.subtotal) ? scoreStr(p.subtotal) : NA}, state=${val(p.state)}, ` +
        `nominalWeight=${isNum(p.nominalWeight) ? pctStr(p.nominalWeight) : NA}, ` +
        `appliedWeight=${isNum(p.appliedWeight) ? pctStr(p.appliedWeight) : NA}, ` +
        `nativeZone=[${val(p.nativeZone.lowerMark)},${val(p.nativeZone.upperMark)}], zonePosition=${val(p.nativeZone.position)}`,
    );
    if (p.metrics) {
      for (const m of p.metrics) {
        L.push(
          `    · metric ${m.metricKey}: rawValue=${val(m.rawValue)}, metricScore=${val(m.metricScore)}, l1Band=${val(m.l1Band)}, ` +
            `contribution=${val(m.contribution)}, nominalWeight=${val(m.nominalWeight)}, effectiveWeight=${val(m.effectiveWeight)}, ` +
            `lensL1=${val(m.l1Score)}, lensL2=${val(m.l2Score)}, lensL3=${val(m.l3Score)}, scoreState=${val(m.scoreState)}, metricState=${val(m.metricState)}` +
            (m.suppressionReason ? `, suppressionReason=${m.suppressionReason}` : ""),
        );
        if (m.lensPattern) L.push(`        lens pattern ${m.lensPattern.id} (${m.lensPattern.label}): fieldVerdict=${val(m.lensPattern.fieldVerdict)}, role=${m.lensPattern.role}`);
      }
    }
    if (p.marketSubs) {
      for (const s of p.marketSubs) {
        L.push(
          `    · market sub ${s.subComponent} (category ${s.category}): available=${s.available}, rawValue=${val(s.rawValue)}, ` +
            `score=${val(s.score)}, band=${val(s.band)}, saturated=${s.saturated}, capped=${s.capped}` +
            (s.reason ? `, reason=${s.reason}` : ""),
        );
      }
    }
    if (p.ownership) {
      const o = p.ownership;
      L.push(
        `    · ownership detail: baseline=${val(o.baseline)} (${val(o.baselineReason)}), pledgingAdjustment=${val(o.pledgingAdjustment)}, ` +
          `penalties r2/r6/prolongedFii=${val(o.penalties.r2)}/${val(o.penalties.r6)}/${val(o.penalties.prolongedFii)}, primarySubtotal=${val(o.primarySubtotal)}, ` +
          `flowAdjustment raw/clamped=${val(o.flowAdjustmentRaw)}/${val(o.flowAdjustmentClamped)}, finalOwnership=${val(o.finalOwnership)}, ` +
          `r1Fired=${o.r1Fired}, r1TriggeringValues=${jsonOr(o.r1TriggeringValues)}`,
      );
      for (const fc of o.flowCategories) {
        L.push(
          `        - flow ${fc.category}: state=${val(fc.categoryState)}, rawSubScore=${val(fc.rawSubScore)}, cappedSubScore=${val(fc.cappedSubScore)}, ` +
            `netFlowValue=${val(fc.netFlowValue)}, trendState=${val(fc.trendState)}, bandLanded=${val(fc.bandLanded)}`,
        );
      }
    }
    if (p.lensPillarPatterns && p.lensPillarPatterns.length) {
      for (const lp of p.lensPillarPatterns) {
        L.push(`    · pillar lens pattern ${lp.id} (${lp.label}): fieldVerdict=${val(lp.fieldVerdict)}, role=${lp.role}`);
      }
    }
  }
  L.push("");

  // FINDINGS — coded keys + evidence values, rendered factually (NO invented prose)
  L.push("[FINDINGS] (coded; the human sentence is composed downstream from these facts)");
  const f = view.findings;
  if (!f || (!f.redFlags.length && !f.patterns.length)) {
    L.push("No red flags or patterns fired.");
  } else {
    for (const rf of f.redFlags) {
      L.push(`- RedFlag ${rf.flagKey}: severity=${val(rf.severity)}, tier=${val(rf.tier)}, triggeringValues=${jsonOr(rf.triggeringValues)}`);
    }
    for (const pt of f.patterns) {
      L.push(
        `- Pattern ${pt.patternKey}: direction=${val(pt.direction)}, severity=${val(pt.severity)}, displayState=${val(pt.displayState)}, ` +
          `magnitude=${val(pt.magnitude)}, evidence=${jsonOr(pt.evidence)}, metricRefs=${jsonOr(pt.metricRefs)}`,
      );
    }
  }
  L.push("");

  // PEER STANDING
  L.push("[PEER STANDING]");
  const ps = view.peerStanding;
  if (!ps) {
    L.push(NA);
  } else {
    L.push(kv("Peer group scored members", ps.memberCount));
    L.push(kv("Rank (1 = highest composite)", `${ps.rank} of ${ps.memberCount}`));
    L.push(kv("Percentile", isNum(ps.percentile) ? pctPointStr(ps.percentile) : null));
    L.push(kv("Neighbour above", ps.neighbours.above ? `${ps.neighbours.above.symbol}=${scoreStr(ps.neighbours.above.composite)}` : null));
    L.push(kv("Neighbour below", ps.neighbours.below ? `${ps.neighbours.below.symbol}=${scoreStr(ps.neighbours.below.composite)}` : null));
    for (const pk of Object.keys(ps.perPillarRank)) {
      const r = ps.perPillarRank[pk as keyof typeof ps.perPillarRank];
      L.push(`    per-pillar rank ${pk}: ${r.rank} of ${r.outOf}`);
    }
  }
  L.push("");

  // TRAJECTORY (quarterly series — the numbers behind the chart)
  L.push("[TRAJECTORY] (quarterly, oldest → newest)");
  const tj = view.trajectory;
  if (!tj || !tj.series.length) {
    L.push(NA);
  } else {
    for (const tp of tj.series) {
      L.push(
        `    ${tp.periodKey} (${tp.asOfDate}): composite=${isNum(tp.composite) ? scoreStr(tp.composite) : NA}, band=${val(tp.labelBand)}, ` +
          `F/M/Mkt/Own=${[tp.foundation, tp.momentum, tp.market, tp.ownership].map((v) => (isNum(v) ? scoreStr(v) : NA)).join("/")}`,
      );
    }
  }

  return L.join("\n");
}

// ── Portfolio fact block ─────────────────────────────────────────────────────────────────────
function renderPortfolioFactBlock(view: PortfolioHealthView): string {
  const L: string[] = [];
  L.push("=== FACTS: portfolio health (the user's book) ===");
  L.push(CLOSED_WORLD_HEADER);
  L.push("");
  L.push(kv("Has holdings", view.hasHoldings));

  const snap = view.snapshot;
  if (!snap) {
    L.push(`[PORTFOLIO SNAPSHOT] ${NA} — no computed snapshot exists yet for this book.`);
  } else {
    L.push(kv("Headline slot", snap.headlineSlot));
    L.push("");

    const cs = snap.coverageState;
    L.push("[COVERAGE]");
    L.push(pctKv("Scored value share (coverage)", cs.scoredWeight));
    L.push(kv("Scored holdings count", cs.scoredCount == null ? null : `${cs.scoredCount} of ${val(cs.totalCount)}`));
    L.push(kv("Total book value (₹)", cs.totalValue));
    L.push(pctKv("Recognized-unscored share", cs.recognizedUnscoredWeight));
    L.push(pctKv("Small-unscored share", cs.smallUnscoredWeight));
    L.push(kv("Unlock trigger (unscored capital exists → scoring it lifts coverage)", cs.unlockTrigger));
    L.push("");

    const cr = snap.constructionRead;
    L.push("[CONSTRUCTION READ] (always present — the book's shape; needs no scored holdings)");
    L.push(scoreKv("Construction Net (0–100)", cr.value));
    L.push(kv("Construction band", cr.band));
    L.push(kv("Archetype", cr.archetype));
    L.push(
      kv(
        "Exposures (composition shares)",
        cr.exposures
          ? (["nameRisk", "basket", "debt", "commodity"] as const)
              .map((k) => `${k}=${isNum(cr.exposures![k]) ? pctStr(cr.exposures![k]) : NA}`)
              .join(", ")
          : null,
      ),
    );
    L.push(scoreKv("Gross (C1+C2)", cr.gross));
    L.push(kv("Capital tier", cr.capitalTier));
    if (cr.rules) {
      for (const r of cr.rules) {
        L.push(
          `    rule ${val(r.rule)}: evaluable=${val(r.evaluable)}, points=${val(r.points)}, subjectShare=${val(r.subjectShare)}, ` +
            `firedSubject=${scalarOrJson(r.firedSubject)}`,
        );
      }
    } else {
      L.push(kv("Construction rules [C1…C6]", null));
    }
    L.push(`    construction findings (${cr.findings.length}):${cr.findings.length ? "" : " none"}`);
    for (const cf of cr.findings) L.push(pfLine(cf));
    L.push("");

    // ── THE ENTITY LEDGER, read FIRST-CLASS off constructionRead.entities ──────────────────────
    // ★ NOT off PA3's bind (see pruneBind). This section is present for EVERY book that has a
    // construction ledger — including the ordinary one-instrument-per-company book PA3 stays silent
    // on. Its presence no longer depends on a finding happening to fire.
    //
    // Weight is the entity's share of the WHOLE book (not of the name-risk sleeve) — stated in the
    // header, because an unlabelled share is a number the model will label for us.
    L.push("[HELD COMPANIES] (the entity ledger — one row per ISSUER, aggregated across every instrument of that issuer; weight = share of the whole book)");
    if (cr.entities == null) {
      L.push(`${NA} — this snapshot carries no construction ledger, so the held companies are not known here.`);
    } else if (cr.entities.length === 0) {
      L.push("none — this book holds no single-company (name-risk) positions; its equity exposure is held through funds/baskets.");
    } else {
      L.push(`    count: ${cr.entities.length}`);
      for (const e of cr.entities) {
        const parts = e.constituentInstruments
          .map((c) => `${val(c.symbol)} (${val(c.assetClass)}, ₹${val(c.marketValue)})`)
          .join(" + ");
        L.push(
          `    - ${val(e.displayName)}: weight=${isNum(e.weight) ? pctStr(e.weight) : NA}, sector=${val(e.sector)}, ` +
            `held via ${e.constituentInstruments.length} instrument(s): ${parts || NA}`,
        );
      }
    }
    L.push("");

    L.push("[HEALTH READ] (present only when scored holdings exist)");
    const hr = snap.healthRead;
    if (!hr) {
      L.push(`${NA} — no scored holdings (coverage = 0). The book has a Construction read only.`);
    } else {
      L.push(scoreKv("Health score (uncapped)", hr.value));
      L.push(kv("Health band", hr.band));
      L.push(scoreKv("Quality (the anchor)", hr.quality));
      L.push(scoreKv("Signals (penalty-only)", hr.signals));
      L.push(kv("Provisional (coverage < 40%)", hr.provisional));
      L.push(`    health findings (${hr.findings.length}):${hr.findings.length ? "" : " none"}`);
      for (const hf of hr.findings) L.push(pfLine(hf));
    }
    L.push("");
  }

  // Held-but-unscored / unvalued names (from the live disclosure — the names NOT behind the score).
  // The names that ARE in the book are above, in [HELD COMPANIES], off `constructionRead.entities`.
  // What still does NOT live in this view is any PER-NAME SCORE: the entity ledger gives the issuer,
  // its weight and its instruments, never that name's own health number. Those are per-stock facts —
  // ground each with groundStockHealth(symbol). Do not let a weight here be mistaken for a score.
  const d = view.disclosure as {
    heldNotScored?: Array<{ symbol?: string; isin?: string }>;
    heldNotValued?: Array<{ symbol?: string; isin?: string; note?: { code?: string; sentence?: string } | null }>;
  };
  L.push("[HELD BUT NOT SCORED / NOT VALUED] (names outside the health number)");
  const hns = d.heldNotScored ?? [];
  const hnv = d.heldNotValued ?? [];
  L.push(kv("Held, priced, but not scored (funds/bonds/etc.)", hns.length ? hns.map((h) => h.symbol ?? h.isin ?? "?").join(", ") : "none"));
  L.push(
    kv(
      "Held but could not be valued (unpriceable)",
      hnv.length ? hnv.map((h) => `${h.symbol ?? h.isin ?? "?"}${h.note?.code ? ` (${h.note.code})` : ""}`).join(", ") : "none",
    ),
  );
  L.push("");

  L.push("[REFERENCE FINDINGS] (coded; about Vytal's data coverage, NOT a judgment about the book)");
  const rfs = view.referenceFindings ?? [];
  L.push(`    count: ${rfs.length}${rfs.length ? "" : " (none)"}`);
  for (const rf of rfs) L.push(pfLine(rf));

  return L.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────
/**
 * Ground a single stock's health. Wraps buildHealthSnapshotView (the canonical, supersede-aware
 * latest-snapshot read). Returns null when the stock is not in the universe (mirrors the read
 * service returning null). A stock that is IN the universe but unscored returns a grounding whose
 * factBlock says so honestly (data.scored = false).
 */
export async function groundStockHealth(symbol: string): Promise<StockGrounding | null> {
  const data = await buildHealthSnapshotView(symbol);
  if (!data) return null;
  return {
    data,
    factBlock: renderStockFactBlock(data),
    sources: { asOfDate: data.identity.asOfDate, periodKey: data.identity.periodKey, snapshotType: "quarterly" },
  };
}

/**
 * Ground the authenticated user's portfolio health. Wraps buildPortfolioHealthView (the same pure
 * read GET /api/v1/me/portfolio serves). Always returns a grounding — an empty book yields a valid
 * "no snapshot / no scored holdings" fact block rather than null.
 */
export async function groundPortfolioHealth(userId: string): Promise<PortfolioGrounding> {
  const data = await buildPortfolioHealthView(userId);
  return {
    data,
    factBlock: renderPortfolioFactBlock(data),
    sources: { asOfDate: data.snapshot?.asOf ?? null, constantVersion: data.snapshot?.constantVersion },
  };
}
