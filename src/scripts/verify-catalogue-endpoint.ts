// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENDPOINT GATES — Stage 4.
//
// ★ THIS BOOTS THE REAL APP AND MAKES REAL HTTP REQUESTS. Every other gate in this build reads the
// source modules; this one reads THE BYTES THAT SHIP. The difference matters: a serialiser that drops
// a field, a controller that spreads the wrong object, a route ordering bug that makes /names resolve
// as a registry — none of those are visible from the source of the copy modules, and all of them are
// exactly the kind of thing that reaches production looking fine.
//
//   1. ROUTING          — every path resolves, /names is not eaten by /:registry, unknown 404s.
//   2. COMPLETENESS     — the live key set EQUALS the catalogue's, registry by registry.
//   3. CACHE + ETAG     — the header is what the controller documents, and a conditional GET 304s.
//   4. ⚠ SECURITY (4d)  — the four scans, run over the SERIALISED RESPONSE BODY:
//                           · no metric bar / pillar weight / nativeZone bound / peer formula
//                           · no guardrail threshold constant (Stage 2's rule)
//                           · no INTERNAL IDENTIFIER inside prose (keys as keys are fine)
//                           · nothing user-scoped
//   5. NO VERDICTS      — a verdict template must never reach this document.
//   6. SIZE             — the report, plus a budget that fails on unexplained growth.
//
//   npx tsx src/scripts/verify-catalogue-endpoint.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Server } from "node:http";
import { createApp } from "../app.js";
import {
  CATALOGUE_DOCUMENT,
  SERVED_REGISTRIES,
  byteSize,
  type ServedRegistry,
} from "../catalogue/serialise.js";
import { STOCK_FINDING_KEYS, LENS_FACE_IDS, PHS_FINDING_IDS, GUARDRAIL_SIGNATURE_KEYS } from "../catalogue/index.js";
import { VERDICTS } from "../scoring/findings/verdicts.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;

