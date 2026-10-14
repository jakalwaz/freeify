// Free replacement for the Apify actors the /hook and /analyze skills use.
//
// TikTok and YouTube go through yt-dlp (needs its curl_cffi extra for TikTok:
// setup.sh installs yt-dlp[curl-cffi] into freeify's venv). Instagram profiles go through a logged-out
// headless Chromium page load: an REA capture of instagram.com/<handle>/reels/
// showed the Reels tab server-renders each reel's play/like/comment counts into
// its <script type="application/json"> blobs, while the JSON API answers 401
// without login and yt-dlp's instagram:user extractor is marked broken.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PLAYWRIGHT, YTDLP } from './paths.mjs';

const PROFILE_URL = {
  tiktok: h => `https://www.tiktok.com/@${h}`,
  youtube: h => `https://www.youtube.com/@${h}/shorts`,
  instagram: h => `https://www.instagram.com/${h}/reels/`,
};

export function fromYtdlp(e) {
  return {
    url: String(e.webpage_url ?? e.url ?? ''),
    views: Number(e.view_count ?? 0),
    likes: Number(e.like_count ?? 0),
    comments: Number(e.comment_count ?? 0),
    shares: Number(e.repost_count ?? 0),
    duration: Number(e.duration ?? 0),
    hook: String(e.description || e.title || '').split('\n')[0].slice(0, 100),
    timestamp: e.timestamp ?? null,
  };
}

// --ignore-errors keeps going past single broken entries, so parse whatever
// stdout holds and only fail when nothing came back at all.
export function ytdlpJson(url, extra = []) {
  const r = spawnSync(YTDLP, ['--skip-download', '--dump-json', '--no-warnings', '--ignore-errors', '--extractor-retries', '3', ...extra, url], { encoding: 'utf8', maxBuffer: 512 << 20 });
  if (r.error) throw new Error(`cannot run ${YTDLP}: ${r.error.message}`);
  const items = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
  if (!items.length) throw new Error(`yt-dlp returned nothing for ${url}: ${r.stderr.trim().split('\n').pop()}`);
  return items;
}

export function igNodes(html) {
  const found = new Map();
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.code === 'string' && 'play_count' in o) found.set(o.code, o);
    Object.values(o).forEach(walk);
  };
  for (const [, json] of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { walk(JSON.parse(json)); } catch {}
  }
  return [...found.values()];
}

export function fromIg(n) {
  return {
    url: `https://www.instagram.com/reel/${n.code}/`,
    views: Number(n.play_count ?? 0),
    likes: Number(n.like_count ?? 0),
    comments: Number(n.comment_count ?? 0),
    shares: 0,
    duration: 0,
    hook: '',
    timestamp: null,
  };
}

// shortcut: logged-out Instagram only renders the first ~12 reels, without
// durations or captions; a logged-in browser profile would be the upgrade.
async function instagramHtml(handle) {
  const { chromium } = await import(existsSync(PLAYWRIGHT) ? pathToFileURL(PLAYWRIGHT).href : 'playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage();
    const res = await page.goto(PROFILE_URL.instagram(handle), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return await res.text();
  } finally {
    await browser.close();
  }
}

export async function scrapeProfile(platform, handle, limit = 20) {
  if (!(platform in PROFILE_URL)) throw new Error(`unsupported platform: ${platform}`);
  if (platform === 'instagram') {
    const posts = igNodes(await instagramHtml(handle)).map(fromIg);
    if (!posts.length) throw new Error(`Instagram returned no reels for @${handle} (private, empty, or a login wall this time)`);
    return posts.slice(0, limit);
  }
  // TikTok intermittently serves the profile without the user id yt-dlp needs
  // ("Unable to extract secondary user ID"); the same call succeeds seconds later.
  for (let attempt = 1; ; attempt++) {
    try {
      return ytdlpJson(PROFILE_URL[platform](handle), ['--playlist-end', String(limit)]).map(fromYtdlp);
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}
