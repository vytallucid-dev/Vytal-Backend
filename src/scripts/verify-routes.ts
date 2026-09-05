// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEEP-LINK GATE — every route an answer can point at, checked against the frontend's app/ tree.
//
// See src/harness/routes.ts for why this cannot be a runtime check and has to be a build-time one.
// Two halves, and the second is the negative control:
//
//   1 · every href `vytal-routes.ts` can emit resolves to a real Next.js route
//   2 · a deliberately wrong href does NOT resolve — because a checker that passes everything is
//       indistinguishable from no checker, and this one walks a directory tree it does not own
//
// ⚠ IT SKIPS RATHER THAN FAILS WHEN THE FRONTEND IS NOT ON DISK. This repo is deployed on its own,
//   and a backend build that cannot run without a sibling checkout is a worse property than a link
//   table that is checked only where both repos are present. It says loudly which one happened.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkAllRoutes, discoverRoutes, frontendDir, routeExists } from "../harness/routes.js";
import { linksFor } from "../composition/vytal-routes.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const root = frontendDir();
  console.log(`\n══ DEEP LINKS · frontend at ${root} ══`);

  if (!existsSync(join(root, "app"))) {
    console.log(`  ⚠ SKIPPED — no app/ directory there. Set FRONTEND_DIR to check the link table.`);
    console.log(`\n  0 checked · the link table is UNVERIFIED in this environment.`);
    return;
  }

  const routes = discoverRoutes(root);
  console.log(`  ${routes.length} routes discovered\n`);

  for (const c of checkAllRoutes(root)) ok(c.name, c.ok, c.href);

  // ── THE NEGATIVE CONTROL ────────────────────────────────────────────────────────────────────────
  console.log(`\n══ NEGATIVE CONTROLS ══`);
  ok("a route that does not exist is rejected", !routeExists("/research/not-a-page", routes));
  ok("an absolute URL is rejected", !routeExists("https://example.com/dashboard", routes));
  ok("a protocol-relative path is rejected", !routeExists("//example.com/dashboard", routes));
  ok("a real route with a query string is accepted",
    routeExists("/research/stock-screener/TCS?tab=health&section=financial-stability", routes));

  // ── AND WHAT `linksFor` ACTUALLY PRODUCES, over every slot combination it branches on ───────────
  console.log(`\n══ EVERY LINK linksFor CAN EMIT ══`);
  const lenses = [null, "health", "fundamentals", "valuation", "price", "ownership", "filings", "events"] as const;
  const ops = ["orient", "decompose", "compare", "screen", "history", "list_findings", "lookup", "unresolved"] as const;
  const kindSets = [[], ["DECOMPOSITION"], ["RELATIVE"], ["RAIL"], ["DECOMPOSITION", "RELATIVE", "RAIL"]];
  const shapes = [null, "portfolio", "watchlist", "relationship", "memory", "alerts"] as const;

  let emitted = 0, bad: string[] = [];
  const check = (href: string) => {
    emitted++;
    if (!routeExists(href, routes)) bad.push(href);
  };
  for (const lens of lenses) {
    for (const operation of ops) {
      for (const kinds of kindSets) {
        for (const symbol of ["TCS", null]) {
          for (const perspective of ["market", "reader"] as const) {
            for (const readerShape of perspective === "reader" ? shapes : [null]) {
              const links = linksFor({
                symbol, name: symbol ? "Tata Consultancy Services" : null,
                lens, operation, perspective, kinds, comparison: false, readerShape,
              });
              for (const l of links) check(l.href);
            }
          }
        }
      }
    }
  }
  // The comparison branch, which returns before the rest and would otherwise never be walked.
  for (const l of linksFor({
    symbol: "TCS", name: "Tata Consultancy Services", lens: null, operation: "compare",
    perspective: "market", kinds: ["RELATIVE"], comparison: true,
  })) check(l.href);

  ok(`every emitted href resolves (${emitted} emitted across the slot space)`, bad.length === 0,
    bad.length ? [...new Set(bad)].join(", ") : "no dead links");

  console.log(`\n  ${pass} passed · ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
