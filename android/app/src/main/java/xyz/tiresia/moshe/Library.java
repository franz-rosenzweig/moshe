package xyz.tiresia.moshe;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * A library folder, as the bridge's file ops need it (docs/BRIDGE.md, 2): a
 * picked folder (TreeLibrary, through the Storage Access Framework) or Moshe's
 * own (FileLibrary, plain files). Paths are relative, '/'-separated, checked
 * before they get here.
 */
interface Library {
    /** Listed, but not looked inside. .moshe is looked inside. */
    Set<String> IGNORED = new HashSet<>(Arrays.asList(
            ".obsidian", ".trash", ".git", ".stfolder", ".stversions", "node_modules"));
    String TEMP_SUFFIX = ".moshe-tmp";

    /** {files, dirs, mtimes}: everything under the root. */
    JSONObject list() throws IOException, BridgeError;

    /** {text, mtime}, or null if there is no such file. */
    JSONObject read(String path) throws IOException, BridgeError;

    /** Exactly these bytes, as whole as the folder allows; {mtime}. */
    JSONObject write(String path, byte[] bytes) throws IOException, BridgeError;

    void remove(String path) throws IOException, BridgeError;

    void move(String from, String to) throws IOException, BridgeError;

    void mkdir(String path) throws IOException, BridgeError;

    boolean removeDir(String path) throws IOException, BridgeError;

    /** A file's bytes, or null: for /_library/, the pictures a sheet shows. */
    byte[] bytes(String path) throws IOException, BridgeError;

    String name();

    String detail();

    /** docs/BRIDGE.md, Paths: relative, '/'-separated, no empty, '.' or '..' segment. */
    static String check(String p) throws BridgeError {
        if (p == null || p.isEmpty() || p.startsWith("/") || p.contains("\\") || p.indexOf('\0') >= 0) throw bad(p);
        for (String seg : p.split("/", -1)) if (seg.isEmpty() || seg.equals(".") || seg.equals("..")) throw bad(p);
        return p;
    }

    static BridgeError bad(String p) {
        return new BridgeError("EINVAL", "not a path inside the library: " + p);
    }

    static String parentOf(String p) {
        int i = p.lastIndexOf('/');
        return i < 0 ? "" : p.substring(0, i);
    }

    static String nameOf(String p) {
        return p.substring(p.lastIndexOf('/') + 1);
    }
}

/** An op's failure, with the bridge's code for it. */
final class BridgeError extends Exception {
    final String code;

    BridgeError(String code, String message) {
        super(message);
        this.code = code;
    }
}
