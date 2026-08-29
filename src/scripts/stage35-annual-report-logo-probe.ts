// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 35 — CAN WE HARVEST EQUITY LOGOS FROM ANNUAL-REPORT COVERS? A yield probe, not a pipeline.
//
//   npx tsx src/scripts/stage35-annual-report-logo-probe.ts [--n 9] [--out Logos/_probe]
//
// PROVEN on one company already: page 1 of Reliance's annual report contains exactly ONE raster
// image and it is the logo, 169x128 PNG with transparency. This measures whether that generalises,
// because one success is not a rate — and the answer decides whether the top-250 curation plan is
// worth building or whether the monogram fallback IS the equity design.
//
// ── THE CHAIN, ALL FROM BSE'S OWN ENDPOINTS ──────────────────────────────────────────────────────
//   ISIN → scrip code   (ListofScripData — the scrip master, matched on ISIN, never on name)
//   scrip code → PDFs   (AnnualReport_New)
//   newest PDF → page 1 → raster images   (extracted by a Python/PyMuPDF helper)
//
// ⚠ MATCHED ON ISIN, NOT NAME. Name matching is what put S7 Airlines' entity behind "SBI" when the
//   same question was asked of Wikidata. The scrip master carries ISIN, so there is no reason to
//   guess.
//
// ⚠ THE WHOLE PDF IS DOWNLOADED, AND THAT IS THE REAL COST. MEASURED: these files are 5-50 MB and
//   partial fetching does NOT work — the PDFs are linearized and BSE honours HTTP Range (206), but
//   the cross-reference STREAM defeats both plain truncation and head+tail splicing, so page 1
//   cannot be read without the rest of the file. At ~11 MB each, 2,290 companies is ~25 GB through a
//   host that throttled this project after ~90 SMALL xml files. That is why this is a probe over a
//   handful and not a run over the universe.
//
// ⚠ PYTHON + PyMuPDF IS AN OFFLINE TOOL HERE, NOT A NEW SERVICE DEPENDENCY. It is invoked as a
//   subprocess for a one-off harvest; nothing in the running product learns about it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../db/prisma.js";
import { BsePacer, BSE_API } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";

const argv = process.argv;
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const N = num("--n", 9);
const OUT = arg("--out", "Logos/_probe");

/** Page-1 image extraction, shelled out to PyMuPDF. Emits one JSON line. */
const PY = `
import sys, json, os
import pymupdf
pdf, outdir, stem = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    doc = pymupdf.open(pdf)
    page = doc[0]
    out = []
    for idx, x in enumerate(page.get_images(full=True)):
        try:
            i = doc.extract_image(x[0])
        except Exception:
            continue
        # A cover photo or full-bleed artwork is page-sized; a logo is not. Keep the plausible ones.
        if max(i["width"], i["height"]) < 32:
            continue
        name = f"{stem}-{idx}.{i['ext']}"
        open(os.path.join(outdir, name), "wb").write(i["image"])
        out.append({"w": i["width"], "h": i["height"], "ext": i["ext"], "kb": len(i["image"]) // 1024, "file": name})
    print(json.dumps({"pages": doc.page_count, "vectorOps": len(page.get_drawings()), "images": out}))
    doc.close()
except Exception as e:
    print(json.dumps({"error": str(e)[:160]}))
`;

