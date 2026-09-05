// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTROL-CHARACTER GATE — the scar this repo has now earned four times.
//
// ── ★ THE FAILURE, AND WHY IT IS UNIQUELY HARD TO SEE ────────────────────────────────────────────
// A `\b` word boundary written into a source file THROUGH A SCRIPT — a Python heredoc, a shell
// rewrite, any layer that processes escapes once more than intended — arrives as a literal 0x08
// BACKSPACE. The result is a regex that is syntactically perfect, reads correctly in every editor
// and every code review, and MATCHES NOTHING, because a backspace never appears in a sentence a
// human typed.
//
// It has happened four times here:
//
//   1-3 · in the router / reader families, one of which silently sent "what alerts do I have" to
//         the portfolio composition. families/reader.ts carries the note and the word-set fix.
//     4 · found by this stage's own self-test — a brand-new obligation reported "THE HARNESS DID
//         NOT CATCH IT", which is exactly what a negative control exists to say. Scanning the tree
//         for the byte then turned up SEVEN MORE, across five patterns in `composition/action.ts`,
//
//         all of them live and shipped:
//
//             alertFields    — the threshold, the direction and the percentage patterns
//             reminderFields — the event type and the lead-time patterns
//
//         Every alert and reminder form the chat has ever rendered came back with EMPTY fields, on
//         every input, because none of those five patterns could match. Nothing failed; the forms
//         just quietly asked the reader to type what we had already been told.
//
// ── ★ WHY A GATE RATHER THAN MORE CARE ───────────────────────────────────────────────────────────
// Care has been applied four times and lost four times. The byte is invisible in a listing, invisible
// in a diff, invisible in review, and produces no error at any stage — so the only thing that can
// catch it is something that looks for the byte. That is one `for` loop over the tree, and it turns
// a defect class that costs a live investigation into a build failure.
//
// ⚠ IT SCANS THE ESCAPE-SHAPED CONTROLS, NOT EVERY C0 BYTE. `\a` `\b` `\v` `\f` and ESC all reach
//   source the same way and are all just as unmatchable. NUL is deliberately NOT on the list: it is
//   a legitimate composite-key separator and this repo uses it as one (scoring/guardrail/
//   suppression-adapter.ts), so flagging it would make the gate cry wolf on correct code — and a
//   gate that is routinely overridden stops being a gate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");

/** Generated Prisma output is machine-written and not ours to police. */
const SKIP = new Set(["generated", "node_modules"]);

const NAMES: Record<number, string> = {
  7: "\\a BELL", 8: "\\b BACKSPACE — a word boundary that was escaped one time too many",
  11: "\\v VERTICAL TAB", 12: "\\f FORM FEED", 27: "ESC",
};

/**
 * The bytes this gate refuses.
 *
 * ⚠ WRITTEN AS CODE POINTS, NOT AS A CHARACTER CLASS. A regex literal `/[\x07\x08]/` in THIS file
 *   would be written through the same tooling that produces the defect, and a gate that catches the
 *   bug by containing the bug is not a gate. Numbers cannot be mangled.
 */
const BANNED = new Set(Object.keys(NAMES).map(Number));

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|cts)$/.test(e)) yield full;
  }
}

interface Hit { file: string; line: number; code: number; text: string }

function scan(): Hit[] {
  const out: Hit[] = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    // Cheap pre-filter — the overwhelming majority of files have none of these.
    if (![...src].some((ch) => isControl(ch.charCodeAt(0)))) continue;
    src.split("\n").forEach((line, i) => {
      for (const ch of line) {
        const code = ch.charCodeAt(0);
        if (!isControl(code)) continue;
        out.push({
          file: relative(process.cwd(), file),
          line: i + 1,
          code,
          // The byte is invisible, so the report renders it as its hex escape — otherwise the
          // failure message would be as unreadable as the source it is complaining about.
          text: Array.from(line)
            .map((c) => (isControl(c.charCodeAt(0)) ? `<0x${c.charCodeAt(0).toString(16).padStart(2, "0")}>` : c))
            .join("")
            .trim()
            .slice(0, 110),
        });
        break; // one report per line is enough to find it
      }
    });
  }
  return out;
}

const isControl = (code: number) => BANNED.has(code);

const hits = scan();
console.log("\n══ CONTROL CHARACTERS IN SOURCE ══");
if (hits.length === 0) {
  console.log(`  ✓ none — scanned every .ts/.tsx under src/ (excluding ${[...SKIP].join(", ")})`);
} else {
  for (const h of hits) {
    console.log(`  ✗ ${h.file}:${h.line}  [${NAMES[h.code] ?? `0x${h.code.toString(16)}`}]`);
    console.log(`      ${h.text}`);
  }
  console.log(`\n  ${hits.length} occurrence(s). These are almost certainly escape sequences that were`);
  console.log(`  processed one time too many on their way into the file. A regex containing one MATCHES`);
  console.log(`  NOTHING and fails silently — see this file's header. Rewrite the pattern, or express`);
  console.log(`  the test as a word-set membership check the way families/reader.ts does.`);
  process.exitCode = 1;
}
