package xyz.tiresia.moshe;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Reading aloud for the page (`mosheShell.voice.speak`), since the Android
 * WebView has no speechSynthesis: the phone's text-to-speech, with each word's
 * place sent back as it is read (mosheVoice.spoken(start, end), offsets in the
 * text given) so the page can light it. speak's promise settles when the reading
 * ends: true when it was read to the end, false when it was stopped.
 */
final class Speaker {
    private static final String TAG = "MosheVoice";
    private final Context context;
    private final Voice voice;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ready, failed;
    private final List<Runnable> waiting = new ArrayList<>();
    private int reading;                 // the reading under way, by number; 0 for none
    private int replyId;                 // its promise
    private int[] offsets = new int[0];  // where each piece of it starts in the text
    private int counter;
    private String language;             // what it reads in, for what it says when it can't

    Speaker(Context context, Voice voice) {
        this.context = context;
        this.voice = voice;
    }

    /** The phone's text-to-speech, started the first time it's wanted (it takes a moment). */
    private void whenReady(Runnable r) {
        if (ready) {
            r.run();
            return;
        }
        waiting.add(r);
        if (tts != null) return;
        failed = false;
        tts = new TextToSpeech(context, status -> main.post(() -> {
            ready = status == TextToSpeech.SUCCESS;
            failed = !ready;
            if (ready) tts.setOnUtteranceProgressListener(new Progress());
            List<Runnable> all = new ArrayList<>(waiting);
            waiting.clear();
            for (Runnable w : all) w.run();
            if (failed) {
                tts.shutdown();
                tts = null;
            }
        }));
    }

    void speak(int id, String text, String lang, float rate) {
        whenReady(() -> {
            if (failed || tts == null) {
                voice.reply(id, false, "This phone has no text-to-speech to read with.");
                return;
            }
            stop();
            Locale locale = Locale.forLanguageTag("he".equals(lang) ? "he-IL" : "en-US");
            int has = tts.setLanguage(locale);
            if (has == TextToSpeech.LANG_MISSING_DATA || has == TextToSpeech.LANG_NOT_SUPPORTED) {
                voice.reply(id, false, "This phone has no " + ("he".equals(lang) ? "Hebrew" : "English")
                        + " voice to read with: Settings › Accessibility › Text-to-speech");
                return;
            }
            tts.setSpeechRate(rate > 0 ? rate : 1);
            language = "he".equals(lang) ? "Hebrew" : "English";
            List<String> pieces = split(text, Math.max(200, TextToSpeech.getMaxSpeechInputLength() - 100));
            reading = ++counter;
            replyId = id;
            offsets = new int[pieces.size()];
            int at = 0;
            for (int i = 0; i < pieces.size(); i++) {
                offsets[i] = at;
                at += pieces.get(i).length();
                Bundle params = new Bundle();
                tts.speak(pieces.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, params, reading + ":" + i + ":" + pieces.size());
            }
        });
    }

    /** Stops reading; the page's promise for it says false. */
    void stop() {
        if (reading == 0) return;
        int id = replyId;
        reading = 0;
        if (tts != null) tts.stop();
        voice.reply(id, true, false);
    }

    void close() {
        stop();
        if (tts != null) tts.shutdown();
        tts = null;
        ready = false;
    }

    /** What went wrong, in words she can act on. */
    private String why(int code) {
        String voice = language == null ? "voice" : language + " voice";
        switch (code) {
            case TextToSpeech.ERROR_NETWORK:
            case TextToSpeech.ERROR_NETWORK_TIMEOUT:
                return "The phone’s " + voice + " works over the network, and couldn’t reach it. Download it in the phone’s text-to-speech settings.";
            case TextToSpeech.ERROR_NOT_INSTALLED_YET:
                return "The phone’s " + voice + " isn’t downloaded yet: the phone’s text-to-speech settings.";
            default:
                return "The phone’s text-to-speech stopped (error " + code + ").";
        }
    }

    /** The text in pieces the engine takes, cut at a paragraph, a sentence or a space. */
    static List<String> split(String text, int max) {
        List<String> out = new ArrayList<>();
        int from = 0;
        while (text.length() - from > max) {
            int cut = -1;
            for (String at : new String[]{"\n", ". ", "? ", "! ", "; ", ", ", " "}) {
                int i = text.lastIndexOf(at, from + max - at.length());
                if (i > from + max / 3) {
                    cut = i + at.length();
                    break;
                }
            }
            if (cut < 0) cut = from + max;
            out.add(text.substring(from, cut));
            from = cut;
        }
        out.add(text.substring(from));
        return out;
    }

    /** The engine's progress, on its own thread: each word's place, and the end. */
    private final class Progress extends UtteranceProgressListener {
        @Override
        public void onStart(String utterance) { }

        @Override
        public void onRangeStart(String utterance, int start, int end, int frame) {
            main.post(() -> {
                int[] p = parse(utterance);
                if (p == null || p[0] != reading || p[1] >= offsets.length) return;
                voice.send("spoken", offsets[p[1]] + start, offsets[p[1]] + end);
            });
        }

        @Override
        public void onDone(String utterance) {
            main.post(() -> {
                int[] p = parse(utterance);
                if (p == null || p[0] != reading || p[1] != p[2] - 1) return;
                reading = 0;
                voice.reply(replyId, true, true);
            });
        }

        @Override
        public void onStop(String utterance, boolean interrupted) { }

        @Override
        @SuppressWarnings("deprecation")
        public void onError(String utterance) {
            onError(utterance, TextToSpeech.ERROR);
        }

        @Override
        public void onError(String utterance, int code) {
            main.post(() -> {
                int[] p = parse(utterance);
                if (p == null || p[0] != reading) return;
                Log.w(TAG, "reading aloud: error " + code);
                reading = 0;
                if (tts != null) tts.stop();
                voice.reply(replyId, false, why(code));
            });
        }

        private int[] parse(String utterance) {
            String[] parts = utterance == null ? new String[0] : utterance.split(":");
            if (parts.length != 3) return null;
            try {
                return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2])};
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
