package xyz.tiresia.moshe;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A folder the person picked (the Syncthing folder that holds Writing), through
 * the Storage Access Framework. Dvarim's, with Moshe's additions: the listing's
 * mtimes, so a rescan reads only what changed, and bytes for pictures.
 *
 * Two things SAF cannot do that a real folder can, and what is done instead:
 *  - no atomic replace: a file is rewritten in place ("wt") and its size checked
 *    afterwards, so a write that went short is reported rather than trusted;
 *  - no change notifications: info() asks the page to rescan every 15 s while in
 *    front, and MainActivity asks it to on every resume.
 *
 * Every method is synchronized: the bridge's queue calls them one at a time,
 * and the WebView's own threads ask for pictures (/_library/) beside it.
 */
final class TreeLibrary implements Library {
    private static final String[] COLUMNS = {
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE};

    private final Uri tree;
    private final String rootId;
    private final ContentResolver cr;
    private final Map<String, Doc> known = new HashMap<>();          // path → document, from the last walk

    private static final class Doc {
        final String id, name;
        final boolean dir;
        final long mtime, size;

        Doc(String id, String name, boolean dir, long mtime, long size) {
            this.id = id; this.name = name; this.dir = dir; this.mtime = mtime; this.size = size;
        }
    }

    TreeLibrary(Context context, Uri tree) {
        this.tree = tree;
        this.rootId = DocumentsContract.getTreeDocumentId(tree);
        this.cr = context.getContentResolver();
    }

    @Override public String name() { return Place.treeName(tree); }

    @Override public String detail() { return Place.treeDetail(tree); }

    // ---- the provider ----

    private Uri docUri(String id) { return DocumentsContract.buildDocumentUriUsingTree(tree, id); }

