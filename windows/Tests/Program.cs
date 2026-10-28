// The folder code's tests (windows/Moshe.Core): every op of docs/BRIDGE.md on a
// scratch folder; the Windows edges (names Windows refuses, a junction out of the
// library, a file another app holds open, a read-only file, case); and the same
// ops through tools/bridge_sim.py, the reference, compared answer for answer.
//
//   dotnet run --project windows/Tests [-- --repo PATH]
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Moshe.Core;

var failures = 0;
var scratch = new List<string>();

void Check(bool ok, string what, string detail = "")
{
    Console.WriteLine($"{(ok ? "ok  " : "FAIL")}  {what}{(ok || detail.Length == 0 ? "" : $"  ({detail})")}");
    if (!ok) failures++;
}

string Scratch()
{
    var dir = Path.Join(Path.GetTempPath(), "moshe-tests-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(dir);
    scratch.Add(dir);
    return dir;
}

JsonObject Args(params (string Key, JsonNode? Value)[] pairs)
{
    var o = new JsonObject();
    foreach (var (k, v) in pairs) o[k] = v;
    return o;
}

string? Code(JsonObject reply) => reply["error"]?["code"]?.GetValue<string>();
string? TextOf(JsonObject reply) => reply["ok"]?["text"]?.GetValue<string>();
HashSet<string> Strings(JsonNode? list) => (list as JsonArray ?? new JsonArray()).Select(n => n!.GetValue<string>()).ToHashSet();

var repo = args.SkipWhile(a => a != "--repo").Skip(1).FirstOrDefault() ?? FindRepo();

try
{
    var root = Scratch();
    var f = new FolderFiles(root);

    // ---- write and read: exactly the bytes, a BOM and \r\n kept, names as written
    var texts = new (string Name, string Text)[]
    {
        ("plain.md", "# Plain\n"), ("Windows.md", "Windows\r\nline endings\r\nkept\r\n"), ("bom.md", "\uFEFF# With a BOM\n"),
        ("\u05E9\u05DC\u05D5\u05DD.md", "\u05E9\u05DC\u05D5\u05DD\n"), ("Caf\u00E9.md", "Caf\u00E9\n"), ("party \U0001F389.md", "\U0001F389\n"),
        ("a & b #1 50%.md", "&\n"), ("it's (really).md", "'\n"), (".hidden.md", "hidden\n"), ("no extension", "none\n"),
    };
    foreach (var (name, text) in texts)
    {
        var w = f.Answer("write", Args(("path", "Notes/" + name), ("text", text)));
        Check(w["ok"]?["mtime"] != null, $"write {name}", w.ToJsonString());
        var disk = File.ReadAllBytes(Path.Join(root, "Notes", name));
        Check(disk.SequenceEqual(Encoding.UTF8.GetBytes(text)), $"{name} holds exactly the bytes written");
        Check(TextOf(f.Answer("read", Args(("path", "Notes/" + name)))) == text, $"read {name} back as written");
    }
    var many = f.Answer("readMany", Args(("paths", new JsonArray("Notes/plain.md", "Notes/nothing.md", "Notes/bom.md"))));
    var answers = many["ok"] as JsonArray;
    Check(answers is { Count: 3 } && answers[1] == null && answers[0]?["text"]?.GetValue<string>() == "# Plain\n", "readMany answers each path in order, null for none");
    Check(f.Answer("read", Args(("path", "Notes/nothing.md")))["ok"] == null && Code(f.Answer("read", Args(("path", "Notes/nothing.md")))) == null,
        "read of no such file is null, not an error");
    Check(f.Answer("read", Args(("path", "Notes")))["ok"] == null, "read of a folder is null");

    // ---- list: everything, empty folders too; .moshe yes; inside .git no; our temporary files never
    File.WriteAllText(Path.Join(root, "Notes", ".0123.moshe-tmp"), "half");
    Directory.CreateDirectory(Path.Join(root, ".git", "objects"));
    File.WriteAllText(Path.Join(root, ".git", "objects", "ab"), "x");
    Directory.CreateDirectory(Path.Join(root, ".moshe"));
    File.WriteAllText(Path.Join(root, ".moshe", "settings.json"), "{}");
    Directory.CreateDirectory(Path.Join(root, "Empty"));
    var list = f.Answer("list", new JsonObject())["ok"]!;
    var files = Strings(list["files"]);
    var dirs = Strings(list["dirs"]);
    Check(files.Contains("Notes/Caf\u00E9.md") && files.Contains("Notes/\u05E9\u05DC\u05D5\u05DD.md"), "list gives names as they were written (NFC)");
    Check(files.Contains(".moshe/settings.json"), "list includes .moshe/");
    Check(dirs.Contains(".git") && !dirs.Contains(".git/objects") && !files.Contains(".git/objects/ab"), "list names .git but doesn't look inside");
    Check(dirs.Contains("Empty") && dirs.Contains("Notes"), "list includes empty folders");
    Check(!files.Any(p => p.EndsWith(".moshe-tmp")), "list leaves out temporary files");
    Check(files.All(p => list["mtimes"]?[p] != null), "list gives every file's mtime");

    // ---- writeBytes
    var bytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0, 1, 2, 255 };
    f.Answer("writeBytes", Args(("path", "Notes/_media/pic.png"), ("base64", Convert.ToBase64String(bytes))));
    Check(File.ReadAllBytes(Path.Join(root, "Notes", "_media", "pic.png")).SequenceEqual(bytes), "writeBytes stores the bytes, making the folder");
    Check(f.Bytes("Notes/_media/pic.png")!.SequenceEqual(bytes), "the bytes come back for /_library/");
    Check(Code(f.Answer("writeBytes", Args(("path", "x.png"), ("base64", "not base64!")))) == "EINVAL", "writeBytes refuses what isn't base64");

    // ---- move
    f.Answer("write", Args(("path", "Notes/draft.md"), ("text", "d")));
    Check(f.Answer("move", Args(("from", "Notes/draft.md"), ("to", "Archive/2026/draft.md"))).ContainsKey("ok")
        && File.Exists(Path.Join(root, "Archive", "2026", "draft.md")) && !File.Exists(Path.Join(root, "Notes", "draft.md")),
        "move a file, making the folders it goes to");
    f.Answer("write", Args(("path", "Notes/taken.md"), ("text", "t")));
    Check(Code(f.Answer("move", Args(("from", "Notes/plain.md"), ("to", "Notes/taken.md")))) == "EEXIST"
        && File.ReadAllText(Path.Join(root, "Notes", "taken.md")) == "t", "move onto a file is EEXIST, with nothing changed");
    Check(Code(f.Answer("move", Args(("from", "Notes/gone.md"), ("to", "Notes/here.md")))) == "ENOENT", "move from nothing is ENOENT");
    f.Answer("write", Args(("path", "Group/one.md"), ("text", "1")));
    f.Answer("mkdir", Args(("path", "Renamed")));
    Check(f.Answer("move", Args(("from", "Group"), ("to", "Renamed"))).ContainsKey("ok") && File.Exists(Path.Join(root, "Renamed", "one.md")),
        "a folder may take an empty folder's place");
    f.Answer("write", Args(("path", "Full/two.md"), ("text", "2")));
    Check(Code(f.Answer("move", Args(("from", "Renamed"), ("to", "Full")))) == "EEXIST", "a folder may not take a full folder's place");
    f.Answer("write", Args(("path", "Notes/lower.md"), ("text", "l")));
    f.Answer("move", Args(("from", "Notes/lower.md"), ("to", "Notes/Lower.md")));
    var afterCase = Strings(f.Answer("list", new JsonObject())["ok"]!["files"]);
    Check(afterCase.Contains("Notes/Lower.md") && !afterCase.Contains("Notes/lower.md"), "a rename by case alone is a rename, not a clash");
    f.Answer("move", Args(("from", "Renamed"), ("to", "renamed")));
    Check(Strings(f.Answer("list", new JsonObject())["ok"]!["dirs"]).Contains("renamed"), "a folder renamed by case alone");

    // ---- remove, mkdir, removeDir
    Check(f.Answer("remove", Args(("path", "Notes/never.md"))).ContainsKey("ok"), "remove of nothing is quiet");
    f.Answer("remove", Args(("path", "Notes/taken.md")));
    Check(!File.Exists(Path.Join(root, "Notes", "taken.md")), "remove a file");
    f.Answer("remove", Args(("path", "Full")));
    Check(Directory.Exists(Path.Join(root, "Full")), "remove leaves a folder alone");
    f.Answer("mkdir", Args(("path", "A/B/C")));
    Check(Directory.Exists(Path.Join(root, "A", "B", "C")) && f.Answer("mkdir", Args(("path", "A/B"))).ContainsKey("ok"), "mkdir makes the parents, and is quiet if there");
    Check(f.Answer("removeDir", Args(("path", "A")))["ok"]?.GetValue<bool>() == false, "removeDir of a full folder is false");
    Check(f.Answer("removeDir", Args(("path", "A/B/C")))["ok"]?.GetValue<bool>() == true && !Directory.Exists(Path.Join(root, "A", "B", "C")), "removeDir of an empty folder");
    Check(f.Answer("removeDir", Args(("path", "Nowhere")))["ok"]?.GetValue<bool>() == true, "removeDir of nothing is true");
    Check(Code(f.Answer("mkdir", Args(("path", "Notes/plain.md/inside")))) == "EEXIST", "a file where a folder should be is EEXIST");

    // ---- paths the bridge refuses
    foreach (var bad in new[] { "", "/abs.md", "a/../b.md", "../out.md", "a\\b.md", "a//b.md", "./a.md", "a/", "C:/x.md", "a:b.md",
                                "con.md", "CON", "nul.txt", "lpt1", "trailing.", "trailing ", "tab\there.md", "what?.md", "quote\".md" })
        Check(Code(f.Answer("read", Args(("path", bad)))) == "EINVAL", $"refuses the path \"{bad.Replace("\t", "\\t")}\"");
    Check(Code(f.Answer("write", Args(("path", "x.md")))) == "EINVAL", "write without text is EINVAL");
    Check(Code(f.Answer("frobnicate", new JsonObject())) == "ENOSYS", "an op it doesn't know is ENOSYS");

    // ---- a junction out of the library: followed, and refused
    var outside = Scratch();
    File.WriteAllText(Path.Join(outside, "secret.txt"), "secret");
    var link = Path.Join(root, "link");
    using (var mk = Process.Start(new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{outside}\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!)
        mk.WaitForExit();
    if (Directory.Exists(link))
    {
        Check(Code(f.Answer("read", Args(("path", "link/secret.txt")))) == "EINVAL", "a read through a junction out of the library is refused");
        Check(Code(f.Answer("write", Args(("path", "link/new.md"), ("text", "x")))) == "EINVAL" && !File.Exists(Path.Join(outside, "new.md")),
            "a write through a junction out of the library is refused, and nothing lands outside");
        var linked = f.Answer("list", new JsonObject())["ok"]!;
        Check(Strings(linked["dirs"]).Contains("link") && !Strings(linked["files"]).Any(p => p.StartsWith("link/")), "list names a junction but doesn't follow it");
    }
    else Check(false, "make a junction to test with", "mklink /J failed");

    // ---- a file another app holds open
    f.Answer("write", Args(("path", "held.md"), ("text", "one")));
    var held = Path.Join(root, "held.md");
    using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))      // may be written, not replaced
    {
        var w = f.Answer("write", Args(("path", "held.md"), ("text", "two")));
        Check(w.ContainsKey("ok") && TextOf(f.Answer("read", Args(("path", "held.md")))) == "two", "a file held open (without delete sharing) is written in place", w.ToJsonString());
    }
    using (new FileStream(held, FileMode.Open, FileAccess.Read, FileShare.Read))           // may not be written at all
    {
        var w = f.Answer("write", Args(("path", "held.md"), ("text", "three")));
        Check(Code(w) == "EACCES", "a file locked by another app is EACCES, with a message", w.ToJsonString());
    }
    Check(!Strings(f.Answer("list", new JsonObject())["ok"]!["files"]).Any(p => p.EndsWith(".moshe-tmp")), "no temporary file is left behind");

    // ---- a read-only file
    f.Answer("write", Args(("path", "ro.md"), ("text", "ro")));
    var ro = Path.Join(root, "ro.md");
    File.SetAttributes(ro, FileAttributes.ReadOnly);
    var roWrite = f.Answer("write", Args(("path", "ro.md"), ("text", "changed")));
    Check(Code(roWrite) == "EACCES" && File.ReadAllText(ro) == "ro", "a read-only file is EACCES, and unchanged", roWrite.ToJsonString());
    File.SetAttributes(ro, FileAttributes.Normal);

    // ---- info
    var info = f.Answer("info", new JsonObject())["ok"]!;
    Check(info["name"]?.GetValue<string>() == Path.GetFileName(root) && info["pollSeconds"]?.GetValue<int>() == 0 && info["canPick"]?.GetValue<bool>() == true,
        "info names the folder and says the shell watches it");

    // ---- the http op's address rules
    Check(ShellHttp.IsPrivate([100, 91, 202, 11]) && ShellHttp.IsPrivate([192, 168, 1, 2]) && ShellHttp.IsPrivate([127, 0, 0, 1]), "tailnet, LAN and loopback addresses are private");
    Check(!ShellHttp.IsPrivate([8, 8, 8, 8]) && !ShellHttp.IsPrivate([100, 128, 0, 1]), "public addresses are not");
    Check(ShellHttp.IsPrivate(System.Net.IPAddress.Parse("fd7a:115c:a1e0::1").GetAddressBytes())
        && ShellHttp.IsPrivate(System.Net.IPAddress.Parse("::1").GetAddressBytes())
        && ShellHttp.IsPrivate(System.Net.IPAddress.Parse("::ffff:10.0.0.1").GetAddressBytes())
        && !ShellHttp.IsPrivate(System.Net.IPAddress.Parse("2001:db8::1").GetAddressBytes()), "IPv6: the tailnet, loopback and mapped IPv4");
    Check(await ShellHttp.IsPrivate("localhost") && await ShellHttp.IsPrivate("app.localhost"), "localhost is private");
    var plain = await ShellHttp.Answer(Args(("url", "http://example.com/"), ("method", "GET")));
    Check(Code(plain) == "EINVAL", "plain http to the internet is refused");

    // ---- the reference: the same messages through tools/bridge_sim.py
    CrossCheck();
}
finally
{
    foreach (var dir in scratch)
        try { Directory.Delete(dir, recursive: true); } catch (Exception) { }
}

