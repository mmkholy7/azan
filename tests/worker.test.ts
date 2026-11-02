import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const secret = 'local-test-bridge-secret-32-characters-minimum';
const settings = { latitude: 30.0444, longitude: 31.2357, timeZone: 'Africa/Cairo', method: 'Egyptian', madhab: 'standard' };
let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const origin = 'https://azan.test';
async function request(path: string, method = 'GET', body?: unknown, auth?: string, extra?: Record<string, string>) {
  return mf.dispatchFetch(`${origin}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function pairing(userId = 'alexa-test-user') {
  const response = await request('/api/v1/alexa/connect', 'POST', { userId }, secret);
  expect(response.status).toBe(200);
  const body = await response.json() as { connectUrl: string };
  return new URL(body.connectUrl).hash.slice('#connect='.length);
}
beforeAll(async () => {
  const result = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'esm', target: 'es2022' });
  mf = new Miniflare({
    workers: [{
      config: {
        name: 'azan-test',
        compatibilityDate: '2026-10-01',
        manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: result.outputFiles[0].text } } },
        env: {
          PUBLIC_ORIGIN: { type: 'text', value: origin },
          BRIDGE_SECRET: { type: 'text', value: secret },
          IDENTITY_SECRET: { type: 'text', value: 'separate-local-identity-secret-32-characters-minimum' },
          DB: { type: 'd1' },
        },
      },
    }],
  });
  db = await mf.getD1Database('DB');
  await db.exec((await readFile('migrations/0001_connections.sql', 'utf8')).replaceAll('\n', ' '));
}, 30000);
afterAll(async () => { await mf?.dispose(); });

describe('real Workers runtime and D1 integration', () => {
  it('advertises unavailable automatic playback and applies no-store security headers', async () => {
    const response = await request('/api/v1/health');
    expect(await response.json()).toMatchObject({ automaticPlayback: 'not-implemented' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
  it('calculates statelessly without creating a stored profile', async () => {
    const response = await request('/api/v1/prayers', 'POST', { settings, date: '2026-11-01' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ date: '2026-11-01', timeZone: settings.timeZone });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM connections').first()).toEqual({ count: 0 });
  });
  it('rejects invalid JSON, oversized bodies, invalid input and browser cross-origin writes', async () => {
    const invalid = await mf.dispatchFetch(`${origin}/api/v1/prayers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(invalid.status).toBe(400);
    expect((await request('/api/v1/prayers', 'POST', { settings: { ...settings, timeZone: 'bad' } })).status).toBe(400);
    expect((await request('/api/v1/prayers', 'POST', { settings, date: '2026-02-30' })).status).toBe(422);
    expect((await request('/api/v1/prayers', 'POST', { data: 'a'.repeat(5000) })).status).toBe(413);
    expect((await request('/api/v1/profile', 'PUT', { consent: true, settings }, 'a'.repeat(64), { Origin: 'https://janat.uably.com' })).status).toBe(403);
  });
  it('requires bridge authentication and does not invent an unconnected profile', async () => {
    expect((await request('/api/v1/alexa/connect', 'POST', { userId: 'x' })).status).toBe(401);
    expect((await request('/api/v1/alexa/next', 'POST', { userId: 'unconnected' }, secret)).status).toBe(409);
  });
  it('connects once with consent, updates, exports, answers, and revokes', async () => {
    const pair = await pairing();
    expect((await request('/api/v1/profile', 'PUT', { consent: false, settings }, pair)).status).toBe(400);
    const saved = await request('/api/v1/profile', 'PUT', { consent: true, settings }, pair);
    expect(saved.status).toBe(201);
    const { manageToken } = await saved.json() as { manageToken: string };
    expect((await request('/api/v1/profile', 'PUT', { consent: true, settings }, pair)).status).toBe(401);
    expect((await request('/api/v1/profile', 'GET', undefined, pair)).status).toBe(401);
    expect(await (await request('/api/v1/profile', 'GET', undefined, manageToken)).json()).toEqual({ settings });
    const row = await db.prepare('SELECT * FROM connections WHERE manage_hash IS NOT NULL').first();
    expect(JSON.stringify(row)).not.toContain('alexa-test-user');
    expect(JSON.stringify(row)).not.toContain(manageToken);
    expect(row?.pair_hash).toBeNull();
    expect((await request('/api/v1/alexa/next', 'POST', { userId: 'alexa-test-user' }, secret)).status).toBe(200);
    const changed = { ...settings, madhab: 'hanafi' };
    expect((await request('/api/v1/profile', 'PATCH', { consent: true, settings: changed }, manageToken)).status).toBe(200);
    expect(await (await request('/api/v1/profile', 'GET', undefined, manageToken)).json()).toEqual({ settings: changed });
    expect((await request('/api/v1/profile', 'DELETE', undefined, manageToken)).status).toBe(200);
    expect((await request('/api/v1/profile', 'DELETE', undefined, manageToken)).status).toBe(401);
    expect((await request('/api/v1/alexa/next', 'POST', { userId: 'alexa-test-user' }, secret)).status).toBe(409);
  });
  it('allows only one concurrent redemption and invalidates management keys on reconnect', async () => {
    const pair = await pairing('race-user');
    const responses = await Promise.all([request('/api/v1/profile', 'PUT', { consent: true, settings }, pair), request('/api/v1/profile', 'PUT', { consent: true, settings }, pair)]);
    expect(responses.map(value => value.status).sort()).toEqual([201, 401]);
    const { manageToken: old } = await responses.find(value => value.status === 201)!.json() as { manageToken: string };
    const fresh = await pairing('race-user');
    expect((await request('/api/v1/profile', 'GET', undefined, old)).status).toBe(200);
    const saved = await request('/api/v1/profile', 'PUT', { consent: true, settings }, fresh);
    expect(saved.status).toBe(201);
    expect((await request('/api/v1/profile', 'GET', undefined, old)).status).toBe(401);
  });
  it('rejects expired links and replaces outstanding links', async () => {
    const old = await pairing('expiry-user');
    const fresh = await pairing('expiry-user');
    expect((await request('/api/v1/profile', 'PUT', { consent: true, settings }, old)).status).toBe(401);
    await db.prepare('UPDATE connections SET pair_expires = 0 WHERE settings IS NULL').run();
    expect((await request('/api/v1/profile', 'PUT', { consent: true, settings }, fresh)).status).toBe(401);
  });
});
