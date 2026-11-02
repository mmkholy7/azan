import { z } from 'zod';

const envelopeSchema = z.object({
  context: z.object({ System: z.object({
    application: z.object({ applicationId: z.string() }),
    user: z.object({ userId: z.string() }),
    device: z.object({ supportedInterfaces: z.record(z.string(), z.unknown()) }).optional(),
  }) }),
  request: z.object({
    type: z.string(),
    timestamp: z.string(),
    intent: z.object({ name: z.string() }).optional(),
    offsetInMilliseconds: z.number().nonnegative().optional(),
  }),
});
type Config = { skillId: string; apiOrigin: string; bridgeSecret: string; audioUrl?: string };
const speech = (text: string) => ({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text }, shouldEndSession: true } });
const empty = () => ({ version: '1.0', response: {} });

export function createHandler(config: Config, http: typeof fetch = fetch) {
  const origin = new URL(config.apiOrigin);
  if (!config.skillId || config.bridgeSecret.length < 32 || origin.protocol !== 'https:' || origin.origin !== config.apiOrigin) {
    throw new Error('Configure SKILL_ID, HTTPS API_ORIGIN, and a BRIDGE_SECRET of at least 32 characters.');
  }
  if (config.audioUrl) {
    const audio = new URL(config.audioUrl);
    if (audio.protocol !== 'https:' || (audio.port && audio.port !== '443') || audio.username || audio.password) {
      throw new Error('ADHAN_AUDIO_URL must be a public HTTPS URL on port 443 without credentials.');
    }
  }
  const api = async (path: string, userId: string) => {
    const response = await http(`${config.apiOrigin}/api/v1/alexa/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.bridgeSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(4500),
      redirect: 'error',
    });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
    return response.json();
  };
  const play = () => ({
    version: '1.0',
    response: {
      shouldEndSession: true,
      directives: [{ type: 'AudioPlayer.Play', playBehavior: 'REPLACE_ALL', audioItem: { stream: {
        token: 'janat-adhan-v1', url: config.audioUrl, offsetInMilliseconds: 0,
      } } }],
    },
  });
  return async (input: unknown) => {
    const event = envelopeSchema.parse(input);
    const system = event.context.System;
    if (system.application.applicationId !== config.skillId) throw new Error('Unexpected Alexa skill ID.');
    const timestamp = Date.parse(event.request.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 150_000) throw new Error('Stale Alexa request.');
    const type = event.request.type;
    if (type === 'AudioPlayer.PlaybackFailed') {
      console.error('azan_audio_playback_failed');
      return empty();
    }
    if (type.startsWith('AudioPlayer.') || type === 'SessionEndedRequest') return empty();
    const intent = event.request.intent?.name;
    if (intent === 'AMAZON.StopIntent' || intent === 'AMAZON.CancelIntent' || intent === 'AMAZON.PauseIntent' || type === 'PlaybackController.PauseCommandIssued') {
      return { version: '1.0', response: { shouldEndSession: true, directives: [{ type: 'AudioPlayer.Stop' }] } };
    }
    if (intent === 'PlayAdhanIntent' || intent === 'AMAZON.ResumeIntent' || type === 'PlaybackController.PlayCommandIssued') {
      if (!config.audioUrl) return speech('Adhan audio is not configured yet. The owner must supply a recording they have permission to use.');
      if (!system.device?.supportedInterfaces || !('AudioPlayer' in system.device.supportedInterfaces)) {
        return speech('This device does not support the audio player. Try an Echo device.');
      }
      // This initial player deliberately restarts the single recording on resume.
      return play();
    }
    try {
      if (intent === 'ConnectIntent') {
        const data = z.object({ connectUrl: z.string().url() }).parse(await api('connect', system.user.userId));
        if (new URL(data.connectUrl).origin !== new URL(config.apiOrigin).origin) throw new Error('Unexpected connection origin.');
        return { version: '1.0', response: {
          outputSpeech: { type: 'PlainText', text: 'Open the Janat Azan card in your Alexa app. Copy its connection link into your browser within ten minutes. Your location is saved only if you choose to connect.' },
          card: { type: 'Simple', title: 'Connect Janat Azan', content: `Private one-use link. Do not share it. Expires in ten minutes:\n${data.connectUrl}` },
          shouldEndSession: true,
        } };
      }
      if (type === 'LaunchRequest' || intent === 'NextPrayerIntent') {
        const data = await api('next', system.user.userId);
        if (!data) return speech('To choose your prayer location, say: Alexa, ask Janat Azan to connect. No Janat account is needed.');
        const prayer = z.object({ name: z.string(), at: z.string().datetime(), timeZone: z.string() }).parse(data);
        const time = new Intl.DateTimeFormat('en-US', { timeZone: prayer.timeZone, hour: 'numeric', minute: '2-digit', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(prayer.at));
        return speech(`Your next prayer is ${prayer.name}, ${time}, in ${prayer.timeZone.replaceAll('_', ' ')}.`);
      }
      return speech('You can ask for the next prayer, say connect, or say play adhan. Automatic scheduled playback is not available in this version.');
    } catch (error) {
      console.error('azan_bridge_failed', { type: error instanceof Error ? error.name : 'unknown' });
      return speech('Janat Azan could not reach your prayer settings. Please try again later or reconnect from the Alexa app.');
    }
  };
}

export const handler = async (event: unknown) => createHandler({
  skillId: process.env.SKILL_ID ?? '',
  apiOrigin: process.env.API_ORIGIN ?? '',
  bridgeSecret: process.env.BRIDGE_SECRET ?? '',
  audioUrl: process.env.ADHAN_AUDIO_URL,
})(event);
