// STEP 10+11 (Option B) GATE 0 — READ-ONLY. THE MAKE-OR-BREAK MEMORY PROOF.
// npx tsx src/scripts/recon-step10b-memory.ts
//
// The brief asks: can the nightly job hold + process the universe in memory?
// The answer depends entirely on WHETHER YOU HOLD THE SERIES. This proves you don't have to.
//
// NAIVE shape:     materialise the 59 MB window body → parse to objects → per-scheme arrays.
//                  A JS string is UTF-16, so a 59 MB ASCII body is ~118 MB in heap ALONE, and
//                  11 M {date,nav} objects over a 5 y window is 1–2 GB. This OOMs.
//
// STREAMING shape: never materialise the body. Pipe the response, split on newlines, and fold
//                  each row straight into a per-scheme ACCUMULATOR. Peak memory is the
//                  accumulators + one line — independent of window size.
//
// This probe runs the STREAMING shape against a real live 90-day window and measures peak heap.
import https from "https";
import { createInterface } from "readline";
import v8 from "v8";

const MB = (b: number) => (b / 1048576).toFixed(1);
const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const f = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

let peakHeap = 0, peakRss = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed);
  peakRss = Math.max(peakRss, m.rss);
}, 50);

console.log(`node ${process.version}   heap_size_limit = ${MB(v8.getHeapStatistics().heap_size_limit)} MB`);
console.log(`baseline heapUsed = ${MB(process.memoryUsage().heapUsed)} MB\n`);

// ── The per-scheme streaming accumulator. THIS is the whole design. ──
// Everything Group-1 needs is computable from a fold + a 1-year lookback ring:
//   returns per horizon → nav at the first observation on/after each anchor date
//   volatility / Sharpe → running n, Σr, Σr²   (r = daily log return)
//   Sortino             → running Σ(min(r,0))²
//   max drawdown        → running peak + worst peak-to-trough
//   rolling 1Y returns  → a 260-slot ring of recent navs
// No full series is ever held.
const ROLL = 260; // ~1 trading year of lookback
class Acc {
  n = 0; sum = 0; sumsq = 0; downsq = 0; ndown = 0;
  firstNav = 0; firstDate = 0;
  lastNav = 0; lastDate = 0;
  prevNav = 0;
  peak = 0; maxDD = 0;
  ring = new Float64Array(ROLL); ringPos = 0; ringFull = false;
  rollMin = Infinity; rollMax = -Infinity; rollSum = 0; rollN = 0; rollPos = 0;

  push(date: number, nav: number) {
    if (this.n === 0) { this.firstNav = nav; this.firstDate = date; this.peak = nav; }
    else if (this.prevNav > 0 && nav > 0) {
      const r = Math.log(nav / this.prevNav);
      this.sum += r; this.sumsq += r * r;
      if (r < 0) { this.downsq += r * r; this.ndown++; }
    }
    if (nav > this.peak) this.peak = nav;
    if (this.peak > 0) { const dd = (nav - this.peak) / this.peak; if (dd < this.maxDD) this.maxDD = dd; }

    if (this.ringFull) {
      const old = this.ring[this.ringPos]!;
      if (old > 0) {
        const rr = nav / old - 1;
        this.rollN++; this.rollSum += rr;
        if (rr < this.rollMin) this.rollMin = rr;
        if (rr > this.rollMax) this.rollMax = rr;
        if (rr > 0) this.rollPos++;
      }
    }
    this.ring[this.ringPos] = nav;
    this.ringPos = (this.ringPos + 1) % ROLL;
    if (this.ringPos === 0) this.ringFull = true;

    this.prevNav = nav; this.lastNav = nav; this.lastDate = date; this.n++;
  }
}

const accs = new Map<string, Acc>();

// ── Stream a live 90-day window; NEVER materialise the body ──
const from = new Date(Date.UTC(2026, 3, 14));
const to = new Date(Date.UTC(2026, 6, 13));
const url = `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${f(from)}&todt=${f(to)}`;
console.log(`streaming ${url}\n`);

const MONTHS: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
let bytes = 0, dataRows = 0, blankNav = 0, badNav = 0, headerSeen = "";
const t0 = Date.now();

