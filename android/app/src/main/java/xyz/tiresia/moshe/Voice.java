package xyz.tiresia.moshe;

import android.Manifest;
import android.annotation.TargetApi;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.speech.ModelDownloadListener;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.function.Consumer;

/**
 * `mosheShell.voice` (docs/VOICE.md), as window.MosheVoiceNative: Android's own
 * speech recognition for the page, and reading aloud (Speaker).
 *
 * The app records the microphone itself and a pause detector (PauseGate, the
 * page's rule) cuts what it hears into utterances. Each utterance is one session
 * of Android's SpeechRecognizer, its sound handed over through a pipe
 * (RecognizerIntent.EXTRA_AUDIO_SOURCE, Android 13 and later); at the pause the
 * pipe closes, the recognizer gives its words, and they go to the page as one
 * mosheVoice.final. One session at a time, in order: what is said meanwhile waits
 * its turn. The recognizer is the phone's on-device one when it has the
 * language, otherwise the phone's default one.
 */
final class Voice {
    private static final String TAG = "MosheVoice";
    static final int RATE = 16000, BLOCK = 320;                 // 20 ms blocks
    private static final int BEFORE = 20;                        // blocks kept from before speech starts: 0.4 s
    private static final long GIVE_UP_MS = 8000;                 // after a pause, the longest to wait for the words

    private final MainActivity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Speaker speaker;
    /** For a self-test (debug builds only): sound from this WAV instead of the microphone. */
    File testFile;

    private SpeechRecognizer recognizer;
    private boolean onDevice;
    private String tag = "en-US";
    private ArrayList<String> words = new ArrayList<>();
    private int pauseMs = 700;
    private Capture capture;
    private boolean listening, paused;
    private boolean fetching, downloading;                      // the on-device language asked for (once), and coming
    private int generation;                                      // a new one on every start and stop
    private final ArrayDeque<Utterance> waiting = new ArrayDeque<>();
    private Utterance active;                                    // the one the recognizer is hearing

    Voice(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.speaker = new Speaker(activity, this);
    }

    /** Whether the page gets voice.start: Android 13 or later (EXTRA_AUDIO_SOURCE), with a recognizer. */
    static boolean canListen(android.content.Context c) {
        return Build.VERSION.SDK_INT >= 33
                && (SpeechRecognizer.isRecognitionAvailable(c) || SpeechRecognizer.isOnDeviceRecognitionAvailable(c));
    }

    // ---- what the page calls (on the WebView's own thread; everything runs on the main one)

    @JavascriptInterface
    public boolean canListen() {
        return canListen(activity);
    }

    /** For the self-test, which never listens to a real microphone: whether this build hears a file. */
    @JavascriptInterface
    public boolean hearsFile() {
        return testFile != null;
    }

    @JavascriptInterface
    public void start(final int id, final String json) {
        main.post(() -> {
            try {
                JSONObject o = new JSONObject(json);
                JSONArray w = o.optJSONArray("words");
                words = new ArrayList<>();
                for (int i = 0; w != null && i < w.length() && i < 300; i++) words.add(w.optString(i));
                pauseMs = Math.max(300, Math.min(3000, o.optInt("pause", 700)));
                begin(id, o.optString("lang", "en"));
            } catch (JSONException e) {
                ShellServices.reply(web, id, false, "voice.start got no options");
            }
        });
    }

    @JavascriptInterface
    public void stop(final int id) {
        main.post(() -> {
            end();
            ShellServices.reply(web, id, true, true);
        });
    }

    @JavascriptInterface
    public void language(final int id, final String lang) {
        main.post(() -> {
            if (listening) begin(id, lang);
            else ShellServices.reply(web, id, true, true);
        });
    }

    @JavascriptInterface
    public void speak(final int id, final String text, final String lang, final String rate) {
        float r;
        try {
            r = Float.parseFloat(rate);
        } catch (NumberFormatException e) {
            r = 1;
        }
        final float speed = r;
        main.post(() -> speaker.speak(id, text, lang, speed));
    }

    @JavascriptInterface
    public void stopSpeaking(final int id) {
        main.post(() -> {
            speaker.stop();
            ShellServices.reply(web, id, true, true);
        });
    }

    void reply(int id, boolean ok, Object value) {
        ShellServices.reply(web, id, ok, value);
    }

