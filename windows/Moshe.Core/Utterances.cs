using System.Text;
using System.Text.RegularExpressions;

namespace Moshe.Core;

/// <summary>
/// The microphone's sound cut into utterances (docs/VOICE.md, the rule): 16 kHz mono
/// through a <see cref="PauseGate"/>, each utterance's sound kept from a little before
/// the gate heard it start to just after its pause began. What Whisper needs around
/// it, and what it wrote, are here too, so the tests can check them without a model.
/// </summary>
public sealed class Utterances
{
    public const int Rate = 16000;
    const double Before = 0.4;                 // seconds kept from before speech was heard: its first sound is quieter than the gate's threshold

    public readonly record struct Cut(PauseGate.Kind Kind, double Level = 0, float[]? Sound = null);

    readonly PauseGate gate = new();
    readonly List<float> kept = [];
    long keptFrom;                             // the sample number of kept[0]
    long seen;                                 // samples taken so far
    long startAt = -1;                         // where the utterance being heard starts, or -1

    public double PauseMs { get => gate.PauseMs; set => gate.PauseMs = value; }

    /// <summary>The next samples; what they finished or started.</summary>
    public List<Cut> Take(ReadOnlySpan<float> samples)
    {
        kept.AddRange(samples);
        seen += samples.Length;
        var cuts = new List<Cut>();
        foreach (var e in gate.Take(samples, Rate))
        {
            switch (e.Kind)
            {
                case PauseGate.Kind.Level:
                    cuts.Add(new(e.Kind, e.Value));
                    break;
                case PauseGate.Kind.Start:
                    startAt = Math.Max(keptFrom, (long)((e.Value - Before) * Rate));
                    cuts.Add(new(e.Kind));
                    break;
                case PauseGate.Kind.End:
                    var end = Math.Clamp((long)(e.Value * Rate), startAt, seen);
                    var sound = kept.GetRange((int)(startAt - keptFrom), (int)(end - startAt)).ToArray();
                    startAt = -1;
                    cuts.Add(new(e.Kind, Sound: sound));
                    break;
                case PauseGate.Kind.Short:
                    startAt = -1;
                    cuts.Add(new(e.Kind));
                    break;
            }
        }
        // between utterances, only enough to start the next one with
        var keep = startAt >= 0 ? seen - startAt : (long)(Before * Rate);
        if (kept.Count > keep)
        {
            var drop = (int)(kept.Count - keep);
            kept.RemoveRange(0, drop);
            keptFrom += drop;
        }
        return cuts;
    }

    /// <summary>
    /// An utterance as whisper.cpp wants it: it hears nothing in less than a second
    /// ("input is too short"), and "Two." or "Bold that." are shorter, so silence on
    /// either side, to a second and a half at least.
    /// </summary>
    public static float[] ForWhisper(float[] sound)
    {
        var lead = Rate / 5;
        var length = Math.Max(lead + sound.Length + Rate / 5, Rate * 3 / 2);
        var padded = new float[length];
        sound.CopyTo(padded, lead);
        return padded;
    }

    static readonly Regex Asides = new(@"\[[^\]]*\]|\([^)]*\)|♪", RegexOptions.Compiled);
    static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);
    static readonly Regex Noise = new(@"^(?:you|thank you|thanks for watching|bye)[.!]*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Looping = new(@"(\p{L}{1,12})(?:[\s,-]+\1){5,}", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    static readonly Regex Quoted = new(@"^[""“](.*)[""”]$", RegexOptions.Compiled);

    /// <summary>What Whisper wrote, without what it makes up from noise: the page's own clean() in frontend/src/voice/mic.js.</summary>
    public static string Clean(string? text)
    {
        var t = Spaces.Replace(Asides.Replace(text ?? "", ""), " ").Trim();
        if (!t.Any(c => char.IsLetterOrDigit(c)) || Noise.IsMatch(t)) return "";
        if (Looping.IsMatch(t)) return "";                     // “buh-buh-buh…”: looping on noise
        var q = Quoted.Match(t);
        return q.Success && q.Groups[1].Value.IndexOfAny(['"', '“', '”']) < 0 ? q.Groups[1].Value.Trim() : t;
    }

    /// <summary>
    /// The words the page passes to voice.start (the commands' own phrases, then the
    /// project's names) as Whisper's initial prompt. whisper.cpp keeps only the prompt's
    /// last 224 tokens, so the names come last, where they are kept, and the whole stays
    /// under <paramref name="budget"/> characters, about that many tokens of English.
    /// Each phrase is written as a sentence, so what Whisper writes back is punctuated.
    /// </summary>
    public static string Prompt(IEnumerable<string> words, int budget = 850)
    {
        var names = new List<string>();
        var phrases = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in words)
        {
            var w = Spaces.Replace(raw ?? "", " ").Trim();
            if (w.Length == 0 || w.Length > 80 || !seen.Add(w)) continue;
            if (char.IsUpper(w[0]) && !w.Contains(' ')) names.Add(w); else phrases.Add(w);
        }
        var tail = new StringBuilder();
        foreach (var name in names)
        {
            if (tail.Length + name.Length + 2 > budget / 3) break;
            tail.Append(tail.Length == 0 ? "" : ", ").Append(name);
        }
        if (tail.Length > 0) tail.Append('.');
        var head = new StringBuilder();
        foreach (var phrase in phrases)
        {
            var sentence = char.ToUpperInvariant(phrase[0]) + phrase[1..] + (char.IsPunctuation(phrase[^1]) ? "" : ".");
            if (head.Length + sentence.Length + 1 + tail.Length > budget) break;
            head.Append(head.Length == 0 ? "" : " ").Append(sentence);
        }
        return (head.Length > 0 && tail.Length > 0 ? $"{head} {tail}" : $"{head}{tail}").Trim();
    }
}
