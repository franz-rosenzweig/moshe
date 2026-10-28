using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Moshe;

/// <summary>
/// window.mosheShell (docs/BRIDGE.md, 5; docs/MENUS.md): what a writing app needs
/// from Windows that a page can't do well — a paginated PDF, a save dialog, the
/// share sheet, the browser for a link, both kinds of clipboard. Each call is a
/// message with a reply, so the page's promise settles when the dialog closes.
/// The Mac's is mac/Moshe/ShellServices.swift. Print… stays the page's own: it
/// prints a hidden frame, and WebView2 shows its print dialog.
/// </summary>
sealed class ShellServices(ShellWindow owner)
{
    StorageFile? sharing;

    public async void Handle(int id, string op, JsonObject args)
    {
        JsonObject reply;
        try { reply = new JsonObject { ["channel"] = "shell", ["id"] = id, ["ok"] = await Answer(op, args) }; }
        catch (Exception e)
        {
            Log.Write($"mosheShell.{op}: {e.Message}");
            reply = new JsonObject { ["channel"] = "shell", ["id"] = id, ["error"] = e.Message };
        }
        owner.Post(reply);
    }

    async Task<JsonNode?> Answer(string op, JsonObject args)
    {
        switch (op)
        {
            case "savePdf":
            {
                var html = J.Text(args["html"]) ?? throw new ShellError("no HTML to print");
                var save = await ChooseDestination(WithExtension(J.Text(args["fileName"]) ?? "Export", "pdf"));
                if (save == null) return false;
                await save(await PdfMaker.Make(owner, html));
                return true;
            }
            case "saveFile":
            {
                var data = Bytes(args);
                var save = await ChooseDestination(J.Text(args["fileName"]) ?? "Export");
                if (save == null) return false;
                await save(data);
                return true;
            }
            case "share":
                return await Share(SafeName(J.Text(args["fileName"]) ?? "Export"), Bytes(args));
            case "sharePdf":
            {
                var html = J.Text(args["html"]) ?? throw new ShellError("nothing to share");
                return await Share(WithExtension(SafeName(J.Text(args["fileName"]) ?? "Export"), "pdf"), await PdfMaker.Make(owner, html));
            }
            case "copy":
            {
                // Copy as HTML / Rich Text: both kinds on the clipboard, for whatever it is pasted into
                var package = new DataPackage();
                var html = J.Text(args["html"]) ?? "";
                if (html.Length > 0) package.SetHtmlFormat(HtmlFormatHelper.CreateHtmlFormat(html));
                package.SetText(J.Text(args["text"]) ?? "");
                Clipboard.SetContent(package);
                try { Clipboard.Flush(); } catch (Exception) { }   // still there after Moshe quits
                return true;
            }
            case "openExternal":
                if (!Uri.TryCreate(J.Text(args["url"]), UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https" or "mailto")) return false;
                Outside.Open(url);
                return true;
            default:
                throw new ShellError($"no such shell call: {op}");
        }
    }

    /// <summary>A save dialog for <c>name</c>; what writes the chosen file, or null if cancelled. The self-test's --save-dir saves there without one.</summary>
    async Task<Func<byte[], Task>?> ChooseDestination(string name)
    {
        name = SafeName(name);
        if (App.Options.SaveDir is { } dir)
        {
            var path = Path.Join(dir, name);
            return bytes => File.WriteAllBytesAsync(path, bytes);
        }
        var picker = new FileSavePicker
        {
            SuggestedFileName = Path.GetFileNameWithoutExtension(name),
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
        };
        var extension = Path.GetExtension(name);
        picker.FileTypeChoices.Add(extension.Length > 1 ? $"{extension[1..].ToUpperInvariant()} file" : "Text file",
            new List<string> { extension.Length > 1 ? extension : ".txt" });
        InitializeWithWindow.Initialize(picker, owner.Handle);
        var file = await picker.PickSaveFileAsync();
        if (file == null) return null;
        return bytes => FileIO.WriteBytesAsync(file, bytes).AsTask();
    }

    /// <summary>The share sheet for a file, kept in a folder of its own under the temporary folder.</summary>
    async Task<bool> Share(string name, byte[] data)
    {
        var dir = Path.Join(Path.GetTempPath(), "Moshe Share", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Join(dir, name);
        await File.WriteAllBytesAsync(path, data);
        if (App.Options.SelfTest) return true;
        sharing = await StorageFile.GetFileFromPathAsync(path);
        var interop = DataTransferManager.As<IDataTransferManagerInterop>();
        var manager = WinRT.MarshalInterface<DataTransferManager>.FromAbi(interop.GetForWindow(owner.Handle, ref DataTransferManagerId));
        manager.DataRequested -= OnDataRequested;
        manager.DataRequested += OnDataRequested;
        interop.ShowShareUIForWindow(owner.Handle);
        return true;
    }

    void OnDataRequested(DataTransferManager sender, DataRequestedEventArgs e)
    {
        if (sharing == null) return;
        e.Request.Data.Properties.Title = sharing.Name;
        e.Request.Data.SetStorageItems(new[] { sharing });
    }

    static byte[] Bytes(JsonObject args)
    {
        try { return Convert.FromBase64String(J.Text(args["base64"]) ?? ""); }
        catch (FormatException) { throw new ShellError("the file's bytes did not arrive"); }
    }

    /// <summary>A name Windows takes for a file: none of / \ : * ? " &lt; &gt; |.</summary>
    public static string SafeName(string name)
    {
        var cleaned = string.Concat(name.Select(c => "/\\:*?\"<>|".Contains(c) || c < ' ' ? '-' : c)).Trim().TrimEnd('.');
        return cleaned.Length == 0 ? "Export" : cleaned;
    }

    public static string WithExtension(string name, string extension) =>
        Path.GetExtension(name).Equals("." + extension, StringComparison.OrdinalIgnoreCase) ? name : $"{name}.{extension}";

    // The share sheet for a desktop window (learn.microsoft.com, "Display WinRT UI objects that depend on CoreWindow").
    [ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDataTransferManagerInterop
    {
        IntPtr GetForWindow([In] IntPtr appWindow, [In] ref Guid riid);
        void ShowShareUIForWindow(IntPtr appWindow);
    }

    static Guid DataTransferManagerId = new(0xa5caee9b, 0x8708, 0x49d1, 0x8d, 0x36, 0x67, 0xd2, 0x5a, 0x8d, 0xa0, 0x0c);
}