await new Promise<void>((resolve, reject) => {
  const go = (u: string, hop: number) => {
    https.get(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hop < 3) {
        res.resume(); go(new URL(loc, u).toString(), hop + 1); return;
      }
      res.on("data", (c: Buffer) => { bytes += c.length; });
      const rl = createInterface({ input: res, crlfDelay: Infinity });
      rl.on("line", (line) => {
        if (!line) return;
        if (line.startsWith("Scheme Code;")) { headerSeen ||= line; return; }
        // history cols: 0=code 1=name 2=isinG 3=isinR 4=nav 5=repurch 6=sale 7=date
        const p = line.split(";");
        if (p.length < 8) return;
        const code = p[0]!;
        if (!/^\d+$/.test(code)) return;
        const navRaw = p[4]!.trim();
        const dRaw = p[7]!.trim();
        dataRows++;
        if (navRaw === "" || navRaw === "-" || /^n\.?a\.?$/i.test(navRaw)) { blankNav++; return; } // absent → append NOTHING
        if (!/^\d+(\.\d*)?$/.test(navRaw)) { badNav++; return; }                                    // malformed → a fault
        const dm = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(dRaw);
        if (!dm) { badNav++; return; }
        const date = Date.UTC(+dm[3]!, MONTHS[dm[2]!]!, +dm[1]!) / 86400000; // day-number, an int
        const nav = Number(navRaw);
        let a = accs.get(code);
        if (!a) { a = new Acc(); accs.set(code, a); }
        a.push(date, nav);
      });
      rl.on("close", () => resolve());
      res.on("error", reject);
    }).on("error", reject);
  };
  go(url, 0);
});

clearInterval(sampler);
const m = process.memoryUsage();
const secs = (Date.now() - t0) / 1000;

console.log(`══ STREAMED, NOT MATERIALISED ══`);
console.log(`  wire bytes      : ${MB(bytes)} MB   in ${secs.toFixed(1)} s`);
console.log(`  data rows folded: ${dataRows.toLocaleString()}`);
console.log(`  schemes tracked : ${accs.size.toLocaleString()}`);
console.log(`  blank NAV rows  : ${blankNav}  (appended NOTHING — absent is not a data point)`);
console.log(`  malformed rows  : ${badNav}  (would be an IngestionError)`);
console.log(`  header          : ${headerSeen.slice(0, 60)}…`);

console.log(`\n══ MEMORY — the make-or-break number ══`);
console.log(`  peak heapUsed : ${MB(peakHeap)} MB`);
console.log(`  peak RSS      : ${MB(peakRss)} MB`);
console.log(`  final heapUsed: ${MB(m.heapUsed)} MB`);
console.log(`  accumulators  : ${accs.size} × (Float64Array(${ROLL}) + ~20 scalars) ≈ ${MB(accs.size * (ROLL * 8 + 200))} MB`);

console.log(`\n══ SCALING TO A 5-YEAR NIGHTLY WINDOW ══`);
console.log(`  A 5 y window = 20 × 90-day pulls, streamed CHRONOLOGICALLY into the SAME accumulators.`);
console.log(`  Rows folded  : ~${((dataRows * 20) / 1e6).toFixed(1)} M   (vs ~${((dataRows * 20 * 60) / 1e9).toFixed(1)} GB if held as JS objects)`);
console.log(`  Peak memory  : UNCHANGED — the accumulator set is bounded by SCHEME COUNT, not by`);
console.log(`                 window length. Streaming makes memory O(schemes), not O(rows).`);
console.log(`  ⇒ peak stays ≈ ${MB(peakRss)} MB regardless of how many years we fold in.`);

// Spot-check one fund's folded numbers so the accumulator is provably doing real work.
const [code, a] = [...accs.entries()].find(([, x]) => x.n > 50)!;
const ann = Math.sqrt(252);
const vol = a.n > 2 ? Math.sqrt(a.sumsq / (a.n - 1) - (a.sum / (a.n - 1)) ** 2 / (a.n - 1)) * ann : 0;
console.log(`\n══ SPOT-CHECK — scheme ${code} (folded, never stored) ══`);
console.log(`  points=${a.n}  first=${a.firstNav} @day${a.firstDate}  last=${a.lastNav} @day${a.lastDate}`);
console.log(`  window return = ${(((a.lastNav / a.firstNav) - 1) * 100).toFixed(2)}%`);
console.log(`  annualised vol≈ ${(vol * 100).toFixed(2)}%   maxDD = ${(a.maxDD * 100).toFixed(2)}%`);
