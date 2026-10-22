import AppKit
import CoreServices
import Foundation
import WebKit

/// The folder bridge of docs/BRIDGE.md, the Mac's half: the page's storage
/// messages answered from the library folder, one at a time and in the order
/// sent, and the page told when someone else (Obsidian, Syncthing, iCloud)
/// changes the folder. tools/bridge_sim.py is the reference; when they differ,
/// the document decides.
final class FolderBridge: NSObject, WKScriptMessageHandlerWithReply {
    let files: FolderFiles
    weak var webView: WKWebView?
    private let queue = DispatchQueue(label: "moshe.folder")       // one message at a time, in order
    private var stream: FSEventStreamRef?

    /// How many `http` ops the pages have sent, for the self-test.
    static var httpRequests = 0

    init(root: URL) {
        files = FolderFiles(root: root)
    }

    // The stream holds an unretained pointer to this bridge, so it must stop
    // before the bridge goes; and a stream is the main actor's to stop.
    isolated deinit { stopWatching() }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        // only the app's own page, never anything else loaded into the window
        guard message.frameInfo.securityOrigin.protocol == AppScheme.scheme else {
            replyHandler(nil, "the folder is only for the app's own page")
            return
        }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(FolderFiles.failure("EINVAL", "not a bridge message"), nil)
            return
        }
        let version = (body["v"] as? NSNumber)?.intValue ?? 0
        let args = body["args"] as? [String: Any] ?? [:]
        guard version == 1 else {
            replyHandler(FolderFiles.failure("EPROTO", "this app speaks protocol 1, not \(version)"), nil)
            return
        }
        switch op {
        case "pick":
            // the picker is the app's; the reply goes when it closes, then the reload
            let chosen = Library.chooseFolder()
            replyHandler(["ok": ["changed": chosen != nil]], nil)
            if let chosen { Library.useFolder(chosen) }
        case "useServer":
            replyHandler(["ok": NSNull()], nil)
            Library.useServer()
        case "changed":
            // the page's word that the library changed: nothing here keeps a
            // copy of it (no badge, no menu bar), so there is nothing to redo
            replyHandler(["ok": NSNull()], nil)
        // Not a file operation, so beside the queue rather than in it: a slow
        // server must not hold up the folder, nor the folder a sync.
        case "http":
            Self.httpRequests += 1
            let url = args["url"] as? String, method = args["method"] as? String, body = args["body"] as? String
            let headers = (args["headers"] as? [String: Any] ?? [:]).mapValues { "\($0)" }
            Task {
                let reply = Plist(await ShellHTTP.answer(url: url, method: method, headers: headers, body: body))
                replyHandler(reply.value, nil)
            }
        default:
            let files = self.files
            let asked = Plist(args)
            queue.async {
                let reply = Plist(files.answer(op: op, args: asked.value))
                DispatchQueue.main.async { MainActor.assumeIsolated { replyHandler(reply.value, nil) } }
            }
        }
    }

    // ---- someone else writes the folder -------------------------------------------

    func startWatching() {
        guard stream == nil else { return }
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let bridge = Unmanaged<FolderBridge>.fromOpaque(info).takeUnretainedValue()
            DispatchQueue.main.async { MainActor.assumeIsolated { bridge.filesChanged() } }
        }
        // our own writes come back through here too; the page compares contents,
        // so telling it is harmless (docs/BRIDGE.md, 3)
        stream = FSEventStreamCreate(nil, callback, &context, [files.root.path] as CFArray,
                                     FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3,
                                     FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer))
        if let stream {
            FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
            FSEventStreamStart(stream)
        }
    }

    func stopWatching() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    /// How many times the page has been told, for the self-test.
    static var nudges = 0

    @MainActor
    private func filesChanged() {
        Self.nudges += 1
        webView?.evaluateJavaScript("window.__mosheFilesChanged && window.__mosheFilesChanged()", completionHandler: nil)
    }
}

/// A message's arguments, or a reply, on its way between the main actor and
/// the bridge's queue. Only strings, numbers, lists, dictionaries and null —
/// what WebKit hands over and takes back — and never changed after it is made,
/// so it is safe to send whatever the type system can tell.
struct Plist: @unchecked Sendable {
    let value: [String: Any]
    init(_ value: [String: Any]) { self.value = value }
}

/// The folder itself: every op of docs/BRIDGE.md, 2, on FileManager. No state
/// but the root, so it is safe on the bridge's queue.
struct FolderFiles {
    let root: URL
    private let realRoot: String

    static let ignored: Set<String> = [".obsidian", ".trash", ".git", ".stfolder", ".stversions", "node_modules"]
    static let tempSuffix = ".moshe-tmp"

    init(root: URL) {
        self.root = root.standardizedFileURL
        realRoot = root.resolvingSymlinksInPath().path
    }

