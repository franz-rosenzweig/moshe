using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace Moshe;

/// <summary>
/// The export's print-ready HTML as a paginated PDF. A web view of its own, never
/// shown, loads it from the app's origin (so a sheet's pictures come from the
/// library as in the editor), and Chromium prints it as Edge saves a PDF: the
/// paper and the margins from its @page, and the page numbers from @page's margin
/// boxes, which Chromium draws itself (the Mac has to draw them on afterwards).
/// </summary>
static class PdfMaker
{
    public static async Task<byte[]> Make(ShellWindow owner, string html)
    {
        var environment = await App.WebEnvironment;
        // a server's page: its pictures come from the server
        if (!Library.UsesFolder && Library.Server is { } server)
            html = Regex.IsMatch(html, "<head[^>]*>", RegexOptions.IgnoreCase)
                ? Regex.Replace(html, "<head[^>]*>", m => $"{m.Value}<base href=\"{server.AbsoluteUri}\">", RegexOptions.IgnoreCase)
                : $"<base href=\"{server.AbsoluteUri}\">{html}";
        var name = Guid.NewGuid().ToString("N");
        AppScheme.Prints[name] = html;
        var controller = await environment.CreateCoreWebView2ControllerAsync(
            CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)owner.Handle));
        try
        {
            controller.IsVisible = false;
            var core = controller.CoreWebView2;
            new AppScheme(Library.WebBundle ?? AppContext.BaseDirectory, Library.UsesFolder ? Library.Folder : null, environment).Attach(core);
            var loaded = new TaskCompletionSource<bool>();
            core.NavigationCompleted += (_, e) => loaded.TrySetResult(e.IsSuccess);
            core.Navigate($"{AppScheme.Origin}/_print/{name}");
            if (!await loaded.Task) throw new ShellError("the PDF's page did not load");
            // the fonts and the pictures, before the pages are cut
            await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", new JsonObject
            {
                ["expression"] = "Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]).then(() => true)",
                ["awaitPromise"] = true,
            }.ToJsonString());
            var printed = await core.CallDevToolsProtocolMethodAsync("Page.printToPDF", new JsonObject
            {
                ["printBackground"] = true,
                ["preferCSSPageSize"] = true,
            }.ToJsonString());
            var data = J.Text(JsonNode.Parse(printed)?["data"]) ?? throw new ShellError("the PDF could not be made");
            return Convert.FromBase64String(data);
        }
        finally
        {
            AppScheme.Prints.TryRemove(name, out _);
            controller.Close();
        }
    }
}
