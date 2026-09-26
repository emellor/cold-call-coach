import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR, AVATAR_URL, fetchAvatar } from './fetch-avatar.mjs';

const body = Buffer.from('glTF pretend avatar bytes');
const sha256 = createHash('sha256').update(body).digest('hex');

describe('fetch-avatar', () => {
  let dir: string;
  let dest: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccc-avatar-'));
    dest = join(dir, 'avatars', 'mpfb.glb');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const serve = (bytes: Buffer, status = 200) =>
    vi.fn<typeof fetch>(() => Promise.resolve(new Response(new Uint8Array(bytes), { status })));

  it('pins a commit SHA, not a branch', () => {
    expect(AVATAR_URL).toContain(`/${AVATAR.commit}/avatars/mpfb.glb`);
    expect(AVATAR.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('downloads, verifies the checksum and writes the file', async () => {
    const fetchImpl = serve(body);
    expect(await fetchAvatar({ dest, sha256, fetchImpl })).toBe('downloaded');
    expect(await readFile(dest)).toEqual(body);
  });

  it('skips the download when the file is already present and correct', async () => {
    await fetchAvatar({ dest, sha256, fetchImpl: serve(body) });
    const fetchImpl = serve(body);
    expect(await fetchAvatar({ dest, sha256, fetchImpl })).toBe('present');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('replaces a file whose checksum does not match', async () => {
    await fetchAvatar({ dest, sha256, fetchImpl: serve(body) });
    await writeFile(dest, 'corrupted');
    expect(await fetchAvatar({ dest, sha256, fetchImpl: serve(body) })).toBe('downloaded');
    expect(await readFile(dest)).toEqual(body);
  });

  it('refuses a download that does not match, writing nothing', async () => {
    await expect(
      fetchAvatar({ dest, sha256, fetchImpl: serve(Buffer.from('something else')) }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(existsSync(dest)).toBe(false);
  });

  it('reports an HTTP failure', async () => {
    await expect(fetchAvatar({ dest, sha256, fetchImpl: serve(body, 404) })).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
