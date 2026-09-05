// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLIENT CONTRACT — what the backend can prove about the renderer without running a browser.
//
// ── ★ WHY A SOURCE SCAN AND NOT ONLY A BROWSER ────────────────────────────────────────────────────
// Two of the ten defects live entirely on the client and neither is visible to any payload assertion:
//
//   · every action button called bare `fetch()` on a RELATIVE path with cookies, against an API on
//     another origin behind a Bearer JWT — 404 and 401, every button, both defects 12 and 13
//   · `NextChips` rendered `<button>` with no `onClick` — every follow-up in the product was dead
//
// The browser gate proves both properly and it is the real evidence. But it needs a driver, a signed-in
// session and a running stack, so it runs on demand — and a check that runs on demand is a check that
// is not running when the mistake is made. These three run in seconds on every build, on source, and
// each would have caught its defect the moment it was typed.
//
// ⚠ THEY ARE NOT A SUBSTITUTE. A source scan proves a call goes THROUGH `apiFetch`; only the browser
//   proves the request arrives authenticated. Both layers are named in the report as what they are.
//
// ── ★ THE THIRD CHECK IS THE INTERESTING ONE ─────────────────────────────────────────────────────
// `PAYLOAD FIELDS ARE READ` — every field the backend puts in a payload must appear in the component
// that draws it. That is a real contract rather than a lint: a field the backend computed and the
// renderer never reads is a fact the reader was supposed to get and did not.
//
// It is exactly the shape of defect 4. `CoverageHeader` never read `subjectKind`, so it printed a
// stock sentence ("nothing filed with us for {symbol} yet") for portfolios, funds and comparisons
// alike — with `symbol` empty on every chat answer, leaving a visible gap. The payload was CORRECT.
// Nothing on the server side could have caught it. This can, and it generalises to every field added
// from here on.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Where the renderer lives. Both repos sit side by side; the path is derived, never hardcoded deep. */
export const FRONTEND_ROOT = process.env.HARNESS_FRONTEND_ROOT
  ?? join(process.cwd(), "..", "Vytal-Frontend");
const SECTIONS_DIR = join(FRONTEND_ROOT, "components", "sections");
const DISPATCH = join(SECTIONS_DIR, "answer-sections.tsx");

export interface ClientFinding {
  readonly check: string;
  readonly where: string;
  readonly detail: string;
}

export const clientRootExists = (): boolean => existsSync(SECTIONS_DIR) && existsSync(DISPATCH);

const sectionFiles = (): { name: string; src: string }[] =>
  readdirSync(SECTIONS_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ name: f, src: readFileSync(join(SECTIONS_DIR, f), "utf8") }));

/**
 * Strip comments before scanning.
 *
 * ★ THE REPO ALREADY LEARNED THIS ONE. `verify-nc-copy-register.mjs` says it outright: a `//` block
 *   may discuss a forbidden word — that is authors talking to each other, not a rendered string.
 *   Stage 8b hit the same thing from the other side, when a stripper control matched the sentence
 *   describing it. Every scan below runs on code with the prose removed.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C1 · NO BARE FETCH TO THE API
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ THE DEFECT: `fetch(payload.endpoint.path, { credentials: "include" })`. Relative, so it resolved
 *   against the Next origin and 404'd; cookie-based, where auth is a Bearer JWT, so it would have
 *   401'd even on the right host. Every other authenticated call in the app already went through
 *   `apiFetch`; this one surface reimplemented the transport and got both halves wrong (N-3).
 */
/**
 * ★ PURE, SO THE SELF-TEST CAN FEED IT A KNOWN-BAD FILE. A scanner that can only read the repo can
 *   only be proven by breaking the repo, and a negative control that requires damaging the product
 *   to run is one nobody runs. Same reason the disk walker is a thin wrapper rather than the check.
 */
