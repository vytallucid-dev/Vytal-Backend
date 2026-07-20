// ─────────────────────────────────────────────────────────────
// STEP 14 — GATE 0b RECON (READ-ONLY). THE ISIN SEAM HUNT.
//
// Gate 0a killed the prior recon's assumption:
//   · NSE sec_bhavdata_full  → carries SERIES (RR=6, IV=11) but NO ISIN column.
//   · NSE EQUITY_L.csv       → carries ISIN but NO RR/IV rows (EQ/BE/BZ only). 0/17.
//   · BSE EQ<ddmmyy>_CSV.ZIP → the legacy URL no longer returns a zip.
//
// So: where does a REIT/InvIT ISIN actually come from? Candidates, in preference order:
//   1. NSE udiff BhavCopy (BhavCopy_NSE_CM_0_0_0_<YYYYMMDD>_F_0000.csv.zip) — the MODERN
//      full CM bhavcopy. If it carries ISIN + SctySrs + ClsPric together, ONE file gives
//      identity AND price for all 17, the BSE join is dead, and there are NO no-ISIN gaps.
//   2. BSE's modern udiff bhavcopy (BhavCopy_BSE_CM_0_0_0_<YYYYMMDD>_F_0000.CSV).
//   3. NSE equity master list variants.
//
// Writes NOTHING.
// ─────────────────────────────────────────────────────────────
import https from "https";
import AdmZip from "adm-zip";

const rule = (s: string) => console.log("\n" + "═".repeat(78) + "\n" + s + "\n" + "═".repeat(78));

