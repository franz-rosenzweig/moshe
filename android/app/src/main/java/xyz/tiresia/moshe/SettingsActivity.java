package xyz.tiresia.moshe;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Where the library lives on this phone (Place), asked the first time Moshe
 * opens and changed here after that: long-press Moshe's icon → Library.
 */
public class SettingsActivity extends Activity {
    static final String FIRST = "first";
    private static final int PICK = 1;

    private RadioGroup kinds;
    private RadioButton tree, app, server;
    private TextView folder;
    private EditText address;
    private Uri picked;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int text = night ? 0xFFDCDCDC : 0xFF1D1D1F, dim = night ? 0xFF9A9A9E : 0xFF6E6E73, accent = night ? 0xFFFFC53D : 0xFFB8730A;   // the page's --accent-fg: the yellow as text on the page

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        col.setPadding(pad, pad, pad, pad);

        TextView title = label(getIntent().getBooleanExtra(FIRST, false) ? "Where is your library?" : "Moshe’s library", 26, text);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(title);
        TextView lede = label("Moshe keeps your writing as Markdown files in a folder. Choose where that folder is on this phone.", 15, dim);
        lede.setPadding(0, dp(8), 0, dp(16));
        col.addView(lede);

        kinds = new RadioGroup(this);
        tree = radio("A folder on this phone", text);
        app = radio("Moshe’s own folder, synced with the server", text);
        server = radio("The server’s page, with no folder", text);
        kinds.addView(tree);
        kinds.addView(note("For a phone with Syncthing: the synced folder that holds Writing. Moshe reads and writes it directly, and Obsidian sees the same files.", dim));
        folder = label("", 15, accent);
        folder.setPadding(dp(32), dp(4), 0, dp(4));
        folder.setOnClickListener(v -> pick());
        kinds.addView(folder);
        kinds.addView(app);
        kinds.addView(note("For a phone without Syncthing. Then, in Moshe, Settings → Sync: the server’s address and a device token made in the server’s own Settings → Sync.", dim));
        kinds.addView(server);
        kinds.addView(note("The library on the server, as in a browser. Nothing is kept on the phone.", dim));
        address = new EditText(this);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(Place.server(this));
        address.setTextColor(text);
        address.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginStart(dp(32));
        kinds.addView(address, lp);
        col.addView(kinds);

        Button open = new Button(this);
        open.setText("Open Moshe");
        open.setAllCaps(false);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(20);
        col.addView(open, bp);
        open.setOnClickListener(v -> done());

        String kind = Place.kind(this);
        picked = Place.treeUsable(this) ? Place.tree(this) : null;
        (Place.APP.equals(kind) ? app : Place.SERVER.equals(kind) ? server : tree).setChecked(true);
        kinds.setOnCheckedChangeListener((g, id) -> show());
        show();

        ScrollView scroll = new ScrollView(this);
        scroll.addView(col);
        scroll.setBackgroundColor(night ? 0xFF1E1E1F : 0xFFFFFFFF);
        setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        WindowInsetsController c = getWindow().getInsetsController();
        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        if (c != null) c.setSystemBarsAppearance(night ? 0 : light, light);
    }

    private void show() {
        folder.setVisibility(tree.isChecked() ? View.VISIBLE : View.GONE);
        folder.setText(picked == null ? "Choose the folder…" : "📁 " + Place.treeDetail(picked) + "  ·  Change…");
        address.setVisibility(server.isChecked() ? View.VISIBLE : View.GONE);
    }

    private void pick() {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(pick, PICK);
        } catch (ActivityNotFoundException ignored) {
            // no picker on this phone
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK && result == RESULT_OK && data != null && data.getData() != null) {
            picked = data.getData();
            tree.setChecked(true);
            show();
        }
    }

    private void done() {
        if (tree.isChecked()) {
            if (picked == null) {
                pick();
                return;
            }
            Place.useTree(this, picked);
        } else if (app.isChecked()) {
            Place.useApp(this);
        } else {
            Place.useServer(this, address.getText().toString());
        }
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
    }

    private TextView label(String s, int sp, int colour) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(colour);
        return t;
    }

    private TextView note(String s, int colour) {
        TextView t = label(s, 13, colour);
        t.setPadding(dp(32), 0, 0, dp(10));
        return t;
    }

    private RadioButton radio(String s, int colour) {
        RadioButton r = new RadioButton(this);
        r.setId(View.generateViewId());
        r.setText(s);
        r.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        r.setTextColor(colour);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(8), dp(10), 0, dp(4));
        return r;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