export function scanBareFetch(name: string, src: string): ClientFinding[] {
  const out: ClientFinding[] = [];
  const code = stripComments(src);
  for (const m of code.matchAll(/\bfetch\s*\(/g)) {
    // `apiFetch(` is the sanctioned wrapper; the bare global is what must not appear.
    if (/\bapiFetch\s*\($/.test(code.slice(0, m.index! + m[0].length))) continue;
    const around = code.slice(m.index!, m.index! + 260);
    if (/["'`]\/api\/|endpoint\.path|\.path\b/.test(around)) {
      out.push({
        check: "C1 · no bare fetch to the API", where: name,
        detail: `bare fetch() reaching an API path — must go through apiFetch (base URL + Authorization: Bearer). "${around.replace(/\s+/g, " ").slice(0, 110)}"`,
      });
    }
  }
  if (/credentials:\s*["']include["']/.test(code)) {
    out.push({
      check: "C1 · no bare fetch to the API", where: name,
      detail: `credentials: "include" — this API authenticates with a Bearer token, not cookies`,
    });
  }
  return out;
}

export function checkNoBareFetch(): ClientFinding[] {
  return sectionFiles().flatMap(({ name, src }) => scanBareFetch(name, src));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C2 · NO DEAD CONTROL
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ THE DEFECT: `NextChips` rendered `<button type="button" className=…>` with no handler. Every
 *   follow-up chip and every candidate company on an ambiguous question looked pressable, hovered
 *   like something pressable, and did nothing.
 *
 * ★ AN EXPLICITLY DISABLED BUTTON IS FINE — that is a control saying so. What is not fine is one
 *   that looks live and is inert, which is the worse failure: it teaches the reader the product is
 *   broken rather than that the feature is missing.
 */
/** Pure, for the same reason as `scanBareFetch`. */
export function scanDeadControl(name: string, src: string): ClientFinding[] {
  const out: ClientFinding[] = [];
  const code = stripComments(src);
  // Each <button …> opening tag, attributes only.
  for (const m of code.matchAll(/<button\b([\s\S]*?)>/g)) {
    const attrs = m[1] ?? "";
    const wired = /\bonClick\b|\bonPointerDown\b|\btype\s*=\s*["']submit["']|\bdisabled\b/.test(attrs);
    if (!wired) {
      out.push({
        check: "C2 · no dead control", where: name,
        detail: `a <button> with no onClick, no submit type and no disabled — it renders as pressable and does nothing`,
      });
    }
  }
  return out;
}

export function checkNoDeadControl(): ClientFinding[] {
  return sectionFiles().flatMap(({ name, src }) => scanDeadControl(name, src));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C3 · EVERY PAYLOAD FIELD IS READ
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** `KIND:renderer` → the component file that draws it, read off the dispatch's own switch. */
export function rendererComponentMap(): Map<string, string> {
  const src = readFileSync(DISPATCH, "utf8");
  const code = stripComments(src);
  // import { A, B } from "./file.js"
  const importOf = new Map<string, string>();
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']\.\/([\w-]+)["']/g)) {
    for (const sym of m[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)) {
      importOf.set(sym, `${m[2]}.tsx`);
    }
  }
  // case "KIND:renderer": [case "…":]* return <Component …
  const out = new Map<string, string>();
  const caseRe = /((?:case\s*"[A-Z]+:[a-z-]+"\s*:\s*)+)return\s*<([A-Za-z][\w]*)/g;
  for (const m of code.matchAll(caseRe)) {
    const comp = m[2]!;
    const file = importOf.get(comp);
    for (const c of m[1]!.matchAll(/"([A-Z]+:[a-z-]+)"/g)) {
      if (file) out.set(c[1]!, file);
    }
  }
  return out;
}

/**
 * ★ FIELDS A RENDERER IS *SUPPOSED* NOT TO READ — with the reason, one per entry.
 *
 * ⚠ THIS LIST IS A LIABILITY AND IS WRITTEN TO BE READ AS ONE. Every entry weakens C3 by exactly one
 *   field, and the entry someone adds under time pressure will be the one that mattered. It exists
 *   because the first run proved the check was too strict in a specific, principled way rather than
 *   an inconvenient one: some payload fields are carried for the DIGEST or for a sibling surface, and
 *   two of them are fields the product forbids itself from showing.
 *
 * ★ THE PLANNER PROMPT'S OWN RULE IS THE AUTHORITY FOR THE FIRST TWO: "Never describe our thresholds,
 *   weights or bars — those are facts about our model, not the company." A renderer that displayed
 *   `weightApplied` would be breaking a house rule, so C3 demanding it be read had the sign backwards.
 *
 * ⚠ ANYTHING NOT LISTED HERE IS A FINDING. Growth in this list is the signal to look at, not the
 *   fix — if it reaches a dozen, the contract is wrong rather than the renderers.
 */
export const DELIBERATELY_UNRENDERED: ReadonlyMap<string, string> = new Map([
  ["weightApplied", "our own pillar weight — the product forbids describing its weights to a reader"],
  ["subtotal", "value x weight, i.e. the weight restated; same rule as weightApplied"],
  ["sortValue", "the numeric sort key behind `figure`; the reader sees the formatted string"],
  ["key", "a React/list identity, never reader-facing text"],
]);

/**
 * Every top-level payload key the backend emitted for a renderer must appear in that renderer's file.
 *
 * ⚠ TOP-LEVEL AND ARRAY-ELEMENT KEYS ONLY, AND THE LIMIT IS DELIBERATE. Deeper nesting produces
 *   generic names (`value`, `label`) that appear in every file for unrelated reasons, so the check
 *   would pass on coincidence rather than on being read. A shallow check that means something beats
 *   a deep one that does not.
 */
/**
 * The field comparison itself, pure — so the self-test can prove C3 discriminates without editing a
 * shipped component. Same reason `scanBareFetch` and `scanDeadControl` are pure.
 */
export function unreadFields(pair: string, file: string, componentSrc: string, payload: unknown): ClientFinding[] {
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return [];
  const src = stripComments(componentSrc);
  const keys = new Set<string>(Object.keys(p));
  // one level into arrays — a member/mark/item's own fields are the renderer's contract too
  for (const val of Object.values(p)) {
    if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === "object") {
      for (const k of Object.keys(val[0] as Record<string, unknown>)) keys.add(k);
    }
  }
  const out: ClientFinding[] = [];
  for (const k of keys) {
    if (DELIBERATELY_UNRENDERED.has(k)) continue;
    if (!new RegExp(`\\b${k}\\b`).test(src)) {
      out.push({
        check: "C3 · every payload field is read", where: `${pair} (${file})`,
        detail: `the backend sends "${k}" and the renderer never reads it — a fact the reader was meant to get`,
      });
    }
  }
  return out;
}

export function checkPayloadFieldsRead(
  live: readonly { kind: string; renderer: string; payload: unknown }[],
): ClientFinding[] {
  const out: ClientFinding[] = [];
  const map = rendererComponentMap();
  const srcCache = new Map<string, string>();
  const readSrc = (f: string) => {
    if (!srcCache.has(f)) srcCache.set(f, stripComments(readFileSync(join(SECTIONS_DIR, f), "utf8")));
    return srcCache.get(f)!;
  };

  const seen = new Set<string>();
  for (const s of live) {
    const pair = `${s.kind}:${s.renderer}`;
    const p = s.payload as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    const file = map.get(pair);
    if (!file) {
      if (!seen.has(`nofile:${pair}`)) {
        seen.add(`nofile:${pair}`);
        out.push({ check: "C3 · every payload field is read", where: pair, detail: "no component is mapped to this renderer in the dispatch" });
      }
      continue;
    }
    for (const f of unreadFields(pair, file, readSrc(file), p)) {
      // De-duplicated across the many answers that carry the same renderer.
      const id = `${f.where}:${f.detail}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(f);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C4 · EVERY EMITTABLE RENDERER IS DRAWN
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A section the backend can produce and the dispatch has no case for renders as an honest note —
 *  but a whole family silently landing there is a gap, not a graceful degradation. */
export function checkEmittableDrawn(
  live: readonly { kind: string; renderer: string }[],
): ClientFinding[] {
  const map = rendererComponentMap();
  const out: ClientFinding[] = [];
  for (const pair of new Set(live.map((s) => `${s.kind}:${s.renderer}`))) {
    if (!map.has(pair)) out.push({ check: "C4 · every emittable renderer is drawn", where: pair, detail: "the backend emits this and the dispatch has no case for it" });
  }
  return out;
}
