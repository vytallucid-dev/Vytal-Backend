// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTE CHECK — does every link an answer can emit actually exist?
//
// ── ★ WHY THIS IS THE LOAD-BEARING PART OF THE DEEP-LINK FEATURE ─────────────────────────────────
// `composition/vytal-routes.ts` is a table of paths into a DIFFERENT REPOSITORY. Nothing at runtime
// can tell us one of them is wrong: the server builds the href, the browser renders an <a>, and the
// failure only appears when a reader clicks it and lands on a 404 — inside an answer that was
// otherwise correct. That is exactly the shape of the invented-figure defect this build spends most
// of its rules preventing, and it would arrive by ROUTE RENAME rather than by anyone writing a bug.
//
// So the check is structural: walk the frontend's `app/` tree, derive the routes Next.js will
// actually serve, and assert every path the table can produce is one of them. A rename in the
// frontend fails here, in the backend's own gate, on the next run.
//
// ⚠ IT CHECKS PATHS, NOT TABS. `?tab=health&section=financial-stability` is a query string — Next
//   serves the page whatever it says, and the page's own map decides what to do with an id it does
//   not know (it falls back to the top of the tab, deliberately). So a stale SECTION id degrades and
//   a stale PATH 404s, and only the second one is checkable from here. That asymmetry is why the
//   section ids were chosen to degrade in the first place.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { SURFACE, stockHref, type SurfaceKey } from "../composition/vytal-routes.js";

/** Where the frontend repo is. Overridable, because a CI checkout may not be a sibling. */
export const frontendDir = (): string =>
  process.env.FRONTEND_DIR ?? resolve(process.cwd(), "..", "Vytal-Frontend");

/**
 * Every route the frontend serves, as a matcher.
 *
 * A `page.tsx` at `app/(main)/research/peer-groups/[id]/page.tsx` serves `/research/peer-groups/:id`
 * — route groups `(main)` contribute nothing to the path, and `[param]` matches one segment.
 */
export interface RouteMatcher {
  readonly segments: readonly string[];
  readonly source: string;
}

export function discoverRoutes(root = frontendDir()): RouteMatcher[] {
  const app = join(root, "app");
  const out: RouteMatcher[] = [];

  const walk = (dir: string, segs: string[]) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("page.tsx") || entries.includes("page.ts")) {
      out.push({ segments: segs, source: dir.slice(app.length + 1) || "." });
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (!statSync(full).isDirectory()) continue;
      // `(group)` is organisational and contributes no path segment; `_private` and `@slot` are not
      // routes at all.
      if (e.startsWith("_") || e.startsWith("@")) continue;
      walk(full, e.startsWith("(") && e.endsWith(")") ? segs : [...segs, e]);
    }
  };
  walk(app, []);
  return out;
}

const matches = (m: RouteMatcher, path: string[]): boolean =>
  m.segments.length === path.length &&
  m.segments.every((s, i) => (s.startsWith("[") && s.endsWith("]") ? path[i]!.length > 0 : s === path[i]));

/** Does the frontend serve this app-relative href? Query and hash are ignored — see the header. */
export function routeExists(href: string, routes: RouteMatcher[]): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
  return routes.some((m) => matches(m, path));
}

export interface RouteCheck {
  readonly name: string;
  readonly href: string;
  readonly ok: boolean;
}

/**
 * Every href the table can produce, checked.
 *
 * ★ THE STOCK PAGE IS CHECKED ONCE PER TAB even though every tab is the same path — cheap, and it
 *   means a future tab that gains its own route is covered without anyone remembering to add it.
 */
export function checkAllRoutes(root = frontendDir()): RouteCheck[] {
  const routes = discoverRoutes(root);
  const out: RouteCheck[] = [];
  for (const key of Object.keys(SURFACE) as SurfaceKey[]) {
    const href = SURFACE[key].href;
    out.push({ name: `SURFACE.${key}`, href, ok: routeExists(href, routes) });
  }
  const tabs = ["overview", "health", "fundamentals", "valuation", "technical", "activity", "events", "news"] as const;
  for (const t of tabs) {
    const href = stockHref("TCS", t);
    out.push({ name: `stockHref(${t})`, href, ok: routeExists(href, routes) });
  }
  return out;
}
