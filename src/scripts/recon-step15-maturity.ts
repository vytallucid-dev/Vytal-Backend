// STEP 15 — GATE 0b (READ-ONLY). THE MATURITY QUESTION.
//
// A G-sec's whole story is coupon + maturity. From the NAME we can read the coupon ("GOI LOAN
// 6.64% 2027") and the maturity YEAR — but NOT the day/month, and inventing one would be a
// fabrication about a government bond's cash flows.
//
// BEFORE settling for a year-only maturity, check whether the file already carries the real thing.
// The udiff header has columns the shared reader does not currently parse:
//     XpryDt · FininstrmActlXpryDt · FinInstrmTp · FinInstrmId
// For a derivative those are the expiry. For a BOND, an expiry IS the maturity. If NSE populates
// them, exact maturity dates come free and nothing has to be guessed.
import AdmZip from "adm-zip";
import { fetchUdiff, weekdaysBack } from "../ingestions/shared/udiff-bhavcopy.js";

const GOVT = ["GS", "TB", "GB", "SG"];

let head: string[] = [];
let rows: Record<string, string>[] = [];
for (const d of weekdaysBack(new Date(), 8)) {
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const zip = new AdmZip(f.buffer);
  const e = zip.getEntries().find((x) => /\.csv$/i.test(x.name));
  if (!e) continue;
  const lines = e.getData().toString("utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  head = lines[0]!.split(",").map((s) => s.trim());
  rows = lines.slice(1).map((l) => {
    const c = l.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = c[i] ?? ""));
    return o;
  });
  console.log(`session ${d.toISOString().slice(0, 10)} · ${rows.length} rows\n`);
  break;
}

console.log("COLUMNS:", JSON.stringify(head), "\n");

for (const s of GOVT) {
  const hits = rows.filter((r) => (r.SctySrs ?? "").trim() === s);
  const filled = (col: string) => hits.filter((r) => (r[col] ?? "").trim() !== "").length;
  console.log(`── ${s} (${hits.length} rows) ──`);
  console.log(
    `   XpryDt filled: ${filled("XpryDt")}/${hits.length} · FininstrmActlXpryDt: ${filled("FininstrmActlXpryDt")}/${hits.length} · FinInstrmTp: ${filled("FinInstrmTp")}/${hits.length}`,
  );
  for (const h of hits.slice(0, 4)) {
    console.log(
      `   ${(h.TckrSymb ?? "").padEnd(13)} tp=${(h.FinInstrmTp ?? "-").padEnd(6)} XpryDt="${h.XpryDt ?? ""}" actlXpry="${h.FininstrmActlXpryDt ?? ""}"  ${h.FinInstrmNm}`,
    );
  }
  console.log("");
}

console.log(`VERDICT INPUTS:
  · XpryDt populated for the government series  → exact maturity, FREE. Store it.
  · XpryDt blank                                → the name gives coupon + maturity YEAR only.
    Store those; leave the exact maturity DATE honestly NULL rather than invent a day.
    (T-bills are the exception either way: their NAME carries a full date — "364D-08/07/27".)`);
