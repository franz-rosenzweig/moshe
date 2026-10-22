"""Chrome over the DevTools Protocol, for screenshots and browser tests with
no Node and no browser on the host: the docker-chrome container does the
rendering (Dvarim's tools/e2e_smoke.py, the Browser class)."""
from __future__ import annotations

import asyncio
import base64
import json

import httpx
import websockets


class Browser:
    def __init__(self, devtools: str = "http://172.19.0.10:9222"):
        self.devtools = devtools
        self.ws = None
        self.n = 0
        self.events: list[dict] = []

    async def __aenter__(self):
        info = httpx.get(f"{self.devtools}/json/new?about:blank", timeout=10)
        if info.status_code >= 400:
            info = httpx.put(f"{self.devtools}/json/new?about:blank", timeout=10)
        self.target = info.json()
        self.ws = await websockets.connect(self.target["webSocketDebuggerUrl"], max_size=80 * 1024 * 1024)
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        await self.send("Page.bringToFront")
        try:
            await self.send("Emulation.setFocusEmulationEnabled", {"enabled": True})
        except RuntimeError:
            pass
        return self

    async def __aexit__(self, *a):
        if self.ws:
            await self.ws.close()
        try:
            httpx.get(f"{self.devtools}/json/close/{self.target['id']}", timeout=5)
        except Exception:
            pass

    async def send(self, method: str, params: dict | None = None):
        self.n += 1
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            if msg.get("method") in ("Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"):
                self.events.append(msg)

    async def size(self, width: int, height: int, dark: bool = False, mobile: bool = False, scale: float = 1):
        await self.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": mobile})
        await self.send("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-color-scheme", "value": "dark" if dark else "light"}]})

    async def goto(self, url: str, wait: float = 1.0):
        await self.send("Page.navigate", {"url": url})
        await asyncio.sleep(wait)

    async def js(self, expr: str):
        r = await self.send("Runtime.evaluate", {"expression": f"(async () => {{ {expr} }})()", "awaitPromise": True, "returnByValue": True})
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r.get("result", {}).get("value")

    async def wait_for(self, expr: str, timeout: float = 20.0, every: float = 0.25):
        waited = 0.0
        while waited < timeout:
            v = await self.js(f"return ({expr});")
            if v:
                return v
            await asyncio.sleep(every)
            waited += every
        return None

    async def key(self, key: str, code: str = "", modifiers: int = 0, text: str = ""):
        """A key press. modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift."""
        base = {"key": key, "code": code or key, "modifiers": modifiers, "windowsVirtualKeyCode": ord(key.upper()[0]) if len(key) == 1 else 0}
        await self.send("Input.dispatchKeyEvent", {"type": "keyDown", **base, **({"text": text} if text else {})})
        await self.send("Input.dispatchKeyEvent", {"type": "keyUp", **base})

    async def type(self, text: str):
        await self.send("Input.insertText", {"text": text})

    async def shot(self, path: str):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))

    def errors(self) -> list[str]:
        out = []
        for e in self.events:
            if e["method"] == "Runtime.exceptionThrown":
                d = e["params"]["exceptionDetails"]
                out.append((d.get("exception", {}) or {}).get("description") or d.get("text", ""))
            elif e["method"] == "Runtime.consoleAPICalled" and e["params"]["type"] in ("error", "warning"):
                out.append(" ".join(str(a.get("value", a.get("description", ""))) for a in e["params"]["args"]))
        return out
