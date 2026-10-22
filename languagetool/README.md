# LanguageTool for Check Text, on demand

Moshe's Check Text (the dashboard's revision view) sends a sheet's prose to
LanguageTool, run here from languagetool.org's own release (LGPL). It is not
kept running: memory on this server is scarce.

- `languagetool.socket` listens on 127.0.0.1:8431, and on the gateway of the
  Docker network the moshe container is on (172.19.0.1 in the file: change it to
  yours, see the comment there; `FreeBind` lets it wait for that network).
- The first request starts `languagetool-proxy.service`
  (`systemd-socket-proxyd`). That needs `languagetool-server.service`, the
  container, and waits until it answers.
- After 15 minutes without a request the proxy quits, and the container
  (`StopWhenUnneeded`) goes with it.

Measured on a small home server (2026-09-26, LanguageTool 6.6, heap ≤ 768 MB, no n-grams):
- ready 1.6 s after starting; a first check from cold 4.4 s, a warm one 40 ms;
- 140 MB idle, about 350 MB after checking 3,400 words;
- nothing at all while stopped.

Install (as the user, lingering on):

```sh
docker build -t moshe-languagetool languagetool/
cp languagetool/systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now languagetool.socket
```

Then give the server `MOSHE_LANGUAGETOOL=http://<that gateway>:8431` (compose).
Obsidian's LanguageTool plugin can use http://127.0.0.1:8431 as well.

With memory to spare, it's simpler to leave LanguageTool running and skip the
socket: `docker run -d --restart unless-stopped -p 127.0.0.1:8010:8010
moshe-languagetool`, and `MOSHE_LANGUAGETOOL` pointed at port 8010.
