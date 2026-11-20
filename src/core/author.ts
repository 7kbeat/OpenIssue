import { spawnSync } from 'node:child_process';
import os from 'node:os';

let cached: string | undefined;

export function currentAuthor(): string {
  if (cached) return cached;
  if (process.env.OPENISSUE_AUTHOR?.trim()) {
    cached = process.env.OPENISSUE_AUTHOR.trim();
    return cached;
  }
  const git = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  const name = git.status === 0 ? git.stdout.trim() : '';
  cached = name || os.userInfo().username || 'unknown';
  return cached;
}
