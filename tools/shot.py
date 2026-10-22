#!/usr/bin/env python3
"""Screenshots of the app in headless Chrome.

    tools/shot.py --url http://172.19.0.20:8430 --out /tmp/shots [--dark] [--size 1920x1052] [--js '...'] name
"""
import argparse, asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default="/tmp/moshe-shots")
    ap.add_argument("--size", default="1920x1052")
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--devtools", default="http://172.19.0.10:9222")
    ap.add_argument("--js", action="append", default=[], help="run after load, in order (each may await)")
    ap.add_argument("--wait", type=float, default=2.5)
    ap.add_argument("--reset", action="store_true", help="clear the page's saved state first")
    ap.add_argument("name")
    a = ap.parse_args()
    Path(a.out).mkdir(parents=True, exist_ok=True)
    w, h = map(int, a.size.split("x"))
    async with Browser(a.devtools) as b:
        await b.size(w, h, dark=a.dark)
        await b.goto(a.url, 0.5)
        if a.reset:
            await b.js("localStorage.clear(); return true;")
            await b.goto(a.url, 0.5)
        await b.wait_for("document.querySelector('.window') || document.querySelector('.fatal') || document.querySelector('.login')", 20)
        await asyncio.sleep(a.wait)
        for j in a.js:
            await b.js(j)
            await asyncio.sleep(0.8)
        await b.shot(f"{a.out}/{a.name}.png")
        errs = b.errors()
        print(f"{a.out}/{a.name}.png", "errors:" if errs else "", *errs[:10], sep="\n  " if errs else " ")


asyncio.run(main())
