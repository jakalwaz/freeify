---
name: study
description: Free, fully local teardown of a short-form video for reverse-engineering virality. Use when the user drops or gives a path to a video file, or pastes a TikTok / Instagram Reel / YouTube Shorts link, and wants it studied, analyzed, broken down, or explained ("why did this go viral", "break this down", "study this"). Measures transcript, voice energy, edit pacing and frames locally; Claude reads the frames for outfits, setting and on-screen text. No Apify, no paid APIs.
---

# study

## Run it

1. Plugin root is `${CLAUDE_PLUGIN_ROOT}`. If that is empty, it is the folder two levels above this SKILL.md.
2. First use, or the run says `no Python env` / a scrape breaks: run `bash "${CLAUDE_PLUGIN_ROOT}/setup.sh"` (one-time, a few minutes; re-running upgrades yt-dlp). If it reports a missing tool, give the user its exact `brew install` line and stop.
3. Run, quoting the input:
   `FREEIFY_HOME="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/study.mjs" "<file path or URL>"`
   Add `--fast` to skip the account-baseline scrape (links only). It prints the path of `study.md`.
   - Video attached in chat without a usable path: ask once for the file path or the link.
   - Several videos: run them one by one, then do the batch section below.
4. Read `study.md`, then `hook.jpg`, `shots.jpg` and `voice.png` from the same folder. Open single files in `frames/` for close-ups (outfits, text overlays, props).

## Write the teardown

Quote real lines and cite timestamps everywhere. Rank things. No generic advice ("provide value", "post consistently"). Use tables and short lines.

1. **Snapshot**: creator, platform, length, topic, format, views / likes / comments, and the outlier score from study.md (views ÷ the account's median: under 2x baseline, 3x significant, 5x+ true outlier, 10x+ mega). Local files have no metrics: say so.
2. **Transcript**: the full timed transcript. Bold the hook line and the CTA. Fix obvious Whisper misspellings using on-screen text and say you did. Lines marked `(?)` are low-confidence (often invented words over music); exclude them from analysis.
3. **Hook (first 3s)**: verbal hook quoted and typed (question, curiosity gap, contrarian, result-first, big number, warning, story open, callout...; stacks allowed), visual hook (what frame 0 shows), text hook (on-screen text), and whether all three point at the same curiosity gap. Name the open loop only the end answers.
4. **Structure**: beat map with real timestamps; structure type (tutorial, listicle, problem-agitate-solve, transformation, story loop, hot take + receipts, secret-tool reveal, skit, hybrid); connector test (beats chain with "but/so" = story, "and then" = list); every open loop and where it closes; where the biggest payoff sits.
5. **Retention**: words per minute, dead air, length vs the 30-45s sweet spot, cuts per minute and where pacing shifts (from the shot list), how often a new payoff lands, how it ends (loop, payoff, CTA, trail-off).
6. **Voice and delivery** (from the Voice section and voice.png): pitch variation label, loudness range, hook loudness vs the rest, stressed words and what they emphasize, lines where energy or pace jumps or drops, and whether music competes with the voice (between-words level). These are measurements: interpret them, never claim you heard the voice. Speakers are not separated; when several people talk, attribute spikes using the transcript and frames, and say it is inferred.
7. **Visual layer** (from the frames only): per person, outfit and styling (garments, colors, accessories, hair, makeup) and what it signals; setting and props; lighting; framing and shot sizes; on-screen text and caption style; expressions and energy; how these change across shots. Frames are stills: infer camera moves and transitions from adjacent frames and label them inferred.
8. **Caption and CTA**: caption first line (links only), CTA type (comment-keyword, follow, share or save bait, link, none) and whether it lands after the payoff. Keyword CTAs inflate comment counts; say so.
9. **Why it works, ranked**: 3-5 causal factors, each tied to evidence. If success looks account-driven (big following, outlier score under 2x), say so. If the baseline is unavailable, say it in one line and judge from follower count, flagged as weaker evidence.
10. **Steal this**: a fill-in-the-blank script of this video's beats, 3 remix angles for the user's niche (guess it from context and say so if unknown), and the one thing that will not transfer.

## Batch (2+ videos)

After a compressed teardown per video (snapshot, hook quote + type, structure, CTA, outlier score), add a pattern report: a comparison table; dominant hook types with the strongest lines side by side; winning formats and lengths; shared beat sequences; shared voice and visual traits (energy profile, outfits, settings, caption styles); what the biggest outliers share that the rest lack; 3-5 rules this niche rewards, each citing videos; 5 ready-to-film ideas with exact hook lines.

End single-video teardowns by offering batch mode.
