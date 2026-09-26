import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';

describe('serving the built SPA', () => {
  let dist: string;
  let app: FastifyInstance;
  const { pool, db } = createDb('postgres://coach:coach@127.0.0.1:1/coach');

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'ccc-web-'));
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>Cold Call Coach</title>');
    await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = await buildApp({ config: loadConfig({}), pool, db }, { webDistDir: dist });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(dist, { recursive: true, force: true });
  });

  it('serves index.html at the root', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Cold Call Coach');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/calls/123' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('keeps unknown API routes as JSON 404s', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('marks fingerprinted assets immutable', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });
});