    private List<Doc> children(String parentId) {
        List<Doc> out = new ArrayList<>();
        try (Cursor c = cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), COLUMNS, null, null, null)) {
            while (c != null && c.moveToNext()) out.add(doc(c));
        }
        return out;
    }

    private static Doc doc(Cursor c) {
        return new Doc(c.getString(0), c.getString(1), Document.MIME_TYPE_DIR.equals(c.getString(2)),
                c.isNull(3) ? 0 : c.getLong(3), c.isNull(4) ? 0 : c.getLong(4));
    }

    private Doc stat(String id) {
        try (Cursor c = cr.query(docUri(id), COLUMNS, null, null, null)) {
            return c == null || !c.moveToFirst() ? null : doc(c);
        }
    }

    /** The document at a path, or null: from the last walk if it is still there,
     *  else by walking the names down from the root. */
    private Doc find(String path) {
        if (path.isEmpty()) return new Doc(rootId, "", true, 0, 0);
        Doc hit = known.get(path);
        if (hit != null) {
            Doc now = stat(hit.id);
            if (now != null && now.name.equals(hit.name)) { known.put(path, now); return now; }
            known.remove(path);
        }
        String parentId = rootId, sofar = "";
        Doc doc = null;
        for (String seg : path.split("/")) {
            doc = null;
            for (Doc child : children(parentId)) if (child.name.equals(seg)) { doc = child; break; }
            if (doc == null) return null;
            sofar = sofar.isEmpty() ? seg : sofar + "/" + seg;
            known.put(sofar, doc);
            parentId = doc.id;
        }
        return doc;
    }

    /** The folder at a path, made if asked and missing. */
    private Doc dir(String path, boolean make) throws BridgeError, FileNotFoundException {
        Doc d = find(path);
        if (d != null) {
            if (!d.dir) throw new BridgeError("EEXIST", "a file is where a folder should be: " + path);
            return d;
        }
        if (!make) return null;
        Doc parent = dir(Library.parentOf(path), true);
        Uri made = DocumentsContract.createDocument(cr, docUri(parent.id), Document.MIME_TYPE_DIR, Library.nameOf(path));
        Doc now = made == null ? null : stat(DocumentsContract.getDocumentId(made));
        if (now == null || !now.name.equals(Library.nameOf(path))) throw new BridgeError("EIO", "could not make the folder " + path);
        known.put(path, now);
        return now;
    }

    // ---- the ops ----

    @Override
    public synchronized JSONObject list() throws IOException {
        JSONArray files = new JSONArray(), dirs = new JSONArray();
        JSONObject mtimes = new JSONObject();
        known.clear();
        ArrayDeque<String[]> todo = new ArrayDeque<>();                  // {path, documentId}
        todo.add(new String[]{"", rootId});
        try {
            while (!todo.isEmpty()) {
                String[] at = todo.poll();
                for (Doc child : children(at[1])) {
                    String p = at[0].isEmpty() ? child.name : at[0] + "/" + child.name;
                    known.put(p, child);
                    if (child.dir) {
                        dirs.put(p);
                        if (!IGNORED.contains(child.name)) todo.add(new String[]{p, child.id});   // listed, not looked inside
                    } else if (!child.name.endsWith(TEMP_SUFFIX)) {
                        files.put(p);
                        mtimes.put(p, child.mtime);
                    }
                }
            }
            return new JSONObject().put("files", files).put("dirs", dirs).put("mtimes", mtimes);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    @Override
    public synchronized JSONObject read(String path) throws IOException {
        Doc d = find(path);
        if (d == null || d.dir) return null;
        byte[] bytes = readDoc(path, d);
        if (bytes == null) return null;
        try {
            // UTF-8, invalid bytes as U+FFFD; a BOM and \r\n are kept as they are
            return new JSONObject().put("text", new String(bytes, StandardCharsets.UTF_8)).put("mtime", d.mtime);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    private byte[] readDoc(String path, Doc d) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream in = cr.openInputStream(docUri(d.id))) {
            if (in == null) return null;
            byte[] chunk = new byte[65536];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
        } catch (FileNotFoundException e) {
            known.remove(path);
            return null;
        }
        return buf.toByteArray();
    }

    @Override
    public synchronized byte[] bytes(String path) throws IOException {
        Doc d = find(path);
        return d == null || d.dir ? null : readDoc(path, d);
    }

    @Override
    public synchronized JSONObject write(String path, byte[] bytes) throws BridgeError, IOException {
        Doc d = find(path);
        if (d != null && d.dir) throw new BridgeError("EEXIST", "a folder is in the way: " + path);
        if (d == null) {
            Doc parent = dir(Library.parentOf(path), true);
            // octet-stream, so the provider adds no extension of its own
            Uri made = DocumentsContract.createDocument(cr, docUri(parent.id), "application/octet-stream", Library.nameOf(path));
            d = made == null ? null : stat(DocumentsContract.getDocumentId(made));
            if (d == null || !d.name.equals(Library.nameOf(path))) {
                if (d != null) DocumentsContract.deleteDocument(cr, docUri(d.id));
                throw new BridgeError("EIO", "the folder would not take the name " + Library.nameOf(path));
            }
        }
        try (OutputStream out = cr.openOutputStream(docUri(d.id), "wt")) {
            if (out == null) throw new BridgeError("EIO", "could not open " + path);
            out.write(bytes);
        }
        Doc now = stat(d.id);
        // SAF has no atomic replace: at least never trust a write that went short
        if (now == null || now.size != bytes.length) throw new BridgeError("EIO", "the write to " + path + " did not complete");
        known.put(path, now);
        try {
            return new JSONObject().put("mtime", now.mtime);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    @Override
    public synchronized void remove(String path) throws FileNotFoundException {
        Doc d = find(path);
        if (d != null && !d.dir) DocumentsContract.deleteDocument(cr, docUri(d.id));
        known.remove(path);
    }

    @Override
    public synchronized void move(String from, String to) throws BridgeError, IOException {
        Doc a = find(from);
        if (a == null) throw new BridgeError("ENOENT", "not there: " + from);
        Doc b = find(to);
        if (b != null && !b.id.equals(a.id)) {
            // a folder may take an empty folder's place, as rename(2) lets it; nothing else is replaced
            if (!(a.dir && b.dir && children(b.id).isEmpty())) throw new BridgeError("EEXIST", "already there: " + to);
            DocumentsContract.deleteDocument(cr, docUri(b.id));
        }
        Doc fromParent = dir(Library.parentOf(from), false), toParent = dir(Library.parentOf(to), true);
        Uri moved = docUri(a.id);
        if (!fromParent.id.equals(toParent.id)) {
            try {
                moved = DocumentsContract.moveDocument(cr, moved, docUri(fromParent.id), docUri(toParent.id));
            } catch (UnsupportedOperationException e) {
                moved = null;
            }
            if (moved == null) throw new BridgeError("EIO", "this folder's provider cannot move " + from);
        }
        if (!Library.nameOf(from).equals(Library.nameOf(to))) {
            moved = DocumentsContract.renameDocument(cr, moved, Library.nameOf(to));
            Doc now = moved == null ? null : stat(DocumentsContract.getDocumentId(moved));
            if (now == null || !now.name.equals(Library.nameOf(to))) throw new BridgeError("EIO", "could not rename " + from + " to " + Library.nameOf(to));
        }
        // everything under either path is somewhere else now
        known.keySet().removeIf(k -> k.equals(from) || k.startsWith(from + "/") || k.equals(to) || k.startsWith(to + "/"));
    }

    @Override
    public synchronized void mkdir(String path) throws BridgeError, FileNotFoundException {
        dir(path, true);
    }

    @Override
    public synchronized boolean removeDir(String path) throws FileNotFoundException {
        Doc d = find(path);
        if (d == null || !d.dir) return true;
        if (!children(d.id).isEmpty()) return false;
        DocumentsContract.deleteDocument(cr, docUri(d.id));
        known.remove(path);
        return true;
    }
}
