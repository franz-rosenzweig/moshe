#!/usr/bin/env python3
"""The real app in a real browser, and the files on disk after each step.

Runs twice: once as the web app on the server's folder (the page's storage is
the server, over HTTP), once as the Mac and Android apps run it (the page's
storage is a folder behind the bridge, played by tools/bridge_sim.py). Each
run starts from a fresh sample library in /tmp, never a real one.

    tools/e2e.py [--devtools http://<chrome>:9222]

It starts its own server container (moshe-e2e) and simulator, and removes them.
"""
import argparse, asyncio, json, math, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
from cdp import Browser

FAILURES = []
SIM_PORT = 8441


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(name)
    return ok


def sh(*a, **k):
    return subprocess.run(a, check=True, capture_output=True, text=True, **k).stdout.strip()


def fresh_library(path: Path):
    if path.exists():
        shutil.rmtree(path)
    sh("docker", "run", "--rm", "-u", f"{__import__('os').getuid()}:{__import__('os').getgid()}", "-v", f"{REPO}:/repo", "-v", "/tmp:/tmp",
       "-w", "/repo", "node:22-alpine", "node", "tools/sample-library.mjs", str(path))


def start_server(root: Path) -> str:
    subprocess.run(["docker", "rm", "-f", "moshe-e2e"], capture_output=True)
    sh("docker", "run", "-d", "--name", "moshe-e2e", "--network", "docker_default", "-u", f"{__import__('os').getuid()}:{__import__('os').getgid()}",
       "-v", f"{REPO}:/app:ro", "-v", f"{root}:/data", "-e", "MOSHE_ROOT=/data", "-e", "MOSHE_STATIC=/app/frontend/dist",
       "-e", "MOSHE_AUTH_FILE=/tmp/auth.json", "node:22-alpine", "node", "/app/server/src/main.js")
    ip = sh("docker", "inspect", "moshe-e2e", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}")
    url = f"http://{ip}:8430"
    for _ in range(40):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=2)
            return url
        except Exception:
            time.sleep(0.25)
    raise SystemExit("the e2e server did not come up")


SHELL = """
(() => {
  const SIM = __SIM__, MODE = __MODE__;
  const realFetch = window.fetch.bind(window);
  let chain = Promise.resolve();
  const call = (msg) => {
    const p = chain.then(() => realFetch(SIM + '/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).then((r) => r.json()));
    chain = p.catch(() => {});
    return p;
  };
  if (MODE === 'webkit') window.webkit = { messageHandlers: { mosheStorage: { postMessage: (msg) => call(msg) } } };
  else {
    let n = 0;
    window.MosheStorage = { request(id, json) { call(JSON.parse(json)).then((reply) => setTimeout(() => window.__mosheStorageReply(id, JSON.stringify(reply)), (n++ * 7) % 5)); } };
  }
})();
"""


