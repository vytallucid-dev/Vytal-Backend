// ═══════════════════════════════════════════════════════════════
// STEP 14 — COLLISION RECON (READ-ONLY. No writes, no load, no dedup, no migration.)
//
// THE CLAIM UNDER TEST: 3 trusts (CAPINVIT, INDIGRID, IRBINVIT) resolve to INF-prefix ISINs in the
// live NSE udiff bhavcopy, and at least one (IRBINVIT → INF788L01014) already exists in the
// catalogue as a mutual_fund row loaded by Step 9 from AMFI's NAVAll.txt.
//
// This script does not argue with the claim or defend an earlier measurement. It RE-DERIVES every
// fact from the live sources, from scratch:
//   A. The udiff bhavcopy — EVERY row for those 3 tickers, under EVERY series. Then: does ANY
//      INF-prefixed ISIN exist anywhere in that file, under any series at all?
//   B. The catalogue — is INF788L01014 there? Are the 3 trusts' actual ISINs there? What is?
//   C. AMFI NAVAll.txt — the Step-9 source. Is INF788L01014 in it? Under what section header, and
//      with what scheme name? (The name is the tell: "HDFC Top 100 Direct Growth" vs "IRB InvIT Fund".)
//   D. THE POPULATION QUESTION — how many of Step-9's 17,567 MF rows are actually InvIT-shaped?
//      This one is worth answering regardless of how A–C land.
// ═══════════════════════════════════════════════════════════════
import https from "https";
import AdmZip from "adm-zip";
import { prisma } from "../db/prisma.js";
import { fetchNavAll } from "../ingestions/amfi/amfi-source.js";

const rule = (s: string) => console.log("\n" + "═".repeat(80) + "\n" + s + "\n" + "═".repeat(80));
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

const TARGETS = ["CAPINVIT", "INDIGRID", "IRBINVIT"];
const CLAIMED_ISIN = "INF788L01014"; // the ISIN the claim attributes to IRBINVIT

function get(url: string): Promise<{ status: number; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("timeout")));
  });
}

// ═══════════════════════════════════════════════════════════════
rule("A · THE LIVE NSE udiff BHAVCOPY — every row for the 3 tickers, under EVERY series");
// ═══════════════════════════════════════════════════════════════
let head: string[] = [];
let rows: Record<string, string>[] = [];
let usedDate = "";

for (let i = 0; i < 8; i++) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - i);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const url = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${dd}_F_0000.csv.zip`;
  const r = await get(url);
  if (r.status !== 200) continue;
  const zip = new AdmZip(r.buffer);
  const e = zip.getEntries().find((x) => /\.csv$/i.test(x.name));
  if (!e) continue;
  const lines = e.getData().toString("utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  head = lines[0]!.split(",").map((s) => s.trim());
  rows = lines.slice(1).map((l) => {
    const c = l.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    head.forEach((h, k) => (o[h] = c[k] ?? ""));
    return o;
  });
  usedDate = `${y}-${m}-${dd}`;
  console.log(`file: ${url}\nrows: ${rows.length}\n`);
  break;
}

if (rows.length === 0) {
  console.log("!! could not fetch a udiff file — cannot proceed");
  await prisma.$disconnect();
  process.exit(1);
}

console.log("── EVERY row whose TckrSymb is one of the 3 targets (NO series filter) ──");
for (const t of TARGETS) {
  const hits = rows.filter((r) => (r.TckrSymb ?? "").trim() === t);
  if (hits.length === 0) console.log(`   ${t.padEnd(11)} — NOT PRESENT in this session's file`);
  for (const h of hits) {
    console.log(
      `   ${t.padEnd(11)} series=${(h.SctySrs ?? "").padEnd(3)} ISIN=${(h.ISIN ?? "").padEnd(14)} close=${(h.ClsPric ?? "").padStart(9)}  ${h.FinInstrmNm ?? ""}`,
    );
  }
}

