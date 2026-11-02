import { daySchedule, localDate, nextPrayer, settingsSchema, type Settings } from './prayers';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('settings');
const status = element('status');
const report = (message: string) => { status.textContent = message; };
const preferenceKey = 'janat.azan.local.v1';
const managementKey = 'janat.azan.connection.v1';
const fragment = new URLSearchParams(location.hash.slice(1));
const pairToken = fragment.get('connect');
if (pairToken) history.replaceState(null, '', location.pathname);
let manageToken: string | null = null;
let current: Settings | undefined;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
field('timeZone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
function fill(settings: Settings) {
  for (const [key, value] of Object.entries(settings)) field(key).value = String(value);
}
try {
  const stored = localStorage.getItem(preferenceKey);
  if (stored) fill(settingsSchema.parse(JSON.parse(stored)));
  manageToken = localStorage.getItem(managementKey);
} catch { report('Saved browser settings could not be read. Enter them again; browser storage may be unavailable.'); }
element('connect-area').hidden = !pairToken;
element('manage-area').hidden = !manageToken;
function readSettings() {
  return settingsSchema.parse({
    latitude: Number(field('latitude').value || NaN),
    longitude: Number(field('longitude').value || NaN),
    timeZone: field('timeZone').value,
    method: field('method').value,
    madhab: field('madhab').value,
  });
}
function render() {
  const settings = readSettings();
  const schedule = daySchedule(settings, localDate(new Date(), settings.timeZone));
  const upcoming = nextPrayer(settings);
  element('date-label').textContent = `${schedule.date} / ${schedule.timeZone}`;
  element('times').replaceChildren(...schedule.events.map(event => {
    const row = document.createElement('li');
    const name = document.createElement('span'); name.textContent = event.name;
    const time = document.createElement('time'); time.dateTime = event.at; time.textContent = event.localTime;
    row.append(name, time);
    return row;
  }));
  element('next').textContent = `Next: ${upcoming.name}, ${upcoming.localTime} (${upcoming.localDate})`;
  current = settings;
  return settings;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const settings = render();
    localStorage.setItem(preferenceKey, JSON.stringify(settings));
    report('Calculated on this device. Preferences saved only in this browser.');
  } catch (error) { report(`Could not save your prayer settings: ${errorMessage(error)}`); }
});
element('locate').addEventListener('click', () => {
  if (!navigator.geolocation) { report('Device location is unavailable. Enter coordinates manually.'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    field('latitude').value = position.coords.latitude.toFixed(3);
    field('longitude').value = position.coords.longitude.toFixed(3);
    report('Location filled, rounded to about 100 metres. Check the timezone and calculation method.');
  }, error => report(`Location unavailable: ${error.message}. Enter coordinates manually.`), { enableHighAccuracy: false, timeout: 10000 });
});
async function cloud(method: string, capability: string, settings?: Settings) {
  const response = await fetch('/api/v1/profile', {
    method,
    headers: { Authorization: `Bearer ${capability}`, ...(settings ? { 'Content-Type': 'application/json' } : {}) },
    body: settings ? JSON.stringify({ consent: true, settings }) : undefined,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String(body.error) : 'Cloud request failed.';
    throw new Error(message);
  }
  return body;
}
async function busy(id: string, action: () => Promise<void>) {
  const button = element<HTMLButtonElement>(id);
  button.disabled = true;
  try { await action(); } catch (error) { report(errorMessage(error)); } finally { button.disabled = false; }
}
element('connect').addEventListener('click', () => void busy('connect', async () => {
  if (!pairToken || !element<HTMLInputElement>('consent').checked) throw new Error('Read and select the cloud-storage consent before connecting.');
  // Check storage before activating; never imply a management key was saved if it was not.
  const probeKey = `${managementKey}.probe`;
  localStorage.setItem(probeKey, '0'.repeat(64));
  localStorage.removeItem(probeKey);
  const settings = render();
  const body = await cloud('PUT', pairToken, settings);
  if (!body || typeof body !== 'object' || !('manageToken' in body) || typeof body.manageToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.manageToken)) throw new Error('Unexpected connection response.');
  manageToken = body.manageToken;
  try { localStorage.setItem(managementKey, manageToken); }
  catch { report('Connected, but this browser could not save the management key. Keep this page open to disconnect; otherwise ask Alexa to connect again.'); element('manage-area').hidden = false; element('connect-area').hidden = true; return; }
  element('connect-area').hidden = true;
  element('manage-area').hidden = false;
  try { localStorage.setItem(preferenceKey, JSON.stringify(settings)); }
  catch { report('Alexa connected and the management key was saved, but local prayer preferences could not be saved. Cloud settings are active.'); return; }
  report('Alexa connected. Cloudflare now stores the settings you consented to. Ask Alexa for your next prayer.');
}));
element('update').addEventListener('click', () => void busy('update', async () => {
  if (!manageToken) throw new Error('No management key in this browser.');
  if (!window.confirm('Replace your cloud-stored Alexa prayer settings with the settings on this page?')) return;
  await cloud('PATCH', manageToken, render());
  report('Cloud settings updated.');
}));
element('delete').addEventListener('click', () => void busy('delete', async () => {
  if (!manageToken) throw new Error('No management key in this browser.');
  if (!window.confirm('Disconnect Alexa and delete your active cloud settings? Local browser preferences will remain.')) return;
  await cloud('DELETE', manageToken);
  manageToken = null;
  element('manage-area').hidden = true;
  try { localStorage.removeItem(managementKey); } catch { report('Cloud settings deleted. Browser key cleanup failed; clear this site’s storage manually.'); return; }
  report('Alexa disconnected and active cloud settings deleted. Local browser preferences were not removed.');
}));
if (field('latitude').value && field('longitude').value) {
  try { render(); } catch (error) { report(errorMessage(error)); }
}
// Refresh after local midnight and as prayers pass; no background audio is attempted.
setInterval(() => {
  if (!current) return;
  try { render(); } catch (error) { report(errorMessage(error)); }
}, 60_000);
