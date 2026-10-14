#!/usr/bin/env node
// study — break one video down for /analyze: platform metrics, account
// baseline, full timed transcript, edit pacing, and labeled frames.
//
//   node study.mjs <video file | TikTok / Instagram / YouTube URL> [--fast]
//
// Writes studies/<name>/: study.md (read first), study.json, hook.jpg (frames
// in the first 3s), shots.jpg (one labeled frame per shot) and frames/. The
// script only measures; Claude reads the images for the visual layer (outfit,
// setting, lighting, framing, on-screen text). --fast skips the account baseline.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { HOME, PY, YTDLP } from './paths.mjs';
import { scrapeProfile } from './scrape.mjs';

const MAX_SHOT_FRAMES = 30;
const HOOK_TIMES = [0, 0.5, 1, 1.5, 2, 3];
const FONT = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'].find(existsSync);

export function probe(file) {
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const v = info.streams.find(s => s.codec_type === 'video');
  if (!v) throw new Error(`${file} has no video stream`);
  // Phone footage stores portrait as landscape + a 90° rotation tag.
  const rot = Math.abs(Number(v.side_data_list?.find(d => d.rotation != null)?.rotation ?? v.tags?.rotate ?? 0));
  const [width, height] = rot % 180 === 90 ? [v.height, v.width] : [v.width, v.height];
  const [num, den] = String(v.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    width, height,
    fps: den ? Math.round((num / den) * 100) / 100 : 0,
    duration: Number(info.format.duration),
    audio: info.streams.some(s => s.codec_type === 'audio'),
  };
}

// Local Whisper + voice measurements via audio.py in freeify's own venv.
// Returns null when the env is missing or the clip has no audio, so callers
// can say "not available".
export function transcribe(file, seconds = null, { voice = false, chart = null } = {}) {
  if (!existsSync(PY)) {
    console.error(`no Python env at ${PY}; run setup.sh for transcripts`);
    return null;
  }
  const wav = join(tmpdir(), `freeify-${process.pid}.wav`);
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...(seconds ? ['-t', String(seconds)] : []), '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav]);
    const args = [join(import.meta.dirname, 'audio.py'), wav, ...(voice ? (chart ? ['--chart', chart] : []) : ['--no-voice'])];
    const out = execFileSync(PY, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (err) {
    console.error(`transcription failed: ${String(err.stderr || err.message).trim().split('\n').pop()}`);
    return null;
  } finally {
    rmSync(wav, { force: true });
  }
}

function sceneCuts(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]));
}

export function shots(cuts, duration) {
  const bounds = [0, ...cuts.filter(t => t > 0.1 && t < duration - 0.1), duration];
  return bounds.slice(1).map((end, i) => ({ start: bounds[i], end }));
}

export function speechStats(words, gap = 1) {
  if (!words?.length) return null;
  const spoken = words.at(-1).end - words[0].start;
  const deadAir = [];
  for (let i = 1; i < words.length; i++) {
    if (words[i].start - words[i - 1].end >= gap) deadAir.push([words[i - 1].end, words[i].start]);
  }
  return { firstWord: words[0].start, wpm: spoken > 0 ? Math.round(words.length / (spoken / 60)) : 0, deadAir };
}

const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function frameAt(file, t, out, label) {
  const draw = FONT ? `,drawtext=fontfile=${FONT}:text='${label}':x=8:y=8:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6` : '';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=540:-2${draw}`, '-q:v', '3', out]);
}

function sheet(frames, cols, out) {
  const list = join(tmpdir(), `freeify-${process.pid}.txt`);
  writeFileSync(list, frames.map(f => `file '${f}'`).join('\n'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=240:-2,tile=${cols}x${Math.ceil(frames.length / cols)}`, '-frames:v', '1', '-q:v', '3', out]);
  } finally {
    rmSync(list, { force: true });
  }
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';

function download(url, dir) {
  execFileSync(YTDLP, ['--no-warnings', '--no-playlist', '-f', 'bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4', '--write-info-json', '-o', join(dir, 'video.%(ext)s'), url], { stdio: ['ignore', 'ignore', 'inherit'] });
  const video = readdirSync(dir).find(f => f.startsWith('video.') && !f.endsWith('.json'));
  if (!video) throw new Error(`yt-dlp downloaded no video for ${url}`);
  return { file: join(dir, video), info: JSON.parse(readFileSync(join(dir, 'video.info.json'), 'utf8')) };
}

const PLATFORM = { TikTok: 'tiktok', Instagram: 'instagram', Youtube: 'youtube' };