console.log("\n── THE DECISIVE SWEEP: does ANY INF-prefixed ISIN appear in the udiff, under ANY series? ──");
const infRows = rows.filter((r) => (r.ISIN ?? "").trim().startsWith("INF"));
console.log(`   INF-prefixed rows in the whole file (all series): ${infRows.length}`);
for (const r of infRows.slice(0, 25)) {
  console.log(`     series=${(r.SctySrs ?? "").padEnd(3)} ${(r.TckrSymb ?? "").padEnd(14)} ${(r.ISIN ?? "").padEnd(14)} ${r.FinInstrmNm ?? ""}`);
}
if (infRows.length > 25) console.log(`     … ${infRows.length - 25} more`);

console.log(`\n── Is the CLAIMED ISIN ${CLAIMED_ISIN} anywhere in the udiff file (any series)? ──`);
const claimed = rows.filter((r) => (r.ISIN ?? "").trim() === CLAIMED_ISIN);
console.log(
  claimed.length === 0
    ? `   NOT FOUND in the ${usedDate} udiff bhavcopy at all.`
    : `   FOUND: ${J(claimed.map((c) => ({ sym: c.TckrSymb, series: c.SctySrs, name: c.FinInstrmNm })))}`,
);

console.log("\n── ISIN prefix census across ALL RR/IV (trust) rows in this file ──");
const trustRows = rows.filter((r) => ["RR", "IV"].includes((r.SctySrs ?? "").trim()));
const prefixes: Record<string, number> = {};
for (const r of trustRows) {
  const p = (r.ISIN ?? "").slice(0, 3);
  prefixes[p] = (prefixes[p] ?? 0) + 1;
}
console.log(`   ${trustRows.length} RR/IV rows · prefixes: ${J(prefixes)}`);

// ═══════════════════════════════════════════════════════════════
rule("B · THE CATALOGUE — what actually sits under these ISINs today?");
// ═══════════════════════════════════════════════════════════════
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);

console.log(`── Does an instruments row exist for the CLAIMED ISIN ${CLAIMED_ISIN}? ──`);
const claimedRow = await q(
  `SELECT isin, symbol, name, asset_class::text ac, amfi_scheme_code, fund_house, category,
          current_nav::text, nav_date::text, stock_id
     FROM instruments WHERE isin = $1`,
  CLAIMED_ISIN,
);
console.log(claimedRow.length === 0 ? "   NO ROW EXISTS with that ISIN." : `   ${J(claimedRow)}`);

console.log(`\n── The 3 targets' ACTUAL ISINs (as the live udiff states them) — what's in the catalogue? ──`);
for (const t of TARGETS) {
  const src = rows.find((r) => (r.TckrSymb ?? "").trim() === t && ["RR", "IV"].includes((r.SctySrs ?? "").trim()));
  if (!src) {
    console.log(`   ${t}: absent from this session's file`);
    continue;
  }
  const isin = (src.ISIN ?? "").trim();
  const inCat = await q(
    `SELECT isin, symbol, name, asset_class::text ac, amfi_scheme_code, fund_house, category,
            current_nav::text, nav_date::text
       FROM instruments WHERE isin = $1`,
    isin,
  );
  console.log(`   ${t.padEnd(11)} NSE ISIN=${isin}`);
  console.log(`      catalogue: ${inCat.length ? J(inCat[0]) : "(no row)"}`);
}

