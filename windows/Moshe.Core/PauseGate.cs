namespace Moshe.Core;

/// <summary>
/// Where speech starts and where it pauses, from the sound alone: a running guess at
/// the room's noise, speech when the sound rises well above it, an utterance's end at
/// the first pause of <see cref="PauseMs"/>. The same rule as the page's
/// (frontend/src/voice/vad-worklet.js) and the Mac's (PauseGate in mac/Moshe/Voice.swift),
/// with two differences: the samples left over from one call's last 20 ms block are kept
/// for the next, and a sound too short to be an utterance says so (<see cref="Kind.Short"/>),
/// so whoever keeps the sound can let it go.
/// </summary>
public sealed class PauseGate
{
    public enum Kind { Start, End, Short, Level }

    /// <summary>Start and Short: the time, in seconds of sound; End: the time the utterance ends at; Level: 0–1.</summary>
    public readonly record struct Event(Kind Kind, double Value);

    /// <summary>MinMs: less speech than that is a click or a cough; a quick "two" (picking from a list) is about 0.2 s.</summary>
    public const double MinMs = 150, MaxMs = 15000;
    public double PauseMs { get; set; } = 700;

    /// <summary>Seconds of sound seen.</summary>
    public double Time { get; private set; }
    public bool Speaking { get; private set; }

    float noise = 0.004f;
    int voiced, ticks;
    double quiet, spoken;
    readonly List<float> rest = [];

    /// <summary>Samples of one channel at <paramref name="rate"/>; what happened in them.</summary>
    public List<Event> Take(ReadOnlySpan<float> samples, double rate)
    {
        var events = new List<Event>();
        var n = Math.Max(1, (int)(rate * 0.02));             // 20 ms blocks
        var ms = n / rate * 1000;
        float[] all;
        if (rest.Count > 0)
        {
            all = new float[rest.Count + samples.Length];
            rest.CopyTo(all);
            samples.CopyTo(all.AsSpan(rest.Count));
            rest.Clear();
        }
        else all = samples.ToArray();
        var i = 0;
        for (; i + n <= all.Length; i += n)
        {
            float s = 0;
            for (var j = i; j < i + n; j++) s += all[j] * all[j];
            var rms = MathF.Sqrt(s / n);
            Time += n / rate;
            ticks++;
            if (ticks % 5 == 0) events.Add(new(Kind.Level, Math.Min(1, rms * 14)));
            noise = rms < noise ? noise * 0.9f + rms * 0.1f : noise * 0.999f + rms * 0.001f;
            float on = MathF.Max(noise * 3, 0.01f), off = MathF.Max(noise * 2, 0.007f);
            if (!Speaking)
            {
                if (rms > on)
                {
                    if (++voiced >= 3)
                    {
                        Speaking = true;
                        quiet = 0;
                        spoken = 0;
                        events.Add(new(Kind.Start, Time));
                    }
                }
                else voiced = 0;
                continue;
            }
            spoken += ms;
            quiet = rms < off ? quiet + ms : 0;
            if (quiet >= PauseMs || spoken >= MaxMs)
            {
                Speaking = false;
                voiced = 0;
                events.Add(spoken - quiet >= MinMs ? new(Kind.End, Time - quiet / 1000 + 0.15) : new(Kind.Short, Time));
            }
        }
        for (; i < all.Length; i++) rest.Add(all[i]);
        return events;
    }
}