function get(url: string, binary = false, hop = 0): Promise<{ status: number; body: any; bytes: number; ctype: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,application/zip,application/octet-stream,*/*",
          Referer: "https://www.bseindia.com/",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && hop < 3) {
          res.resume();
          get(new URL(loc, url).toString(), binary, hop + 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status,
            body: binary ? buf : buf.toString("utf8"),
            bytes: buf.length,
            ctype: String(res.headers["content-type"] ?? ""),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("timeout")));
  });
}

function csv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines[0] ?? "").split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l) => {
    const c = l.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = c[i] ?? ""));
    return o;
  });
  return { head, rows };
}

function recentWeekdays(n = 8): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
  }
  return out;
}
const p2 = (n: number) => String(n).padStart(2, "0");
const dd = (d: Date) => p2(d.getUTCDate());
const mm = (d: Date) => p2(d.getUTCMonth() + 1);
const yyyy = (d: Date) => String(d.getUTCFullYear());

// The 17 live RR/IV symbols from Gate 0a.
const REITS = ["BAGMANE", "BIRET", "EMBASSY", "KRT", "MINDSPACE", "NXST"];
const INVITS = ["ANANTAM", "ANZEN", "CAPINVIT", "CITIUSINVT", "INDIGRID", "INDUSINVIT", "IRBINVIT", "NHIT", "PGINVIT", "RIIT", "VERTIS"];

// ═══════════════════════════════════════════════════════════════
rule("C1 · NSE udiff BhavCopy — does ONE file carry ISIN + series + close?");
// ═══════════════════════════════════════════════════════════════
for (const d of recentWeekdays(6)) {
  const url = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyy(d)}${mm(d)}${dd(d)}_F_0000.csv.zip`;
  try {
    const r = await get(url, true);
    if (r.status !== 200) {
      console.log(`  ${r.status} — ${url}`);
      continue;
    }
    let text: string;
    try {
      const zip = new AdmZip(r.body as Buffer);
      const e = zip.getEntries().find((x) => /\.csv$/i.test(x.name));
      if (!e) {
        console.log("  no csv inside zip");
        continue;
      }
      text = e.getData().toString("utf8");
    } catch {
      // maybe it is served as a plain csv despite the .zip name
      text = (r.body as Buffer).toString("utf8");
    }
    const p = csv(text);
    console.log(`✓ ${url}  (${r.bytes} bytes, ${p.rows.length} rows)`);
    console.log("HEADER:", JSON.stringify(p.head));

    const srsCol = p.head.find((h) => /^SctySrs$|SERIES/i.test(h)) ?? "";
    const isinCol = p.head.find((h) => /ISIN/i.test(h)) ?? "";
    const tkrCol = p.head.find((h) => /^TckrSymb$|^SYMBOL$/i.test(h)) ?? "";
    const clsCol = p.head.find((h) => /^ClsPric$|CLOSE/i.test(h)) ?? "";
    const nmCol = p.head.find((h) => /FinInstrmNm|SecurityName|NAME/i.test(h)) ?? "";
    console.log(`cols → ticker=${tkrCol} series=${srsCol} isin=${isinCol} close=${clsCol} name=${nmCol}`);

    const hist: Record<string, number> = {};
    for (const row of p.rows) {
      const s = (row[srsCol] ?? "").trim();
      hist[s] = (hist[s] ?? 0) + 1;
    }
    console.log("SERIES HISTOGRAM:", JSON.stringify(hist));

    let resolved = 0;
    const gaps: string[] = [];
    for (const series of ["RR", "IV"]) {
      const hits = p.rows.filter((row) => (row[srsCol] ?? "").trim() === series);
      console.log(`\n── udiff SERIES ${series} (${series === "RR" ? "REIT" : "InvIT"}) — ${hits.length} rows ──`);
      for (const h of hits) {
        const isin = (h[isinCol] ?? "").trim();
        if (isin) resolved++;
        else gaps.push((h[tkrCol] ?? "").trim());
        console.log(
          `   ${(h[tkrCol] ?? "").padEnd(12)} isin=${(isin || "(NONE)").padEnd(14)} close=${(h[clsCol] ?? "").padStart(9)}  ${h[nmCol] ?? ""}`,
        );
      }
    }
    console.log(`\n   *** udiff RESOLVED ${resolved} ISINs · gaps: ${gaps.length ? gaps.join(", ") : "(none)"} ***`);

    // Cross-check: does every symbol from the sec_bhavdata_full RR/IV set appear here?
    const present = new Set(p.rows.filter((row) => ["RR", "IV"].includes((row[srsCol] ?? "").trim())).map((row) => (row[tkrCol] ?? "").trim()));
    const missing = [...REITS, ...INVITS].filter((s) => !present.has(s));
    console.log(`   cross-check vs sec_bhavdata_full's 17: missing from udiff = ${missing.length ? missing.join(", ") : "(none — all 17 present)"}`);

    // ISIN prefix census (INE vs INF — the trespass-guard question).
    const prefixes: Record<string, number> = {};
    for (const row of p.rows) {
      if (!["RR", "IV"].includes((row[srsCol] ?? "").trim())) continue;
      const pre = (row[isinCol] ?? "").trim().slice(0, 3);
      if (pre) prefixes[pre] = (prefixes[pre] ?? 0) + 1;
    }
    console.log("   ISIN PREFIX CENSUS (RR/IV):", JSON.stringify(prefixes), "← INF% would trip the Step-9 trespass guard");
    break;
  } catch (err) {
    console.log(`  err ${url}: ${(err as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
rule("C2 · BSE udiff BhavCopy — the independent ISIN corroboration");
// ═══════════════════════════════════════════════════════════════
for (const d of recentWeekdays(4)) {
  const url = `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyy(d)}${mm(d)}${dd(d)}_F_0000.CSV`;
  try {
    const r = await get(url);
    if (r.status !== 200 || !String(r.body).includes(",")) {
      console.log(`  ${r.status} (${r.ctype}) — ${url}`);
      continue;
    }
    const p = csv(r.body);
    console.log(`✓ ${url} (${r.bytes} bytes, ${p.rows.length} rows)`);
    console.log("HEADER:", JSON.stringify(p.head));
    const isinCol = p.head.find((h) => /ISIN/i.test(h)) ?? "";
    const nmCol = p.head.find((h) => /FinInstrmNm/i.test(h)) ?? "";
    const tkrCol = p.head.find((h) => /TckrSymb/i.test(h)) ?? "";
    const needles = ["EMBASSY", "MINDSPACE", "BROOKFIELD", "NEXUS", "BAGMANE", "KNOWLEDGE", "IRB INVIT", "INDIGRID", "POWERGRID", "ANZEN", "NHIT", "VERTIS", "CAPITAL INFRA", "ANANTAM", "CITIUS", "INDUS INFRA", "RELIANCE INFRA"];
    console.log("\n── BSE name-match probe (REIT/InvIT candidates) ──");
    for (const row of p.rows) {
      const nm = (row[nmCol] ?? "").toUpperCase();
      if (needles.some((n) => nm.includes(n))) {
        console.log(`   ${(row[tkrCol] ?? "").padEnd(12)} isin=${(row[isinCol] ?? "").padEnd(14)} ${row[nmCol]}`);
      }
    }
    break;
  } catch (err) {
    console.log(`  err ${url}: ${(err as Error).message}`);
  }
}

console.log("\n═══ GATE 0b COMPLETE — nothing was written. ═══");
