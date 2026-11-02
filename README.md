# Janat Azan

A simpler, Alexa-first adhan companion for [Janat](https://janat.uably.com). No Mac mini, always-on laptop, Voice Monkey, Amazon account cookies, or new Janat account.

**This is a working initial implementation, not a certified Alexa skill. Automatic prayer-time playback is not implemented.** The public companion test site is intended for `https://azan.melkhouly.workers.dev`; publishing the companion does not configure or certify Alexa. Amazon currently restricts custom routine triggers to a developer preview and requires a published skill. A Cloudflare cron cannot bypass those requirements.

## What works locally

- A responsive companion page calculates all five daily prayers **in the browser**, with no coordinate upload by default. Device location is optional; manual coordinates work too.
- Explicit IANA timezone, six calculation methods, Standard/Hanafi Asr, middle-of-the-night high-latitude adjustment, and explicit errors for unavailable polar events. Always compare with your local mosque.
- An optional Cloudflare D1 connection stores only coordinates, timezone, calculation settings, a keyed pseudonymous Alexa identifier, and hashed connection capabilities. It does not import Janat fasting/Quran records or require login.
- One-use, ten-minute Alexa-app connection links; profile read/update/deletion with a separate browser-held management key. Concurrent redemption cannot create two connections.
- A bundled AWS Lambda adapter answers "next prayer," returns a connection card to the **Alexa app**, and issues user-invoked AudioPlayer play/stop directives when an owner-supplied licensed recording is configured. Without audio it clearly says audio is unavailable.
- A stateless prayer API, automated tests using the real local Workers runtime/D1, and GitHub CI.

## Try it

Use Node.js **22.14 or newer** (Node 22 LTS is recommended).

```sh
npm ci
npm run check
npm run db:local
npm run dev
```

Open `http://localhost:8787`. Use device location or enter approximate coordinates and confirm the timezone. Click **Show my prayer times**. The coordinates and preferences stay in this browser; no calculation request is sent to the server. An internet connection is initially needed to load the page; this is not an offline-installed PWA.

`npm run build` produces `dist/web/` (companion assets) and `dist/lambda/index.mjs` (Alexa Lambda bundle). Worker deployment uses `src/worker.ts` through Wrangler. `npm run check` type-checks, runs unit/Workers integration tests, and builds both bundles. No real cloud credentials are needed for those checks.

The tracked configuration targets the existing production Worker `azan` and D1 database `azan`. `db:local` initializes only local Wrangler storage; `npm run dev` pins port 8787 and overrides `PUBLIC_ORIGIN` to `http://localhost:8787` so local connection links and same-origin writes stay local. No deployment occurs during `build`, `test`, `check`, or `dev`. Production deployment requires owner approval; see the [setup guide](docs/DEPLOYMENT.md).

## First Alexa experience after setup

1. Owner follows [deployment and setup](docs/DEPLOYMENT.md), configures a development skill, and enables it on their Amazon account.
2. User says **"Alexa, ask Janat Azan to connect."** Open its card in the Alexa app and copy the private link into a browser within ten minutes. Card/link handling must still be confirmed in the actual Alexa app; some clients may require copying rather than tapping.
3. Choose location/method, select the explicit cloud-storage consent, and connect. Then say **"Alexa, ask Janat Azan what is the next prayer."**
4. With authorized audio configured, say **"Alexa, ask Janat Azan to play adhan."** Pause/stop works; resume intentionally restarts the single recording rather than restoring an offset.

These are implemented request/response flows, tested locally with Alexa-shaped events. They have **not** been tested against a live Amazon skill, Alexa app, or Echo. English (`en-US`) is the initial interaction model; Arabic and other locales are not claimed.

## Integration and limits

- [Janat integration contract](docs/JANAT.md): exact endpoints, privacy boundary, and changes still required in the separate Janat repository.
- [Alexa capabilities and automatic-playback blockers](docs/ALEXA.md): official references, permission/certification gates, and a future idempotent-delivery plan.
- [Cloudflare/GitHub deployment](docs/DEPLOYMENT.md): owner-controlled setup, secrets, rollback, and real-device acceptance checklist.

Local checks and development commands do not push or deploy; production publishing uses the owner-approved release flow. A project source-code license has not yet been selected by the owner; public hosting does not grant a license. The `adhan` and `zod` dependencies are MIT-licensed; see their bundled licenses. No audio recording is included.
