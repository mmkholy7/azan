import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { CalculationError, daySchedule, localDate, nextPrayer, settingsSchema } from './prayers';

interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  BRIDGE_SECRET?: string;
  IDENTITY_SECRET?: string;
  PUBLIC_ORIGIN: string;
}
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
const token = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const bearer = (request: Request) => {
  const value = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!value) throw new HttpError(401, 'A valid connection capability is required.');
  return value;
};
async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A JSON body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new HttpError(413, 'Request exceeds 4 KiB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const consentSchema = z.object({ consent: z.literal(true), settings: settingsSchema }).strict();
async function subjectFor(userId: string, env: Env) {
  if (!env.IDENTITY_SECRET || env.IDENTITY_SECRET.length < 32) throw new HttpError(503, 'Alexa identity configuration is not ready.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.IDENTITY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(userId)));
}
async function verifyBridge(request: Request, env: Env) {
  if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) throw new HttpError(503, 'Alexa bridge is not configured.');
  const received = request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${env.BRIDGE_SECRET}`;
  const [a, b] = await Promise.all([digest(received), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (difference) throw new HttpError(401, 'Invalid bridge authorization.');
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = request.headers.get('Origin');
  // Browser writes are same-origin only. The Lambda bridge has no browser Origin.
  if (origin && origin !== env.PUBLIC_ORIGIN && path !== '/api/v1/prayers') {
    throw new HttpError(403, 'Use the Azan companion origin for cloud connections.');
  }
  if (request.method === 'GET' && path === '/api/v1/health') {
    return json({ status: 'ok', automaticPlayback: 'not-implemented', version: 1 });
  }
  if (request.method === 'POST' && path === '/api/v1/prayers') {
    const body = z.object({ settings: settingsSchema, date: z.string().optional() }).strict().parse(await jsonBody(request));
    return json(daySchedule(body.settings, body.date ?? localDate(new Date(), body.settings.timeZone)));
  }
  if (request.method === 'POST' && path.startsWith('/api/v1/alexa/')) {
    await verifyBridge(request, env);
    const { userId } = z.object({ userId: z.string().min(1).max(1024) }).strict().parse(await jsonBody(request));
    const subject = await subjectFor(userId, env);
    if (path === '/api/v1/alexa/connect') {
      const pairToken = token();
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM connections WHERE settings IS NULL AND pair_expires < ?').bind(now),
        env.DB.prepare('UPDATE connections SET pair_hash = NULL, pair_expires = NULL WHERE pair_expires < ?').bind(now),
        env.DB.prepare(`INSERT INTO connections (subject, pair_hash, pair_expires) VALUES (?, ?, ?)
          ON CONFLICT(subject) DO UPDATE SET pair_hash = excluded.pair_hash, pair_expires = excluded.pair_expires`)
          .bind(subject, await digest(pairToken), now + 10 * 60_000),
      ]);
      return json({ connectUrl: `${env.PUBLIC_ORIGIN}/#connect=${pairToken}`, expiresInSeconds: 600 });
    }
    if (path === '/api/v1/alexa/next') {
      const row = await env.DB.prepare('SELECT settings FROM connections WHERE subject = ?').bind(subject).first<{ settings: string | null }>();
      if (!row?.settings) throw new HttpError(409, 'Connect your location using the Alexa app card first.');
      return json(nextPrayer(settingsSchema.parse(JSON.parse(row.settings))));
    }
  }
  if (path === '/api/v1/profile') {
    const hash = await digest(bearer(request));
    if (request.method === 'PUT') {
      const { settings } = consentSchema.parse(await jsonBody(request));
      const manageToken = token();
      const row = await env.DB.prepare(`UPDATE connections SET settings = ?, manage_hash = ?, pair_hash = NULL, pair_expires = NULL
        WHERE pair_hash = ? AND pair_expires > ? RETURNING subject`)
        .bind(JSON.stringify(settings), await digest(manageToken), hash, Date.now()).first();
      if (!row) throw new HttpError(401, 'This connection link has expired or was already used. Ask Alexa to connect again.');
      return json({ settings, manageToken }, 201);
    }
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT settings FROM connections WHERE manage_hash = ?').bind(hash).first<{ settings: string }>();
      if (!row) throw new HttpError(401, 'Connection not found.');
      return json({ settings: settingsSchema.parse(JSON.parse(row.settings)) });
    }
    if (request.method === 'PATCH') {
      const { settings } = consentSchema.parse(await jsonBody(request));
      const result = await env.DB.prepare('UPDATE connections SET settings = ? WHERE manage_hash = ? RETURNING subject')
        .bind(JSON.stringify(settings), hash).first();
      if (!result) throw new HttpError(401, 'Connection not found.');
      return json({ settings });
    }
    if (request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM connections WHERE manage_hash = ? RETURNING subject').bind(hash).first();
      if (!result) throw new HttpError(401, 'Connection not found.');
      return json({ deleted: true });
    }
  }
  if (path.startsWith('/api/')) throw new HttpError(404, 'Endpoint not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status);
      else if (error instanceof z.ZodError) response = json({ error: 'Invalid input.', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, 400);
      else if (error instanceof CalculationError) response = json({ error: error.message }, 422);
      else {
        // Do not log request bodies, tokens, Alexa IDs, or location.
        console.error('azan_request_failed', { type: error instanceof Error ? error.name : 'unknown' });
        response = json({ error: 'Service unavailable. Please try again later.' }, 503);
      }
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    headers.set('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
    return new Response(response.body, { status: response.status, headers });
  },
};
