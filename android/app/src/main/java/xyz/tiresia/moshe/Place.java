package xyz.tiresia.moshe;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.io.File;

/**
 * Where the library lives on this phone, as the person chose it (docs/BRIDGE.md, 4):
 *
 *  - "tree": a folder they picked, through the Storage Access Framework — the
 *    Syncthing folder that holds Writing, for a phone with Syncthing on it;
 *  - "app": Moshe's own folder (files/library), which the page keeps in step
 *    with the server over WebDAV (Settings → Sync in the page), for a phone
 *    without Syncthing;
 *  - "server": no folder at all, the server's own page.
 */
final class Place {
    static final String TREE = "tree", APP = "app", SERVER = "server";
    static final String DEFAULT_SERVER = "https://moshe.tiresia.xyz/";
    private static final String PREFS = "moshe.place";

    private Place() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** "tree", "app", "server", or "" before the first choice. */
    static String kind(Context c) {
        return prefs(c).getString("kind", "");
    }

    static Uri tree(Context c) {
        String s = prefs(c).getString("tree", null);
        return s == null ? null : Uri.parse(s);
    }

    /** The picked folder, if Android still lets the app into it. */
    static boolean treeUsable(Context c) {
        Uri tree = tree(c);
        if (tree == null) return false;
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission() && p.isWritePermission()) return true;
        }
        return false;
    }

    /** Whether the app can open as chosen, or has to ask again. */
    static boolean ready(Context c) {
        switch (kind(c)) {
            case TREE: return treeUsable(c);
            case APP: case SERVER: return true;
            default: return false;
        }
    }

    static File appFolder(Context c) {
        return new File(c.getFilesDir(), "library");
    }

    static String server(Context c) {
        return prefs(c).getString("server", DEFAULT_SERVER);
    }

    static void useTree(Context c, Uri uri) {
        c.getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Uri old = tree(c);
        if (old != null && !old.equals(uri)) {
            try {
                c.getContentResolver().releasePersistableUriPermission(old,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // already gone
            }
        }
        prefs(c).edit().putString("tree", uri.toString()).putString("kind", TREE).apply();
    }

    static void useApp(Context c) {
        //noinspection ResultOfMethodCallIgnored
        appFolder(c).mkdirs();
        prefs(c).edit().putString("kind", APP).apply();
    }

    static void useServer(Context c, String address) {
        String a = address == null || address.trim().isEmpty() ? DEFAULT_SERVER : address.trim();
        if (!a.endsWith("/")) a += "/";
        prefs(c).edit().putString("server", a).putString("kind", SERVER).apply();
    }

    /** The picked folder's own name, for Settings. */
    static String treeName(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        String path = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        String name = path.substring(path.lastIndexOf('/') + 1);
        return name.isEmpty() ? "the storage’s top folder" : name;
    }

    /** Where it is, as a person would say it: "Phone storage › Sync › Writing". */
    static String treeDetail(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        String volume = id.contains(":") ? id.substring(0, id.indexOf(':')) : "";
        String path = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        String where = "primary".equals(volume) ? "Phone storage" : volume.isEmpty() ? "Storage" : "Card " + volume;
        return path.isEmpty() ? where : where + " › " + path.replace("/", " › ");
    }
}
