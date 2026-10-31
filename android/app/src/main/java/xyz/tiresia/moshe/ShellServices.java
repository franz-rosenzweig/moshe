package xyz.tiresia.moshe;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * `window.mosheShell` (docs/BRIDGE.md, 5), as window.MosheShellNative plus a
 * small script the page gets before its own (SCRIPT, served by MainActivity):
 * the print system for a PDF, a create-document for the other exports, the
 * share sheet, and the browser for a link. Also `voice` (docs/VOICE.md), from
 * window.MosheVoiceNative (Voice): reading aloud always, and listening where the
 * phone can. Each call answers the page's promise through
 * window.__mosheShellReply(id, ok, value).
 */
final class ShellServices {
    /** Put in the page before its own scripts (MainActivity adds it to index.html). */
    static final String SCRIPT = "(() => {\n"
            + "  const native = window.MosheShellNative;\n"
            + "  if (!native) return;\n"
            + "  let next = 1; const waiting = new Map();\n"
            + "  window.__mosheShellReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); ok ? w.resolve(value) : w.reject(new Error(value)); };\n"
            + "  const callOn = (to, fn, ...args) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject });\n"
            + "    try { to[fn](id, ...args.map((a) => String(a ?? ''))); } catch (e) { waiting.delete(id); reject(e); } });\n"
            + "  const call = (fn, ...args) => callOn(native, fn, ...args);\n"
            + "  const v = window.MosheVoiceNative;\n"
            + "  const voice = v && Object.freeze({\n"
            + "    speak: (text, lang, rate) => callOn(v, 'speak', text, lang || 'en', Number(rate) || 1),\n"
            + "    stopSpeaking: () => callOn(v, 'stopSpeaking'),\n"
            + "    ...(v.canListen() ? {\n"
            + "      start: (o) => callOn(v, 'start', JSON.stringify({ lang: String((o && o.lang) || 'en'), words: Array.isArray(o && o.words) ? o.words.map(String).slice(0, 300) : [], pause: Number(o && o.pause) || 700 })),\n"
            + "      stop: () => callOn(v, 'stop'),\n"
            + "      language: (lang) => callOn(v, 'language', lang),\n"
            + "    } : {}),\n"
            + "  });\n"
            + "  window.mosheShell = Object.freeze({\n"
            + "    savePdf: (html, fileName) => call('savePdf', html, fileName || 'Export.pdf'),\n"
            + "    saveFile: (fileName, base64, mime) => call('saveFile', fileName, base64, mime),\n"
            + "    share: (fileName, base64, mime) => call('share', fileName, base64, mime),\n"
            + "    openExternal: (url) => call('openExternal', url),\n"
            + "    copy: (what) => call('copy', (what && what.text) || '', (what && what.html) || ''),\n"
            + "    print: (html, fileName) => call('print', html, fileName || 'Print'),\n"
            + "    ...(voice ? { voice } : {}),\n"
            + "  });\n"
            + "})();\n";

    private final MainActivity activity;
    private final WebView web;
    /** The page being printed, held until the print system is done with it. */
    private WebView printing;

