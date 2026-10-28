using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Moshe;

/// <summary>
/// The self-test (windows/selftest.ps1): the real app on a scratch folder, with no
/// dialog for anyone to answer, checked from inside the page and from outside it.
/// The results go to --out, and the exit code says whether every check held.
/// The Mac's is mac/SelfTest.
/// </summary>
static class SelfTest
{
    sealed record Check(string Name, bool Ok, string Detail);
    static readonly List<Check> Checks = [];
    static readonly object Gate = new();

    // a picture of one pixel, for /_library/
    static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    public static void Start()
    {
        // never longer than two minutes, whatever hangs
        _ = Task.Delay(TimeSpan.FromMinutes(2)).ContinueWith(_ => Finish("it took more than two minutes"));
    }

    static void Add(string name, bool ok, string detail = "")
    {
        lock (Gate) Checks.Add(new Check(name, ok, detail));
    }

    public static async Task Run(ShellWindow window)
    {
        try
        {
            var folder = Library.Folder ?? throw new Exception("no folder: run it with --folder");
            Add("folder mode", Library.UsesFolder, folder);

            var mode = await Until(window, "window.__mosheLocal ? window.__mosheLocal.mode : null", TimeSpan.FromSeconds(60));
            Add("the page started on the folder", J.Text(mode) == "folder", mode?.ToJsonString() ?? "it never started");
            var agent = J.Text(await window.Evaluate("navigator.userAgent")) ?? "";
            Add("the user agent names the shell", agent.Contains($"Moshe/{App.Version} (Windows shell)"), agent);
            Add("window.mosheShell has every call",
                J.Bool(await window.Evaluate("['savePdf', 'saveFile', 'share', 'sharePdf', 'openExternal', 'copy'].every((k) => typeof window.mosheShell[k] === 'function')")));

            // the bridge's conformance checks (docs/BRIDGE.md, "Checking a shell"), in the page, over the bridge
            var conformance = await window.Evaluate("window.__mosheLocal.conformance()");
            foreach (var result in (conformance?["results"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
                Add($"conformance: {J.Text(result["name"])}", J.Bool(result["ok"]), J.Text(result["error"]) ?? $"{result["ms"]} ms");
            Add("conformance as a whole", J.Bool(conformance?["ok"]), conformance == null ? "no answer" : "");

            // /_library/: the folder's pictures, and nothing outside it
            Directory.CreateDirectory(Path.Join(folder, "_media"));
            await File.WriteAllBytesAsync(Path.Join(folder, "_media", "selftest.png"), Png);
            var served = J.Text(await window.Evaluate(
                "fetch('/_library/_media/selftest.png').then(async (r) => `${r.status} ${r.headers.get('content-type')} ${(await r.arrayBuffer()).byteLength}`)"));
            Add("/_library/ serves the folder's pictures", served == $"200 image/png {Png.Length}", served ?? "");
            var refused = (await window.Evaluate("fetch('/_library/a%5C..%5C..%5Csecret.txt').then((r) => r.status)"))?.ToJsonString();
            Add("/_library/ refuses a path out of the folder", refused == "403", refused ?? "");
            var route = J.Text(await window.Evaluate("fetch('/project/some/route').then(async (r) => `${r.status} ${(await r.text()).includes('<script')}`)"));
            Add("any other path is the app", route == "200 true", route ?? "");

            // a change from outside reaches the page
            var before = FolderBridge.Nudges;
            Directory.CreateDirectory(Path.Join(folder, "Notes"));
            await File.WriteAllTextAsync(Path.Join(folder, "Notes", "From outside.md"), "# From outside\n\nWritten by the self-test, as Obsidian would.\n");
            var told = await Until(() => FolderBridge.Nudges > before, TimeSpan.FromSeconds(5));
            Add("a change from another app reaches the page", told, $"{FolderBridge.Nudges - before} times");

            // the shell's services, saving into --save-dir instead of a dialog
            var saveDir = App.Options.SaveDir ?? throw new Exception("no --save-dir");
            var pdf = await window.Evaluate("window.mosheShell.savePdf('<!doctype html><html><head><meta charset=\"utf-8\"><style>"
                + "@page { size: A5; margin: 20mm; @bottom-center { content: counter(page); } } body { font: 12pt Georgia, serif; }"
                + "</style></head><body><h1>Moshe</h1><p>The self-test\\u2019s page.</p></body></html>', 'Self-test.pdf')");
            var pdfFile = Path.Join(saveDir, "Self-test.pdf");
            var pdfBytes = File.Exists(pdfFile) ? await File.ReadAllBytesAsync(pdfFile) : Array.Empty<byte>();
            var head = pdfBytes.Length >= 5 ? Encoding.ASCII.GetString(pdfBytes, 0, 5) : "";
            Add("savePdf makes a PDF", J.Bool(pdf) && head == "%PDF-", $"{pdfBytes.Length} bytes");
            // A5 is 419.53 × 595.28 points, which Chromium may round: the @page size was used, not Letter or A4
            var box = Regex.Match(Encoding.ASCII.GetString(pdfBytes), @"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]");
            var (width, height) = box.Success
                ? (double.Parse(box.Groups[1].Value, CultureInfo.InvariantCulture), double.Parse(box.Groups[2].Value, CultureInfo.InvariantCulture))
                : (0.0, 0.0);
            Add("the PDF is on the paper @page asks for", Math.Abs(width - 419.5) < 3 && Math.Abs(height - 595.3) < 3,
                box.Success ? $"a MediaBox of {box.Groups[1].Value} × {box.Groups[2].Value} points" : "no MediaBox found");
            var saved = await window.Evaluate("window.mosheShell.saveFile('Self-test.md', btoa('# Saved\\n'), 'text/markdown')");
            var savedFile = Path.Join(saveDir, "Self-test.md");
            Add("saveFile saves the bytes", J.Bool(saved) && File.Exists(savedFile) && await File.ReadAllTextAsync(savedFile) == "# Saved\n");
            Add("share has the file ready", J.Bool(await window.Evaluate("window.mosheShell.share('Self-test.txt', btoa('shared'), 'text/plain')")));
            Add("openExternal sends a link to the browser",
                J.Bool(await window.Evaluate("window.mosheShell.openExternal('https://example.com/moshe-help')"))
                && Outside.Opened.Any(u => u.AbsoluteUri == "https://example.com/moshe-help"));
            Add("openExternal refuses other kinds of address", !J.Bool(await window.Evaluate("window.mosheShell.openExternal('file:///C:/Windows/notepad.exe')")));

            // nothing but the app ever loads in the window
            await window.Evaluate("location.assign('https://example.com/elsewhere'), true");
            await Task.Delay(1000);
            Add("a link elsewhere opens in the browser, not in the window",
                window.Source?.AbsoluteUri.StartsWith(AppScheme.Origin, StringComparison.Ordinal) == true
                && Outside.Opened.Any(u => u.AbsoluteUri == "https://example.com/elsewhere"),
                window.Source?.AbsoluteUri ?? "");

            // the window: Windows 11's title bar, holding the five menus
            var titles = string.Join(", ", window.MenuTitles);
            Add("the title bar holds File, Edit, Format, View and Help", titles == "File, Edit, Format, View, Help" && window.ExtendsContentIntoTitleBar, titles);
            Add("the window is named for its library", window.Title == $"{Path.GetFileName(folder)} - Moshe", window.Title);

            // the menu's state, from the page
            var state = await window.MenuState();
            Add("the page gives the menus their state", state?["commands"] is JsonArray { Count: > 0 }, state == null ? "none" : $"{(state["commands"] as JsonArray)?.Count} commands");

            Finish();
        }
        catch (Exception e)
        {
            Finish(e.ToString());
        }
    }

    /// <summary>The expression's value once it is truthy, or its last value when the time runs out.</summary>
    static async Task<JsonNode?> Until(ShellWindow window, string expression, TimeSpan within)
    {
        var end = DateTime.UtcNow + within;
        JsonNode? value = null;
        while (DateTime.UtcNow < end)
        {
            try { value = await window.Evaluate(expression); }
            catch (Exception) { value = null; }
            if (value != null && value.ToJsonString() is not ("false" or "0" or "\"\"")) return value;
            await Task.Delay(250);
        }
        return value;
    }

    static async Task<bool> Until(Func<bool> condition, TimeSpan within)
    {
        var end = DateTime.UtcNow + within;
        while (DateTime.UtcNow < end)
        {
            if (condition()) return true;
            await Task.Delay(100);
        }
        return condition();
    }

    static void Finish(string? problem = null)
    {
        Check[] checks;
        lock (Gate)
        {
            if (problem != null) Checks.Add(new Check("the self-test ran to the end", false, problem));
            checks = [.. Checks];
        }
        var ok = checks.Length > 0 && checks.All(c => c.Ok);
        var report = new JsonObject
        {
            ["ok"] = ok,
            ["version"] = App.Version,
            ["checks"] = new JsonArray(checks.Select(c => (JsonNode?)new JsonObject { ["name"] = c.Name, ["ok"] = c.Ok, ["detail"] = c.Detail }).ToArray()),
        };
        try
        {
            if (App.Options.Out is { } path)
                File.WriteAllText(path, report.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        }
        catch (Exception e) { Log.Write($"self-test results: {e.Message}"); }
        Environment.Exit(ok ? 0 : 1);
    }
}