console.log("\n── Any INF-prefixed ISIN sitting under a NON-fund class in the catalogue? (the trespass query) ──");
console.log(`   ${J(await q(`SELECT isin, symbol, asset_class::text ac FROM instruments
                               WHERE isin LIKE 'INF%' AND asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass")`))}`);

console.log("\n── Do the 21 loaded trusts have ANY INF ISIN at all? ──");
console.log(
  `   ${J(await q(`SELECT count(*)::int total,
                          count(*) FILTER (WHERE isin LIKE 'INF%')::int inf,
                          count(*) FILTER (WHERE isin LIKE 'INE%')::int ine
                     FROM instruments WHERE asset_class IN ('reit','invit')`))}`,
);

// ═══════════════════════════════════════════════════════════════
rule("C · AMFI NAVAll.txt (the Step-9 source) — is the claimed ISIN there, and under what section?");
// ═══════════════════════════════════════════════════════════════
const amfi = await fetchNavAll();
console.log(`AMFI fetch: HTTP ${amfi.status}, ${amfi.bytes} bytes`);
const amfiLines = amfi.body.split(/\r?\n/);

// Stateful section walk — the same discipline the Step-9 parser uses: a row's class comes from the
// SECTION HEADER it sits under, never from its name.
let section = "(none)";
let amc = "(none)";
const hits: { isin: string; line: string; section: string; amc: string }[] = [];
const invitShaped: { isin: string; name: string; section: string; amc: string }[] = [];

const INVIT_NAME = /invit|infrastructure investment trust|\breit\b|real estate investment trust/i;

for (const raw of amfiLines) {
  const line = raw.trim();
  if (line === "") continue;
  if (!line.includes(";")) {
    // a bare line: either a scheme-type section header (contains "Scheme") or an AMC name
    if (/scheme/i.test(line)) section = line;
    else amc = line;
    continue;
  }
  const cols = line.split(";");
  const isinG = (cols[1] ?? "").trim();
  const isinR = (cols[2] ?? "").trim();
  const schemeName = (cols[3] ?? "").trim();

  if (isinG === CLAIMED_ISIN || isinR === CLAIMED_ISIN) {
    hits.push({ isin: CLAIMED_ISIN, line, section, amc });
  }
  if (INVIT_NAME.test(schemeName)) {
    invitShaped.push({ isin: isinG || isinR, name: schemeName, section, amc });
  }
}

console.log(`\n── Is ${CLAIMED_ISIN} present in AMFI NAVAll.txt? ──`);
if (hits.length === 0) {
  console.log(`   NOT PRESENT. AMFI's file does not contain that ISIN at all.`);
} else {
  for (const h of hits) {
    console.log(`   FOUND under section: "${h.section}"\n     AMC: ${h.amc}\n     line: ${h.line}`);
  }
}

console.log(`\n── AMFI scheme names that LOOK like an InvIT/REIT (the name tell) ──`);
console.log(`   ${invitShaped.length} matching scheme name(s) in the whole AMFI file`);
for (const v of invitShaped.slice(0, 20)) {
  console.log(`     ${v.isin.padEnd(14)} ${v.name}\n        section: ${v.section}`);
}

// ═══════════════════════════════════════════════════════════════
rule("D · THE POPULATION QUESTION — how many of Step-9's 17,567 MF rows are actually InvITs?");
// ═══════════════════════════════════════════════════════════════
const mfInvitShaped = await q(
  `SELECT isin, symbol, name, category, fund_house
     FROM instruments
    WHERE asset_class = 'mutual_fund'
      AND (name ~* 'invit' OR name ~* 'infrastructure investment trust'
           OR name ~* 'real estate investment trust' OR name ~* '\\mreit\\M')
    ORDER BY name`,
);
console.log(`MF rows whose NAME is InvIT/REIT-shaped: ${mfInvitShaped.length}`);
for (const r of mfInvitShaped.slice(0, 25)) {
  console.log(`   ${r.isin.padEnd(14)} [${r.category ?? "—"}] ${r.name}`);
}
if (mfInvitShaped.length > 25) console.log(`   … ${mfInvitShaped.length - 25} more`);

// The 21 trusts by NAME — does any MF row share a trust's NAME (as opposed to its ISIN)?
console.log("\n── Does any MF row carry one of the 21 loaded trusts' NAMES? (a name-level collision) ──");
const nameClash = await q(
  `SELECT t.symbol AS trust, t.name AS trust_name, m.isin AS mf_isin, m.name AS mf_name
     FROM instruments t
     JOIN instruments m
       ON m.asset_class = 'mutual_fund'
      AND upper(m.name) LIKE '%' || upper(split_part(t.name, ' ', 1)) || '%'
    WHERE t.asset_class IN ('reit','invit')
      AND length(split_part(t.name, ' ', 1)) >= 5
    ORDER BY t.symbol`,
);
console.log(`   ${nameClash.length} name-level overlap(s)`);
for (const n of nameClash.slice(0, 20)) {
  console.log(`     ${String(n.trust).padEnd(11)} "${n.trust_name}"  ~  MF ${n.mf_isin} "${n.mf_name}"`);
}

await prisma.$disconnect();
console.log("\n═══ COLLISION RECON COMPLETE — nothing was written. ═══");
