#!/usr/bin/env python3
"""The real app in a real browser, and the files on disk after each step.

Runs twice: once as the web app on the server's folder (the page's storage is
the server, over HTTP), once as the Mac and Android apps run it (the page's
storage is a folder behind the bridge, played by tools/bridge_sim.py). Each
run starts from a fresh sample library in /tmp, never a real one.

    tools/e2e.py [--devtools http://<chrome>:9222]

It starts its own server container (moshe-e2e) and simulator, and removes them.
"""
import argparse, asyncio, json, shutil, subprocess, sys, time, urllib.request
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
    await b.js("""
        const rows = () => [...document.querySelectorAll('.library .row')];
        rows().find(r => r.textContent.includes('Kafka')).click();
        await new Promise(r => setTimeout(r, 400));
        rows().find(r => r.textContent.trim() === 'Original').click();
        await new Promise(r => setTimeout(r, 400));
        window.mosheCommand('translation');
        return true;""")
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
