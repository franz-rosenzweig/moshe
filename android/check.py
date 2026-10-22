#!/usr/bin/env python3
"""The test build's page, over DevTools (check.sh forwards it): the bridge's
conformance checks, and what the shell adds — the user agent, mosheShell before
the page's scripts, /_library/ serving pictures and refusing paths out, the
Back chain, and info."""
import asyncio
import json
import sys

import urllib.request

import websockets

failures = 0


def check(ok, what, detail=""):
    global failures
    print(("PASS  " if ok else "FAIL  ") + what + (f"  [{detail}]" if detail else ""))
    if not ok:
        failures += 1


async def main(devtools, kind):
    pages = [t for t in json.load(urllib.request.urlopen(f"{devtools}/json", timeout=10)) if t.get("type") == "page"]
    page = next((t for t in pages if "appassets.androidplatform.net" in t.get("url", "")), None)
    if not page:
        print("FAIL  no page of the app's own", [t.get("url") for t in pages])
        return 1
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=80 * 1024 * 1024) as ws:
        n = 0

        async def js(expr, timeout=60):
            nonlocal n
            n += 1
            await ws.send(json.dumps({"id": n, "method": "Runtime.evaluate",
                                      "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
                if msg.get("id") == n:
                    r = msg.get("result", {})
                    if "exceptionDetails" in r:
                        raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", "error"))
                    return r.get("result", {}).get("value")

        for _ in range(80):
            if await js("!!(window.__mosheLocal && document.querySelector('.window'))"):
                break
            await asyncio.sleep(0.25)
        check(await js("!!window.__mosheLocal"), "the page opens the library")
        check(await js("window.__mosheLocal.mode") == "folder", "the page runs on the folder")
        ua = await js("navigator.userAgent")
        check("(Android shell)" in ua and "Moshe/" in ua, "the user agent names the shell", ua)
        check(await js("['savePdf','saveFile','share','openExternal'].every((k) => typeof window.mosheShell[k] === 'function')"),
              "window.mosheShell is there for the page")
        info = await js("window.__mosheStore && window.MosheStorage ? new Promise((res) => { const id = 99999; const prev = window.__mosheStorageReply; "
                        "window.__mosheStorageReply = (i, j) => { if (i === id) { window.__mosheStorageReply = prev; res(JSON.parse(j).ok); } else prev(i, j); }; "
                        "window.MosheStorage.request(id, JSON.stringify({ v: 1, op: 'info', args: {} })); }) : null")
        check(info and info.get("pollSeconds") == 15 and info.get("http") is True, "info: poll every 15 s, and op http", json.dumps(info, ensure_ascii=False))

        r = await js("window.__mosheLocal.conformance()", timeout=300)
        for x in (r or {}).get("results", []):
            check(x.get("ok"), f"conformance: {x.get('name')}", x.get("error") or f"{x.get('ms')} ms")

        png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="
        pics = await js("""(async () => {
            const st = window.__mosheStore._storage || null;
            const call = (op, args) => new Promise((res) => { const id = Math.floor(Math.random() * 1e9); const prev = window.__mosheStorageReply;
              window.__mosheStorageReply = (i, j) => { if (i === id) { window.__mosheStorageReply = prev; res(JSON.parse(j)); } else prev(i, j); };
              window.MosheStorage.request(id, JSON.stringify({ v: 1, op, args })); });
            const out = {};
            out.write = await call('writeBytes', { path: 'Notes/_media/dot.png', base64: '%s' });
            out.hebrew = await call('writeBytes', { path: 'Notes/_media/תמונה.png', base64: '%s' });
            const a = await fetch('/_library/Notes/_media/dot.png');
            out.status = a.status; out.type = a.headers.get('content-type'); out.size = (await a.arrayBuffer()).byteLength;
            out.hebrewStatus = (await fetch('/_library/Notes/_media/' + encodeURIComponent('תמונה.png'))).status;
            out.outside = (await fetch('/_library/Notes/..%%2F..%%2F..%%2Fshared_prefs%%2Fmoshe.place.xml')).status;
            out.missing = (await fetch('/_library/Notes/_media/none.png')).status;
            return out; })()""" % (png, png))
        check(pics["status"] == 200 and pics["type"] == "image/png" and pics["size"] == 79, "writeBytes, then /_library/ serves the picture", json.dumps(pics, ensure_ascii=False))
        check(pics["hebrewStatus"] == 200, "a picture with a Hebrew name is served too")
        check(pics["outside"] == 403, "a path out of the library is refused", str(pics["outside"]))
        check(pics["missing"] == 404, "a missing picture is a 404")

        # Back: the page goes back a pane at a time (on a phone's layout)
        if await js("matchMedia('(max-width: 760px)').matches"):
            first = await js("window.mosheBack()")
            check(first is True, "Back goes back a pane in the page first")
        print("SELFTEST passed" if failures == 0 else f"SELFTEST {failures} failed")
        return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "app")))
