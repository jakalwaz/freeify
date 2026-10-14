---
name: virality-check
description: Pre-post check of the user's own unposted video against what has actually worked on their account. Use when the user wants to know if a draft video is ready to post, asks for a virality check or score before posting, and names their TikTok, Instagram or YouTube handle. Free and local.
---

# virality-check

1. Plugin root is `${CLAUDE_PLUGIN_ROOT}` (if empty: two folders above this SKILL.md). If the run reports `no Python env`, run `bash "${CLAUDE_PLUGIN_ROOT}/setup.sh"` first.
2. Need the video's file path and the user's handle with platform. Ask once for whichever is missing.
3. Run:
   `REELSCOPE_HOME="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/virality-check.mjs" "<video>" --tiktok <handle>`
   (or `--instagram` / `--youtube`; `--refresh` re-scrapes, otherwise the account scrape is cached for 24h).
4. Report the score and each check with its evidence, then compare the user's first 3 seconds against the hooks of their top posts and name what separates winners from losers on their account. The score is a heuristic, not a prediction: say so once.
5. For a deeper read of the draft itself (voice, visuals, structure), offer the `study` skill on the same file.