async def until(fn, timeout=8.0, every=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        await asyncio.sleep(every)
    return fn()


async def enter(b):
    for t in ("keyDown", "keyUp"):
        await b.send("Input.dispatchKeyEvent", {"type": t, "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, **({"text": "\r"} if t == "keyDown" else {})})


async def press(b, key, code, vk, modifiers=0):
    for t in ("keyDown", "keyUp"):
        await b.send("Input.dispatchKeyEvent", {"type": t, "key": key, "code": code, "windowsVirtualKeyCode": vk, "modifiers": modifiers})


async def tab(b, shift=False):
    await press(b, "Tab", "Tab", 9, 8 if shift else 0)


WORD_RECT = """const word = %s, nth = %d; const host = document.querySelector('.cm-content'); const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let n = 0, node; while ((node = tw.nextNode())) { let i = -1; while ((i = node.data.indexOf(word, i + 1)) >= 0) { if (n++ === nth) {
    const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length); const b = r.getBoundingClientRect(); return {l: b.left, r: b.right, t: b.top, b: b.bottom}; } } }
  return null;"""


async def word_rect(b, word, nth=0):
    """Where a word is drawn in the editor, on screen."""
    return await b.js(WORD_RECT % (json.dumps(word), nth))


async def pen(b, pts):
    """A stroke of a pen (with pressure) through the points, as a tablet's pen sends it."""
    await b.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": pts[0][0], "y": pts[0][1], "button": "left", "buttons": 1, "clickCount": 1, "pointerType": "pen", "force": 0.5})
    for x, y in pts[1:]:
        await b.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "left", "buttons": 1, "pointerType": "pen", "force": 0.5})
    await b.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": pts[-1][0], "y": pts[-1][1], "button": "left", "buttons": 0, "clickCount": 1, "pointerType": "pen", "force": 0})


def seg(a, b, n=16):
    return [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]


async def type_in_editor(b, text):
    await b.js("document.querySelector('.cm-content').focus(); return true;")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line:
            await b.type(line)
        if i < len(lines) - 1:
            await enter(b)


async def run(b, url, root: Path, mode: str, sim_url: str | None):
    print(f"\n==== {mode}")
    await b.size(1600, 1000)
    await b.goto(url, 0.4)
    await b.js("localStorage.clear(); return true;")
    if sim_url:
        await b.send("Page.addScriptToEvaluateOnNewDocument", {"source": SHELL.replace("__SIM__", json.dumps(sim_url)).replace("__MODE__", json.dumps(mode))})
    await b.goto(url, 0.5)
    ok = await b.wait_for("!!window.__mosheLocal && !!document.querySelector('.window')", 25)
    check("the app opens", bool(ok))
    check("on the right storage", await b.js("return window.__mosheLocal.mode;") == ("folder" if sim_url else "server"))
    names = await b.js("return [...document.querySelectorAll('.library .row')].map(r => r.textContent.trim());")
    check("the library shows the folder's groups and projects", "Getting Started" in names and "Novel Without a Cause" in names, str(names))

    print("\nA new sheet, typed, is a file named from its first line")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.3)
    await b.js("window.mosheCommand('newSheet'); return true;")
    await asyncio.sleep(0.4)
    await type_in_editor(b, "# Made in the browser\nSome text, and **strong** text.")
    f = root / "Notes" / "Made in the browser.md"
    got = await until(lambda: f.exists() and "strong" in f.read_text(), 6)
    check("Notes/Made in the browser.md holds what was typed", bool(got), str(sorted(p.name for p in (root / 'Notes').glob('*.md'))))
    if f.exists():
        check("exactly, with its tags", f.read_text() == "# Made in the browser\nSome text, and **strong** text.", repr(f.read_text()))

    print("\nAn edit made elsewhere reaches the open sheet")
    f.write_text(f.read_text() + "\nA line from Obsidian.")
    if sim_url:
        await b.js("window.__mosheFilesChanged && window.__mosheFilesChanged(); return true;")
    shown = await b.wait_for("document.querySelector('.cm-content').textContent.includes('A line from Obsidian')", 8)
    check("the editor shows it without being reopened", bool(shown))

    print("\nTyping while someone else edits: both kept")
    await b.js("const v = document.querySelector('.cm-content'); v.focus(); return true;")
    await b.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await b.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await enter(b)
    await b.type("Typed in Moshe.")
    f.write_text(f.read_text().replace("Some text", "Some edited text"))
    await asyncio.sleep(2.5)
    if sim_url:
        await b.js("window.__mosheFilesChanged && window.__mosheFilesChanged(); return true;")
    merged = await until(lambda: "Some edited text" in f.read_text() and "Typed in Moshe." in f.read_text(), 8)
    check("the file has both edits", bool(merged), repr(f.read_text()))

    print("\nTyping, then at once another sheet, or the trash")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Getting Started').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("document.querySelectorAll('.card')[1].click(); return true;")
    await asyncio.sleep(0.4)
    await type_in_editor(b, "")
    await b.js("const v = document.querySelector('.cm-content'); v.focus(); return true;")
    await b.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await b.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await b.type("Switched away at once.")
    await b.js("document.querySelectorAll('.card')[2].click(); return true;")
    gs = root / "Notes" / "Getting Started"
    kept = await until(lambda: any("Switched away at once." in p.read_text() for p in gs.glob("*.md")), 6)
    check("what was typed just before switching sheets is saved", bool(kept))
    await b.js("const v = document.querySelector('.cm-content'); v.focus(); return true;")
    await b.send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await b.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End", "code": "End", "windowsVirtualKeyCode": 35, "modifiers": 2})
    await b.type("Trashed at once.")
    before = sorted(p.name for p in gs.glob("*.md"))
    await b.js("window.mosheCommand('trash'); return true;")
    gone = await until(lambda: any("Trashed at once." in p.read_text() for p in (root / ".moshe" / "trash").glob("*.md")), 6)
    check("what was typed just before the trash is in the trashed sheet", bool(gone))
    await asyncio.sleep(1.5)
    check("and nothing is written back where it was", len(list(gs.glob("*.md"))) == len(before) - 1, str(sorted(p.name for p in gs.glob("*.md"))))

    print("\nTab, tables, lists and undo, as the Mac's menus use them")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.3)
    await b.js("window.mosheCommand('newSheet'); return true;")
    await asyncio.sleep(0.4)
    await type_in_editor(b, "# Typing\n")
    await b.js("window.mosheCommand('insert', 'table'); return true;")
    for i, word in enumerate(["Feature", "Status", "Tables", "work", "x"]):
        if i:
            await tab(b)
        await b.type(word)
    in_editor = await b.js("return !!document.activeElement.closest('.cm-editor');")
    await press(b, "End", "End", 35, 2)
    await enter(b)
    await b.type("Plain")
    await tab(b)
    await b.type("text")
    await enter(b)
    await b.type("- a")
    await enter(b)
    await tab(b)
    await b.type("b")
    for _ in range(3):
        await enter(b)
    await b.type("After")
    await tab(b, shift=True)
    t = root / "Notes" / "Typing.md"
    want = "# Typing\n\n| Feature | Status |\n| --- | --- |\n| Tables | work |\n| x |  |\nPlain\ttext\n- a\n\t- b\n\nAfter"
    got = await until(lambda: t.exists() and t.read_text() == want, 6)
    check("Tab goes from cell to cell, adds a row, types a tab, indents a list; ending a list leaves a blank line", bool(got), repr(t.read_text() if t.exists() else None))
    check("and the editor keeps the focus", bool(in_editor) and await b.js("return !!document.activeElement.closest('.cm-editor');"))
    await b.type(" it")
    await b.js("window.mosheCommand('insert', 'footnote'); return true;")
    await b.js("window.mosheCommand('undo'); return true;")
    text = await b.js("return window.__mosheStore && document.querySelector('.cm-content').textContent;")
    check("Undo from the menu takes back the footnote, not the words before it", text.endswith("After it"), repr(text[-30:]))
    await b.js("window.mosheCommand('redo'); return true;")
    text = await b.js("return document.querySelector('.cm-content').textContent;")
    state = await b.js("return window.mosheMenuState();")
    check("Redo puts it back, and the menu knows there is something to undo", text.endswith("After it^[]") and state.get("canUndo") and not state.get("canRedo"), repr(text[-30:]) + " " + str({k: state.get(k) for k in ("canUndo", "canRedo")}))

    print("\nThe menus' keys are the menus', not the code editor's (⇧⌘K, ⌘], ⌘/)")
    await b.js("window.mosheCommand('newSheet'); return true;")
    await asyncio.sleep(0.4)
    await type_in_editor(b, "# Keys\nA line to keep.")
    await press(b, "K", "KeyK", 75, 2 | 8)
    kw = await b.wait_for("[...document.querySelectorAll('.dialog h3')].some(h => h.textContent === 'Keywords')", 4)
    check("⇧⌘K opens Keywords (which opens at all)", bool(kw))
    await press(b, "Escape", "Escape", 27)
    check("and Escape closes it, though the editor kept the keyboard", bool(await b.wait_for("!document.querySelector('.dialog')", 2)))
    await b.js("document.querySelector('.cm-content').focus(); return true;")
    await press(b, "]", "BracketRight", 221, 2)
    await press(b, "/", "Slash", 191, 2)
    await asyncio.sleep(1.2)
    kf = root / "Notes" / "Keys.md"
    check("and the line stays, unindented", kf.exists() and kf.read_text() == "# Keys\nA line to keep.", repr(kf.read_text() if kf.exists() else None))

    print("\nInsert › Table in the middle of a paragraph")
    await b.js("document.querySelector('.cm-content').focus(); return true;")
    await press(b, "End", "End", 35, 2)
    await press(b, "Home", "Home", 36)
    for _ in range(2):
        await press(b, "ArrowRight", "ArrowRight", 39)
    await b.js("window.mosheCommand('insert', 'table'); return true;")
    await b.type("Cell")
    got = await until(lambda: kf.read_text() == "# Keys\nA line to keep.\n\n| Cell |  |\n| --- | --- |\n|  |  |", 5)
    check("goes after the paragraph, with a blank line, the caret in its first cell", bool(got), repr(kf.read_text()))

    print("\nThe sheet list: Shift-↓ picks a run of sheets")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Getting Started').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("document.querySelectorAll('.card')[0].click(); document.querySelector('section.list').focus(); return true;")
    await asyncio.sleep(0.3)
    for _ in range(2):
        await press(b, "ArrowDown", "ArrowDown", 40, 8)
    n = await b.js("return document.querySelectorAll('.card.sel').length;")
    check("three sheets picked after two presses", n == 3, str(n))

    print("\nA long sheet scrolled down, then a short one: the short one from its top")
    await b.js("""const p = window.__mosheStore.createSheet('Notes', {text: '# Long\\n' + Array.from({length: 300}, (_, i) => 'Paragraph ' + i + ' of the long sheet.').join('\\n')}); window.__longSheet = p; return true;""")
    await asyncio.sleep(0.4)
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Long')).click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("const s = document.querySelector('.cm-scroller'); s.scrollTop = s.scrollHeight; return true;")
    await asyncio.sleep(0.3)
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Keys')).click(); return true;")
    await asyncio.sleep(0.5)
    top = await b.js("const s = document.querySelector('.cm-scroller'), l = document.querySelector('.cm-line'); const r = l.getBoundingClientRect(), q = s.getBoundingClientRect(); return r.top >= q.top && r.bottom <= q.bottom;")
    check("its first line is on screen", bool(top))
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Long')).click(); return true;")
    await asyncio.sleep(0.5)
    back_at = await b.js("return document.querySelector('.cm-scroller').scrollTop;")
    check("and the long one back where it was left", back_at > 2000, str(back_at))

    print("\nParagraph numbers stand clear of hanging tags")
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Keys')).click(); return true;")
    await b.js("window.mosheCommand('toggleParagraphNumbers'); return true;")
    await asyncio.sleep(0.5)
    clear = await b.js("""const l = document.querySelector('.cm-line.cm-heading'); const t = l.querySelector('.cm-tag-h');
        const before = getComputedStyle(l, '::before'); const right = l.getBoundingClientRect().left + parseFloat(before.left) + parseFloat(before.width);
        return [right, t.getBoundingClientRect().left];""")
    check("the heading's number ends before its #", clear[0] <= clear[1] + 0.5, str(clear))
    await b.js("window.mosheCommand('toggleParagraphNumbers'); return true;")

    if sim_url:
        print("\nBrowse Backups in a folder library")
        await b.js("window.mosheCommand('browseBackups'); return true;")
        said = await b.wait_for("(document.querySelector('[aria-label=Backups]') || {}).textContent?.includes('folder on this device')", 4)
        check("says where the backups are, not that the server will make one", bool(said))
        await b.js("document.querySelector('[aria-label=Backups] .x').click(); return true;")

    print("\nPen marks in Revision Mode: strike, scribble, caret, circle")
    pf = root / "Notes" / "Pen marks.md"
    await b.js("window.__mosheStore.createSheet('Notes', {text: '# Pen marks\\nThe quick brown fox jumps over the lazy dog.\\nשלום עולם יפה מאוד.'}); return true;")
    await asyncio.sleep(0.4)
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Pen marks')).click(); return true;")
    await b.wait_for("document.querySelector('.cm-content').textContent.includes('lazy dog')", 5)
    await asyncio.sleep(0.3)
    r = await word_rect(b, "quick")
    await pen(b, seg((r["l"] - 2, (r["t"] + r["b"]) / 2), (r["r"] + 2, (r["t"] + r["b"]) / 2)))
    await asyncio.sleep(1.2)
    check("outside Revision Mode the pen marks nothing", "{--" not in pf.read_text(), pf.read_text())
    await b.js("window.mosheCommand('revision'); return true;")
    await asyncio.sleep(0.8)
    line1 = lambda: pf.read_text().split("\n")[1]
    r = await word_rect(b, "quick"); y = (r["t"] + r["b"]) / 2
    await pen(b, seg((r["l"] - 2, y), (r["r"] + 2, y + 1)))
    got = await until(lambda: "{--quick--}" in line1(), 4)
    check("a strike through a word deletes it, as a revision", bool(got), line1())
    r = await word_rect(b, "quick"); y = (r["t"] + r["b"]) / 2; w = r["r"] - r["l"]
    zig = [(r["l"] + (w if k % 2 else 0), y + (k % 3) - 1) for k in range(7)]
    await pen(b, [p for i in range(1, len(zig)) for p in seg(zig[i - 1], zig[i], 8)])
    got = await until(lambda: line1() == "The quick brown fox jumps over the lazy dog.", 4)
    check("a scribble over it takes the deletion back", bool(got), line1())
    a_, f_ = await word_rect(b, "brown"), await word_rect(b, "fox")
    x = (a_["r"] + f_["l"]) / 2; top = a_["t"] + 3; foot = a_["b"] + 6
    await pen(b, seg((x - 6, foot), (x, top), 10) + seg((x, top), (x + 6, foot), 10)[1:])
    box = await b.wait_for("!!document.querySelector('.writebox')", 3)
    check("a caret between two words opens the writing box", bool(box))
    await b.send("Input.insertText", {"text": "red"})
    await enter(b)
    got = await until(lambda: re.search(r"brown ?\{\+\+ ?red ?\+\+\} ?fox", line1()), 4)
    check("and what's written there is an insertion", bool(got), line1())
    l_, d_ = await word_rect(b, "lazy"), await word_rect(b, "dog")
    cx = (l_["l"] + d_["r"]) / 2; cy = (l_["t"] + l_["b"]) / 2; rx = (d_["r"] - l_["l"]) / 2 + 10; ry = (l_["b"] - l_["t"]) / 2 + 6
    await pen(b, [(cx + rx * math.cos(t / 40 * 2.15 * math.pi), cy + ry * math.sin(t / 40 * 2.15 * math.pi)) for t in range(41)])
    await b.wait_for("!!document.querySelector('.writebox')", 3)
    await b.send("Input.insertText", {"text": "too cute"})
    await b.js("document.querySelector('.writebox .btn.primary').click(); return true;")
    got = await until(lambda: "{==lazy dog==}{>>too cute<<}." in line1(), 4)
    check("a circle round words highlights them, with the comment written for it", bool(got), line1())
    await b.js("window.mosheCommand('undo'); return true;")
    got = await until(lambda: "{==" not in line1() and "{++" in line1(), 4)
    check("and Undo takes back one mark at a time", bool(got), line1())
    h = await word_rect(b, "עולם"); y = (h["t"] + h["b"]) / 2
    await pen(b, seg((h["r"] + 2, y), (h["l"] - 2, y + 1)))
    got = await until(lambda: "{--עולם--}" in pf.read_text(), 4)
    check("a strike through a Hebrew word, right to left", bool(got), pf.read_text().split("\n")[2])
    await pen(b, seg((700, 260), (701, 560)))
    toast = await b.wait_for("[...document.querySelectorAll('.toast, [class*=toast]')].some(t => t.textContent.includes('caret'))", 3)
    check("a stroke that isn't a mark says what the marks are, and changes nothing", bool(toast) and "{--עולם--}" in pf.read_text())
    await b.js("window.mosheCommand('revision'); return true;")

    print("\nSketches: drawn with the pen, saved beside the sheet, drawn on again")
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Pen marks')).click(); return true;")
    await b.wait_for("document.querySelector('.cm-content').textContent.includes('lazy')", 5)
    await b.js("document.querySelector('.cm-content').focus(); return true;")
    await press(b, "End", "End", 35, 2)
    await b.js("window.mosheCommand('insert', 'sketch'); return true;")
    check("Insert › Sketch opens a sheet of paper", bool(await b.wait_for("!!document.querySelector('[aria-label=Sketch] canvas')", 4)))
    c = await b.js("const r = document.querySelector('[aria-label=Sketch] canvas').getBoundingClientRect(); return {l: r.left, t: r.top};")
    wave = lambda x0, y0: [(x0 + i * 6, y0 + math.sin(i / 3) * 30) for i in range(40)]
    await pen(b, wave(c["l"] + 100, c["t"] + 150))
    await b.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": c["l"] + 300, "y": c["t"] + 400}]})
    for x, y in wave(c["l"] + 300, c["t"] + 400)[1:]:
        await b.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    await b.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    await b.js("document.querySelector('[aria-label=Sketch] .btn.primary').click(); return true;")
    media = root / "Notes" / "_media"
    got = await until(lambda: media.exists() and any(media.glob("Sketch *.svg")), 5)
    check("Done saves it as an SVG beside the sheet", bool(got), str(sorted(p.name for p in media.glob("*"))) if media.exists() else "no _media")
    svg = sorted(media.glob("Sketch *.svg"))[0] if got else None
    strokes = lambda: len(json.loads(re.search(r'<metadata id="moshe-sketch">(.*?)</metadata>', svg.read_text()).group(1))["strokes"])
    check("with the pen's stroke in it, and nothing from the hand resting on the paper", bool(svg) and strokes() == 1)
    linked = await until(lambda: bool(svg) and f"![Sketch](_media/{svg.name.replace(' ', '%20')})" in pf.read_text(), 5)
    check("and the sheet shows it", bool(linked), pf.read_text())
    # (the Mac and Android apps serve the library's pictures at /_library/, which the simulator doesn't: so the server only)
    if not sim_url:
        await b.wait_for("!!document.querySelector('.cm-imgbox img') && document.querySelector('.cm-imgbox img').naturalWidth > 0", 5)
        box = await b.js("const r = document.querySelector('.cm-imgbox img').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};")
        for n in (1, 2):
            await b.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": box["x"], "y": box["y"], "button": "left", "clickCount": n})
            await b.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": box["x"], "y": box["y"], "button": "left", "clickCount": n})
        check("a double-click on it opens it again", bool(await b.wait_for("!!document.querySelector('[aria-label=Sketch] canvas')", 4)))
        await pen(b, wave(c["l"] + 400, c["t"] + 250))
        await b.js("document.querySelector('[aria-label=Sketch] .btn.primary').click(); return true;")
        got = await until(lambda: svg and strokes() == 2, 5)
        check("and what's drawn then goes into the same picture", bool(got) and len(list(media.glob("Sketch *.svg"))) == 1)

    print("\nHandwritten sheets: a page to write on, kept as an Excalidraw drawing and a picture")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("window.mosheCommand('newHandwrittenSheet'); return true;")
    check("New Handwritten Sheet opens a page", bool(await b.wait_for("!!document.querySelector('.ink .page svg')", 6)))
    media = root / "Notes" / "_media"
    drawings = lambda: sorted(media.glob("Handwritten *.excalidraw.md")) if media.exists() else []
    hw = await until(lambda: drawings() and sorted((root / "Notes").glob("Handwritten *.md")), 4)
    hw = hw[0] if hw else None
    dr = drawings()[0] if drawings() else None
    check("the sheet names its drawing, and shows its picture", bool(hw) and "ink: _media/" in hw.read_text() and "![Handwriting](_media/" in hw.read_text(), hw.read_text() if hw else "no sheet")
    els = lambda: json.loads(re.search(r"```json\n([\s\S]*?)```", dr.read_text()).group(1))["elements"]
    pg = await b.js("const r = document.querySelector('.ink .page').getBoundingClientRect(); return {l: r.left, t: r.top};")
    scrawl = lambda x0, y0: [(x0 + i * 4, y0 + math.sin(i / 2) * 12) for i in range(40)]
    await pen(b, scrawl(pg["l"] + 80, pg["t"] + 150))
    await pen(b, scrawl(pg["l"] + 280, pg["t"] + 150))
    await b.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pg["l"] + 300, "y": pg["t"] + 400}]})
    for k in range(10):
        await b.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": pg["l"] + 300 + k * 10, "y": pg["t"] + 400 - k * 5}]})
    await b.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    got = await until(lambda: dr and len(els()) == 2, 5)
    check("the pen's strokes go into the drawing, pressure and all; a finger writes nothing", bool(got) and all(e["type"] == "freedraw" and len(e["pressures"]) == len(e["points"]) for e in els()))
    pic = dr.with_name(dr.name.replace(".excalidraw.md", ".svg")) if dr else None
    inked = lambda: len(re.findall(r'<path d="M[^"]*Q[^"]*" fill=', pic.read_text())) if pic and pic.exists() else 0
    check("and into its picture", inked() == 2, str(inked()))
    # the pens: the pencil, from the pen's panel (the pen tapped again)
    await b.js("document.querySelector('.ink .pentool').click(); return true;")
    await b.wait_for("!!document.querySelector('.ink .panel .kind')", 3)
    await b.js("[...document.querySelectorAll('.ink .panel .kind')].find(k => k.textContent.includes('Pencil')).click(); return true;")
    await b.js("document.querySelector('.ink .scrim').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); return true;")
    await pen(b, scrawl(pg["l"] + 80, pg["t"] + 260))
    got = await until(lambda: dr and len(els()) == 3, 5)
    check("each pen draws its own way, and the drawing says which pen", bool(got) and els()[2].get("customData", {}).get("moshe", {}).get("pen") == "pencil" and 'filter="url(#grain)"' in pic.read_text())
    # the eraser cuts the first stroke where it passes
    await b.js("document.querySelector('.ink [aria-label=Eraser]').click(); return true;")
    await pen(b, [(pg["l"] + 120, pg["t"] + 110 + i * 6) for i in range(14)])
    got = await until(lambda: dr and len(els()) == 4, 5)
    check("the eraser takes only what it passes over, and the stroke falls in two", bool(got), str(len(els())))
    # the lasso round the second stroke, and it moved
    await b.js("document.querySelector('.ink [aria-label=Lasso]').click(); return true;")
    x2 = max(e["x"] for e in els() if e["y"] < 200)
    await pen(b, [(pg["l"] + 300 + 110 * math.cos(t / 16 * 2 * math.pi), pg["t"] + 150 + 50 * math.sin(t / 16 * 2 * math.pi)) for t in range(17)])
    check("the lasso holds what it goes round", bool(await b.wait_for("!!document.querySelector('.ink .held')", 3)))
    box = await b.js("const r = document.querySelector('.ink .held').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};")
    await pen(b, [(box["x"], box["y"] + i * 10) for i in range(11)])
    got = await until(lambda: dr and any(abs(e["x"] - x2) < 1 and e["y"] > 200 for e in els()), 5)
    check("and moves it, as the same element", bool(got))
    # a dark page: the paper's colour is kept, and black ink turns white
    await b.js("document.querySelector('.ink [aria-label=Page]').click(); return true;")
    await b.wait_for("!!document.querySelector('.ink .panel .paper-c')", 3)
    await b.js("[...document.querySelectorAll('.ink .panel .paper-c')].find(x => x.getAttribute('aria-label').includes('dark')).click(); return true;")
    await b.js("document.querySelector('.ink .scrim').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true})); return true;")
    got = await until(lambda: dr and "moshe-color: #3b352e" in dr.read_text() and all(e["strokeColor"] != "#1e1e1e" for e in els()), 5)
    check("a dark page keeps its colour in the drawing, and its black ink turns white", bool(got))
    # handwriting read as text: the lasso round the pencil's line, To Text (Grape, in a worker, its model fetched)
    await b.js("document.querySelector('.ink [aria-label=Lasso]').click(); return true;")
    await pen(b, [(pg["l"] + 160 + 120 * math.cos(t / 16 * 2 * math.pi), pg["t"] + 260 + 45 * math.sin(t / 16 * 2 * math.pi)) for t in range(17)])
    await b.wait_for("!!document.querySelector('.ink .held')", 3)
    await b.js("[...document.querySelectorAll('.ink .heldbar button')].find(x => x.textContent.includes('To Text')).click(); return true;")
    read = await b.wait_for("!!document.querySelector('#ink-readout') || (document.querySelector('.readout .dim') && !document.querySelector('.readout .dim').textContent.includes('Reading'))", 20)
    check("To Text reads the handwriting the lasso holds", bool(read) and await b.js("return !!document.querySelector('#ink-readout');"), await b.js("return document.querySelector('.readout')?.textContent;"))
    await b.js("document.querySelector('.readout .close')?.click(); return true;")
    # a text box: the text tool, a tap, typing
    await b.js("document.querySelector('.ink [aria-label=Text]').click(); return true;")
    await pen(b, [(pg["l"] + 120, pg["t"] + 420), (pg["l"] + 121, pg["t"] + 420)])
    await b.wait_for("!!document.querySelector('.ink .textedit')", 3)
    await b.send("Input.insertText", {"text": "Typed on the page"})
    await b.key("Escape", "Escape")
    got = await until(lambda: dr and any(e["type"] == "text" and e["text"] == "Typed on the page" for e in els()) and "\nTyped on the page ^" in dr.read_text(), 5)
    check("a text box typed on the page is the drawing's text element, listed as the plugin lists it", bool(got))
    await b.js("document.querySelector('.ink .type').click(); return true;")
    await b.wait_for("!!document.querySelector('.textside .cm-content')", 4)
    await b.js("document.querySelector('.textside .cm-content').focus(); return true;")
    await press(b, "End", "End", 35, 2)
    await b.send("Input.insertText", {"text": "Typed from the page."})
    got = await until(lambda: hw and hw.read_text().endswith("Typed from the page."), 4)
    check("Type It Up puts the text beside the page, in the same sheet", bool(got) and "![Handwriting]" in hw.read_text())
    # Obsidian's Excalidraw plugin draws on it too: Moshe takes what it saved
    t = dr.read_text()
    scene = json.loads(re.search(r"```json\n([\s\S]*?)```", t).group(1))
    scene["elements"].append({"id": "t1", "type": "text", "x": 120, "y": 400, "width": 200, "height": 25, "text": "From Excalidraw", "fontSize": 24, "strokeColor": "#e03131", "opacity": 100})
    dr.write_text(re.sub(r"```json\n[\s\S]*?```", lambda m: "```json\n" + json.dumps(scene) + "\n```", t))
    if sim_url:
        await b.js("window.__mosheFilesChanged && window.__mosheFilesChanged(); return true;")
    await b.js("document.querySelector('.ink .type').click(); return true;")
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Typed from the page') === false && c.textContent.includes('Buy') ) ?.click(); return true;")
    await asyncio.sleep(0.5)
    await b.js("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Handwritten')).click(); return true;")
    shown = await b.wait_for("!!document.querySelector('.ink .page svg') && document.querySelector('.ink .page svg').innerHTML.includes('From Excalidraw')", 6)
    redone = await until(lambda: "From Excalidraw" in pic.read_text(), 4)
    check("what the plugin added is on the page when it opens again, and in its picture", bool(shown) and bool(redone))

    print("\nFocus mode: only the page, the bars back when they're wanted")
    await b.js("window.mosheCommand('hideInterface'); return true;")
    await asyncio.sleep(0.5)
    hidden = await b.js("return document.documentElement.classList.contains('moshe-focus') && [...document.querySelectorAll('.chrome')].every(e => getComputedStyle(e).opacity === '0') && !document.querySelector('.col.list');")
    check("focus mode hides the panes and every bar, the pens' too", bool(hidden))
    await b.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 800, "y": 20})
    check("and the pointer up at the top brings them back", bool(await b.wait_for("document.documentElement.classList.contains('moshe-chrome')", 3)))
    await b.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 800, "y": 500})
    check("and they go again when it leaves", bool(await b.wait_for("!document.documentElement.classList.contains('moshe-chrome')", 5)))
    await b.js("window.mosheCommand('hideInterface'); return true;")
    await asyncio.sleep(0.4)
    check("leaving it brings the panes back", bool(await b.js("return !document.documentElement.classList.contains('moshe-focus') && !!document.querySelector('.col.list');")))

    print("\nGroups are folders")
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Inbox').click(); return true;")
    await asyncio.sleep(0.3)
    await b.js("window.mosheCommand('newGroup'); return true;")
    await b.wait_for("!!document.querySelector('#g-name')", 5)
    await b.js("const i = document.querySelector('#g-name'); i.value = 'Essays'; i.dispatchEvent(new Event('input', {bubbles: true})); return true;")
    await b.js("[...document.querySelectorAll('.dialog .btn.primary')].pop().click(); return true;")
    made = await until(lambda: (root / "Notes" / "Essays").is_dir(), 5)
    check("New Group makes Notes/Essays", bool(made))
    await b.js("window.__mosheStore.moveSheets(['Notes/Made in the browser.md'], 'Notes/Essays'); return true;")
    moved = await until(lambda: (root / "Notes" / "Essays" / "Made in the browser.md").exists() and not f.exists(), 5)
    check("a sheet moved into it moves its file", bool(moved))
    await b.js("window.__mosheStore.editGroup('Notes/Essays', {name: 'Essays 2026'}); return true;")
    renamed = await until(lambda: (root / "Notes" / "Essays 2026" / "Made in the browser.md").exists(), 5)
    check("renaming the group renames the folder", bool(renamed))

    print("\nThe trash")
    await b.js("window.__mosheStore.trashSheet('Notes/Essays 2026/Made in the browser.md'); return true;")
    trashed = await until(lambda: (root / ".moshe" / "trash" / "Made in the browser.md").exists(), 5)
    check("Move to Trash puts the file in .moshe/trash", bool(trashed))
    await b.js("window.__mosheStore.restore('.moshe/trash/Made in the browser.md'); return true;")
    back = await until(lambda: (root / "Notes" / "Essays 2026" / "Made in the browser.md").exists(), 5)
    check("Put Back returns it where it was", bool(back))

    print("\nHebrew names and translation mode")
    await b.js("const p = window.__mosheStore.createSheet('Notes', {text: '# שלום עולם\\nטקסט.\\n'}); return p;")
    heb = await until(lambda: (root / "Notes" / "שלום עולם.md").exists(), 5)
    check("a Hebrew title makes a Hebrew file name, exactly", bool(heb), str([p.name for p in (root / "Notes").iterdir()]))
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.includes('Kafka')).click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("[...document.querySelectorAll('.library .row')].find(r => r.textContent.trim() === 'Original').click(); return true;")
    await asyncio.sleep(0.4)
    await b.js("window.mosheCommand('translation'); return true;")
    two = await b.wait_for("document.querySelectorAll('.cm-editor').length === 2 && document.querySelectorAll('.cm-editor')[1].textContent.includes('Gregor Samsa')", 6)
    check("translation mode shows the translation beside the original", bool(two))
    rtl = await b.js("const l = document.querySelector('.cm-line'); return getComputedStyle(l).direction;")
    check("the Hebrew runs right to left", rtl == "rtl", rtl)
    await b.js("window.mosheCommand('translation'); return true;")

    if sim_url:
        print("\nThe folder passes the shell's conformance check")
        r = await b.js("return await window.__mosheLocal.conformance();")
        bad = [x for x in (r or {}).get("results", []) if not x.get("ok")]
        check("every check holds", bool(r) and r.get("ok"), json.dumps(bad)[:400])

    errs = [e for e in b.errors() if "favicon" not in e]
    check("no errors in the page", not errs, "; ".join(errs[:5]))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--devtools", default=None, help="the headless Chrome's DevTools (default: the docker-chrome-1 container's address)")
    ap.add_argument("--sim-host", default="172.19.0.1")
    a = ap.parse_args()
    if not a.devtools:
        # its address moves when the host restarts
        ip = subprocess.run(["docker", "inspect", "docker-chrome-1", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"], capture_output=True, text=True).stdout.strip()
        a.devtools = f"http://{ip or '172.19.0.10'}:9222"
    srv_root, dev_root = Path("/tmp/moshe-e2e-server"), Path("/tmp/moshe-e2e-folder")
    fresh_library(srv_root)
    fresh_library(dev_root)
    url = start_server(srv_root)
    sim = subprocess.Popen([sys.executable, str(HERE / "bridge_sim.py"), "--root", str(dev_root), "--host", a.sim_host, "--port", str(SIM_PORT)])
    try:
        time.sleep(0.8)
        async with Browser(a.devtools) as b:
            await run(b, url, srv_root, "server", None)
        async with Browser(a.devtools) as b:
            await run(b, url, dev_root, "webkit", f"http://{a.sim_host}:{SIM_PORT}")
        async with Browser(a.devtools) as b:
            fresh_library(dev_root)
            await run(b, url, dev_root, "android", f"http://{a.sim_host}:{SIM_PORT}")
    finally:
        sim.terminate()
        subprocess.run(["docker", "rm", "-f", "moshe-e2e"], capture_output=True)
    print("\n" + ("everything holds" if not FAILURES else f"{len(FAILURES)} failed: " + "; ".join(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
