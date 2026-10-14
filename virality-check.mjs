#!/usr/bin/env node
// virality-check — pre-post gate for a video you have not posted yet.
//
// Scrapes your account's recent posts for free (scrape.mjs: yt-dlp or a
// logged-out headless browser, no Apify), builds your own baseline from them,
// then checks the local video against what has actually worked on that
// account. Heuristic, not a prediction.
//
//   node virality-check.mjs <video> --tiktok <handle> [--refresh]
//   node virality-check.mjs <video> --instagram <handle> | --youtube <handle>

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { HOME } from './paths.mjs';
import { scrapeProfile } from './scrape.mjs';
import { probe, transcribe } from './study.mjs';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HANDLE_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function baseline(posts) {
  const views = posts.map(p => p.views).sort((a, b) => a - b);
  const med = median(views);
  const q = f => views[Math.floor((views.length - 1) * f)];
  const winners = posts.filter(p => p.views >= med);
  const winnerDurations = winners.map(p => p.duration).filter(d => d > 0);
  return {
    n: posts.length,
    median: med,
    spread: q(0.25) > 0 ? q(0.75) / q(0.25) : Infinity,
    // The runtime past which nothing on this account has beaten its own median.
    cliff: winnerDurations.length ? Math.max(...winnerDurations) : null,
    top: [...posts].sort((a, b) => b.views - a.views).slice(0, 5),
  };
}

const secs = n => `${Math.round(n)}s`;

export function checks(video, words, base) {
  const rows = [];
  const ratio = video.height / video.width;
  rows.push(ratio >= 1.7
    ? ['PASS', 'Format', `vertical ${video.width}x${video.height}`]
    : ['FAIL', 'Format', `${video.width}x${video.height} is not 9:16; feeds will crop or letterbox it`]);

  if (base.cliff == null) rows.push(['SKIP', 'Length', 'scrape returned no durations']);
  else if (video.duration <= base.cliff) rows.push(['PASS', 'Length', `${secs(video.duration)} <= ${secs(base.cliff)}, your longest post that beat your median`]);
  else rows.push(['FAIL', 'Length', `${secs(video.duration)} is past ${secs(base.cliff)}; no longer post on this account has beaten your median`]);

  if (words == null) rows.push(['SKIP', 'Hook speed', 'no local whisper or no audio, no transcript']);
  else if (!words.length || words[0].start > 3) rows.push(['WARN', 'Hook speed', 'no speech in the first 3s; the hook must be visual or on-screen text']);
  else rows.push([words[0].start <= 1 ? 'PASS' : 'WARN', 'Hook speed', `first word at ${words[0].start.toFixed(1)}s (aim for <= 1s)`]);

  if (base.spread < 1.5) rows.push(['INFO', 'Account ceiling', `views cluster tightly (p75/p25 = ${base.spread.toFixed(1)}x): reach looks account-limited, so craft fixes move less`]);
  if (base.n < 8) rows.push(['INFO', 'Sample', `only ${base.n} posts scraped; baseline is noisy`]);
  return rows;
}

export function score(rows) {
  const pts = { PASS: 1, WARN: 0.5, FAIL: 0 };
  const scored = rows.filter(([s]) => s in pts);
  return scored.length ? Math.round(100 * scored.reduce((a, [s]) => a + pts[s], 0) / scored.length) : null;
}

// Scrape once per day per account; reruns read the cache instead of re-scraping.
async function scrape(platform, handle, refresh) {
  const dir = join(HOME, 'cache');
  const file = join(dir, `${platform}-${handle}.json`);
  if (!refresh && existsSync(file) && Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const posts = await scrapeProfile(platform, handle, 20);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(posts));
  return posts;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { tiktok: { type: 'string' }, instagram: { type: 'string' }, youtube: { type: 'string' }, refresh: { type: 'boolean' } },
  });
  const [video] = positionals;
  const platform = ['tiktok', 'instagram', 'youtube'].find(p => values[p]);
  const handle = String(values[platform] ?? '').replace(/^@/, '');
  if (!video || !platform) {
    console.error('usage: node virality-check.mjs <video> --tiktok <handle> | --instagram <handle> | --youtube <handle> [--refresh]');
    process.exit(2);
  }
  if (!existsSync(video)) throw new Error(`no such file: ${video}`);
  if (!HANDLE_RE.test(handle)) throw new Error(`invalid handle: ${JSON.stringify(handle)}`);

  const posts = (await scrape(platform, handle, values.refresh)).filter(p => p.views > 0);
  if (!posts.length) throw new Error(`no posts with view counts for @${handle} (private account or empty scrape)`);
  const base = baseline(posts);
  const vid = probe(video);
  const words = transcribe(video, 10)?.words ?? null;
  const rows = checks(vid, words, base);
  const s = score(rows);
  const fmt = n => Math.round(n).toLocaleString('en-US');

  console.log(`# Virality check: ${basename(video)}\n`);
  console.log(`@${handle} on ${platform}: ${base.n} recent posts, median ${fmt(base.median)} views.`);
  console.log(`To count as an outlier here it needs 3x median = ${fmt(base.median * 3)}+ views (5x = ${fmt(base.median * 5)}).\n`);
  console.log(`Score: ${s ?? 'n/a'}/100 (heuristic, not a prediction)\n`);
  for (const [st, name, why] of rows) console.log(`- [${st}] ${name}: ${why}`);
  if (words?.length) console.log(`\nYour first 3s: "${words.filter(w => w.start < 3).map(w => w.text).join(' ')}"`);
  console.log('\nTop posts on this account (compare your hook against these):');
  base.top.forEach((p, i) => console.log(`${i + 1}. ${fmt(p.views)} views, ${p.duration ? secs(p.duration) : '?'}, likes/views ${(p.likes / p.views * 100).toFixed(1)}%: "${p.hook}" ${p.url}`));
}

if (import.meta.main) {
  main().catch(err => { console.error(`virality-check: ${err.message}`); process.exit(1); });
}
