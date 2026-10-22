package xyz.tiresia.moshe;

import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The folder bridge of docs/BRIDGE.md, Android's half, as window.MosheStorage:
 * the page's storage messages answered from the library, one at a time and in
 * the order sent (a single-thread executor), replies sent back by id through
 * window.__mosheStorageReply. tools/bridge_sim.py is the reference; when they
 * differ, the document decides.
 *
 * `http` (the page's WebDAV sync) runs beside the queue, not in it: a slow
 * server must not hold up the folder, nor the folder a sync.
 */
final class Bridge {
    interface Reply { void ok(String resultJson); }

    private final MainActivity activity;
    private final WebView web;
    private final Library library;
    private final ExecutorService queue = Executors.newSingleThreadExecutor();   // one at a time, in order
    private final ExecutorService beside = Executors.newCachedThreadPool();     // http, alongside the files

    Bridge(MainActivity activity, WebView web, Library library) {
        this.activity = activity;
        this.web = web;
        this.library = library;
    }

    void close() {
        queue.shutdown();
        beside.shutdown();
    }

    /** From the page: a message now, its reply later (docs/BRIDGE.md, Transport). */
    @JavascriptInterface
    public void request(final int id, final String json) {
        JSONObject msg;
        try {
            msg = new JSONObject(json);
        } catch (JSONException e) {
            send(id, error("EINVAL", "not a bridge message: " + e.getMessage()));
            return;
        }
        if (msg.optInt("v") != 1) {
            send(id, error("EPROTO", "this app speaks protocol 1, not " + msg.opt("v")));
            return;
        }
        final String op = msg.optString("op");
        final JSONObject args = msg.optJSONObject("args") == null ? new JSONObject() : msg.optJSONObject("args");
        switch (op) {
            case "changed":
                // the page's word that the library changed: nothing here keeps a copy of it
                send(id, "{\"ok\":null}");
                return;
            case "http":
                beside.execute(() -> {
                    try {
                        send(id, new JSONObject().put("ok", ShellHttp.request(args)).toString());
                    } catch (ShellHttp.Refused e) {
                        send(id, error(e.code, e.getMessage()));
                    } catch (JSONException | RuntimeException e) {
                        send(id, error("EIO", String.valueOf(e.getMessage())));
                    }
                });
                return;
            case "pick":
                // the picker is the activity's; the reply goes when it closes
                activity.runOnUiThread(() -> activity.pickFolder(result -> send(id, "{\"ok\":" + result + "}")));
                return;
            case "useServer":
                send(id, "{\"ok\":null}");
                activity.runOnUiThread(activity::useServer);
                return;
            default:
                break;
        }
        queue.execute(() -> {
            String reply;
            try {
                reply = new JSONObject().put("ok", answer(op, args)).toString();
            } catch (BridgeError e) {
                reply = error(e.code, e.getMessage());
            } catch (SecurityException e) {
                reply = error("EACCES", "Moshe can no longer open " + library.name()
                        + ". Choose the folder again: long-press Moshe's icon → Library.");
            } catch (IOException e) {
                String m = String.valueOf(e.getMessage());
                reply = m.startsWith("ENOSPC") ? error("ENOSPC", m.substring(m.indexOf(':') + 1).trim()) : error("EIO", m);
            } catch (JSONException | RuntimeException e) {
                reply = error("EIO", String.valueOf(e.getMessage()));
            }
            send(id, reply);
        });
    }

    private void send(int id, String reply) {
        web.post(() -> web.evaluateJavascript(
                "window.__mosheStorageReply && window.__mosheStorageReply(" + id + "," + JSONObject.quote(reply) + ")", null));
    }

    static String error(String code, String message) {
        try {
            return new JSONObject().put("error", new JSONObject().put("code", code).put("message", message)).toString();
        } catch (JSONException e) {
            return "{\"error\":{\"code\":\"EIO\"}}";
        }
    }

    private Object answer(String op, JSONObject args) throws BridgeError, IOException, JSONException {
        switch (op) {
            case "list": return library.list();
            case "read": return orNull(library.read(path(args, "path")));
            case "readMany": {
                JSONArray paths = args.optJSONArray("paths");
                if (paths == null) throw new BridgeError("EINVAL", "paths must be a list");
                JSONArray out = new JSONArray();
                for (int i = 0; i < paths.length(); i++) out.put(orNull(library.read(Library.check(paths.optString(i, null)))));
                return out;
            }
            case "write": {
                Object text = args.opt("text");
                if (!(text instanceof String)) throw new BridgeError("EINVAL", "text must be a string");
                return library.write(path(args, "path"), ((String) text).getBytes(StandardCharsets.UTF_8));   // exactly these bytes
            }
            case "writeBytes": {
                Object b64 = args.opt("base64");
                if (!(b64 instanceof String)) throw new BridgeError("EINVAL", "base64 must be a string");
                byte[] bytes;
                try {
                    bytes = Base64.decode((String) b64, Base64.DEFAULT);
                } catch (IllegalArgumentException e) {
                    throw new BridgeError("EINVAL", "base64 must be a string of base64");
                }
                return library.write(path(args, "path"), bytes);
            }
            case "remove": library.remove(path(args, "path")); return JSONObject.NULL;
            case "move": library.move(path(args, "from"), path(args, "to")); return JSONObject.NULL;
            case "mkdir": library.mkdir(path(args, "path")); return JSONObject.NULL;
            case "removeDir": return library.removeDir(path(args, "path"));
            case "info":
                return new JSONObject().put("name", library.name()).put("detail", library.detail())
                        .put("canPick", true).put("canUseServer", true).put("pollSeconds", 15)
                        .put("http", true).put("changes", false);
            default: throw new BridgeError("ENOSYS", "no such operation: " + op);
        }
    }

    private static Object orNull(Object o) { return o == null ? JSONObject.NULL : o; }

    private static String path(JSONObject args, String key) throws BridgeError {
        Object p = args.opt(key);
        if (!(p instanceof String)) throw new BridgeError("EINVAL", key + " must be a string");
        return Library.check((String) p);
    }
}
