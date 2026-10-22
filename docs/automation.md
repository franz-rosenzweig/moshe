<sub>[Moshe docs](README.md) › Automation</sub>

# Sheets from outside

This page is about putting text into Moshe from outside the app: from a phone shortcut, a bot, a script or a cron job. Moshe offers two actions, make a sheet and add to a sheet, plus a list of a group's sheets, over HTTP with a device token, or on the server's command line. Whatever comes in this way is just a file written into the library, so the open app picks it up like an edit from any other editor.

## A token

Every request carries a device token, so the script never needs your password. Make one in the browser, in **Settings › Sync** under **Devices** (call it "Shortcuts", say, and press **Add a Device**), or on the server:

```sh
docker exec moshe node server/src/cli.js add-token Shortcuts
```

The token is shown once. Keep it in the shortcut or the script, and if it ever leaks, **Remove** it in the same place and make a new one.

## Over HTTP

The examples use `https://moshe.example.com` for your server's address and `$TOKEN` for the token.

```sh
# a new sheet, named from its first line; GROUP is Inbox (the default), a path, or a group's name
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"group":"Inbox","text":"# An idea\nWorth keeping."}' https://moshe.example.com/api/sheets
# text added to a sheet (by path or title) at its end, or "at":"start"; "create":true makes it if missing
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sheet":"Today","group":"Journal","text":"More.","create":true}' https://moshe.example.com/api/sheets/append
curl -H "Authorization: Bearer $TOKEN" 'https://moshe.example.com/api/sheets?group=Chapters'   # a group's sheets
```

**Making a sheet** (`/api/sheets`) takes the text and the group. The group can be `Inbox` (or `Notes`, or left out), a path like `Projects/Late Apples/Part One`, or just a group's name, as long as only one group has it. The sheet is named from its first line, the way the app names one, and a name that's taken gets a number. The answer is the new sheet's path.

**Adding to a sheet** (`/api/sheets/append`) finds the sheet by its path, its file name or its title, in the group if you give one. The text goes in as a new paragraph at the end, or with `"at":"start"` at the top, after any front matter. With `"create":true`, a sheet that doesn't exist yet is made, with the name you gave as its title, which is the easy way to keep a sheet per day or per week. The answer says the path and whether it was made.

**Listing** (`/api/sheets?group=…`) gives the sheets directly in a group, each with its path and title, and not those of the groups inside it.

When something's wrong, the answer says it in plain words: no such group, two groups with that name, no such sheet, or a missing token. After a few wrong tokens in a row, the server makes the caller wait before it tries again.

## On the server's command line

The same three, for a script running on the server itself, read the text from what's piped in:

```sh
echo "# An idea" | docker exec -i moshe node server/src/cli.js new Inbox
echo "More."     | docker exec -i moshe node server/src/cli.js append "An idea" [--group G] [--start] [--create]
docker exec moshe node server/src/cli.js sheets Chapters
```

Outside Docker, run `node server/src/cli.js` from the repository with `MOSHE_ROOT` set to the library folder, or `--root` and the folder before the command.

## Ideas

- **A phone shortcut.** On an iPhone, a Shortcuts action "Get Contents of URL" with the POST method, the two headers and the JSON makes a "Save to Moshe" shortcut for the share sheet. On Android, an app like HTTP Shortcuts does the same. (The Android app can already take shared text into the Inbox by itself; see [The Android app](android.md).)
- **A bot.** A message to your own chat bot can go straight into the Inbox, or be added to a running "Ideas" sheet.
- **A cron job.** Append the date and a line to a "Log" sheet every evening, with `"create":true` so the first run makes it.

Basically, instead of opening Moshe to jot something down, anything that can send a web request can do it for you. If you set one of these up and get stuck, feel free to ask me.

<sub>Next: [Your own server](server.md) →</sub>
