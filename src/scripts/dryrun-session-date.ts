// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SESSION-DATE GUARD — BUILD GATE.
//
// Proves that every fetch-by-date archive lane REFUSES a file that is not the day it asked for.
//
// ⚠ THIS SCRIPT WRITES NOTHING. NOT TO THE DATABASE, NOT TO DISK, NOT TO THE NETWORK.
//   That makes it the odd one out among `dryrun-*`, and the difference is deliberate — do NOT
//   assume the convention from its siblings:
//     · dryrun-ingestion-guards.ts and dryrun-indices-guards.ts DO write. They exercise the real
//       reportIngestionError seam, so they insert SENTINEL rows (runRef "1990-01-01:…", cron
//       "_dryrun") and clean them up afterwards. They need a live database and cannot be build gates.
//     · THIS one exercises only the pure reject/accept decision, which happens BEFORE any fault is
//       reported. No fixture below breaches GUARD 1 (shape) or GUARD 2 (skip-rate), so
//       reportIngestionError is never reached and no row is ever written.
//   It imports the real providers, which transitively pull db/prisma.ts, so a pg Pool is CONSTRUCTED
//   — never connected, because the pool is lazy and nothing here issues a query. That is the same
//   allowance verify-catalogue-endpoint.ts carries, and it is declared for this file in
//   verify-build-gate-hygiene.ts's ENV_OR_DB_ALLOWANCE.
//
// ── WHY THIS IS A BUILD GATE AND NOT A `verify:all` SCRIPT ────────────────────────────────────────
// It reads only this checkout, touches no database, no network and no sibling repo, and is
// deterministic and instant. That is the whole admission test for `build`. It runs in `verify:copy`.
//
// ── WHY IT MUST EXIST AT ALL ──────────────────────────────────────────────────────────────────────
// MEASURED 2026-08-15: nsearchives does NOT 404 on a non-session date for the EQUITY archive. It
// returns HTTP 200 carrying the PRIOR session's file:
//     sec_bhavdata_full_05072026.csv  (Sunday)        → 200, every DATE1 "03-Jul-2026"
//     sec_bhavdata_full_01052026.csv  (Maharashtra Day) → 200, every DATE1 "30-Apr-2026"
// Every parser used to stamp the REQUESTED date onto every row without reading the file's own date
// column, so those rows landed as a FABRICATED SESSION — a full bar, volume and all, asserting the
// market traded on a day it did not. Five such sessions reached daily_prices before this was closed.
//
// ⚠ TWO OF THE SIX LANES CAN ONLY BE PROVEN SYNTHETICALLY, AND THAT IS THE POINT. The index and
//   udiff archives were MEASURED to 404 correctly on the same Sunday, so their hardening cannot be
//   demonstrated against live data — there is no live stale-200 to fetch. A fixture is the only way
//   to show they would reject one. They are hardened because they carry the identical latent flaw
//   and are protected only by upstream behaviour we do not control: behaviour that already differs
//   between sibling directories on the same host.
//
//   npx tsx src/scripts/dryrun-session-date.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import AdmZip from "adm-zip";
import { NseBhavcopyCsvProvider } from "../ingestions/prices/providers/nse-bhavcopy.js";
import { NseIndexCsvProvider } from "../ingestions/indices/providers/nse-index-bhavcopy.js";
import {
  parseUdiff,
  checkUdiffShape,
  checkUdiffTradeDate,
  calendarDaysBack,
  weekdaysBack,
} from "../ingestions/shared/udiff-bhavcopy.js";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}   (got: ${JSON.stringify(got)})`); }
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ── EQUITY fixtures — header MEASURED from the real sec_bhavdata_full ────────────────────────────
const EQ_COLS = ["SYMBOL","SERIES","DATE1","PREV_CLOSE","OPEN_PRICE","HIGH_PRICE","LOW_PRICE",
  "LAST_PRICE","CLOSE_PRICE","AVG_PRICE","TTL_TRD_QNTY","TURNOVER_LACS","NO_OF_TRADES","DELIV_QTY","DELIV_PER"];
function eqRow(i: number, date1: string): string {
  const b: Record<string, string> = { SYMBOL:`TEST${i}`, SERIES:"EQ", DATE1:date1, PREV_CLOSE:"100",
    OPEN_PRICE:"101", HIGH_PRICE:"105", LOW_PRICE:"99", LAST_PRICE:"103", CLOSE_PRICE:"103",
    AVG_PRICE:"102", TTL_TRD_QNTY:"10000", TURNOVER_LACS:"1030", NO_OF_TRADES:"500",
    DELIV_QTY:"5000", DELIV_PER:"50" };
  return EQ_COLS.map((c) => b[c]).join(",");
}
const eqCsv = (n: number, date1: string, extra: string[] = []) =>
  [EQ_COLS.join(","), ...Array.from({ length: n }, (_, i) => eqRow(i, date1)), ...extra].join("\n");

// ── INDEX fixtures — "Index Date" is DD-MM-YYYY, MEASURED ("13-08-2026") ─────────────────────────
const IDX_COLS = ["Index Name","Index Date","Open Index Value","High Index Value","Low Index Value",
  "Closing Index Value","Points Change","Change(%)","Volume","Turnover (Rs. Cr.)","P/E","P/B","Div Yield"];
const idxCsv = (n: number, d: string) =>
  [IDX_COLS.join(","), ...Array.from({ length: n }, (_, i) =>
    [`Nifty Test ${i}`, d, "100","105","99","103","3","2.5","1000","500","22.5","3.2","1.1"].join(","))].join("\n");

// ── UDIFF fixtures — TradDt is ISO YYYY-MM-DD, MEASURED ("2026-08-13") ───────────────────────────
const U_COLS = ["TradDt","BizDt","Sgmt","Src","FinInstrmTp","FinInstrmId","ISIN","TckrSymb","SctySrs",
  "XpryDt","FininstrmActlXpryDt","StrkPric","OptnTp","FinInstrmNm","OpnPric","HghPric","LwPric","ClsPric",
  "LastPric","PrvsClsgPric","UndrlygPric","SttlmPric","OpnIntrst","ChngInOpnIntrst","TtlTradgVol","TtlTrfVal",
  "TtlNbOfTxsExctd","SsnId","NewBrdLotQty","Rmks","Rsvd1","Rsvd2","Rsvd3","Rsvd4"];
function uRow(i: number, tradDt: string): string {
  const m: Record<string, string> = {};
  for (const c of U_COLS) m[c] = "";
  Object.assign(m, { TradDt: tradDt, BizDt: tradDt, ISIN: `INE000A0${String(i).padStart(4, "0")}`,
    TckrSymb: `T${i}`, SctySrs: "EQ", FinInstrmNm: `Test ${i}`, OpnPric: "101", HghPric: "105",
    LwPric: "99", ClsPric: "103", PrvsClsgPric: "100", TtlTradgVol: "1000", TtlTrfVal: "10300000" });
  return U_COLS.map((c) => m[c]).join(",");
}
function uZip(rows: string[]): Buffer {
  const csv = [U_COLS.join(","), ...rows].join("\n");
  const z = new AdmZip();
  z.addFile("BhavCopy_NSE_CM.csv", Buffer.from(csv, "utf8"));
  return z.toBuffer();
}

async function main() {
  rule("§1  EQUITY LANE (sec_bhavdata_full) — the lane that actually corrupted data");
  const eq = new NseBhavcopyCsvProvider();

  const real = await eq.processBhavcopyBody(eqCsv(202, "16-Aug-2022"), D("2022-08-16"));
  check("a real session is ACCEPTED", real.notASession === null);
  check("…and parses every EQ row — the guard changes nothing on a good day", real.prices.length === 202, real.prices.length);
  check("…and stamps the requested date", real.prices[0]?.date?.toISOString().slice(0, 10) === "2022-08-16");

  const holiday = await eq.processBhavcopyBody(eqCsv(3214, "30-Apr-2026"), D("2026-05-01"));
  check("WEEKDAY HOLIDAY (2026-05-01, file says 30-Apr) REJECTED", holiday.notASession !== null);
  check("…writes ZERO rows", holiday.prices.length === 0, holiday.prices.length);
  check("…classified stale", holiday.notASession?.kind === "stale", holiday.notASession?.kind);
  check("…names requested AND returned, for the operator",
    holiday.notASession?.requested === "2026-05-01" && !!holiday.notASession?.returned.includes("30-Apr-2026"));

  const sunday = await eq.processBhavcopyBody(eqCsv(3283, "03-Jul-2026"), D("2026-07-05"));
  check("THE SUNDAY CASE (2026-07-05, file says 03-Jul) REJECTED", sunday.notASession !== null);
  check("…writes ZERO rows — this is the 504-row corruption, refused", sunday.prices.length === 0, sunday.prices.length);

  // ★ The regression this guard must never cause: a GENUINE weekend session.
  const budgetSat = await eq.processBhavcopyBody(eqCsv(470, "01-Feb-2025"), D("2025-02-01"));
  check("★ BUDGET SATURDAY (2025-02-01) ACCEPTED — a real weekend session", budgetSat.notASession === null);
  check("…all its rows land", budgetSat.prices.length === 470, budgetSat.prices.length);

  const mixed = await eq.processBhavcopyBody(eqCsv(100, "16-Aug-2022", [eqRow(999, "15-Aug-2022")]), D("2022-08-16"));
  check("MIXED-DATE file REJECTED WHOLE", mixed.notASession?.kind === "mixed", mixed.notASession?.kind);
  check("…including the 100 rows that DID match — no salvaging", mixed.prices.length === 0, mixed.prices.length);
  check("…and the distinct set is logged, so a real mixed file teaches us its shape",
    (mixed.notASession?.returned ?? []).length === 2, mixed.notASession?.returned);

  const junk = await eq.processBhavcopyBody(eqCsv(10, "not-a-date"), D("2022-08-16"));
  check("UNPARSEABLE date REJECTED — fails closed, never assumes a match",
    junk.notASession?.kind === "unparseable", junk.notASession?.kind);

  rule("§2  INDEX LANE (ind_close_all) — 404s today; the stale-200 is PROVABLE ONLY SYNTHETICALLY");
  const idx = new NseIndexCsvProvider();

  const idxReal = await idx.processIndexBody(idxCsv(164, "13-08-2026"), D("2026-08-13"));
  check("a real index session is ACCEPTED", idxReal.notASession === null);
  check("…all indices land", idxReal.values.length === 164, idxReal.values.length);

  const idxStale = await idx.processIndexBody(idxCsv(164, "12-08-2026"), D("2026-08-13"));
  check("SIMULATED stale-200 REJECTED", idxStale.notASession?.kind === "stale", idxStale.notASession?.kind);
  check("…writes ZERO values", idxStale.values.length === 0, idxStale.values.length);

  // The formats are lane-specific and MEASURED different. Accepting the equity shape here would mean
  // the parser was sniffing rather than being told, which is how a guard silently starts passing.
  const idxWrongFmt = await idx.processIndexBody(idxCsv(10, "13-Aug-2026"), D("2026-08-13"));
  check("equity-format (DD-MMM-YYYY) date in an INDEX file REJECTED — no format sniffing",
    idxWrongFmt.notASession?.kind === "unparseable", idxWrongFmt.notASession?.kind);

  rule("§3  UDIFF LANE (BhavCopy_NSE_CM) — 404s today; also provable only synthetically");
  const uReal = parseUdiff(uZip(Array.from({ length: 50 }, (_, i) => uRow(i, "2026-08-13"))));
  check("udiff parses and exposes its TradDt values", uReal.ok === true && uReal.tradDates.length === 50);
  if (uReal.ok) {
    check("TradDt is asserted by GUARD 1 (shape)", checkUdiffShape(uReal.header).length === 0, checkUdiffShape(uReal.header));
    check("a real udiff session is ACCEPTED", checkUdiffTradeDate(uReal.tradDates, D("2026-08-13")) === null);
  }

  const uStale = parseUdiff(uZip(Array.from({ length: 50 }, (_, i) => uRow(i, "2026-08-12"))));
  check("SIMULATED stale-200 REJECTED",
    uStale.ok === true && checkUdiffTradeDate(uStale.tradDates, D("2026-08-13"))?.kind === "stale");

  const uMixed = parseUdiff(uZip([uRow(1, "2026-08-13"), uRow(2, "2026-08-12")]));
  check("MIXED udiff file REJECTED WHOLE",
    uMixed.ok === true && checkUdiffTradeDate(uMixed.tradDates, D("2026-08-13"))?.kind === "mixed");

  // If TradDt could vanish unnoticed, the date check would have nothing to compare and would
  // silently degrade to "accept" — the exact failure mode this whole guard exists to end.
  check("a missing TradDt FAILS GUARD 1 — the date check cannot silently degrade",
    checkUdiffShape(U_COLS.filter((c) => c !== "TradDt")).includes("TradDt"));

  rule("§4  THE WEEKEND SKIP IS GONE — genuine weekend sessions are reachable again");
  const cal = calendarDaysBack(D("2026-07-06"), 7).map((d) => d.toISOString().slice(0, 10));
  check("calendarDaysBack INCLUDES Saturday and Sunday",
    cal.includes("2026-07-04") && cal.includes("2026-07-05"), cal);
  const wd = weekdaysBack(D("2026-07-06"), 7).map((d) => d.toISOString().slice(0, 10));
  check("the deprecated weekdaysBack still excludes them — archived recon scripts unchanged",
    !wd.includes("2026-07-04") && !wd.includes("2026-07-05"), wd);

  console.log(`\n${"─".repeat(100)}\n  PASS ${pass}   FAIL ${fail}\n`);
  if (fail > 0) {
    console.error(
      `\n❌ ${fail} session-date assertion(s) failed. A lane that accepts a file dated other than the ` +
        `day it requested will fabricate sessions — a full bar, volume and all, on a day the market ` +
        `never opened. Fix the lane, not this gate.\n`,
    );
    process.exit(1);
  }
  console.log("✅ All six fetch-by-date paths reject a file that is not the session they asked for.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