    ShellServices(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    void reply(int id, boolean ok, Object value) {
        reply(web, id, ok, value);
    }

    /** Settles the page's promise for call `id`. */
    static void reply(WebView web, int id, boolean ok, Object value) {
        String v = value instanceof String ? JSONObject.quote((String) value) : String.valueOf(value);
        web.post(() -> web.evaluateJavascript("window.__mosheShellReply && window.__mosheShellReply(" + id + "," + ok + "," + v + ")", null));
    }

    /** The export's print HTML, laid out by an offscreen WebView and handed to the
     *  print system, whose dialog has Save as PDF. @page gives the paper. */
    @JavascriptInterface
    public void savePdf(final int id, final String html, final String fileName) {
        activity.runOnUiThread(() -> {
            try {
                final String job = withoutExtension(fileName, "pdf");
                WebView page = activity.offscreenPage();
                page.setWebViewClient(activity.new Pages() {
                    private boolean done;
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (done) return;
                        done = true;
                        PrintManager pm = (PrintManager) activity.getSystemService(android.content.Context.PRINT_SERVICE);
                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(paper(html))
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)   // @page's margins are the page's
                                .build();
                        pm.print(job, view.createPrintDocumentAdapter(job), attrs);
                        reply(id, true, true);
                    }
                });
                if (printing != null) printing.destroy();
                printing = page;
                page.loadDataWithBaseURL(MainActivity.ORIGIN + "/", html, "text/html", "utf-8", null);
            } catch (RuntimeException e) {
                reply(id, false, String.valueOf(e.getMessage()));
            }
        });
    }

    /** File › Print…: the same print system, whose dialog has the printers and Save as PDF. */
    @JavascriptInterface
    public void print(final int id, final String html, final String fileName) {
        savePdf(id, html, fileName);
    }

    /** Copy as HTML / Rich Text: the HTML and its text on the clipboard. */
    @JavascriptInterface
    public void copy(final int id, final String text, final String html) {
        activity.runOnUiThread(() -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            if (cm == null) {
                reply(id, true, false);
                return;
            }
            cm.setPrimaryClip(html.isEmpty() ? ClipData.newPlainText("Moshe", text) : ClipData.newHtmlText("Moshe", text, html));
            reply(id, true, true);
        });
    }

    /** The paper @page names: `@page { size: A4; … }`. */
    static PrintAttributes.MediaSize paper(String html) {
        Matcher m = Pattern.compile("@page\\s*\\{[^}]*?size:\\s*([A-Za-z0-9]+)").matcher(html);
        String size = m.find() ? m.group(1).toLowerCase(Locale.ROOT) : "a4";
        switch (size) {
            case "letter": return PrintAttributes.MediaSize.NA_LETTER;
            case "legal": return PrintAttributes.MediaSize.NA_LEGAL;
            case "a5": return PrintAttributes.MediaSize.ISO_A5;
            default: return PrintAttributes.MediaSize.ISO_A4;
        }
    }

    /** An export (DOCX, ePub, Markdown…), saved where the person says. */
    @JavascriptInterface
    public void saveFile(final int id, final String fileName, final String base64, final String mime) {
        final byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            reply(id, false, "the file's bytes did not arrive");
            return;
        }
        activity.runOnUiThread(() -> activity.createDocument(safeName(fileName), mime.isEmpty() ? "application/octet-stream" : mime, uri -> {
            if (uri == null) {
                reply(id, true, false);                 // cancelled
                return;
            }
            new Thread(() -> {
                try (OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("could not open the file");
                    out.write(bytes);
                    reply(id, true, true);
                } catch (IOException | SecurityException e) {
                    reply(id, false, "could not save " + fileName + ": " + e.getMessage());
                }
            }).start();
        }));
    }

    /** The share sheet, with the export as a file. */
    @JavascriptInterface
    public void share(final int id, final String fileName, final String base64, final String mime) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(activity.getCacheDir(), "share/" + UUID.randomUUID());
            if (!dir.mkdirs()) throw new IOException("no room to put the file");
            File file = new File(dir, safeName(fileName));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = ShareProvider.uriFor(activity, file);
            String type = mime.isEmpty() ? "application/octet-stream" : mime;
            Intent send = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(fileName, uri));
            activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(send, fileName)));
            reply(id, true, true);
        } catch (IOException | IllegalArgumentException e) {
            reply(id, false, "could not share " + fileName + ": " + e.getMessage());
        }
    }

    /** A link in the text: the browser, or whatever opens it. */
    @JavascriptInterface
    public void openExternal(final int id, final String url) {
        Uri u = Uri.parse(url);
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https") && !scheme.equals("mailto")) {
            reply(id, true, false);
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, u));
                reply(id, true, true);
            } catch (ActivityNotFoundException e) {
                reply(id, true, false);
            }
        });
    }

    void close() {
        if (printing != null) printing.destroy();
        printing = null;
    }

    static String safeName(String name) {
        String n = name == null ? "" : name.replace('/', '-').replace('\\', '-').replace(':', '-').trim();
        return n.isEmpty() ? "Export" : n;
    }

    private static String withoutExtension(String name, String ext) {
        String n = safeName(name);
        return n.toLowerCase(Locale.ROOT).endsWith("." + ext) ? n.substring(0, n.length() - ext.length() - 1) : n;
    }
}