async function main() {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}/api/v1/catalogue`;
  const GET = async (path = "", init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    return { res, text, json: text ? JSON.parse(text) : null };
  };

  try {
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("1 · ROUTING — every path resolves, and /names is not swallowed by /:registry");
    const full = await GET();
    ok("GET /api/v1/catalogue → 200", full.res.status === 200, `${full.res.status}`);
    ok("…in the v1 envelope { success, data }", full.json?.success === true && !!full.json?.data, "envelope");
    ok("…with NO auth header sent (public read)", true, "no Authorization on any request in this run");

    const names = await GET("/names");
    ok(
      "GET /catalogue/names → 200 and a name map (route order: static before param)",
      names.res.status === 200 && typeof names.json?.data?.names === "object",
      `${names.res.status} · ${names.json?.data?.count} names`,
    );

    for (const r of SERVED_REGISTRIES) {
      const seg = await GET(`/${r}`);
      ok(`GET /catalogue/${r} → 200`, seg.res.status === 200, `${seg.res.status} · ${seg.json?.data?.count} entries`);
    }
    const bogus = await GET("/not_a_registry");
    ok(
      "an unknown registry → 404 that NAMES the real ones (never a silent empty document)",
      bogus.res.status === 404 && /stock_finding/.test(bogus.json?.error ?? ""),
      `${bogus.res.status}: ${bogus.json?.error ?? ""}`,
    );

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("2 · COMPLETENESS — the LIVE key set equals the catalogue's, registry by registry");
    const data = full.json.data as typeof CATALOGUE_DOCUMENT;
    const EXPECTED: Record<ServedRegistry, readonly string[]> = {
      stock_finding: STOCK_FINDING_KEYS,
      lens_face: LENS_FACE_IDS,
      phs_finding: PHS_FINDING_IDS,
      guardrail_signature: GUARDRAIL_SIGNATURE_KEYS,
    };
    for (const r of SERVED_REGISTRIES) {
      const live = Object.keys(data.registries[r].entries).sort();
      const want = [...EXPECTED[r]].sort();
      const missing = want.filter((k) => !live.includes(k));
      const extra = live.filter((k) => !want.includes(k));
      ok(
        `${r}: ${live.length}/${want.length} keys served`,
        missing.length === 0 && extra.length === 0,
        missing.length || extra.length ? `missing ${missing.join(",")} · extra ${extra.join(",")}` : "exact",
      );
    }
    ok(
      "the boundary maps ship (a consumer can resolve a composed lens key and an unknown key)",
      Object.keys(data.boundaries.family).length === 10 && Object.keys(data.boundaries.lens).length === 4,
      `family ${Object.keys(data.boundaries.family).length} · lens ${Object.keys(data.boundaries.lens).length}`,
    );
    ok(
      "…and on the stock_finding SEGMENT too (a segmented consumer is not left without them)",
      !!data.registries.stock_finding.boundaries,
      "present",
    );
    // Every entry complete on the wire — a serialiser that drops a field is invisible from the source.
    const liveStock = Object.values(data.registries.stock_finding.entries) as Record<string, unknown>[];
    ok(
      "every SERVED stock finding carries name + description + doesntMean + family + concern + status",
      liveStock.every((e) => e.name && e.description && e.doesntMean && e.family && e.concern && e.status),
      `${liveStock.length} entries`,
    );
    const liveGuard = Object.values(data.registries.guardrail_signature.entries) as Record<string, unknown>[];
    ok(
      "every SERVED guardrail signature carries the generated consequence + status (0b · 0c reach the wire)",
      liveGuard.every((e) => e.consequence && e.status),
      `${liveGuard.length} entries`,
    );

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("3 · CACHE-CONTROL + ETAG — public and shared, because nothing here is per-reader");
    const cc = full.res.headers.get("cache-control");
    const etag = full.res.headers.get("etag");
    ok("Cache-Control is public, max-age=3600, stale-while-revalidate=86400", cc === "public, max-age=3600, stale-while-revalidate=86400", cc ?? "(absent)");
    ok(
      "…`public`, NOT relational's `private, no-store` — opposite need, opposite header",
      !!cc && cc.startsWith("public") && !/no-store|private/.test(cc),
      "shared-cacheable",
    );
    ok("a strong ETag is set", !!etag && /^"[0-9a-f]{16}"$/.test(etag), etag ?? "(absent)");
    const conditional = await GET("", { headers: { "If-None-Match": etag ?? "" } });
    ok(
      "a conditional GET returns 304 with no body (revalidation costs a round trip, not the payload)",
      conditional.res.status === 304 && conditional.text.length === 0,
      `${conditional.res.status} · ${conditional.text.length} bytes`,
    );
    const staleCond = await GET("", { headers: { "If-None-Match": '"deadbeefdeadbeef"' } });
    ok("…and a STALE ETag returns the full 200 (never a false 304)", staleCond.res.status === 200, `${staleCond.res.status}`);
    ok(
      "every segment carries the SAME version (a segmented consumer can detect a split-deploy mix)",
      (await Promise.all(SERVED_REGISTRIES.map((r) => GET(`/${r}`)))).every((s) => s.json.data.version === data.version) &&
        names.json.data.version === data.version,
      data.version,
    );

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("4 · ⚠ SECURITY — scanned over the SERIALISED RESPONSE BODY, not the source modules");
    // Extract every STRING VALUE from the live body. Keys are excluded on purpose: the payload's own
    // keys ARE finding keys and belong there. What must not appear is an internal identifier inside
    // PROSE — a reader-facing sentence naming F1 or M2 or peerStatsSnapshotId.
    //
    // ⚠ `entry.key` IS EXCLUDED, and that exclusion is the distinction 4d draws. Every entry restates
    // its own key as a value ("A-1", "ownership_R1_pledge") so a consumer holding a detached entry
    // still knows what it is. Those are the payload's KEYS wearing a value's clothes — legitimate, and
    // the reason the digit rule reads as violated when it is not. What must stay clean is PROSE. The
    // first run of this gate flagged all eleven `.key` fields, which is the scan working, not the copy
    // failing; scoping it here is the fix, and scoping beats an allowlist because it needs no upkeep.
    const strings: { path: string; text: string }[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") strings.push({ path, text: node });
      else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(data, "$");
    const prose = strings.filter((s) => !s.path.endsWith(".key") && !s.path.endsWith(".registry") && !s.path.endsWith(".version"));
    console.log(`  scanning ${prose.length} prose string values from the live response body (${strings.length - prose.length} identity fields excluded — see note)`);

    const CALIBRATION: { re: RegExp; why: string }[] = [
      { re: /native\s*zone/i, why: "nativeZone bound" },
      { re: /\bpillar\s+weight/i, why: "pillar weight" },
      { re: /\bweighted\s+at\b/i, why: "pillar weight" },
      { re: /\bz-?score\b/i, why: "peer formula" },
      { re: /\bstd\s*dev\b|\bstandard\s+deviation\b/i, why: "peer formula" },
      { re: /[μσ]\s*[=:]/, why: "peer μ/σ value" },
      { re: /\bN\s*=\s*\d/, why: "peer sample size" },
      { re: /\bbar\s*[=:]\s*-?\d/i, why: "metric bar value" },
    ];
    const calLeaks = prose.flatMap((s) => CALIBRATION.filter((t) => t.re.test(s.text)).map((t) => `${s.path}: ${t.why}`));
    ok("no metric bar / pillar weight / nativeZone bound / peer formula in any served string", calLeaks.length === 0, calLeaks.join(" · ") || `${CALIBRATION.length} patterns`);

    // Guardrail thresholds — Stage 2's rule, re-run over the wire.
    const guardStrings = prose.filter((s) => s.path.includes("guardrail_signature"));
    ok(
      "GUARDRAIL: not one digit in any served guardrail string (Stage 2's rule, on the wire)",
      !guardStrings.some((s) => /\d/.test(s.text)),
      guardStrings.filter((s) => /\d/.test(s.text)).map((s) => s.path).join(",") || `${guardStrings.length} strings, digit-free`,
    );

    // Internal identifiers inside PROSE. Metric codes (F1..F10 / M1..M5), engine field names, table
    // names, rule refs. Deliberately NOT applied to object KEYS — those are the vocabulary itself.
    const INTERNAL: { re: RegExp; why: string }[] = [
      { re: /\b[FM]\d{1,2}\b(?!\w)/, why: "internal metric code (F1 / M2)" },
      { re: /\bscore_(?:metrics|pillars|patterns|red_flags|snapshots|suppressions|peer_stats)\b/, why: "table name" },
      { re: /\bpeerStats|\bsnapshotId\b|\bperiodKey\b|\bflagKey\b|\bpatternKey\b/, why: "engine field name" },
      { re: /\bO[1-6]\b(?!\w)/, why: "guardrail outcome code" },
      // NB: no leading \b — "§" is a non-word character, so \b before it requires a WORD char to its
      // left. In "per §2B" the char to the left is a space, and the pattern silently never fired. The
      // negative control is what caught that; a scan nobody has watched fail is a scan nobody trusts.
      { re: /§\s*\d/, why: "internal spec citation" },
      { re: /\bK2_|\bNATIVE_ZONES\b|\bTTM_/, why: "engine constant name" },
    ];
    const idLeaks = prose.flatMap((s) =>
      INTERNAL.filter((t) => t.re.test(s.text)).map((t) => `${s.path}: "${s.text.match(t.re)![0]}" (${t.why})`),
    );
    ok("no INTERNAL IDENTIFIER inside any served prose string", idLeaks.length === 0, idLeaks.join(" · ") || `${INTERNAL.length} patterns · keys deliberately out of scope`);
    ok(
      "NEGATIVE CONTROL — the identifier scan catches 'suppress F1 ROCE and M2 per §2B (outcome O2)'",
      INTERNAL.filter((t) => t.re.test("suppress F1 ROCE and M2 per §2B (outcome O2)")).length >= 3,
      `${INTERNAL.filter((t) => t.re.test("suppress F1 ROCE and M2 per §2B (outcome O2)")).length} of 6 patterns fired`,
    );

    // Nothing user-scoped. The document is built from frozen constants and the route takes no
    // identifying input, but assert on the BODY so the claim is about what shipped.
    const USER_SCOPED = /\buserId\b|\bemail\b|\bportfolioId\b|\baccountId\b|\bsupabase\b|@[\w.-]+\.\w+/i;
    ok("nothing user-scoped in the body", !prose.some((s) => USER_SCOPED.test(s.text)), "no user fields, no addresses");
    ok(
      "…and the route takes no identifying input (two requests, byte-identical bodies)",
      (await GET()).text === full.text,
      "deterministic per deploy",
    );

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("5 · NO VERDICTS ON THIS DOCUMENT — they ride the finding rows (Stage 3)");
    ok(
      "no `verdict` field anywhere in the served body",
      !JSON.stringify(data).includes('"verdict"'),
      "static copy only",
    );
    // A verdict TEMPLATE reaching here would show up as an un-interpolated placeholder.
    ok(
      "no un-interpolated template placeholder in any served string",
      !prose.some((s) => /\$\{|\{\{/.test(s.text)),
      "no holes",
    );
    ok(
      `…and the ${Object.keys(VERDICTS).length} verdict renderers stay server-side (functions cannot serialise)`,
      !JSON.stringify(data).includes("=>"),
      "not on the wire",
    );

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    rule("6 · SIZE — the report, and a budget that fails on unexplained growth");
    const fullBytes = byteSize(CATALOGUE_DOCUMENT);
    const rows: [string, number][] = [
      ["FULL document", fullBytes],
      ...SERVED_REGISTRIES.map((r) => [`  ${r}`, byteSize(CATALOGUE_DOCUMENT.registries[r])] as [string, number]),
      ["  /names (alert picker)", byteSize(names.json.data)],
    ];
    for (const [label, b] of rows) {
      const pct = label.startsWith("  ") ? ` (${Math.round((b / fullBytes) * 100)}% of full)` : "";
      console.log(`     ${label.padEnd(28)} ${String(b).padStart(7)} bytes  ${kb(b).padStart(9)}${pct}`);
    }
    // A budget, not a limit: it fails when the document grows without anyone deciding it should.
    const BUDGET = 120_000;
    ok(`the full document is under the ${kb(BUDGET)} budget`, fullBytes < BUDGET, kb(fullBytes));
    const namesBytes = byteSize(names.json.data);
    ok(
      "the alert picker's projection is a small fraction of the full document",
      namesBytes < fullBytes / 8,
      `${kb(namesBytes)} vs ${kb(fullBytes)} — ${Math.round(fullBytes / namesBytes)}× smaller`,
    );

    console.log(`\n  document version (ETag): ${data.version}`);
    console.log(
      `\n${fail === 0 ? "✅ ENDPOINT GATES PASS — complete key set, cacheable, nothing leaked, no verdicts" : `❌ ${fail} FAILURE(S)`}`,
    );
  } finally {
    server.close();
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
