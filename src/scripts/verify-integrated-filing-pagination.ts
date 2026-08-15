// File: src/scripts/verify-integrated-filing-pagination.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GATE — the integrated-filing page walk. OFFLINE: no network, no database.
//
// ★ WHY THIS GATE EXISTS. `/api/integrated-filing-results` returns
//   `{ data, size, page, totalCount }` and has ALWAYS been paginated. The response interface used
//   to declare `data` alone, so `totalCount` was never read and every caller silently took the
//   first page as the complete answer. MEASURED 2026-08-14: ITI reported totalCount=31 behind a
//   20-row default page, and 5 of the 11 hidden rows were Financials — a whole quarter (Q1 FY26)
//   and the FY25 annual that this pipeline had never once seen. Nothing failed. Nothing logged.
//
// ★ WHY IT IS DRIVEN BY A STUB. At the production PAGE_SIZE of 100, no symbol on the books
//   exceeds one page — the largest totalCount observed anywhere is 31. So the multi-page path
//   CANNOT be exercised live on demand, and a gate that needs a >100-filing symbol to exist is a
//   gate that never runs. The stub asserts the walk's PROPERTIES instead, which is the thing that
//   has to stay true.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { fetchIntegratedFilingPages } from "../ingestions/quaterly-results/results/discovery.js";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** A row shaped enough for the walker (it only reads `seq_Id`). */
const row = (id: number) => ({ seq_Id: String(id) }) as never;

/** A well-behaved server: `total` rows, honouring `size` and 1-based `page`. */
function goodServer(total: number) {
  const calls: string[] = [];
  const fetchPage = async (path: string) => {
    calls.push(path);
    const size = Number(/[?&]size=(\d+)/.exec(path)?.[1] ?? 20);
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    const start = (page - 1) * size;
    const data = Array.from(
      { length: Math.max(0, Math.min(size, total - start)) },
      (_, i) => row(start + i + 1),
    );
    return { data, size, page: page - 1, totalCount: total };
  };
  return { fetchPage, calls };
}

async function expectThrow(name: string, fn: () => Promise<unknown>, mustContain: string) {
  try {
    await fn();
    check(name, false, "expected a throw, got a result");
  } catch (e) {
    const msg = (e as Error).message;
    check(name, msg.includes(mustContain), `threw: ${msg.slice(0, 110)}`);
  }
}

async function main() {
  console.log("── integrated-filing pagination gate ──────────────────────────────────\n");

  // ── 1 · THE WALK. 31 rows behind a 5-row page must come back as 31, in 7 requests. ──
  {
    const { fetchPage, calls } = goodServer(31);
    const r = await fetchIntegratedFilingPages("index=equities&symbol=STUB", "STUB", undefined, {
      pageSize: 5,
      fetchPage,
    });
    check("walks every page", r.rows.length === 31, `got ${r.rows.length} rows in ${r.pages} pages`);
    check("reports pages spent", r.pages === 7, `pages=${r.pages} (ceil(31/5))`);
    check("reports totalCount", r.totalCount === 31, `totalCount=${r.totalCount}`);
    check(
      "requests are 1-based and carry size",
      calls[0].includes("&size=5&page=1") && calls[6].includes("&size=5&page=7"),
      calls[0].slice(-24),
    );
    const ids = r.rows.map((x) => Number((x as { seq_Id: string }).seq_Id));
    check("no row lost or duplicated", new Set(ids).size === 31 && Math.max(...ids) === 31);
  }

  // ── 2 · THE ORIGINAL BUG. One page must NOT be mistaken for the whole answer. ──
  {
    const { fetchPage } = goodServer(31);
    const r = await fetchIntegratedFilingPages("index=equities&symbol=STUB", "STUB", undefined, {
      pageSize: 20,
      fetchPage,
    });
    check(
      "the ITI case (31 behind a 20-row page) returns 31, not 20",
      r.rows.length === 31,
      `got ${r.rows.length}`,
    );
  }

  // ── 3 · EXACT FIT. total === pageSize must stop at one request, not spend an empty second one. ──
  {
    const { fetchPage, calls } = goodServer(20);
    const r = await fetchIntegratedFilingPages("q", "STUB", undefined, { pageSize: 20, fetchPage });
    check("exact-fit page stops immediately", r.rows.length === 20 && calls.length === 1, `calls=${calls.length}`);
  }

  // ── 4 · EMPTY. A window nobody filed in is honest-empty, not an error. ──
  {
    const { fetchPage } = goodServer(0);
    const r = await fetchIntegratedFilingPages("q", "STUB", undefined, { pageSize: 20, fetchPage });
    check("empty result is not an error", r.rows.length === 0);
  }

  // ── 5 · THE SERVER IGNORES `page`. This is the failure that must never be silent. ──
  await expectThrow(
    "server ignoring `page` throws rather than truncating",
    () =>
      fetchIntegratedFilingPages("q", "STUB", undefined, {
        pageSize: 5,
        // Always returns page 1, whatever we ask for.
        fetchPage: async () => ({
          data: [row(1), row(2), row(3), row(4), row(5)],
          size: 5,
          page: 0,
          totalCount: 31,
        }),
      }),
    "made no progress",
  );

  // ── 6 · CAP. More rows than MAX_PAGES × pageSize must throw, not return a partial list. ──
  await expectThrow(
    "exceeding MAX_PAGES throws rather than returning a partial list",
    () => {
      const { fetchPage } = goodServer(100_000);
      return fetchIntegratedFilingPages("q", "STUB", undefined, { pageSize: 1, fetchPage });
    },
    "Refusing to return a truncated filing list",
  );

  // ── 7 · SHAPE. A non-array `data` (the envelope trap) throws. ──
  await expectThrow(
    "non-array `data` throws",
    () =>
      fetchIntegratedFilingPages("q", "STUB", undefined, {
        fetchPage: async () => ({ data: null as never }),
      }),
    "Expected { data: [...] }",
  );

  // ── 8 · A SHRINKING totalCount MUST NOT END THE WALK EARLY. ──
  {
    let call = 0;
    const r = await fetchIntegratedFilingPages("q", "STUB", undefined, {
      pageSize: 5,
      fetchPage: async () => {
        call++;
        // Page 1 says 12 rows exist; page 2 claims only 5 do. The walk must still finish the 12.
        if (call === 1) return { data: [1, 2, 3, 4, 5].map(row), size: 5, page: 0, totalCount: 12 };
        if (call === 2) return { data: [6, 7, 8, 9, 10].map(row), size: 5, page: 1, totalCount: 5 };
        return { data: [11, 12].map(row), size: 5, page: 2, totalCount: 5 };
      },
    });
    check("a shrinking totalCount cannot end the walk early", r.rows.length === 12, `got ${r.rows.length}`);
  }

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — integrated-filing pagination gate (${failures} failure(s))\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("gate crashed:", e);
  process.exit(1);
});
