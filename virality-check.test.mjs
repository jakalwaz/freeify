import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, checks, median, score } from './virality-check.mjs';
import { fromIg, fromYtdlp, igNodes } from './scrape.mjs';
import { shots, speechStats } from './study.mjs';

test('fromYtdlp maps yt-dlp metadata to a post', () => {
  const p = fromYtdlp({ webpage_url: 'https://www.tiktok.com/@a/video/1', view_count: 900, like_count: 90, comment_count: 9, repost_count: 3, duration: 21, description: 'POV: hook\nmore', timestamp: 5 });
  assert.deepEqual(p, { url: 'https://www.tiktok.com/@a/video/1', views: 900, likes: 90, comments: 9, shares: 3, duration: 21, hook: 'POV: hook', timestamp: 5 });
});

test('igNodes finds reels in Instagram page JSON and dedupes by code', () => {
  const node = { code: 'Dab1', play_count: 4500, like_count: 120, comment_count: 7 };
  const html = `<script type="application/json" data-sjs>${JSON.stringify({ a: [{ b: node }], c: node })}</script>`
    + '<script type="application/json">not json</script>';
  const nodes = igNodes(html);
  assert.equal(nodes.length, 1);
  assert.equal(fromIg(nodes[0]).url, 'https://www.instagram.com/reel/Dab1/');
  assert.equal(fromIg(nodes[0]).views, 4500);
});

test('shots split on cuts and drop cuts at the very edges', () => {
  assert.deepEqual(shots([0.05, 2, 5, 9.95], 10), [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 10 }]);
});

test('speechStats finds first word, pace and dead air', () => {
  const words = [{ start: 0.3, end: 0.6 }, { start: 0.7, end: 1 }, { start: 2.5, end: 3 }];
  const s = speechStats(words);
  assert.equal(s.firstWord, 0.3);
  assert.deepEqual(s.deadAir, [[1, 2.5]]);
  assert.equal(speechStats([]), null);
});

test('median ignores outliers that would skew a mean', () => {
  assert.equal(median([100, 200, 300, 100000]), 250);
  assert.equal(median([5, 1, 3]), 3);
});

test('baseline finds the duration cliff among posts that beat the median', () => {
  const posts = [[1000, 15], [3000, 22], [200, 60], [150, 45], [800, 30]].map(([views, duration]) => ({ views, duration, likes: 0, hook: '', url: '' }));
  const b = baseline(posts);
  assert.equal(b.median, 800);
  assert.equal(b.cliff, 30);
  assert.equal(b.top[0].views, 3000);
});

test('checks and score flag a long, horizontal, slow-hook video', () => {
  const base = { n: 20, median: 800, spread: 4, cliff: 30, top: [] };
  const bad = checks({ width: 1920, height: 1080, duration: 45 }, [{ text: 'so', start: 2.4 }], base);
  assert.deepEqual(bad.map(r => r[0]), ['FAIL', 'FAIL', 'WARN']);
  assert.equal(score(bad), 17);
  const good = checks({ width: 1080, height: 1920, duration: 20 }, [{ text: 'Stop', start: 0.2 }], base);
  assert.equal(score(good), 100);
  assert.equal(checks({ width: 1080, height: 1920, duration: 20 }, null, base)[2][0], 'SKIP');
});
