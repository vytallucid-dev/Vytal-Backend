// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 4e · THE PRODUCTION CHECK. Point this at a DEPLOYED backend and it proves the endpoint is live and
// COMPLETE before any frontend change ships.
//
//   npx tsx src/scripts/check-catalogue-live.ts https://your-api-host
//
// ★ WHY THIS IS A SEPARATE SCRIPT FROM verify-catalogue-endpoint.ts. That one boots the app IN THIS
// PROCESS — it proves the code is correct. It cannot prove the code is DEPLOYED. A frontend repointed
// at an endpoint that exists only on a laptop degrades every finding card in the product to its
// bundled fallback, silently, for everyone. So this asks the real host over the real network and
// compares what came back against the catalogue this build knows about.
//
// EXPECTED COUNTS ARE READ FROM THE LOCAL CATALOGUE, not hardcoded — so the check stays correct as the
// catalogue grows, and a deploy running OLD code fails loudly on the count rather than passing on a
// stale number somebody forgot to update.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  SERVED_REGISTRIES,
  CATALOGUE_DOCUMENT,
  type ServedRegistry,
} from "../catalogue/serialise.js";
import {
  STOCK_FINDING_KEYS,
  LENS_FACE_IDS,
  PHS_FINDING_IDS,
  GUARDRAIL_SIGNATURE_KEYS,
} from "../catalogue/index.js";

const EXPECTED: Record<ServedRegistry, readonly string[]> = {
  stock_finding: STOCK_FINDING_KEYS,
  lens_face: LENS_FACE_IDS,
  phs_finding: PHS_FINDING_IDS,
  guardrail_signature: GUARDRAIL_SIGNATURE_KEYS,
};

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("usage: npx tsx src/scripts/check-catalogue-live.ts <baseUrl>");
    console.error("   e.g. npx tsx src/scripts/check-catalogue-live.ts https://api.example.com");
    process.exit(2);
  }
  const base = raw.replace(/\/+$/, "");
  const url = `${base}/api/v1/catalogue`;
  console.log(`\n═══ 4e · PRODUCTION CHECK — ${url} ═══\n`);

  const started = process.hrtime.bigint();
  const res = await fetch(url);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const body = await res.text();

  ok(`reachable and 200 (${ms.toFixed(0)} ms)`, res.status === 200, `HTTP ${res.status}`);
  if (res.status !== 200) {
    console.log(`\n❌ NOT LIVE — Stage 5 must not ship.\n`);
    process.exit(1);
  }

  const json = JSON.parse(body);
  ok("v1 envelope { success, data }", json?.success === true && !!json?.data, "envelope");
  const data = json.data as typeof CATALOGUE_DOCUMENT;

  // ── the gate: the COMPLETE key set, registry by registry ──
  let totalLive = 0;
  let totalWant = 0;
  for (const r of SERVED_REGISTRIES) {
    const live = Object.keys(data.registries?.[r]?.entries ?? {}).sort();
    const want = [...EXPECTED[r]].sort();
    totalLive += live.length;
    totalWant += want.length;
    const missing = want.filter((k) => !live.includes(k));
    const extra = live.filter((k) => !want.includes(k));
    ok(
      `${r}: ${live.length}/${want.length}`,
      missing.length === 0 && extra.length === 0,
      missing.length ? `MISSING ${missing.join(",")}` : extra.length ? `EXTRA ${extra.join(",")}` : "complete",
    );
  }
  ok(`TOTAL: ${totalLive}/${totalWant} keys live`, totalLive === totalWant, totalLive === totalWant ? "complete" : "INCOMPLETE");

  // ── the deployed build must be THIS build ──
  ok(
    "the live document version matches this build's",
    data.version === CATALOGUE_DOCUMENT.version,
    data.version === CATALOGUE_DOCUMENT.version
      ? data.version
      : `live ${data.version} · local ${CATALOGUE_DOCUMENT.version} — the deploy is running DIFFERENT copy`,
  );

  // ── the header actually survived the proxy/CDN in front of the app ──
  const cc = res.headers.get("cache-control");
  ok(
    "Cache-Control survived to the client (a proxy can rewrite it)",
    cc === "public, max-age=3600, stale-while-revalidate=86400",
    cc ?? "(absent — check the proxy/CDN)",
  );
  ok("ETag survived", /^"[0-9a-f]{16}"$/.test(res.headers.get("etag") ?? ""), res.headers.get("etag") ?? "(absent)");

  // ── public: it must answer with NO credentials at all ──
  ok("answers anonymously (no auth header was sent)", res.status === 200, "public read confirmed against the deployed host");

  // ── the segments + the picker projection are live too (Stage 5 uses BOTH doors) ──
  for (const path of ["/names", ...SERVED_REGISTRIES.map((r) => `/${r}`)]) {
    const r2 = await fetch(`${url}${path}`);
    ok(`GET /api/v1/catalogue${path} → 200`, r2.status === 200, `HTTP ${r2.status}`);
  }

  console.log(
    `\n${fail === 0 ? "✅ LIVE AND COMPLETE — Stage 5 may ship." : `❌ ${fail} FAILURE(S) — Stage 5 must NOT ship.`}\n`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("\n❌ UNREACHABLE —", e instanceof Error ? e.message : e);
  console.error("Stage 5 must not ship.\n");
  process.exit(1);
});
