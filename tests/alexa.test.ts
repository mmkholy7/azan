import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../src/alexa';

const config = { skillId: 'amzn1.ask.skill.test', apiOrigin: 'https://azan.test', bridgeSecret: 'local-bridge-secret-at-least-32-characters' };
const event = (intent?: string, type = 'IntentRequest') => ({
  context: { System: { application: { applicationId: config.skillId }, user: { userId: 'alexa-user' }, device: { supportedInterfaces: { AudioPlayer: {} } } } },
  request: { type, timestamp: new Date().toISOString(), ...(intent ? { intent: { name: intent } } : {}) },
});
describe('Alexa Lambda adapter', () => {
  it('rejects foreign skills and stale or invalid timestamps before network access', async () => {
    const http = vi.fn();
    const handler = createHandler(config, http);
    const foreign = event(); foreign.context.System.application.applicationId = 'other';
    await expect(handler(foreign)).rejects.toThrow('skill ID');
    const stale = event(); stale.request.timestamp = '2020-01-01T00:00:00Z';
    await expect(handler(stale)).rejects.toThrow('Stale');
    stale.request.timestamp = 'invalid';
    await expect(handler(stale)).rejects.toThrow('Stale');
    expect(http).not.toHaveBeenCalled();
  });
  it('returns a private one-use setup link in an Alexa app card', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connectUrl: 'https://azan.test/#connect=secret' }));
    const result = await createHandler(config, http)(event('ConnectIntent'));
    expect(result.response).toMatchObject({ card: { type: 'Simple', content: expect.stringContaining('#connect=secret') } });
    expect(http.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ userId: 'alexa-user' }), redirect: 'error' });
  });
  it('speaks the next prayer in the connected timezone', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'maghrib', at: '2026-11-01T15:05:00Z', timeZone: 'Africa/Cairo' }));
    const result = await createHandler(config, http)(event('NextPrayerIntent'));
    expect(result.response).toMatchObject({ outputSpeech: { text: expect.stringContaining('5:05 PM') } });
  });
  it('explains unconnected state and backend failure without claiming success', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 409 }));
    expect((await createHandler(config, http)(event(undefined, 'LaunchRequest'))).response).toMatchObject({ outputSpeech: { text: expect.stringContaining('No Janat account') } });
    http.mockResolvedValue(new Response('', { status: 503 }));
    expect((await createHandler(config, http)(event('NextPrayerIntent'))).response).toMatchObject({ outputSpeech: { text: expect.stringContaining('could not reach') } });
  });
  it('does not pretend to play audio without a licensed configured recording', async () => {
    const result = await createHandler(config)(event('PlayAdhanIntent'));
    expect(result.response).toMatchObject({ outputSpeech: { text: expect.stringContaining('not configured') } });
  });
  it('issues user-invoked play and stop directives; resume restarts this single recording', async () => {
    const handler = createHandler({ ...config, audioUrl: 'https://audio.example.org/owned.mp3' });
    expect((await handler(event('PlayAdhanIntent'))).response).toMatchObject({
      shouldEndSession: true, directives: [{ type: 'AudioPlayer.Play', audioItem: { stream: { offsetInMilliseconds: 0, url: 'https://audio.example.org/owned.mp3' } } }],
    });
    expect((await handler(event('AMAZON.ResumeIntent'))).response).toMatchObject({ directives: [{ type: 'AudioPlayer.Play' }] });
    expect((await handler(event('AMAZON.StopIntent'))).response).toMatchObject({ directives: [{ type: 'AudioPlayer.Stop' }] });
    expect((await handler(event(undefined, 'AudioPlayer.PlaybackFinished'))).response).toEqual({});
  });
  it('rejects insecure audio and unsupported device playback', async () => {
    expect(() => createHandler({ ...config, audioUrl: 'http://example.org/a.mp3' })).toThrow('HTTPS');
    const unsupported = event('PlayAdhanIntent');
    Reflect.deleteProperty(unsupported.context.System.device.supportedInterfaces, 'AudioPlayer');
    const result = await createHandler({ ...config, audioUrl: 'https://audio.example.org/owned.mp3' })(unsupported);
    expect(result.response).toMatchObject({ outputSpeech: { text: expect.stringContaining('does not support') } });
  });
});
