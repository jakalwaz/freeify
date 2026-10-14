"""Transcribe a 16 kHz mono WAV with local Whisper and measure the voice.

    python audio.py <wav> [--no-voice] [--chart out.png]

Prints JSON: {"segments": [...], "words": [...], "voice": {...} | null}.
Everything runs locally: mlx-whisper (Apple Silicon) for words, librosa for
loudness and pitch. Speakers are not separated, so voice stats mix everyone.
"""

import json
import sys

import numpy as np

SR = 16000
HOP = 320  # 20 ms frames
MODEL = "mlx-community/whisper-large-v3-turbo"
# shortcut: -0.8 split Whisper's music-only phantoms ("Thank you.", -0.93) from real
# speech (-0.41) on the clips tested; retune if real lines get flagged.
DOUBTFUL_LOGPROB = -0.8
# Function words spike in loudness from neighbouring stress, not their own; skip them.
FILLER = set("a an the and or but so if of to in on at it its is are was be you your i my me we he she they "
             "this that for with as just do did can will would".split())


def transcribe(wav):
    import mlx_whisper

    r = mlx_whisper.transcribe(wav, path_or_hf_repo=MODEL, word_timestamps=True,
                               hallucination_silence_threshold=2.0, verbose=None)
    segments, words = [], []
    for s in r["segments"]:
        doubtful = s["avg_logprob"] < DOUBTFUL_LOGPROB
        segments.append({"start": s["start"], "end": s["end"], "text": s["text"].strip(), "doubtful": doubtful})
        if not doubtful:
            words += [{"text": w["word"].strip(), "start": w["start"], "end": w["end"]} for w in s.get("words", [])]
    return segments, words


def semitones(hz, ref):
    return 12 * np.log2(hz / ref)


def zscores(xs):
    xs = np.asarray(xs, dtype=float)
    sd = np.nanstd(xs)
    return (xs - np.nanmean(xs)) / sd if sd > 0 else np.zeros_like(xs)


def label(value, cuts, names):
    for cut, name in zip(cuts, names):
        if value < cut:
            return name
    return names[-1]


def voice(wav, segments, words, chart=None):
    import librosa

    if not words:
        return None
    y, _ = librosa.load(wav, sr=SR, mono=True)
    db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0] + 1e-10)
    # shortcut: pYIN over the whole clip is fine for shorts; minutes-long videos get slow.
    f0, voiced, _ = librosa.pyin(y, fmin=65, fmax=500, sr=SR, frame_length=1024, hop_length=HOP)
    n = min(len(db), len(f0))
    db, f0, voiced = db[:n], f0[:n], voiced[:n]
    t = librosa.frames_to_time(np.arange(n), sr=SR, hop_length=HOP)

    def span(a, b):
        return (t >= a) & (t < b)

    speech = np.zeros(n, bool)
    for w in words:
        speech |= span(w["start"], w["end"])
    sp_db = db[speech]
    ref_db = float(np.median(sp_db))
    pitched = f0[speech & voiced]
    if len(pitched) < 10:
        return None
    ref_hz = float(np.median(pitched))
    st = semitones(pitched, ref_hz)

    def stats(a, b):
        m = span(a, b) & speech
        p = f0[m & voiced]
        return (float(np.median(db[m]) - ref_db) if m.any() else None,
                float(np.median(semitones(p, ref_hz))) if len(p) else None)

    # Stressed words: louder and/or higher than the speaker's usual, both z-scored.
    w_db, w_st = zip(*(stats(w["start"], w["end"]) for w in words))
    score = np.nansum([zscores([np.nan if v is None else v for v in w_db]),
                       zscores([np.nan if v is None else v for v in w_st])], axis=0)
    content = [i for i, w in enumerate(words) if w["text"].strip(".,!?;:'\"").lower() not in FILLER]
    stressed = sorted((i for i in content if score[i] > 1.5), key=lambda i: -score[i])[:10]

    lines = []
    for s in segments:
        if s["doubtful"]:
            continue
        ws = [w for w in words if s["start"] <= w["start"] < s["end"]]
        dur = (ws[-1]["end"] - ws[0]["start"]) if ws else 0
        d, p = stats(s["start"], s["end"])
        lines.append({"start": s["start"], "db": d, "st": p, "wpm": round(len(ws) / (dur / 60)) if dur > 0 else None})

    end = words[-1]["end"]
    gaps = (~speech) & (t > words[0]["start"]) & (t < end)
    hook_db, _ = stats(0, 3)
    pitch_sd = float(np.std(st))
    loud_range = float(np.percentile(sp_db, 90) - np.percentile(sp_db, 10))
    per_second = [round(float(np.median(db[span(i, i + 1)]) - ref_db), 1) if span(i, i + 1).any() else None
                  for i in range(int(np.ceil(t[-1])))]

    if chart:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 5), sharex=True)
        a1.plot(t, db - ref_db, lw=0.6)
        a1.set_ylabel("loudness dB vs median")
        a1.set_ylim(-40, 15)
        a2.plot(t, np.where(voiced, semitones(np.where(voiced, f0, ref_hz), ref_hz), np.nan), lw=1)
        a2.set_ylabel("pitch semitones vs median")
        a2.set_xlabel("seconds")
        for ax in (a1, a2):
            for s in segments:
                ax.axvline(s["start"], color="grey", lw=0.4, alpha=0.5)
            ax.grid(alpha=0.2)
        for i in stressed:
            a1.annotate(words[i]["text"], (words[i]["start"], 10), fontsize=7, rotation=45)
        fig.tight_layout()
        fig.savefig(chart, dpi=110)

    return {
        "pitch_median_hz": round(ref_hz),
        "pitch_range_st": round(float(np.percentile(st, 90) - np.percentile(st, 10)), 1),
        "pitch_sd_st": round(pitch_sd, 1),
        # shortcut: label cut-offs are rules of thumb, not calibrated against listeners.
        "pitch_label": label(pitch_sd, [2, 4], ["flat / monotone", "conversational", "animated"]),
        "loudness_range_db": round(loud_range, 1),
        "loudness_label": label(loud_range, [6, 12], ["even", "dynamic", "very dynamic"]),
        "hook_vs_median_db": None if hook_db is None else round(hook_db, 1),
        "gap_vs_speech_db": round(float(np.median(db[gaps]) - ref_db), 1) if gaps.sum() >= 10 else None,
        "stressed": [{"text": words[i]["text"], "start": words[i]["start"]} for i in stressed],
        "lines": lines,
        "per_second_db": per_second,
    }


def main():
    args = sys.argv[1:]
    wav = args[0]
    chart = args[args.index("--chart") + 1] if "--chart" in args else None
    segments, words = transcribe(wav)
    v = None if "--no-voice" in args else voice(wav, segments, words, chart)
    print(json.dumps({"segments": segments, "words": words, "voice": v}))


if __name__ == "__main__":
    main()
