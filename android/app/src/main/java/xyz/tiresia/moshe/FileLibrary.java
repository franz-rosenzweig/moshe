package xyz.tiresia.moshe;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.UUID;

/**
 * Moshe's own folder (files/library), for a phone without Syncthing: plain
 * files, so a write is a temporary file renamed over the old one — atomic, as
 * docs/BRIDGE.md asks — and a rescan is a walk of the disk. The page keeps it in
 * step with the server itself (engine/src/webdav.js, through op http).
 *
 * Names are stored as the page wrote them: Java hands the file system the
 * string's UTF-8 bytes, and Android's file systems keep them as they are.
 */
final class FileLibrary implements Library {
    private final File root;
    private final String canonicalRoot;

    FileLibrary(File root) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        root.mkdirs();
        this.root = root;
        this.canonicalRoot = root.getCanonicalPath();
    }

    @Override public String name() { return "Moshe’s own folder"; }

    @Override public String detail() { return "On this phone, kept in step with the server"; }

    /** The file at a path, still inside the root once links are followed. */
    private File file(String path) throws BridgeError, IOException {
        File f = new File(root, Library.check(path));
        String c = f.getCanonicalPath();
        if (!c.equals(canonicalRoot) && !c.startsWith(canonicalRoot + "/")) {
            throw new BridgeError("EINVAL", "outside the library: " + path);
        }
        return f;
    }

    @Override
    public synchronized JSONObject list() throws IOException {
        JSONArray files = new JSONArray(), dirs = new JSONArray();
        JSONObject mtimes = new JSONObject();
        ArrayDeque<String> todo = new ArrayDeque<>();
        todo.add("");
        try {
            while (!todo.isEmpty()) {
                String at = todo.poll();
                File[] kids = (at.isEmpty() ? root : new File(root, at)).listFiles();
                if (kids == null) continue;
                for (File k : kids) {
                    String p = at.isEmpty() ? k.getName() : at + "/" + k.getName();
                    if (k.isDirectory()) {
                        dirs.put(p);
                        if (!IGNORED.contains(k.getName())) todo.add(p);
                    } else if (!k.getName().endsWith(TEMP_SUFFIX)) {
                        files.put(p);
                        mtimes.put(p, k.lastModified());
                    }
                }
            }
            return new JSONObject().put("files", files).put("dirs", dirs).put("mtimes", mtimes);
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    @Override
    public synchronized JSONObject read(String path) throws IOException, BridgeError {
        File f = file(path);
        if (!f.isFile()) return null;
        byte[] bytes = Files.readAllBytes(f.toPath());
        try {
            // UTF-8, invalid bytes as U+FFFD; a BOM and \r\n are kept as they are
            return new JSONObject().put("text", new String(bytes, StandardCharsets.UTF_8)).put("mtime", f.lastModified());
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    @Override
    public synchronized JSONObject write(String path, byte[] bytes) throws IOException, BridgeError {
        File f = file(path);
        if (f.isDirectory()) throw new BridgeError("EEXIST", "a folder is in the way: " + path);
        makeDirs(Library.parentOf(path));
        File temp = new File(f.getParentFile(), "." + UUID.randomUUID() + TEMP_SUFFIX);
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(bytes);
            out.getFD().sync();
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            throw space(e);
        }
        if (!temp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            throw new BridgeError("EIO", "could not save " + path);
        }
        try {
            return new JSONObject().put("mtime", f.lastModified());
        } catch (JSONException e) {
            throw new IOException(e);
        }
    }

    @Override
    public synchronized void remove(String path) throws IOException, BridgeError {
        File f = file(path);
        if (f.isFile() && !f.delete()) throw new BridgeError("EIO", "could not remove " + path);
    }

    @Override
    public synchronized void move(String from, String to) throws IOException, BridgeError {
        File a = file(from), b = file(to);
        if (!a.exists()) throw new BridgeError("ENOENT", "not there: " + from);
        if (b.exists()) {
            // a folder may take an empty folder's place, as rename(2) lets it; nothing else is replaced
            String[] inside = b.isDirectory() ? b.list() : null;
            if (!(a.isDirectory() && inside != null && inside.length == 0)) throw new BridgeError("EEXIST", "already there: " + to);
            if (!b.delete()) throw new BridgeError("EIO", "could not replace " + to);
        }
        makeDirs(Library.parentOf(to));
        if (!a.renameTo(b)) throw new BridgeError("EIO", "could not move " + from + " to " + to);
    }

    @Override
    public synchronized void mkdir(String path) throws IOException, BridgeError {
        file(path);
        makeDirs(path);
    }

    private void makeDirs(String path) throws IOException, BridgeError {
        if (path.isEmpty()) return;
        File d = file(path);
        if (d.isDirectory()) return;
        if (d.exists()) throw new BridgeError("EEXIST", "a file is where a folder should be: " + path);
        makeDirs(Library.parentOf(path));
        if (!d.mkdir() && !d.isDirectory()) throw new BridgeError("EIO", "could not make the folder " + path);
    }

    @Override
    public synchronized boolean removeDir(String path) throws IOException, BridgeError {
        File d = file(path);
        if (!d.isDirectory()) return true;
        String[] inside = d.list();
        if (inside != null && inside.length > 0) return false;
        return d.delete() || !d.exists();
    }

    @Override
    public synchronized byte[] bytes(String path) throws IOException, BridgeError {
        File f = file(path);
        return f.isFile() ? Files.readAllBytes(f.toPath()) : null;
    }

    private static IOException space(IOException e) {
        String m = String.valueOf(e.getMessage());
        return m.contains("ENOSPC") || m.contains("No space") ? new IOException("ENOSPC: the phone's storage is full", e) : e;
    }
}