    struct BridgeError: Error {
        let code: String
        let message: String
    }

    static func failure(_ code: String, _ message: String) -> [String: Any] {
        ["error": ["code": code, "message": message]]
    }

    func answer(op: String, args: [String: Any]) -> [String: Any] {
        do {
            switch op {
            case "list": return ["ok": try list()]
            case "read": return ["ok": orNull(try read(string(args, "path")))]
            case "readMany":
                guard let paths = args["paths"] as? [String] else { throw BridgeError(code: "EINVAL", message: "paths must be a list") }
                return ["ok": try paths.map { orNull(try read($0)) }]
            case "write":
                guard let text = args["text"] as? String else { throw BridgeError(code: "EINVAL", message: "text must be a string") }
                return ["ok": try write(string(args, "path"), Data(text.utf8))]
            case "writeBytes":
                guard let base64 = args["base64"] as? String, let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
                    throw BridgeError(code: "EINVAL", message: "base64 must be a string of base64")
                }
                return ["ok": try write(string(args, "path"), data)]
            case "remove": try remove(string(args, "path")); return ["ok": NSNull()]
            case "move": try move(string(args, "from"), string(args, "to")); return ["ok": NSNull()]
            case "mkdir": try mkdir(string(args, "path")); return ["ok": NSNull()]
            case "removeDir": return ["ok": try removeDir(string(args, "path"))]
            case "info":
                return ["ok": ["name": root.lastPathComponent,
                               "detail": (root.path as NSString).abbreviatingWithTildeInPath,
                               "canPick": true, "canUseServer": true,
                               "pollSeconds": 0,                      // FSEvents says when it changes
                               // -FolderHTTP NO leaves the sync's requests to the page, for the self-test
                               "http": UserDefaults.standard.object(forKey: "FolderHTTP") == nil || UserDefaults.standard.bool(forKey: "FolderHTTP"),
                               "changes": false]]
            default: throw BridgeError(code: "ENOSYS", message: "no such operation: \(op)")
            }
        } catch let e as BridgeError {
            return Self.failure(e.code, e.message)
        } catch let e as CocoaError where e.code == .fileWriteOutOfSpace {
            return Self.failure("ENOSPC", "the disk is full")
        } catch let e as CocoaError where [.fileReadNoPermission, .fileWriteNoPermission].contains(e.code) {
            return Self.failure("EACCES", "Moshe may not write to \(root.lastPathComponent): \(e.localizedDescription). "
                                + "Check the folder's permissions in Finder (Get Info → Sharing & Permissions).")
        } catch {
            return Self.failure("EIO", error.localizedDescription)
        }
    }

    private func orNull(_ value: [String: Any]?) -> Any {
        if let value { return value }
        return NSNull()
    }

    private func string(_ args: [String: Any], _ key: String) throws -> String {
        guard let s = args[key] as? String else { throw BridgeError(code: "EINVAL", message: "\(key) must be a string") }
        return s
    }

    /// A library path as a URL inside the root, or EINVAL (docs/BRIDGE.md, Paths).
    func url(_ path: String) throws -> URL {
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        if path.isEmpty || path.hasPrefix("/") || path.contains("\\") || path.contains("\0")
            || segments.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) {
            throw BridgeError(code: "EINVAL", message: "not a path inside the library: \(path)")
        }
        let url = root.appendingPathComponent(path)
        let real = url.resolvingSymlinksInPath().path
        guard real == realRoot || real.hasPrefix(realRoot + "/") else {
            throw BridgeError(code: "EINVAL", message: "outside the library: \(path)")
        }
        return url
    }

    private func isDirectory(_ url: URL) -> Bool? {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) ? isDir.boolValue : nil
    }

    func list() throws -> [String: Any] {
        var files: [String] = [], dirs: [String] = [], mtimes: [String: Double] = [:]
        // Relative paths as the disk has them. A URL's standardizedFileURL
        // decomposes Café.md on the way out, as creating it would on the way in.
        guard let walk = FileManager.default.enumerator(atPath: root.path) else {
            throw BridgeError(code: "EACCES", message: "cannot read \(root.lastPathComponent)")
        }
        while let rel = walk.nextObject() as? String {
            let attributes = walk.fileAttributes
            if attributes?[.type] as? FileAttributeType == .typeDirectory {
                dirs.append(rel)
                if Self.ignored.contains((rel as NSString).lastPathComponent) { walk.skipDescendants() }   // listed, not looked inside
            } else if !rel.hasSuffix(Self.tempSuffix) {
                files.append(rel)
                // the enumerator has already statted it: with these the page
                // reads only what changed on a rescan
                if let date = attributes?[.modificationDate] as? Date { mtimes[rel] = date.timeIntervalSince1970 * 1000 }
            }
        }
        return ["files": files, "dirs": dirs, "mtimes": mtimes]
    }

    func read(_ path: String) throws -> [String: Any]? {
        let url = try url(path)
        guard isDirectory(url) == false else { return nil }
        let data = try Data(contentsOf: url)
        // decoding: invalid bytes become U+FFFD; a BOM and \r\n are kept as they are
        return ["text": String(decoding: data, as: UTF8.self), "mtime": mtime(url)]
    }

    /// The bytes of a file of the library, for the scheme handler's /_library/.
    func bytes(_ path: String) throws -> Data? {
        let url = try url(path)
        guard isDirectory(url) == false else { return nil }
        return try Data(contentsOf: url)
    }

    // Names go to disk exactly as the page wrote them. When Foundation creates
    // something it goes through the path's "file system representation", which
    // decomposes: Café.md, written with é as one code point, landed on disk as
    // e plus a combining accent — another name to Syncthing, to the server on
    // the far side of it, and to the page's own next listing. rename(2) and
    // mkdir(2) take the bytes as they are, so whatever creates a name goes
    // through them. Reading, statting and removing may stay with Foundation:
    // APFS finds a name however it is composed.

    func write(_ path: String, _ data: Data) throws -> [String: Any] {
        let url = try url(path)
        try makeDirectories(parent(of: path))
        // exactly these bytes, atomically: written beside it under a name of
        // our own, then renamed over it
        let temp = url.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString)\(Self.tempSuffix)")
        try data.write(to: temp)
        do {
            try posix("save", rename(temp.path, full(path)), path)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
        return ["mtime": mtime(url)]
    }

    func remove(_ path: String) throws {
        let url = try url(path)
        if isDirectory(url) == false { try FileManager.default.removeItem(at: url) }
    }

    func move(_ from: String, _ to: String) throws {
        let a = try url(from), b = try url(to)
        guard let fromIsDir = isDirectory(a) else { throw BridgeError(code: "ENOENT", message: "not there: \(from)") }
        if let toIsDir = isDirectory(b) {
            // A folder may take an empty folder's place, as rename(2) lets it;
            // nothing else is replaced. On a disk that ignores case, "draft.md"
            // to "Draft.md" finds the file itself at `to`: that is a rename of
            // one file, not a clash.
            let same = (try? a.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier)
                .map { idA in (try? b.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier).map { idA.isEqual($0) } ?? false } ?? false
            if !same {
                let empty = toIsDir && ((try? FileManager.default.contentsOfDirectory(atPath: b.path).isEmpty) ?? false)
                guard fromIsDir && empty else { throw BridgeError(code: "EEXIST", message: "already there: \(to)") }
                try FileManager.default.removeItem(at: b)
            }
        }
        try makeDirectories(parent(of: to))
        try posix("move", rename(full(from), full(to)), to)
    }

    func mkdir(_ path: String) throws {
        _ = try url(path)
        try makeDirectories(path)
    }

    /// The path on disk, as a string whose bytes are the ones the page sent.
    private func full(_ path: String) -> String { root.path + "/" + path }

    private func parent(of path: String) -> String {
        path.split(separator: "/").dropLast().joined(separator: "/")
    }

    /// Every directory along `path`, made where missing, each under its name as given.
    private func makeDirectories(_ path: String) throws {
        var so = ""
        for part in path.split(separator: "/") {
            so = so.isEmpty ? String(part) : so + "/" + part
            switch isDirectory(root.appendingPathComponent(so)) {
            case true?: continue
            case false?: throw BridgeError(code: "EEXIST", message: "a file is where a folder should be: \(so)")
            case nil: try posix("make the folder", Darwin.mkdir(full(so), 0o755), so)
            }
        }
    }

    /// A POSIX call's result, as the bridge's errors.
    private func posix(_ what: String, _ result: Int32, _ path: String) throws {
        guard result != 0 else { return }
        let e = errno
        switch e {
        case EACCES, EPERM, EROFS:
            throw BridgeError(code: "EACCES", message: "Moshe may not \(what) \(path) in \(root.lastPathComponent). "
                              + "Check the folder's permissions in Finder (Get Info → Sharing & Permissions).")
        case ENOSPC, EDQUOT:
            throw BridgeError(code: "ENOSPC", message: "the disk is full")
        default:
            throw BridgeError(code: "EIO", message: "could not \(what) \(path): \(String(cString: strerror(e)))")
        }
    }

    func removeDir(_ path: String) throws -> Bool {
        let url = try url(path)
        guard isDirectory(url) == true else { return true }
        if !(try FileManager.default.contentsOfDirectory(atPath: url.path)).isEmpty { return false }
        try FileManager.default.removeItem(at: url)
        return true
    }

    private func mtime(_ url: URL) -> Double {
        let date = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
        return (date ?? Date()).timeIntervalSince1970 * 1000
    }
}
