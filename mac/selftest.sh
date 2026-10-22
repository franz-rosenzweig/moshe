#!/bin/zsh
# Tests the shell from inside: builds Moshe with SelfTest/ linked in, runs it on
# a fresh copy of the sample library and checks what a person would press and
# see: the conformance checks, ⌘N making one sheet, ⌘B once, the menus, edits
# from another app arriving, pictures, PDF export, translation mode.
#
#   ./selftest.sh                       # every section
#   ./selftest.sh keys,menus            # some: load window conformance keys menus shortcuts outside images services pdf translation proof hebrew settings panes reload
#
# It runs as its own app (xyz.tiresia.moshe.selftest), so Moshe itself can stay
# open and keeps its settings. It takes the keyboard for about half a minute:
# leave the Mac alone meanwhile. Pictures and PDFs land in build/selftest/out.
set -euo pipefail
cd "${0:A:h}"

OUT=build/selftest
mkdir -p $OUT && rm -rf $OUT/out && mkdir -p $OUT/out/saved
[[ -f ../frontend/dist/index.html ]] || { echo "build the web app first: cd ../frontend && npm ci && npm run build" >&2; exit 2; }
command -v node >/dev/null || { echo "node is needed to make the sample library" >&2; exit 2; }

LIB=$(mktemp -d -t moshe-selftest)/library
node ../tools/sample-library.mjs $LIB >/dev/null
# The export's print HTML, as the page makes it, for the PDF check.
node --input-type=module -e '
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { exportSheets } = await import(process.argv[1] + "/../engine/src/export/index.js");
const [lib, out] = process.argv.slice(2);
const sheets = [];
const walk = (d) => { for (const n of readdirSync(d).sort()) { if (n.startsWith(".") || n.startsWith("_")) continue;
  const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".md")) sheets.push({ title: n.slice(0, -3), text: readFileSync(p, "utf8") }); } };
walk(join(lib, "Projects/Novel Without a Cause"));
walk(join(lib, "Notes"));
writeFileSync(join(out, "print-a4.html"), exportSheets(sheets, { format: "pdf-html", title: "Novel Without a Cause" }).text);
writeFileSync(join(out, "print-letter.html"), exportSheets(sheets, { format: "pdf-html", title: "Novel Without a Cause", pageSize: "Letter" }).text);
' "$PWD" "$LIB" "$PWD/$OUT/out"

clang -c -target "$(uname -m)-apple-macos14.0" SelfTest/hook.c -o $OUT/hook.o
# quiet unless it fails: the harness's one warning is CGWindowListCreateImage, deprecated but
# the only way to picture the app's own windows without the Screen Recording permission
MOSHE_OUT=$OUT MOSHE_BUNDLE_ID=xyz.tiresia.moshe.selftest MOSHE_EXTRA="SelfTest/SelfTest.swift $OUT/hook.o" \
    ./build.sh >$OUT/build.log 2>&1 || { cat $OUT/build.log; exit 1; }

ARGS=()
(( $# )) && ARGS+=(-SelfTestOnly "$1")
BIN=$PWD/$OUT/Moshe.app/Contents/MacOS/Moshe
( sleep 240; pkill -f "$BIN" ) 2>/dev/null &           # a stuck run ends after four minutes
watchdog=$!
open -W -n --stdout $OUT/out/log.txt --stderr $OUT/out/log.txt $OUT/Moshe.app \
    --args -libraryMode folder -libraryFolder "$LIB" -SelfTestOut "$PWD/$OUT/out" -SelfTestSaveDir "$PWD/$OUT/out/saved" \
    -ApplePersistenceIgnoreState YES "${ARGS[@]}"
kill $watchdog 2>/dev/null || true
rm -rf "${LIB:h}"
grep -E "^(SELFTEST|PASS|FAIL|SKIP|INFO|MENU)" $OUT/out/log.txt
grep -q "SELFTEST passed" $OUT/out/log.txt
