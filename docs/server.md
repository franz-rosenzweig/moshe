<sub>[Moshe docs](README.md) › Running your own server</sub>

# Your own server

This page walks you through running your own Moshe server: one small Node program, with no dependencies, that serves the app and your library folder to the browser, keeps the backups, offers the folder over WebDAV to devices without Syncthing, and asks for the password. I run mine in Docker next to my other services, and it's the same setup described here.

## What you need

A machine that's on when you want to write, Docker, and the folder for your library. The folder can be empty, in which case Moshe starts an empty library in it, or a folder Syncthing already keeps in step with your Mac, which is how mine works: the server and the Mac app open the same folder.

## Running it with Docker Compose

Build the image from the repository, which builds the web app inside it too:

```sh
git clone https://github.com/franz-rosenzweig/moshe.git
cd moshe && docker build -t moshe:latest .
```

Then add a service like this to your `docker-compose.yml`, with your own paths:

```yaml
services:
  moshe:
    image: moshe:latest
    container_name: moshe
    restart: unless-stopped
    user: "1000:1000"                  # the user who owns the library folder
    environment:
      TZ: Europe/London                # your time zone
      MOSHE_ROOT: /data
      MOSHE_AUTH_FILE: /secrets/auth.json
      MOSHE_BACKUPS: /backups
      # MOSHE_LANGUAGETOOL: http://172.17.0.1:8431   # for Check Text, below
    volumes:
      - /path/to/your/Writing:/data
      - ./moshe/secrets:/secrets
      - ./moshe/backups:/backups
    ports:
      - "127.0.0.1:8430:8430"
```

Start it with `docker compose up -d moshe`, and it says in its log which folder it serves and where its backups go.

Two things in there matter more than they look. `MOSHE_AUTH_FILE` puts the password file OUTSIDE the library, which is important, since the library is synced to every device and a password hash doesn't belong on all of them. And `MOSHE_BACKUPS` is what turns the backups on; without it, the server keeps none.

## The password

Set the password before anything else:

```sh
docker exec -it moshe node server/src/cli.js set-password
```

It asks twice, signs everyone out, and from then on the app asks for it. A sign-in lasts 30 days, and after a few wrong passwords in a row the server makes the next try wait a little longer each time.

Without a password, the server opens the library to a direct connection only, like a browser on the same machine. Through a proxy or a tunnel it refuses until a password is set, and the sign-in page says how to set one. The other commands:

| Command | What it does |
|---|---|
| `set-password` | Set or change the password, and sign everyone out |
| `logout-everywhere` | Sign out every browser, without changing the password |
| `clear-password` | Remove the password (only for a server nobody else can reach) |
| `add-token NAME` | A device token, for WebDAV sync or a script |
| `list-tokens` | The devices that have one |
| `remove-token NAME` | Take a device's token away |

Each is `docker exec -it moshe node server/src/cli.js` and the command. The same tokens can be made in the browser, in **Settings › Sync**.

## Reaching it from outside

The server speaks plain HTTP on port 8430, so put HTTPS in front of it before it leaves your network: a reverse proxy you already run, or a tunnel. A Cloudflare tunnel reaches it from anywhere, and a private network like Tailscale from your own devices, which is why the port above is bound to `127.0.0.1` only.

## The settings

| Setting | What it is | If you leave it out |
|---|---|---|
| `MOSHE_ROOT` | The library folder | `./data` in the repository |
| `MOSHE_AUTH_FILE` | The password and session secret | `.moshe/auth.json` inside the library |
| `MOSHE_BACKUPS` | Where the backups go | No backups |
| `MOSHE_LANGUAGETOOL` | A LanguageTool server for Check Text | No Check Text |
| `MOSHE_WATCH` | `0` to stop watching the folder for changes from other apps | Watching |
| `MOSHE_STATIC` | The built app | The image's own |
| `PORT`, `HOST` | Where it listens | `8430`, all addresses |

`/api/health` answers `{"ok":true,"app":"moshe"}`, for a monitor, and the image checks it every minute.

## Check Text and LanguageTool

**Check Text** needs a LanguageTool server that Moshe's server can reach, given in `MOSHE_LANGUAGETOOL`. LanguageTool is a Java program that wants several hundred megabytes of memory, so on my server it doesn't run all the time: systemd starts it on the first check and stops it after 15 minutes with none, and while it's stopped it costs nothing. [languagetool/README.md](../languagetool/README.md) has the Dockerfile, the systemd units and the numbers. Any LanguageTool server works too, if you'd rather keep one running.

## Updating

Pull the repository, build the image again and restart the service:

```sh
git pull && docker build -t moshe:latest . && docker compose up -d moshe
```

The library is only files, so an update never touches your writing. Reload the page in an open browser to get the new version.

## Without Docker

The server needs only Node 20 or newer. Build the web app (`frontend/build.sh` does it in Docker, or `npm ci && npm run build` in `frontend/`), then:

```sh
MOSHE_ROOT=/path/to/Writing MOSHE_BACKUPS=/path/to/backups node server/src/main.js
```

[DEVELOPING.md](DEVELOPING.md) has the rest of the developer's notes, the tests among them. If you set one up and something doesn't work the way I described here, feel free to ask me.

<sub>Next: [The library on disk](FORMAT.md) →</sub>