    /** window.mosheVoice.fn(args…) in the page. */
    void send(String fn, Object... args) {
        JSONArray list = new JSONArray();
        for (Object a : args) list.put(a);
        String js = "window.mosheVoice && window.mosheVoice." + fn + "(..." + list + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    // ---- starting: the microphone, then the recognizer that has the language

    /** One voice.start (or language): its promise is settled once, and it's let go if another comes. */
    private final class Start {
        final int id, gen;
        boolean settled;

        Start(int id) {
            this.id = id;
            this.gen = generation;
        }

        boolean stale() {
            return settled || gen != generation;
        }

        void settle(boolean ok, Object value) {
            if (settled) return;
            settled = true;
            reply(id, ok, value);
        }
    }

    private void begin(int id, String lang) {
        end();
        Start st = new Start(id);
        activity.withMic(allowed -> {
            if (st.stale()) st.settle(true, false);
            else if (!allowed) st.settle(false, "The microphone isn’t allowed for Moshe: Settings › Apps › Moshe › Permissions");
            else choose("he".equals(lang) ? "he-IL" : "en-US", st);
        });
    }

    /**
     * Asks a recognizer which languages it has. Some never answer (a recognizer that can't be reached), some
     * answer twice: `then` gets the first answer, or null for none in time or an error.
     */
    @TargetApi(33)
    private void support(SpeechRecognizer r, String want, Start st, Consumer<RecognitionSupport> then) {
        final boolean[] answered = {false};
        Consumer<RecognitionSupport> once = s -> {
            if (answered[0]) return;
            answered[0] = true;
            if (st.stale()) {
                if (r != recognizer) r.destroy();
                st.settle(true, false);
                return;
            }
            then.accept(s);
        };
        main.postDelayed(() -> {
            if (!answered[0]) Log.i(TAG, "no answer from the recognizer about its languages");
            once.accept(null);
        }, 2500);
        r.checkRecognitionSupport(intent(want), activity.getMainExecutor(), new RecognitionSupportCallback() {
            @Override
            public void onSupportResult(RecognitionSupport s) {
                once.accept(s);
            }

            @Override
            public void onError(int error) {
                Log.i(TAG, "support check: error " + error);
                once.accept(null);
            }
        });
    }

    /** The on-device recognizer if it has the language (fetching it if it can), else the phone's default one. */
    @TargetApi(33)
    private void choose(String want, Start st) {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)) {
            fallback(want, st);
            return;
        }
        SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity);
        support(r, want, st, s -> {
            if (s == null) {
                // no answer: it can't be reached (so on a Galaxy S24+), or it won't say; the default one, then
                r.destroy();
                fallback(want, st);
                return;
            }
            Log.i(TAG, "on-device " + want + ": installed " + s.getInstalledOnDeviceLanguages() + ", pending " + s.getPendingOnDeviceLanguages()
                    + ", supported " + s.getSupportedOnDeviceLanguages());
            String have = best(want, s.getInstalledOnDeviceLanguages());
            String can = best(want, s.getSupportedOnDeviceLanguages());
            if (can == null) can = best(want, s.getPendingOnDeviceLanguages());
            boolean told = !s.getInstalledOnDeviceLanguages().isEmpty() || !s.getSupportedOnDeviceLanguages().isEmpty()
                    || !s.getPendingOnDeviceLanguages().isEmpty();
            if (have != null || !told) {
                // an empty answer says nothing (Android System Intelligence gives one): try it, and if the
                // language turns out to be missing, the session asks for it then (missing())
                go(r, true, have != null ? have : want, st);
            } else if (can != null && Build.VERSION.SDK_INT >= 34) {
                fetch(r, can, want, st);
            } else {
                r.destroy();
                fallback(want, st);
            }
        });
    }

    /** The language's model for the on-device recognizer, fetched once (Android asks first), with its
     *  progress on the strip. If it can't be fetched: the default recognizer. */
    @TargetApi(34)
    private void fetch(SpeechRecognizer r, String lang, String want, Start st) {
        send("state", "loading", 0);
        r.triggerModelDownload(intent(lang), activity.getMainExecutor(), new ModelDownloadListener() {
            @Override
            public void onProgress(int pct) {
                if (!st.stale()) send("state", "loading", pct);
            }

            @Override
            public void onSuccess() {
                Log.i(TAG, "on-device " + lang + ": fetched");
                go(r, true, lang, st);
            }

            @Override
            public void onScheduled() {
                // it will come later (on Wi-Fi, say): the default recognizer meanwhile
                Log.i(TAG, "on-device " + lang + ": fetching later");
                r.destroy();
                if (!st.stale()) fallback(want, st);
            }

            @Override
            public void onError(int error) {
                Log.i(TAG, "on-device download: error " + error);
                r.destroy();
                if (!st.stale()) fallback(want, st);
            }
        });
    }

    /** The phone's default recognizer, if it has the language (or doesn't say). */
    @TargetApi(33)
    private void fallback(String want, Start st) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            st.settle(false, "This phone has no speech recognizer. Choose Whisper in Settings › Voice.");
            return;
        }
        SpeechRecognizer r = SpeechRecognizer.createSpeechRecognizer(activity);
        support(r, want, st, s -> {
            if (s == null) {
                go(r, false, want, st);                                    // no answer: try it
                return;
            }
            Log.i(TAG, "default " + want + ": installed " + s.getInstalledOnDeviceLanguages() + ", online " + s.getOnlineLanguages());
            String lang = best(want, s.getInstalledOnDeviceLanguages());
            if (lang == null) lang = best(want, s.getOnlineLanguages());
            if (lang == null && (!s.getInstalledOnDeviceLanguages().isEmpty() || !s.getOnlineLanguages().isEmpty())) {
                r.destroy();
                st.settle(false, "This phone’s speech recognizer has no " + language(want) + ". Choose Whisper in Settings › Voice.");
                return;
            }
            go(r, false, lang == null ? want : lang, st);
        });
    }

    private static String language(String tag) {
        return tag.startsWith("he") || tag.startsWith("iw") ? "Hebrew" : "English";
    }

    /** The tag in `have` for the language wanted: the same one, or the same language elsewhere. */
    private static String best(String want, List<String> have) {
        if (have == null) return null;
        String lang = want.substring(0, 2);
        String near = null;
        for (String h : have) {
            if (h.equalsIgnoreCase(want)) return h;
            String l = h.toLowerCase(Locale.ROOT);
            if (near == null && (l.startsWith(lang + "-") || l.equals(lang) || ("he".equals(lang) && l.startsWith("iw")))) near = h;
        }
        return near;
    }

    /** Listening: the recognizer chosen, the microphone open. */
    private void go(SpeechRecognizer r, boolean device, String lang, Start st) {
        if (st.stale()) {
            r.destroy();
            st.settle(true, false);
            return;
        }
        recognizer = r;
        onDevice = device;
        tag = lang;
        listening = true;
        Log.i(TAG, "listening in " + lang + (device ? " on the device" : " with the default recognizer"));
        if (!paused) open();
        send("state", "listening");
        st.settle(true, true);
    }

    private void open() {
        if (capture != null) return;
        capture = new Capture(generation, testFile);
        capture.start();
    }

    /** Stops listening; what was said and not yet written is let go, as on the Mac. */
    private void end() {
        generation++;
        boolean was = listening;
        listening = false;
        if (capture != null) capture.running = false;
        capture = null;
        if (active != null) close(active);
        active = null;
        waiting.clear();
        if (recognizer != null) {
            recognizer.cancel();
            recognizer.destroy();
        }
        recognizer = null;
        downloading = false;
        if (was) send("state", "off");
    }

    /** The app went to the background, where Android gives it no microphone; it listens again on coming back. */
    void pause() {
        paused = true;
        if (capture != null) capture.running = false;
        capture = null;
    }

    void resume() {
        paused = false;
        if (listening) open();
    }

    void close() {
        end();
        speaker.close();
    }

    // ---- the utterances, one recognizer session each

    /** One utterance's sound, from a little before speech started to the pause. */
    static final class Utterance {
        static final byte[] END = new byte[0];
        final LinkedBlockingDeque<byte[]> sound = new LinkedBlockingDeque<>();
        final StringBuilder said = new StringBuilder();         // what earlier sessions heard of it
        boolean ended;
        long endedAt;
        volatile int session;                                    // which session hears it now
        ParcelFileDescriptor read;
        Thread feeder;
        final List<String> also = new ArrayList<>();             // what the recognizer also thought it heard
    }

    private void began(Utterance u, int gen) {
        if (gen != generation) return;
        waiting.add(u);
        send("state", "hearing");
        next();
    }

    private void ended(Utterance u, boolean dropped, int gen) {
        if (gen != generation) return;
        u.ended = true;
        u.endedAt = SystemClock.elapsedRealtime();
        send("state", "listening");
        if (dropped) {
            // too short to be speech: as if it never was
            if (u == active) {
                recognizer.cancel();
                close(u);
                active = null;
            } else {
                waiting.remove(u);
            }
            send("partial", "");
            next();
            return;
        }
        if (u == active) watch(u);
    }

    /** The next utterance to the recognizer, when it's free. */
    private void next() {
        if (active != null || waiting.isEmpty() || recognizer == null || downloading) return;
        active = waiting.poll();
        hear(active);
        if (active.ended) watch(active);
    }

    /** After the pause, the words should come soon: if they don't, what was heard so far goes, and on to the next.
     *  A language being fetched may take minutes, and is waited for. */
    private void watch(Utterance u) {
        final int gen = generation;
        main.postDelayed(() -> {
            if (active != u || gen != generation) return;
            if (downloading) {
                watch(u);
                return;
            }
            Log.i(TAG, "no words after " + GIVE_UP_MS + " ms");
            if (recognizer != null) recognizer.cancel();
            close(u);
            deliver(u);
        }, GIVE_UP_MS);
    }

    /** A session for `u`: a pipe for its sound, a thread to feed it, the recognizer listening to the other end. */
    @TargetApi(33)
    private void hear(Utterance u) {
        ParcelFileDescriptor[] pipe;
        try {
            pipe = ParcelFileDescriptor.createPipe();
        } catch (IOException e) {
            fail("No way to hand the sound to the recognizer: " + e.getMessage());
            return;
        }
        final int session = ++u.session, gen = generation;
        u.read = pipe[0];
        final ParcelFileDescriptor write = pipe[1];
        u.feeder = new Thread(() -> feed(u, session, write), "moshe-voice-feed");
        u.feeder.start();
        recognizer.setRecognitionListener(new Session(u, session, gen));
        recognizer.startListening(intent(tag).putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, u.read)
                .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE));
    }

    /** The utterance's sound into the pipe as it comes, closed at the pause: that's the recognizer's cue. */
    private static void feed(Utterance u, int session, ParcelFileDescriptor write) {
        try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(write)) {
            while (true) {
                byte[] b = u.sound.take();
                if (u.session != session) {                       // a newer session has it now
                    u.sound.putFirst(b);
                    return;
                }
                if (b == Utterance.END) return;
                try {
                    out.write(b);
                } catch (IOException e) {                         // the recognizer stopped reading
                    u.sound.putFirst(b);
                    return;
                }
            }
        } catch (IOException | InterruptedException ignored) {
            // closed
        }
    }

    private void close(Utterance u) {
        if (u.feeder != null) u.feeder.interrupt();
        u.feeder = null;
        if (u.read != null) {
            try {
                u.read.close();
            } catch (IOException ignored) {
                // gone already
            }
        }
        u.read = null;
    }

    /** What one session hears. Google's recognizers hand over the finished words as a partial result marked
     *  final_result, and onResults may then come empty: those are kept, and count as the result. */
    private final class Session implements RecognitionListener {
        final Utterance u;
        final int session, gen;
        boolean done;
        final List<String> finals = new ArrayList<>();
        List<String> alternatives;

        Session(Utterance u, int session, int gen) {
            this.u = u;
            this.session = session;
            this.gen = gen;
        }

        private boolean mine() {
            return !done && gen == generation && active == u && u.session == session;
        }

        @Override
        public void onPartialResults(Bundle b) {
            if (!mine()) return;
            String guess;
            if (b.getBoolean("final_result", false)) {
                String s = words(first(b));
                if (!s.isEmpty()) finals.add(s);
                alternatives = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                guess = "";
            } else {
                // the words still settling come apart, a list like the results'
                List<String> unstable = b.getStringArrayList("android.speech.extra.UNSTABLE_TEXT");
                guess = join(first(b), unstable == null || unstable.isEmpty() ? "" : unstable.get(0));
            }
            guess = join(join(u.said.toString(), String.join(" ", finals)), guess);
            if (!guess.isEmpty()) send("partial", guess);
        }

        @Override
        public void onSegmentResults(Bundle b) {
            if (!mine()) return;
            String s = words(first(b));
            if (!s.isEmpty()) u.said.append(u.said.length() > 0 ? " " : "").append(s);
        }

        @Override
        public void onEndOfSegmentedSession() {
            if (!mine()) return;
            finished(String.join(" ", finals), alternatives);
        }

        @Override
        public void onResults(Bundle b) {
            if (!mine()) return;
            List<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (finals.isEmpty()) finished(first(b), list);
            else finished(String.join(" ", finals), list != null && !list.isEmpty() ? list : alternatives);
        }

        @Override
        public void onError(int error) {
            if (!mine()) return;
            Log.i(TAG, "session " + session + ": error " + error);
            switch (error) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                case SpeechRecognizer.ERROR_CLIENT:
                    finished(String.join(" ", finals), alternatives);    // nothing (more) heard in it
                    break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                    done = true;
                    main.postDelayed(() -> { if (gen == generation && active == u) hear(u); }, 300);
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    fail("The microphone isn’t allowed for Moshe: Settings › Apps › Moshe › Permissions");
                    break;
                case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                    done = true;
                    missing(u);
                    break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                    fail("The phone’s speech recognizer needs the network and can’t reach it. Choose Whisper in Settings › Voice.");
                    break;
                default:
                    done = true;
                    close(u);
                    if (onDevice) another(u);                    // the on-device one failed: the default one, from here on
                    else fail("The phone’s speech recognizer stopped (error " + error + "). Choose Whisper in Settings › Voice.");
            }
        }

        /** This session is over: the utterance's words to the page, or, if it isn't over yet, another session for the rest. */
        private void finished(String text, List<String> alternatives) {
            done = true;
            String s = words(text);
            if (!s.isEmpty()) u.said.append(u.said.length() > 0 ? " " : "").append(s);
            if (alternatives != null) {
                for (int i = 1; i < alternatives.size(); i++) {
                    String a = words(alternatives.get(i));
                    // not the same words unpunctuated, which formatting gives as the second guess
                    if (!a.isEmpty() && !bare(a).equals(bare(s))) u.also.add(a);
                }
            }
            close(u);
            if (!u.ended) {
                // it stopped before the pause: go on with the rest, in a moment (one that keeps stopping mustn't spin)
                main.postDelayed(() -> { if (gen == generation && active == u) hear(u); }, 100);
                return;
            }
            deliver(u);
        }

        @Override public void onReadyForSpeech(Bundle b) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float db) { }         // the level comes from our own sound
        @Override public void onBufferReceived(byte[] b) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int type, Bundle b) { }
    }

    /**
     * The recognizer turned out not to have the language. The on-device one is asked to fetch it, once
     * (Android asks her first, and the strip shows the download); otherwise, or if she says no, the phone's
     * default recognizer takes over. What was said meanwhile waits, and is heard after.
     */
    private void missing(Utterance u) {
        close(u);
        final int gen = generation;
        if (onDevice && !fetching && Build.VERSION.SDK_INT >= 34) {
            fetching = downloading = true;
            send("state", "loading", 0);
            recognizer.triggerModelDownload(intent(tag), activity.getMainExecutor(), new ModelDownloadListener() {
                @Override
                public void onProgress(int pct) {
                    if (gen == generation) send("state", "loading", pct);
                }

                @Override
                public void onSuccess() {
                    Log.i(TAG, "on-device " + tag + ": fetched");
                    downloading = false;
                    if (gen != generation) return;
                    send("state", "listening");
                    if (active == u) hear(u);
                }

                @Override
                public void onScheduled() {
                    Log.i(TAG, "on-device " + tag + ": fetching later");
                    downloading = false;
                    if (gen == generation && active == u) another(u);
                }

                @Override
                public void onError(int error) {
                    Log.i(TAG, "on-device download: error " + error);
                    downloading = false;
                    if (gen == generation && active == u) another(u);
                }
            });
            return;
        }
        if (onDevice) another(u);
        else fail("The phone’s speech recognizer has no " + language(tag) + ". Choose Whisper in Settings › Voice.");
    }

    /** The phone's default recognizer instead of the on-device one, from this utterance on. */
    private void another(Utterance u) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            fail("The phone’s speech recognizer has no " + language(tag) + ". Choose Whisper in Settings › Voice.");
            return;
        }
        Log.i(TAG, "the default recognizer instead");
        recognizer.destroy();
        recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
        onDevice = false;
        send("state", "listening");
        hear(u);
    }

    private void deliver(Utterance u) {
        active = null;
        String text = u.said.toString().trim();
        if (text.isEmpty()) {
            send("partial", "");
        } else {
            double after = (SystemClock.elapsedRealtime() - u.endedAt) / 1000.0;
            String how = String.format(Locale.ROOT, "%s%s · words %.1f s after the pause%s",
                    onDevice ? "Android’s on-device speech" : "Android’s speech recognizer",
                    testFile != null ? ", from a file" : "", after,
                    u.also.isEmpty() ? "" : " · also heard: " + String.join(" / ", u.also));
            JSONObject meta = new JSONObject();
            try {
                meta.put("how", how);
            } catch (JSONException ignored) {
                // a string into a fresh object
            }
            send("final", text, meta);
        }
        next();
    }

    private void fail(String why) {
        Log.w(TAG, why);
        end();
        send("state", "error", null, why);
    }

    private static String first(Bundle b) {
        List<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    /** What the recognizer wrote. A result that is only a line break is the words that made it. */
    static String words(String s) {
        if (s == null) return "";
        String t = s.replace('\r', '\n');
        if (!t.isEmpty() && t.trim().isEmpty() && t.indexOf('\n') >= 0) {
            return t.indexOf('\n') != t.lastIndexOf('\n') ? "new paragraph" : "new line";
        }
        return t.trim();
    }

    private static String bare(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    private static String join(String a, String b) {
        a = a == null ? "" : a.trim();
        b = b == null ? "" : b.trim();
        return a.isEmpty() ? b : b.isEmpty() ? a : a + " " + b;
    }

    /** The request for the recognizer, in a language. */
    private Intent intent(String lang) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName())
                // the pause is ours (the pipe closes at it), so the recognizer's own end-of-speech should wait longer
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000);
        if (Build.VERSION.SDK_INT >= 33 && !words.isEmpty()) i.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, words);
        if (Build.VERSION.SDK_INT >= 34) {
            // punctuation and capitals, as Apple's dictation writes them (the page's cleanup expects them)
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
                    .putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true)
                    .putExtra(RecognizerIntent.EXTRA_MASK_OFFENSIVE_WORDS, false);    // a writer's words, as said
        }
        return i;
    }

    // ---- the sound: the microphone, or for the self-test a file

    /** Reads the sound in 20 ms blocks, through the pause detector, into utterances. */
    private final class Capture extends Thread {
        final int gen;
        final File file;
        volatile boolean running = true;
        final PauseGate gate = new PauseGate();

        Capture(int gen, File file) {
            super("moshe-voice-capture");
            this.gen = gen;
            this.file = file;
            gate.pauseMs = pauseMs;
        }

        @Override
        public void run() {
            AudioRecord rec = null;
            InputStream wav = null;
            Utterance current = null;
            try {
                if (file != null) {
                    wav = wavData(file);
                } else {
                    if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        throw new IOException("the microphone isn’t allowed for Moshe");
                    }
                    int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));         // half a second
                    if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("the microphone didn’t open");
                    rec.startRecording();
                }
                short[] block = new short[BLOCK];
                ArrayDeque<byte[]> before = new ArrayDeque<>();
                final boolean[] what = new boolean[3];           // started, ended, dropped
                PauseGate.Events events = new PauseGate.Events() {
                    @Override public void start() { what[0] = true; }
                    @Override public void end() { what[1] = true; }
                    @Override public void drop() { what[2] = true; }
                    @Override public void level(float v) { send("level", (double) v); }
                };
                long due = SystemClock.elapsedRealtime();
                while (running) {
                    int n = rec != null ? fill(rec, block) : fill(wav, block);
                    if (n <= 0) break;
                    if (wav != null) {                           // a file plays at the pace it was spoken
                        due += 20;
                        long wait = due - SystemClock.elapsedRealtime();
                        if (wait > 0) SystemClock.sleep(wait);
                    }
                    what[0] = what[1] = what[2] = false;
                    gate.take(block, n, RATE, events);
                    byte[] chunk = bytes(block, n);
                    if (what[0]) {
                        Utterance u = new Utterance();
                        u.sound.addAll(before);
                        before.clear();
                        current = u;
                        main.post(() -> began(u, gen));
                    }
                    if (current != null) {
                        current.sound.add(chunk);
                    } else {
                        before.add(chunk);
                        if (before.size() > BEFORE) before.removeFirst();
                    }
                    if ((what[1] || what[2]) && current != null) {
                        Utterance u = current;
                        boolean dropped = what[2];
                        u.sound.add(Utterance.END);
                        current = null;
                        main.post(() -> ended(u, dropped, gen));
                    }
                }
            } catch (IOException | RuntimeException e) {
                Log.w(TAG, "the sound stopped", e);
                String why = e.getMessage();
                main.post(() -> { if (gen == generation) fail("Listening stopped: " + why); });
            } finally {
                if (current != null) {                           // stopped mid-sentence: what was said still counts
                    Utterance u = current;
                    u.sound.add(Utterance.END);
                    main.post(() -> ended(u, false, gen));
                }
                if (rec != null) {
                    try {
                        rec.stop();
                    } catch (IllegalStateException ignored) {
                        // never started
                    }
                    rec.release();
                }
                if (wav != null) {
                    try {
                        wav.close();
                    } catch (IOException ignored) {
                        // closed
                    }
                }
            }
        }
    }

    private static int fill(AudioRecord rec, short[] block) throws IOException {
        int got = 0;
        while (got < block.length) {
            int n = rec.read(block, got, block.length - got);
            if (n < 0) throw new IOException("the microphone stopped (" + n + ")");
            got += n;
        }
        return got;
    }

    private static int fill(InputStream in, short[] block) throws IOException {
        byte[] b = new byte[block.length * 2];
        int got = 0;
        while (got < b.length) {
            int n = in.read(b, got, b.length - got);
            if (n < 0) break;
            got += n;
        }
        for (int i = 0; i < got / 2; i++) block[i] = (short) ((b[2 * i] & 0xff) | (b[2 * i + 1] << 8));
        return got / 2;
    }

    private static byte[] bytes(short[] block, int n) {
        byte[] b = new byte[n * 2];
        for (int i = 0; i < n; i++) {
            b[2 * i] = (byte) block[i];
            b[2 * i + 1] = (byte) (block[i] >> 8);
        }
        return b;
    }

    /** A WAV file's samples: 16 kHz, 16-bit, one channel, as the self-test makes it. */
    private static InputStream wavData(File f) throws IOException {
        DataInputStream in = new DataInputStream(new FileInputStream(f));
        try {
            byte[] head = new byte[12];
            in.readFully(head);
            if (!new String(head, 0, 4, "US-ASCII").equals("RIFF") || !new String(head, 8, 4, "US-ASCII").equals("WAVE")) {
                throw new IOException("not a WAV file");
            }
            while (true) {
                byte[] id = new byte[4];
                in.readFully(id);
                int size = Integer.reverseBytes(in.readInt());
                String name = new String(id, "US-ASCII");
                if (name.equals("fmt ")) {
                    byte[] fmt = new byte[size];
                    in.readFully(fmt);
                    int channels = (fmt[2] & 0xff) | (fmt[3] & 0xff) << 8;
                    int rate = (fmt[4] & 0xff) | (fmt[5] & 0xff) << 8 | (fmt[6] & 0xff) << 16 | (fmt[7] & 0xff) << 24;
                    int bits = (fmt[14] & 0xff) | (fmt[15] & 0xff) << 8;
                    if (channels != 1 || rate != RATE || bits != 16) throw new IOException("the WAV must be 16 kHz, 16-bit, mono");
                } else if (name.equals("data")) {
                    return in;
                } else {
                    in.skipBytes(size + (size & 1));
                }
            }
        } catch (EOFException e) {
            in.close();
            throw new IOException("the WAV has no sound in it");
        } catch (IOException e) {
            in.close();
            throw e;
        }
    }
}
