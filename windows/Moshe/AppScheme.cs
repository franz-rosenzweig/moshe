using System.Collections.Concurrent;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Moshe.Core;

namespace Moshe;

/// <summary>
/// The web app, served from inside Moshe at https://moshe-app.example/, and the
/// library's own files at /_library/&lt;path&gt; (docs/BRIDGE.md, 1): the images a
/// sheet uses (<c>![](_media/photo.png)</c>) come from there. A path that names a
/// file in the build is that file; any other path is index.html, so a reload
/// lands back on the app whatever the address says. The Mac's is
/// mac/Moshe/AppScheme.swift, at moshe-app://app/.
/// </summary>
/// <remarks>
/// WebView2 answers an https origin's requests from here, before any network;
/// .example is reserved (RFC 2606), so no real site can ever be at it.
/// </remarks>
sealed class AppScheme
{
    public const string Origin = "https://moshe-app.example";
    const string LibraryPrefix = "/_library/";
    const string PrintPrefix = "/_print/";

    /// <summary>Pages PdfMaker prints, by a name of their own: from the app's origin, so their pictures load as in the editor.</summary>
    public static readonly ConcurrentDictionary<string, string> Prints = new();

    readonly string web;
    readonly FolderFiles? library;
    readonly CoreWebView2Environment environment;

    public AppScheme(string web, string? library, CoreWebView2Environment environment)
    {
        this.web = Path.TrimEndingDirectorySeparator(Path.GetFullPath(web));
        this.library = library == null ? null : new FolderFiles(library);
        this.environment = environment;
    }

    public void Attach(CoreWebView2 core)
    {
        core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += Answer;
    }

    void Answer(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var url)
            || !url.AbsoluteUri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) return;
        // still percent-encoded here: פרק ראשון.md, as the page named it, once decoded
        var path = Uri.UnescapeDataString(url.AbsolutePath);
        try
        {
            if (path.StartsWith(LibraryPrefix, StringComparison.Ordinal))
                e.Response = FromLibrary(path[LibraryPrefix.Length..]);
            else if (path.StartsWith(PrintPrefix, StringComparison.Ordinal) && Prints.TryGetValue(path[PrintPrefix.Length..], out var html))
                e.Response = Respond(200, Encoding.UTF8.GetBytes(html), Mime(".html"));
            else
            {
                var file = Resolve(path);
                e.Response = Respond(200, File.ReadAllBytes(file), Mime(Path.GetExtension(file)));
            }
        }
        catch (Exception x)
        {
            Log.Write($"could not answer {path}: {x.Message}");
            e.Response = Respond(500, Encoding.UTF8.GetBytes(x.Message), "text/plain; charset=utf-8");
        }
    }

    /// <summary>A file of the library, as bytes: 404 if it is not there, 403 for a path that leaves the folder.</summary>
    CoreWebView2WebResourceResponse FromLibrary(string rel)
    {
        if (library == null) return Respond(404, [], "text/plain");
        try
        {
            return library.Bytes(rel) is { } data ? Respond(200, data, Mime(Path.GetExtension(rel))) : Respond(404, [], "text/plain");
        }
        catch (FolderFiles.BridgeError x) when (x.Code == "EINVAL")
        {
            return Respond(403, Encoding.UTF8.GetBytes(x.Message), "text/plain; charset=utf-8");
        }
        catch (Exception)
        {
            return Respond(404, [], "text/plain");
        }
    }

    CoreWebView2WebResourceResponse Respond(int status, byte[] data, string mime)
    {
        var reason = status switch { 200 => "OK", 403 => "Forbidden", 404 => "Not Found", _ => "Error" };
        return environment.CreateWebResourceResponse(new MemoryStream(data).AsRandomAccessStream(), status, reason,
            $"Content-Type: {mime}\r\nCache-Control: no-cache");
    }

    string Resolve(string path)
    {
        var index = Path.Join(web, "index.html");
        var rel = path.TrimStart('/');
        if (rel.Length == 0 || rel.Contains('\\')) return index;
        var candidate = Path.GetFullPath(Path.Join(web, rel.Replace('/', Path.DirectorySeparatorChar)));
        // inside the build, and a file: anything else is the app's own route
        return candidate.StartsWith(web + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(candidate) ? candidate : index;
    }

    public static string Mime(string extension) => extension.TrimStart('.').ToLowerInvariant() switch
    {
        "html" or "htm" => "text/html; charset=utf-8",
        "js" or "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" or "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" or "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "md" => "text/markdown; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    };
}
