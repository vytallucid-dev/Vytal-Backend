// File: src/controllers/catalogue-controller.ts
//
// GET /api/v1/catalogue → the product's static copy catalogue.
// Public, no auth. Returns the v1 { success, data } envelope, exactly like results-list-controller.
//
// ── ⚠ 4c · THE CACHE HEADER — THIS SETS THE HOUSE PATTERN, SO THE REASONING IS HERE ───────────────
//
// There is no existing pattern to follow. The ONLY explicit Cache-Control in the codebase is
// relational-controller.ts's `private, no-store`, and that is the exact opposite need: relational's
// response is per-reader and must never touch a shared cache. This one is per-DEPLOY and touches no
// reader at all, so it wants the strongest sharing the correctness allows.
//
//   public                  there is nothing per-user in the body. A CDN or a shared proxy caching it
//                           once for everyone is correct, not a leak. This is the load-bearing word.
//   max-age=3600            the content changes on deploy only. An hour bounds how long a reader can
//                           hold yesterday's wording after a deploy — and Stage 5's bundled fallback
//                           covers the gap, so the cost of the stale window is a slightly older
//                           sentence, never a blank card.
//   stale-while-revalidate  a day. A cache past max-age serves the stale copy INSTANTLY and refreshes
//     =86400                behind the request. The reader never waits on the catalogue, ever — which
//                           matters because Stage 5 makes a page's copy depend on this fetch.
//   ETag + 304              revalidation costs a round trip and ~200 bytes instead of the payload.
//                           The hash is over the served bytes and is computed once at module load,
//                           because the inputs are frozen constants — a per-request hash over
//                           identical input is the same hash at more cost.
//
// ── WHY NOT A VERSIONED URL + `immutable`, WHICH IS STRICTLY BETTER FOR TRUE BUILD ARTEFACTS ──────
// `/api/v1/catalogue?v=<hash>` with `max-age=31536000, immutable` is the right answer when the client
// LEARNS the version out of band — a bundler stamps the hash into the HTML, so the browser knows the
// URL before it makes a request. Nothing does that here: the frontend fetches this at runtime and has
// no way to know the hash without first asking, which needs an unversioned request, which is the
// request we were trying to make immutable. The chicken-and-egg costs an extra round trip on every
// cold load to save a 304 on later ones.
//
// If this ever moves into the build (the catalogue baked into the bundle at compile time), the
// versioned-immutable form becomes correct and this comment is the argument for switching.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";
import {
  CATALOGUE_DOCUMENT,
  isServedRegistry,
  registrySegment,
  stockFindingNames,
  SERVED_REGISTRIES,
} from "../catalogue/serialise.js";

/** One hour fresh, one day of instant-stale-then-refresh. Shared cache, because nothing is per-user. */
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

/** Send with the cache headers + ETag, honouring a conditional request with a 304. */
function sendCached(req: Request, res: Response, version: string, data: unknown) {
  const etag = `"${version}"`;
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("ETag", etag);
  // A cache revalidating with If-None-Match gets 304 + headers, no body.
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  return res.json({ success: true, data });
}

/** GET /api/v1/catalogue — the full document, all four registries + the boundary maps. */
export const getCatalogue = (req: Request, res: Response) => {
  try {
    return sendCached(req, res, CATALOGUE_DOCUMENT.version, CATALOGUE_DOCUMENT);
  } catch (err) {
    console.error("[catalogue] full document error:", err);
    return res.status(500).json({ success: false, error: "Failed to build the catalogue" });
  }
};

/**
 * GET /api/v1/catalogue/names — key → name for the stock findings only.
 * The alert picker's projection: a dropdown has no use for descriptions or boundaries, and should not
 * pay for the portfolio library and the guardrail layer to render a name list.
 *
 * Registered BEFORE the /:registry param route so "names" is never read as a registry id.
 */
export const getCatalogueNames = (req: Request, res: Response) => {
  try {
    const doc = stockFindingNames();
    return sendCached(req, res, doc.version, doc);
  } catch (err) {
    console.error("[catalogue] names error:", err);
    return res.status(500).json({ success: false, error: "Failed to build the name list" });
  }
};

/** GET /api/v1/catalogue/:registry — one registry on its own. */
export const getCatalogueRegistry = (req: Request, res: Response) => {
  try {
    const registry = String(req.params.registry ?? "").trim();
    if (!isServedRegistry(registry)) {
      // An unknown registry is a caller error, not a server one — and the reply names the real ones
      // rather than leaving the caller to guess. Same posture as the finding-key refusal in chat.
      return res.status(404).json({
        success: false,
        error: `Unknown registry "${registry}". Served registries: ${SERVED_REGISTRIES.join(", ")}.`,
      });
    }
    const doc = registrySegment(registry);
    return sendCached(req, res, doc.version, doc);
  } catch (err) {
    console.error("[catalogue] registry error:", err);
    return res.status(500).json({ success: false, error: "Failed to build the registry segment" });
  }
};