interface Row { symbol: string; name: string; isin: string; tier: string }

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 35 — annual-report logo yield probe (n=${N})`);
  console.log("=".repeat(104));
  fs.mkdirSync(OUT, { recursive: true });
  const pyFile = path.join(OUT, "_extract.py");
  fs.writeFileSync(pyFile, PY);

  const per = Math.max(1, Math.round(N / 3));
  const rows = (await prisma.$queryRawUnsafe(`
    (SELECT symbol, name, isin, market_cap_category tier FROM stocks WHERE is_active AND market_cap_category='large_cap' ORDER BY random() LIMIT ${per})
    UNION ALL (SELECT symbol, name, isin, market_cap_category FROM stocks WHERE is_active AND market_cap_category='mid_cap' ORDER BY random() LIMIT ${per})
    UNION ALL (SELECT symbol, name, isin, market_cap_category FROM stocks WHERE is_active AND market_cap_category='small_cap' ORDER BY random() LIMIT ${per})`)) as Row[];

  const pacer = new BsePacer({ minSpacingMs: 2500 });
  console.log(`\n  fetching the BSE scrip master…`);
  const master = await fetchScripMaster(pacer);
  const byIsin = new Map(master.filter((m) => m.isin).map((m) => [m.isin as string, m]));
  console.log(`  scrip master: ${master.length} entries · ${byIsin.size} carry an ISIN\n`);

  let noScrip = 0, noReport = 0, dlFail = 0, noImage = 0, gotLogo = 0;
  let bytes = 0;
  const sizes: Array<{ symbol: string; w: number; h: number; ext: string }> = [];

  for (const s of rows) {
    const scrip = byIsin.get(s.isin)?.scripCode;
    if (!scrip) { noScrip++; console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} — not in the scrip master`); continue; }

    let pdfUrl: string | null = null;
    try {
      const r = await pacer.get(`${BSE_API}/AnnualReport_New/w?scripcode=${scrip}`, "application/json");
      const m = String(r.body).match(/https?:\/\/[^"']+\.pdf/i);
      pdfUrl = m ? m[0] : null;
    } catch { /* counted below */ }
    if (!pdfUrl) { noReport++; console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} — no annual report listed`); continue; }

    const pdfPath = path.join(OUT, `${s.symbol}.pdf`);
    try {
      const res = await fetch(pdfUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bseindia.com/" },
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      bytes += buf.length;
      fs.writeFileSync(pdfPath, buf);
    } catch (e) {
      dlFail++; console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} — download failed: ${String(e).slice(0, 60)}`); continue;
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(execFileSync("python", [pyFile, pdfPath, OUT, s.symbol], { encoding: "utf8", timeout: 120000 }).trim());
    } catch (e) { parsed = { error: String(e).slice(0, 90) }; }
    fs.unlinkSync(pdfPath);   // the PDF is 11 MB and we only wanted page 1

    const mb = (fs.existsSync(pdfPath) ? 0 : 0);
    if (parsed.error) { noImage++; console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} — extract failed: ${parsed.error}`); continue; }
    const imgs: Array<{ w: number; h: number; ext: string; kb: number; file: string }> = parsed.images ?? [];
    if (!imgs.length) {
      noImage++;
      console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} — page 1 has NO raster image (${parsed.vectorOps} vector ops — logo is probably vector)`);
      continue;
    }
    gotLogo++;
    const best = imgs.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    sizes.push({ symbol: s.symbol, w: best.w, h: best.h, ext: best.ext });
    console.log(`  ${s.symbol.padEnd(13)} ${s.tier.replace("_cap","").padEnd(6)} ✅ ${imgs.length} image(s) · largest ${best.w}×${best.h} ${best.ext} ${best.kb}KB${mb}`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  sampled                        ${rows.length}`);
  console.log(`  not in the scrip master        ${noScrip}`);
  console.log(`  no annual report listed        ${noReport}`);
  console.log(`  download failed                ${dlFail}`);
  console.log(`  page 1 had no raster image     ${noImage}`);
  console.log(`  YIELDED AT LEAST ONE IMAGE     ${gotLogo}  (${((gotLogo / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  downloaded                     ${(bytes / 1e6).toFixed(0)} MB for ${rows.length} companies (${(bytes / 1e6 / Math.max(1, rows.length)).toFixed(1)} MB each)`);
  if (sizes.length) {
    const long = sizes.map((s) => Math.max(s.w, s.h)).sort((a, b) => a - b);
    console.log(`\n  largest-image long edge: min ${long[0]} · median ${long[Math.floor(long.length / 2)]} · max ${long[long.length - 1]}`);
    console.log(`  at or above 180px: ${long.filter((l) => l >= 180).length}/${long.length} · at or above 512px: ${long.filter((l) => l >= 512).length}/${long.length}`);
  }
  console.log(`\n  extracted images kept in ${OUT}/ — LOOK AT THEM. A count is not a verdict on whether\n  the thing extracted is the logo rather than a cover photograph.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
