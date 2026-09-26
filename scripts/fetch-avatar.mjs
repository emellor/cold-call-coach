#!/usr/bin/env node
// @ts-check
// Fetches TalkingHead's CC0 sample avatar, mpfb.glb (about 37 MB), into
// apps/web/public/avatars/. It is not in the npm package, and it is git-ignored
// here. The download is pinned to a commit and verified against a SHA-256, so a
// changed upstream file can never slip in. Run with `pnpm avatar:fetch`.
//
// Only mpfb.glb is fetched: the repo's other sample avatars (brunette.glb,
// avatar.glb, vroid.glb, ...) are licensed for non-commercial use only.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AVATAR = {
  /** met4citizen/TalkingHead commit that added mpfb.glb; unchanged since. */
  commit: '6318ff8c798e4a661fcd70c9373c4ab789c822bb',
  sha256: '63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c',
  bytes: 36_815_920,
};

export const AVATAR_URL = `https://raw.githubusercontent.com/met4citizen/TalkingHead/${AVATAR.commit}/avatars/mpfb.glb`;
export const AVATAR_PATH = fileURLToPath(
  new URL('../apps/web/public/avatars/mpfb.glb', import.meta.url),
);

/** @param {string} path */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.dest]
 * @param {string} [options.url]
 * @param {string} [options.sha256]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<'present' | 'downloaded'>}
 */
export async function fetchAvatar({
  dest = AVATAR_PATH,
  url = AVATAR_URL,
  sha256 = AVATAR.sha256,
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  if (existsSync(dest)) {
    if ((await sha256File(dest)) === sha256) {
      log(`Avatar already present: ${dest}`);
      return 'present';
    }
    log('Avatar on disk does not match the pinned checksum; downloading it again.');
  }

  log(`Downloading ${url}`);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Avatar download failed: HTTP ${res.status} for ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== sha256) {
    throw new Error(
      `Avatar checksum mismatch: expected ${sha256}, got ${actual}. Nothing written.`,
    );
  }

  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  await writeFile(partial, body);
  await rename(partial, dest).catch(async (error) => {
    await rm(partial, { force: true });
    throw error;
  });
  log(`Saved ${(body.length / 1e6).toFixed(1)} MB to ${dest}`);
  return 'downloaded';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchAvatar({ log: (line) => console.log(`[avatar] ${line}`) }).catch((error) => {
    console.error(`[avatar] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