async function platformData(info, fast) {
  const platform = PLATFORM[info.extractor_key] ?? info.extractor_key;
  // yt-dlp puts the @handle in a different field per site; the others hold display names.
  const handle = String({ tiktok: info.uploader, instagram: info.channel, youtube: info.uploader_id }[platform] ?? info.uploader ?? '').replace(/^@/, '') || null;
  const m = {
    platform, handle,
    followers: info.channel_follower_count ?? null,
    posted: info.timestamp ? new Date(info.timestamp * 1000).toISOString().slice(0, 10) : null,
    views: info.view_count ?? null,
    likes: info.like_count ?? null,
    comments: info.comment_count ?? null,
    shares: info.repost_count ?? null,
    music: [info.track, info.artist].filter(Boolean).join(' — ') || null,
    caption: String(info.description || info.title || '').replace(/[\u200b-\u200d\u2060-\u2064\ufeff]/g, ''),
  };
  m.hashtags = [...new Set(m.caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
  if (fast || !handle || !Object.values(PLATFORM).includes(platform)) return m;
  try {
    const posts = await scrapeProfile(platform, handle, 20);
    // Instagram hides views on a single logged-out reel; the profile page has them.
    if (m.views == null) m.views = posts.find(p => p.url.includes(`/${info.id}/`))?.views ?? null;
    const views = posts.map(p => p.views).filter(v => v > 0).sort((a, b) => a - b);
    const median = views.length ? views[Math.floor(views.length / 2)] : 0;
    m.baseline = { posts: views.length, median, outlier: m.views && median ? Math.round((m.views / median) * 10) / 10 : null };
  } catch (err) {
    m.baseline = { error: err.message };
  }
  return m;
}

const fmt = n => (n == null ? 'n/a' : Number(n).toLocaleString('en-US'));
const pct = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');

function outlierLabel(x) {
  if (x == null) return '';
  return x >= 10 ? 'mega outlier' : x >= 5 ? 'true outlier' : x >= 3 ? 'significant' : x >= 1 ? 'baseline' : 'below their own floor';
}

const signed = (n, unit) => (n == null ? '?' : `${n > 0 ? '+' : ''}${n.toFixed(1)}${unit}`);
const lineTag = l => (l ? ` (${signed(l.db, 'dB')}, ${signed(l.st, 'st')}, ${l.wpm ?? '?'}wpm)` : '');
const BARS = '▁▂▃▄▅▆▇█';

function voiceSection(v) {
  const bar = d => (d == null ? ' ' : BARS[Math.max(0, Math.min(7, Math.round((d + 20) / 25 * 7)))]);
  return [
    '## Voice (measured; all speakers mixed, no speaker separation)', '',
    `- Pitch: median ${v.pitch_median_hz} Hz, range ${v.pitch_range_st} semitones (p10-p90), variation ${v.pitch_sd_st} st: ${v.pitch_label}`,
    `- Loudness: range ${v.loudness_range_db} dB (p10-p90): ${v.loudness_label}; first 3s ${signed(v.hook_vs_median_db, ' dB')} vs the median voice`,
    `- Between words: ${v.gap_vs_speech_db == null ? 'too few gaps to measure' : `${v.gap_vs_speech_db} dB vs speech (near 0 = music or noise as loud as the voice; below -20 = clean)`}`,
    `- Stressed words: ${v.stressed.map(w => `"${w.text}" ${clock(w.start)}`).join(', ') || 'none stand out'}`,
    `- Energy per second (dB vs median, -20..+5): ${v.per_second_db.map(bar).join('')}`,
  ];
}

function report(s) {
  const L = [`# Study: ${s.name}`, '', `Source: ${s.source}`];
  const m = s.meta;
  if (m) {
    L.push(`Platform: ${m.platform} @${m.handle}${m.followers ? ` (${fmt(m.followers)} followers)` : ''}${m.posted ? `, posted ${m.posted}` : ''}${m.music ? `, sound: ${m.music}` : ''}`);
    L.push(`Metrics: ${fmt(m.views)} views, ${fmt(m.likes)} likes (${pct(m.likes, m.views)}), ${fmt(m.comments)} comments (${pct(m.comments, m.views)}), ${fmt(m.shares)} shares (${pct(m.shares, m.views)})`);
    if (m.baseline?.error) L.push(`Account baseline: unavailable (${m.baseline.error})`);
    else if (m.baseline) L.push(`Account baseline: median ${fmt(m.baseline.median)} views over ${m.baseline.posts} recent posts; this video = ${m.baseline.outlier ?? 'n/a'}x ${outlierLabel(m.baseline.outlier)}`);
    L.push(`Caption: ${m.caption.replace(/\s+/g, ' ').slice(0, 500)}`, `Hashtags: ${m.hashtags.join(' ') || 'none'}`);
  } else {
    L.push('Platform metrics: none (local file). Pass the posted link instead to get views, likes and the account baseline.');
  }
  const v = s.video;
  L.push(`Video: ${v.width}x${v.height}, ${v.fps}fps, ${v.duration.toFixed(1)}s, ${v.audio ? 'has audio' : 'NO audio'}`);
  L.push(`Edit: ${s.shots.length} shots, avg shot ${(v.duration / s.shots.length).toFixed(1)}s, ${Math.round(s.cuts.length / (v.duration / 60))} cuts/min, first cut ${s.cuts[0] != null ? `at ${clock(s.cuts[0])}` : 'none'}`);
  const sp = s.speech;
  if (sp) L.push(`Speech: first word at ${sp.firstWord.toFixed(1)}s, ${sp.wpm} wpm, dead air (>=1s): ${sp.deadAir.map(([a, b]) => `${clock(a)}-${clock(b)}`).join(', ') || 'none'}`);
  else if (s.transcript) L.push('Speech: none detected with confidence (music-only or silent)');
  if (s.voice) L.push('', ...voiceSection(s.voice));
  L.push('', '## Transcript', '');
  if (s.voice) L.push('Each line: (loudness dB vs the median voice, pitch semitones vs median, words per minute).', '');
  if (!s.transcript) L.push('Not available (no audio or no local Whisper).');
  else if (!s.transcript.segments.length) L.push('No speech detected (music-only or silent).');
  else {
    const byStart = new Map((s.voice?.lines ?? []).map(l => [l.start, l]));
    s.transcript.segments.forEach(seg => L.push(`[${clock(seg.start)}]${seg.doubtful ? ' (?)' : lineTag(byStart.get(seg.start))} ${seg.text}`));
    if (s.transcript.segments.some(seg => seg.doubtful)) L.push('', '(?) = low Whisper confidence; often invented words over music. Not counted in the speech stats.');
  }
  L.push('', '## Shots', '');
  s.shots.forEach((sh, i) => L.push(`${String(i + 1).padStart(2, '0')}. ${clock(sh.start)}-${clock(sh.end)} (${(sh.end - sh.start).toFixed(1)}s)`));
  L.push('', '## Visual files (read these for the visual layer)', '',
    '- hook.jpg: frames at 0, 0.5, 1, 1.5, 2 and 3s, left to right',
    `- shots.jpg: ${s.shotFrames.length} shot frames, each labeled with its timestamp`,
    '- frames/: the same frames at 540px wide, for close-ups (outfit, text overlays, props)',
    ...(s.voice ? ['- voice.png: loudness (top) and pitch (bottom) over time; grey lines = transcript lines, labels = stressed words'] : []));
  return L.join('\n') + '\n';
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { fast: { type: 'boolean' } } });
  const [input] = positionals;
  if (!input) {
    console.error('usage: node study.mjs <video file | TikTok / Instagram / YouTube URL> [--fast]');
    process.exit(2);
  }
  const isUrl = /^https?:\/\//i.test(input);
  if (!isUrl && !existsSync(input)) throw new Error(`no such file: ${input}`);
  // YouTube keeps the video id in ?v=, so the path alone would name every study "watch".
  const name = isUrl ? slug(`${new URL(input).pathname} ${new URL(input).searchParams.get('v') ?? ''}`) : slug(basename(input, extname(input)));
  const dir = join(HOME, 'studies', name);
  // Re-studying a file that lives in its own study folder must not delete it first.
  if (isUrl || !resolve(input).startsWith(dir + sep)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });

  console.error('fetching...');
  const { file, info } = isUrl ? download(input, dir) : { file: input, info: null };
  const meta = info ? await platformData(info, values.fast) : null;
  const video = probe(file);

  console.error('cutting...');
  const cuts = sceneCuts(file);
  const allShots = shots(cuts, video.duration);
  const step = Math.max(1, allShots.length / MAX_SHOT_FRAMES);
  const picked = Array.from({ length: Math.min(allShots.length, MAX_SHOT_FRAMES) }, (_, i) => allShots[Math.floor(i * step)]);
  const shotFrames = picked.map((sh, i) => {
    const t = (sh.start + sh.end) / 2;
    const out = join(dir, 'frames', `shot_${String(i + 1).padStart(2, '0')}_${t.toFixed(1)}s.jpg`);
    frameAt(file, t, out, clock(t).replace(':', '\\:'));
    return out;
  });
  const hookFrames = HOOK_TIMES.filter(t => t < video.duration).map(t => {
    const out = join(dir, 'frames', `hook_${t.toFixed(1)}s.jpg`);
    frameAt(file, t, out, `${t.toFixed(1)}s`);
    return out;
  });
  sheet(hookFrames, hookFrames.length, join(dir, 'hook.jpg'));
  sheet(shotFrames, 6, join(dir, 'shots.jpg'));

  console.error('transcribing...');
  const transcript = video.audio ? transcribe(file, null, { voice: true, chart: join(dir, 'voice.png') }) : null;
  const study = { name, source: input, meta, video, cuts, shots: allShots, shotFrames, speech: speechStats(transcript?.words), voice: transcript?.voice ?? null, transcript };
  writeFileSync(join(dir, 'study.json'), JSON.stringify(study, null, 2));
  writeFileSync(join(dir, 'study.md'), report(study));
  console.log(join(dir, 'study.md'));
}

if (import.meta.main) {
  main().catch(err => { console.error(`study: ${err.message}`); process.exit(1); });
}
