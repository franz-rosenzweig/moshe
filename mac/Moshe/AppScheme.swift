import Foundation
import UniformTypeIdentifiers
import WebKit

/// The web app, served from inside Moshe.app at moshe-app://app/, and the
/// library's own files at moshe-app://app/_library/<path> (docs/BRIDGE.md, 1):
/// the images a sheet uses (`![](_media/photo.png)`) come from there.
///
/// A path that names a file in the build is that file; any other path is
/// index.html, so a reload lands back on the app whatever the address says.
final class AppScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "moshe-app"
    static let libraryPrefix = "/_library/"

    private let root: URL
    private let library: FolderFiles?

    init(root: URL, library: URL?) {
        self.root = root.standardizedFileURL
        self.library = library.map(FolderFiles.init(root:))
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        // URL.path is already percent-decoded: פרק ראשון.md, as the page named it
        let path = url.path
        if path.hasPrefix(Self.libraryPrefix) {
            return answerLibrary(String(path.dropFirst(Self.libraryPrefix.count)), url: url, task: task)
        }
        let file = resolve(path)
        do {
            respond(task, url: url, status: 200, data: try Data(contentsOf: file), mime: Self.mime(file.pathExtension))
        } catch {
            task.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// A file of the library, as bytes: 404 if it is not there, 403 for a path
    /// that leaves the folder.
    private func answerLibrary(_ rel: String, url: URL, task: WKURLSchemeTask) {
        guard let library else { return respond(task, url: url, status: 404, data: Data(), mime: "text/plain") }
        do {
            guard let data = try library.bytes(rel) else { return respond(task, url: url, status: 404, data: Data(), mime: "text/plain") }
            respond(task, url: url, status: 200, data: data, mime: Self.mime((rel as NSString).pathExtension))
        } catch let e as FolderFiles.BridgeError where e.code == "EINVAL" {
            respond(task, url: url, status: 403, data: Data(e.message.utf8), mime: "text/plain; charset=utf-8")
        } catch {
            respond(task, url: url, status: 404, data: Data(), mime: "text/plain")
        }
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, data: Data, mime: String) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        // An HTTPURLResponse with a status, or WebKit will not run a module script.
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func resolve(_ path: String) -> URL {
        let index = root.appendingPathComponent("index.html")
        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard !rel.isEmpty else { return index }
        let candidate = root.appendingPathComponent(rel).standardizedFileURL
        var isDir: ObjCBool = false
        // inside the build, and a file: anything else is the app's own route
        guard candidate.path.hasPrefix(root.path + "/"),
              FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), !isDir.boolValue else { return index }
        return candidate
    }

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        case "woff2": return "font/woff2"
        case "md": return "text/markdown; charset=utf-8"
        default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
