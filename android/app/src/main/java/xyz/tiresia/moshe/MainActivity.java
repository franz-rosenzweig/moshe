package xyz.tiresia.moshe;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Moshe: the web app (frontend/) from inside the APK, over the library, in a
 * WebView. The page is the whole interface and already has a phone layout —
 * library, sheets, editor, each with a way back — so this serves it, gives it
 * the folder (Bridge, as window.MosheStorage) and the few things a page cannot
 * do (ShellServices), and hands Back to it.
 *
 * The page comes from https://appassets.androidplatform.net/, answered from
 * assets/web/, and nothing else is ever loaded here: any other address goes to
 * the system, so nothing else can reach the bridge. In server mode the window
 * is the server's own page instead, with no bridge.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String HOST = "appassets.androidplatform.net";
    private static final String SHELL_JS = "/__moshe/shell.js";
    private static final String LIBRARY = "/_library/";
    private static final int PICK = 1, SAVE = 2, FILES = 3;

    private WebView web;
    private Bridge bridge;
    private ShellServices services;
    private Library library;
    private boolean serverMode;
    private Uri server;

    private Bridge.Reply picking;                 // a "pick" waiting for the picker to close
    private ValueCallback<Uri> saving;            // a save waiting for its place
    private ValueCallback<Uri[]> choosing;        // an <input type=file> waiting for files

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        // a test build can be opened on a kind of library without the settings screen (check.sh)
        String asked = debuggable ? getIntent().getStringExtra("moshe.kind") : null;
        if (Place.APP.equals(asked)) Place.useApp(this);
        else if (Place.SERVER.equals(asked)) Place.useServer(this, getIntent().getStringExtra("moshe.server"));
        if (!Place.ready(this)) {
            // first run, or the picked folder's permission went: ask where the library is
            startActivity(new Intent(this, SettingsActivity.class).putExtra(SettingsActivity.FIRST, true));
            finish();
            return;
        }
        serverMode = Place.SERVER.equals(Place.kind(this));
        server = Uri.parse(Place.server(this));
        if (!serverMode) {
            try {
                library = Place.TREE.equals(Place.kind(this))
                        ? new TreeLibrary(this, Place.tree(this)) : new FileLibrary(Place.appFolder(this));
            } catch (IOException | RuntimeException e) {
                Toast.makeText(this, "Moshe could not open its library: " + e.getMessage(), Toast.LENGTH_LONG).show();
                startActivity(new Intent(this, SettingsActivity.class).putExtra(SettingsActivity.FIRST, true));
                finish();
                return;
            }
        }
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true);

        web = page(this);
        web.setWebViewClient(new Pages());
        web.setWebChromeClient(new Chrome());
        if (!serverMode) {
            bridge = new Bridge(this, web, library);
            services = new ShellServices(this, web);
            web.addJavascriptInterface(bridge, "MosheStorage");
            web.addJavascriptInterface(services, "MosheShellNative");
        }
        setContentView(web);
        edgeToEdge();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        web.loadUrl(startUrl(getIntent()));
        libraryShortcut();
    }

    /** Long-press Moshe's icon → Library: where the library lives (SettingsActivity). */
    private void libraryShortcut() {
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null) return;
        ShortcutInfo library = new ShortcutInfo.Builder(this, "library")
                .setShortLabel(getString(R.string.shortcut_library))
                .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(new Intent(Intent.ACTION_VIEW).setClass(this, SettingsActivity.class))
                .build();
        try {
            sm.setDynamicShortcuts(java.util.Collections.singletonList(library));
        } catch (IllegalStateException | IllegalArgumentException ignored) {
            // the launcher's limit on shortcuts; nothing lost but the shortcut
        }
    }

    /** A WebView as the app's pages have them. */
    static WebView page(Activity a) {
        WebView w = new WebView(a);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // the page's own settings (localStorage)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " Moshe/" + version(a) + " (Android shell)");
        return w;
    }

    static String version(Activity a) {
        try {
            return a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    /** An offscreen page, for printing (ShellServices.savePdf). */
    WebView offscreenPage() {
        return page(this);
    }

    /** The app's start, or ?share=<text> for text shared from another app:
     *  the page makes it a new sheet in the Inbox. */
    private String startUrl(Intent intent) {
        String base = serverMode ? server.toString() : ORIGIN + "/";
        String shared = sharedText(intent);
        return shared == null ? base : base + "?share=" + Uri.encode(shared);
    }

    private static String sharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT), subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String all = subject != null && text != null && !text.startsWith(subject) ? subject + "\n\n" + text : text != null ? text : subject;
        return all == null || all.trim().isEmpty() ? null : all;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (web == null || sharedText(intent) == null) return;
        // what is being typed is saved before the page starts again with the share
        web.evaluateJavascript("(window.__mosheLocal ? window.__mosheLocal.flush() : Promise.resolve()).catch(() => {})"
                + ".then(() => { location.href = " + JSONObject.quote(startUrl(intent)) + "; })", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Syncthing may have brought changes while the app was away
        if (web != null) web.evaluateJavascript("window.__mosheFilesChanged && window.__mosheFilesChanged()", null);
    }

    // ---- Back ----

    /** The page goes back a pane first (editor → sheets → library); only when
     *  it has nowhere to go does Back leave the app. */
    private void back() {
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript("(() => { try { return !!(window.mosheBack && window.mosheBack()); } catch (e) { return false; } })()",
                went -> { if (!"true".equals(went)) finish(); });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT >= 33) super.onBackPressed();
        else back();
    }

    // ---- the window ----

    /**
     * The page runs up under the status bar, which it makes room for itself
     * (env(safe-area-inset-top) on its bars), so the bar's colour goes to the top
     * edge. Below, it stops at the navigation bar and at the keyboard: the
     * WebView gets shorter when the keyboard opens, so the page's visualViewport
     * follows it and the markup bar sits on the keyboard. The page is told of
     * the top inset only.
     */
    private void edgeToEdge() {
        View content = findViewById(android.R.id.content);
        content.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            int ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
            v.setPadding(bars.left, 0, bars.right, Math.max(bars.bottom, ime));
            return new WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.systemBars(), Insets.of(0, bars.top, 0, 0))
                    .build();
        });
        paintBars();
    }

    /** Behind the navigation bar, and the page's background before it paints:
     *  the colour of its lists, light or dark as the phone is. */
    private void paintBars() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int colour = night ? 0xFF232324 : 0xFFFFFFFF;
        getWindow().getDecorView().setBackgroundColor(colour);
        if (web != null) web.setBackgroundColor(colour);
        WindowInsetsController c = getWindow().getInsetsController();
        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        if (c != null) c.setSystemBarsAppearance(night ? 0 : light, light);
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        paintBars();
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.close();
        if (services != null) services.close();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---- what the page asks of the app (Bridge, ShellServices) ----

    /** "Choose another folder…": the system's folder picker. */
    void pickFolder(Bridge.Reply reply) {
        picking = reply;
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(pick, PICK);
        } catch (ActivityNotFoundException e) {
            picking = null;
            reply.ok("{\"changed\":false}");
        }
    }

    /** "Use the server instead". */
    void useServer() {
        if (Place.useServer(this, Place.server(this))) recreate();
        // no address yet: the settings screen asks for one
        else startActivity(new Intent(this, SettingsActivity.class));
    }

    /** A place for an export, from the system's create-document screen. */
    void createDocument(String name, String mime, ValueCallback<Uri> done) {
        if (saving != null) saving.onReceiveValue(null);
        saving = done;
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(save, SAVE);
        } catch (ActivityNotFoundException e) {
            saving = null;
            done.onReceiveValue(null);
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        switch (request) {
            case PICK: {
                boolean changed = uri != null;
                if (changed) Place.useTree(this, uri);
                if (picking != null) picking.ok("{\"changed\":" + changed + "}");
                picking = null;
                if (changed) recreate();          // the page again, on the new folder
                break;
            }
            case SAVE:
                if (saving != null) saving.onReceiveValue(uri);
                saving = null;
                break;
            case FILES:
                if (choosing != null) choosing.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                choosing = null;
                break;
            default:
                break;
        }
    }

    // ---- serving the web app from assets/web/, and the library's pictures ----

    /** The app's pages, main and offscreen: the web app, /_library/, and every other address sent out. */
    class Pages extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (serverMode || !HOST.equals(url.getHost())) return null;
            String path = url.getPath() == null ? "/" : url.getPath();
            if (path.equals(SHELL_JS)) return text(ShellServices.SCRIPT, "text/javascript");
            if (path.startsWith(LIBRARY)) return fromLibrary(path.substring(LIBRARY.length()));
            byte[] file = asset(path);
            if (file == null || path.equals("/") || path.equals("/index.html")) {
                // the app's own route: index.html, with mosheShell before the page's scripts
                byte[] index = asset("/index.html");
                if (index == null) return null;
                String html = new String(index, StandardCharsets.UTF_8)
                        .replaceFirst("<head>", "<head><script src=\"" + SHELL_JS + "\"></script>");
                return text(html, "text/html");
            }
            return respond(200, mime(path), file);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!serverMode && HOST.equals(url.getHost())) return false;
            if (serverMode && url.getHost() != null && url.getHost().equals(server.getHost())
                    && String.valueOf(url.getScheme()).equals(server.getScheme())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
                // nothing on the phone opens it; stay put
            }
            return true;
        }
    }

    /** A picture a sheet shows: bytes from the library, or 404; 403 for a path out of it. */
    private WebResourceResponse fromLibrary(String rel) {
        try {
            byte[] bytes = library.bytes(Library.check(rel));
            if (bytes == null) return respond(404, "text/plain", new byte[0]);
            return respond(200, mime(rel), bytes);
        } catch (BridgeError e) {
            return respond(403, "text/plain", e.getMessage().getBytes(StandardCharsets.UTF_8));
        } catch (IOException | SecurityException e) {
            return respond(404, "text/plain", new byte[0]);
        }
    }

    private static WebResourceResponse text(String body, String mime) {
        return respond(200, mime, body.getBytes(StandardCharsets.UTF_8));
    }

    private static WebResourceResponse respond(int status, String mime, byte[] body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        String reason = status == 200 ? "OK" : status == 403 ? "Forbidden" : "Not Found";
        String charset = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") ? "utf-8" : null;
        return new WebResourceResponse(mime, charset, status, reason, headers, new ByteArrayInputStream(body));
    }

    private byte[] asset(String path) {
        String rel = path.startsWith("/") ? path.substring(1) : path;
        if (rel.isEmpty() || rel.contains("..")) return null;
        try (InputStream in = getAssets().open("web/" + rel)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[65536];
            for (int n; (n = in.read(chunk)) > 0; ) out.write(chunk, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".wasm")) return "application/wasm";      // or WebAssembly's streaming compile refuses it
        String ext = p.contains(".") ? p.substring(p.lastIndexOf('.') + 1) : "";
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return type == null ? "application/octet-stream" : type;
    }

    /** <input type=file>: a picture for a sheet, a file to import. */
    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (choosing != null) choosing.onReceiveValue(null);
            choosing = callback;
            try {
                startActivityForResult(params.createIntent(), FILES);
                return true;
            } catch (ActivityNotFoundException e) {
                choosing = null;
                return false;
            }
        }
    }
}