Console.WriteLine(failures == 0 ? "\nall passed" : $"\n{failures} failed");
return failures == 0 ? 0 : 1;

void CrossCheck()
{
    if (repo == null || !File.Exists(Path.Join(repo, "tools", "bridge_sim.py"))) { Console.WriteLine("skip  the reference: no tools/bridge_sim.py (--repo)"); return; }
    // what both answer alike on Windows: not a folder onto an empty one (Python's rename can't
    // replace a folder there) nor a rename by case (the reference sees a clash), which the tests above cover
    var messages = new JsonArray(
        Msg("mkdir", ("path", "Notes/Inbox")),
        Msg("write", ("path", "Notes/Inbox/a.md"), ("text", "# A\n")),
        Msg("write", ("path", "Notes/\u05E9\u05DC\u05D5\u05DD.md"), ("text", "\u05E9\u05DC\u05D5\u05DD\r\n")),
        Msg("write", ("path", "Notes/bom.md"), ("text", "\uFEFFbom")),
        Msg("read", ("path", "Notes/Inbox/a.md")),
        Msg("read", ("path", "Notes/missing.md")),
        Msg("readMany", ("paths", new JsonArray("Notes/Inbox/a.md", "nope.md", "Notes/\u05E9\u05DC\u05D5\u05DD.md", "Notes/bom.md"))),
        Msg("move", ("from", "Notes/Inbox/a.md"), ("to", "Notes/b.md")),
        Msg("move", ("from", "Notes/missing.md"), ("to", "Notes/c.md")),
        Msg("write", ("path", "Notes/c.md"), ("text", "c")),
        Msg("move", ("from", "Notes/b.md"), ("to", "Notes/c.md")),
        Msg("move", ("from", "Notes/b.md"), ("to", "Elsewhere/Deeper/b.md")),
        Msg("removeDir", ("path", "Notes")),
        Msg("removeDir", ("path", "Notes/Inbox")),
        Msg("remove", ("path", "Notes/c.md")),
        Msg("remove", ("path", "Notes/c.md")),
        Msg("removeDir", ("path", "Nowhere")),
        Msg("read", ("path", "../outside.md")),
        Msg("read", ("path", "a/./b.md")),
        Msg("list"),
        Msg("frobnicate"));

    var mine = new JsonArray();
    var f = new FolderFiles(Scratch());
    foreach (var m in messages) mine.Add(f.Answer(m!["op"]!.GetValue<string>(), m["args"]?.DeepClone() as JsonObject ?? new JsonObject()));

    var reference = Scratch();
    var ops = Path.Join(Scratch(), "ops.json");
    File.WriteAllText(ops, messages.ToJsonString(), new UTF8Encoding(false));
    var code = "import sys, json\nsys.path.insert(0, sys.argv[3])\nimport bridge_sim as b\nfrom pathlib import Path\n"
        + "f = b.Folder(Path(sys.argv[1]))\nops = json.load(open(sys.argv[2], encoding='utf-8'))\n"
        + "print(json.dumps([b.answer(f, m, {}) for m in ops], ensure_ascii=False))";
    var start = new ProcessStartInfo("python") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
    foreach (var a in new[] { "-I", "-c", code, reference, ops, Path.Join(repo, "tools") }) start.ArgumentList.Add(a);
    start.Environment["PYTHONIOENCODING"] = "utf-8";
    string output, errors;
    try
    {
        using var python = Process.Start(start)!;
        output = python.StandardOutput.ReadToEnd();
        errors = python.StandardError.ReadToEnd();
        python.WaitForExit();
    }
    catch (System.ComponentModel.Win32Exception) { Console.WriteLine("skip  the reference: no python"); return; }
    // Windows' stand-in that offers Python from the Store, rather than Python
    if (output.Trim().Length == 0 && errors.Contains("Microsoft Store")) { Console.WriteLine("skip  the reference: no python"); return; }
    if (JsonNode.Parse(output.Trim().Length > 0 ? output : "null") is not JsonArray theirs) { Check(false, "the reference answered", errors.Trim()); return; }

    for (var i = 0; i < messages.Count; i++)
    {
        var a = Normal(mine[i]);
        var b = Normal(theirs[i]);
        Check(a == b, $"same answer as the reference: {messages[i]!["op"]} {messages[i]!["args"]?.ToJsonString() ?? ""}", $"mine {a}, the reference's {b}");
    }
}

