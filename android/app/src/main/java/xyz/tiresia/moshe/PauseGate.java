package xyz.tiresia.moshe;

/**
 * Where speech starts and where it pauses, from the sound alone: a running
 * guess at the room's noise, speech when the sound rises well above it, an
 * utterance's end at the first pause of pauseMs. The same rule as the page's
 * (frontend/src/voice/vad-worklet.js) and the Mac's (Voice.swift, PauseGate).
 * It runs where the audio comes in, off the main thread, one 20 ms block at a time.
 */
final class PauseGate {
    interface Events {
        /** Speech began, a few blocks ago. */
        void start();
        /** The utterance ended at a pause (or at 15 s). */
        void end();
        /** What started was too short to be speech: a cough, a knock. */
        void drop();
        /** How loud, 0–1, five times a second. */
        void level(float v);
    }

    static final double MIN_MS = 150, MAX_MS = 15000;   // less speech than this is a click; a quick "two" is about 0.2 s
    double pauseMs = 700;
    private float noise = 0.004f;
    private boolean speaking;
    private int voiced, ticks;
    private double quiet, spoken;

    /** One block of 16-bit samples. */
    void take(short[] block, int n, int rate, Events out) {
        if (n <= 0) return;
        double s = 0;
        for (int i = 0; i < n; i++) {
            double x = block[i] / 32768.0;
            s += x * x;
        }
        float rms = (float) Math.sqrt(s / n);
        double ms = n * 1000.0 / rate;
        if (++ticks % 5 == 0) out.level(Math.min(1f, rms * 14));
        noise = rms < noise ? noise * 0.9f + rms * 0.1f : noise * 0.999f + rms * 0.001f;
        float on = Math.max(noise * 3, 0.01f), off = Math.max(noise * 2, 0.007f);
        if (!speaking) {
            if (rms > on) {
                if (++voiced >= 3) {
                    speaking = true;
                    quiet = 0;
                    spoken = 0;
                    out.start();
                }
            } else {
                voiced = 0;
            }
            return;
        }
        spoken += ms;
        quiet = rms < off ? quiet + ms : 0;
        if (quiet >= pauseMs || spoken >= MAX_MS) {
            speaking = false;
            voiced = 0;
            if (spoken - quiet >= MIN_MS) out.end();
            else out.drop();
        }
    }

    boolean speaking() {
        return speaking;
    }
}
