// Where reelscope keeps its Python env, browser driver, studies and cache.
// As a Claude Code plugin that is CLAUDE_PLUGIN_DATA (survives plugin updates);
// standalone it is ~/.reelscope. REELSCOPE_HOME overrides both.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.REELSCOPE_HOME || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.reelscope');
export const PY = process.env.REELSCOPE_PYTHON || join(HOME, '.venv/bin/python');
const venvYtdlp = join(HOME, '.venv/bin/yt-dlp');
export const YTDLP = process.env.YTDLP || (existsSync(venvYtdlp) ? venvYtdlp : 'yt-dlp');
export const PLAYWRIGHT = join(HOME, 'node_modules/playwright-core/index.mjs');