static JsonObject Msg(string op, params (string Key, JsonNode? Value)[] pairs)
{
    var args = new JsonObject();
    foreach (var (k, v) in pairs) args[k] = v;
    return new JsonObject { ["v"] = 1, ["op"] = op, ["args"] = args };
}

// An answer with what may differ taken out: mtimes, the words of an error (its code stays), the order of a listing.
static string Normal(JsonNode? reply)
{
    var copy = reply?.DeepClone();
    if (copy is JsonObject o)
    {
        if (o["error"] is JsonObject e) e.Remove("message");
        if (o["ok"] is JsonObject ok && ok.ContainsKey("files"))
        {
            ok.Remove("mtimes");
            foreach (var key in new[] { "files", "dirs" })
                ok[key] = new JsonArray((ok[key] as JsonArray ?? new JsonArray()).Select(n => n!.GetValue<string>()).Order(StringComparer.Ordinal).Select(s => (JsonNode?)s).ToArray());
        }
    }
    Strip(copy);
    return copy?.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }) ?? "null";
}

static void Strip(JsonNode? node)
{
    if (node is JsonObject o)
    {
        o.Remove("mtime");
        foreach (var (_, v) in o.ToList()) Strip(v);
    }
    else if (node is JsonArray a) foreach (var v in a) Strip(v);
}

static string? FindRepo()
{
    for (var dir = new DirectoryInfo(Environment.CurrentDirectory); dir != null; dir = dir.Parent)
        if (File.Exists(Path.Join(dir.FullName, "tools", "bridge_sim.py"))) return dir.FullName;
    return null;
}
