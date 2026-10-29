using System.Text.Json.Nodes;
using System.Threading.Channels;
using Moshe.Core;

namespace Moshe;

/// <summary>
/// The folder bridge of docs/BRIDGE.md, Windows' half: the page's storage
/// messages answered from the library folder, one at a time and in the order
/// sent, and the page told when someone else (Obsidian, Syncthing, OneDrive)
/// changes the folder. The transport is Android's — window.MosheStorage.request(id,
/// json), answered by window.__mosheStorageReply(id, reply) — over WebView2's web
/// messages (Scripts.Shell). The Mac's is mac/Moshe/FolderBridge.swift.
/// </summary>
sealed class FolderBridge : IDisposable
{
    public FolderFiles Files { get; }
    readonly Channel<(int Id, string Op, JsonObject Args)> queue =
        Channel.CreateUnbounded<(int Id, string Op, JsonObject Args)>(new UnboundedChannelOptions { SingleReader = true });
    readonly Action<int, JsonObject> reply;
    readonly Action<int, string> asked;
    readonly Timer settle;
    FileSystemWatcher? watcher;

    /// <summary>How many times the page has been told the folder changed, for the self-test.</summary>
    public static int Nudges;

    /// <summary>How many <c>http</c> ops the pages have sent, for the self-test.</summary>
    public static int HttpRequests;

    /// <param name="reply">sends a reply to the page, from any thread</param>
    /// <param name="nudge">tells the page the folder changed, from any thread</param>
    /// <param name="asked">pick and useServer, which are the window's: a picker, then a reload</param>
    public FolderBridge(string root, Action<int, JsonObject> reply, Action nudge, Action<int, string> asked)
    {
        Files = new FolderFiles(root);
        this.reply = reply;
        this.asked = asked;
        settle = new Timer(_ =>
        {
            Interlocked.Increment(ref Nudges);
            nudge();
        });
        _ = Task.Run(Pump);
    }

    /// <summary>One message from the page, as Android's transport sends it: an id and the message's JSON.</summary>
    public void Receive(int id, string json)
    {
        JsonObject? message = null;
        try { message = JsonNode.Parse(json) as JsonObject; }
        catch (Exception) { }
        if (J.Text(message?["op"]) is not { } op)
        {
            reply(id, FolderFiles.Failure("EINVAL", "not a bridge message"));
            return;
        }
        var version = J.Int(message!["v"]);
        if (version != 1)
        {
            reply(id, FolderFiles.Failure("EPROTO", $"this app speaks protocol 1, not {version}"));
            return;
        }
        var args = message["args"] as JsonObject ?? new JsonObject();
        switch (op)
        {
            case "pick":
            case "useServer":
                asked(id, op);
                break;
            case "changed":
                // the page's word that the library changed: nothing here keeps a
                // copy of it (no badge, no tray), so there is nothing to redo
                reply(id, J.Ok(null));
                break;
            case "http":
                // Not a file operation, so beside the queue rather than in it: a
                // slow server must not hold up the folder, nor the folder a sync.
                Interlocked.Increment(ref HttpRequests);
                _ = Task.Run(async () => reply(id, await ShellHttp.Answer(args)));
                break;
            default:
                queue.Writer.TryWrite((id, op, args));
                break;
        }
    }

    async Task Pump()
    {
        await foreach (var (id, op, args) in queue.Reader.ReadAllAsync())
        {
            JsonObject answer;
            try { answer = Files.Answer(op, args); }
            catch (Exception e) { answer = FolderFiles.Failure("EIO", e.Message); }
            reply(id, answer);
        }
    }

    // ---- someone else writes the folder -------------------------------------------

    public void StartWatching()
    {
        if (watcher != null) return;
        try
        {
            watcher = new FileSystemWatcher(Files.Root)
            {
                IncludeSubdirectories = true,
                InternalBufferSize = 64 * 1024,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
            };
            watcher.Created += Changed;
            watcher.Changed += Changed;
            watcher.Deleted += Changed;
            watcher.Renamed += Changed;
            // more at once than Windows could list (a big sync): say so anyway
            watcher.Error += (_, e) =>
            {
                Log.Write($"watching {Files.Root}: {e.GetException().Message}");
                Soon();
            };
            watcher.EnableRaisingEvents = true;
        }
        catch (Exception e)
        {
            Log.Write($"cannot watch {Files.Root}: {e.Message}");
        }
    }

    void Changed(object sender, FileSystemEventArgs e)
    {
        var name = e.Name ?? "";
        // our own temporary files, and what goes on inside .git and the rest the page never reads
        if (name.EndsWith(FolderFiles.TempSuffix, StringComparison.Ordinal)) return;
        if (name.Split(Path.DirectorySeparatorChar).Any(FolderFiles.Ignored.Contains)) return;
        Soon();
    }

    /// <summary>
    /// About a third of a second after the last change, as the Mac's FSEvents
    /// latency. Our own writes come back this way too; the page debounces and
    /// compares contents, so telling it is harmless (docs/BRIDGE.md, 3).
    /// </summary>
    void Soon() => settle.Change(300, Timeout.Infinite);

    public void Dispose()
    {
        watcher?.Dispose();
        watcher = null;
        queue.Writer.TryComplete();
        settle.Dispose();
    }
}
