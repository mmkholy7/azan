# Cloudflare and GitHub setup

This is an owner-operated checklist, not evidence of a successful production deployment. The existing Cloudflare Worker and D1 database are both named `azan`. Do not enter credentials into chat or commit them. Local setup does not provision cloud services.

## Hosting choice

Cloudflare Workers hosts the companion assets, API, and optional D1 settings store. GitHub hosts the code and CI, not a continuously running scheduler. No Mac mini is needed. Render and Vercel can host web code, but this initial backend is deliberately implemented for Cloudflare D1/Workers and would need an adapter for other hosts.

Alexa has an additional small **official AWS Lambda endpoint**. Amazon's Lambda invocation permissions validate the source, so this avoids implementing certificate-chain/signature verification on Workers. This is serverless, not a home server. A Cloudflare-only Alexa HTTP endpoint is possible in principle, but is **not implemented** here; never expose this Lambda handler as an unauthenticated HTTP function. Lambda is not an automatic-playback workaround.

## 1. Local preparation

```sh
npm ci
npm run check
npm run db:local
npm run dev
```

Open `http://localhost:8787`. `npm run dev` pins this port and overrides the production `PUBLIC_ORIGIN` for local connection links and same-origin writes. Use that script rather than bare `wrangler dev`, which would retain the production origin. `db:local` and `dev` use local D1 storage, not the remote database. A timezone is initially suggested from the browser, but must be checked against the selected location. Location is rounded to three decimal places by the optional device-location button. Manual coordinates are accepted as entered.

For local bridge experiments, copy `.dev.vars.example` to `.dev.vars` and populate its two values with separate cryptographically random secrets of at least 32 characters. Keep that file private. The automated test fixtures use public test-only keys in isolated, ephemeral D1; they are not production credentials.

## 2. Cloudflare deployment (requires owner's approval and account)

The tracked `wrangler.jsonc` targets the GitHub-connected Worker `azan`, with exactly one `DB` binding to the existing D1 database `azan` (`df291c5d-1cad-4a05-8959-f6e2b5001949`) and the existing `migrations` directory. Do not create a replacement database or append a second `DB` binding to fix a deployment. Database IDs are resource identifiers, not credentials.

The intended production origin is `https://azan.melkhouly.workers.dev`, without a trailing slash or path. The route was disabled when this fix was prepared; `workers_dev: true` explicitly requests enabling it on the next approved deploy. Editing this file alone does not enable the live route. If choosing a custom domain later, configure its routing and update `PUBLIC_ORIGIN` and Lambda `API_ORIGIN` together.

After the owner approves cloud changes, sign in to Wrangler and verify the intended account and existing database. For a different account only, create its database with `npx wrangler d1 create azan` and replace the single binding's ID with that account's ID.

The optional Alexa bridge requires two **different** random secrets, at least 32 characters long. `BRIDGE_SECRET` authenticates only the Lambda bridge. `IDENTITY_SECRET` HMAC-pseudonymizes Alexa IDs and remains only on Cloudflare. Check whether they are already configured; do not overwrite existing secrets as part of this configuration fix. If absent, install them only with owner approval through interactive secret prompts, never command-line literal values or committed variables:

```sh
npx wrangler secret put BRIDGE_SECRET
npx wrangler secret put IDENTITY_SECRET
```

With separate approval to apply remote migrations and deploy:

```sh
npx wrangler d1 migrations apply azan --remote
npm run deploy
```

The final two commands change cloud resources; run only after confirming the intended account/database/environment. No cron triggers are configured. The health endpoint is `/api/v1/health`, reporting `automaticPlayback: "not-implemented"`; it is a liveness endpoint, not a database or Amazon readiness check.

D1 is only required by the optional Alexa connection. Browser-local calculations need only static assets and use no API. Before publishing, add account-appropriate Cloudflare rate limits to `/api/*`, particularly `/api/v1/alexa/connect`, and configure budget/usage alerts. There is a 4 KiB streamed JSON-body limit, but no claim of application-level abuse throttling in this initial version. Secret-bearing endpoints are not accessible through browser CORS.

## 3. Official Alexa development skill

1. In the Alexa developer console, create a **custom** skill, `en-US`, with your own backend. Import `alexa/interaction-model.en-US.json` in the JSON interaction-model editor. Build the model. Enable the **Audio Player** interface if testing audio. No account-linking OAuth or address permission is requested.
2. In AWS Lambda, create a Node.js 22 function in a supported Alexa region (for example `us-east-1`). Do not enable a Function URL. Grant only the normal execution/logging role needed by the function; it needs outbound HTTPS, not AWS database access.
3. Run `npm run build`. Zip **the contents** of `dist/lambda/` with `index.mjs` at the archive root and upload the zip. Set the handler to `index.handler`. The bundle has no runtime npm-install step. Use a timeout of at least 8 seconds; the bridge HTTP call times out after 4.5 seconds.
4. Add an **Alexa Skills Kit trigger**, enable **Skill ID verification**, and enter the exact development skill ID. Do not grant wildcard invocation to unrelated skills or make the function publicly invokable.
5. In Lambda environment variables, set `SKILL_ID`, `API_ORIGIN` (the exact HTTPS Cloudflare origin), and `BRIDGE_SECRET` (matching the Cloudflare secret). Use the AWS console's protected environment-variable mechanism, not a public config file. `IDENTITY_SECRET` is not given to Lambda.
6. Configure the skill's endpoint as this Lambda ARN, for every enabled Alexa region. Keep skill testing in Development, enable it for your own Amazon account in the Alexa app, and build/test the invocation model.
7. Test a launch request, connect request/card, next-prayer request, stop, and failure cases. Test the actual Alexa app card before assuming it can launch/copy the link conveniently.

Do not publicly distribute this development skill as if certified. Publishing requires Amazon's current certification, privacy-policy, availability, and skill-name review. Voice requests and displayed prayer answers go through Amazon; do not describe the Alexa feature as browser-only.

## 4. Adhan recording

No recording is bundled or fetched from an unofficial source. Choose a recording you own, commissioned, or have a license for that explicitly allows hosting and Alexa playback; record attribution/license terms in your release notes. Fajr-specific audio is not implemented; this version has one recording.

Host it at a public HTTPS URL on port 443 with a valid certificate, no credentials, and no short-lived access token. Set Lambda `ADHAN_AUDIO_URL` to that URL. Amazon currently documents supported AAC/MP4, MP3, PLS, M3U/M3U8 and HLS formats and 16-384 KB/s bit rates. Validate codec/headers/range handling with a real device; URL validation alone does not establish playable audio. Test `AudioPlayer.PlaybackFailed` logs, pause/stop, and the documented restart-on-resume behavior.

Do not use the cloud profile as consent for unexpected scheduled audio. This release only returns audio in response to a user request (or a user-configured routine invoking that request where Amazon/device support allows it).

## 5. GitHub

`.github/workflows/ci.yml` runs type-checks, tests, builds and a Wrangler **dry run** on pushes and pull requests. That workflow does not deploy. Separately, Cloudflare Workers Builds is connected to this repository's production branch for Worker `azan`; pushing or merging to that branch may automatically deploy. Do not push or merge this configuration fix until the owner explicitly approves that production change. The Lambda bundle is uploaded as a build artifact, not published as a skill. Do not commit generated bundles.

Release flow: review the configuration diff and run CI plus `npx wrangler deploy --dry-run --outdir dist/worker`. Confirm Cloudflare Workers Builds uses this repository, the intended production branch, and Worker `azan`. With owner approval, check/apply D1 migrations before publishing code that needs them, then either update the connected production branch to trigger Cloudflare's deployment or use the separately approved manual deployment above. Do not unintentionally run both release paths. After deployment, verify the `workers.dev` route is enabled, visit `https://azan.melkhouly.workers.dev` and `/api/v1/health`, and confirm the deployed version has the single `DB` binding and correct origin. Health alone does not prove D1 readiness; exercise the optional connection flow after its secrets and schema are ready. Upload the Lambda bundle and test the same version on a development Echo when configuring Alexa. Do not expose secrets to forks or assume GitHub Actions scheduled jobs provide prayer-time precision.

## Data, recovery, and rollback

- Local preferences and the cloud management token use separate `localStorage` keys, unencrypted, on the **companion origin**, not Janat. Clearing browser data loses them. Do not share browser profiles or connection URLs.
- One-time pairing tokens have 256 bits of randomness; only SHA-256 hashes are stored. They expire after ten minutes, are consumed atomically, and are replaced when Alexa issues another. Expired pending rows are physically pruned on the next pairing request (not a guaranteed timed deletion). Active cloud profiles remain until explicitly disconnected.
- Cloudflare stores the opted-in settings in plaintext D1, not end-to-end encryption. HMAC identifiers are pseudonymous, not anonymous. D1/provider backups may retain deleted data according to provider policy; Amazon history is separately controlled in the Alexa app. Assess hosting/data-processing obligations before public launch.
- Reconnect from the same Alexa account to replace a lost browser management key. Merely requesting a new link does not change an existing connected profile; consuming it with consent rotates/revokes the old management key.
- Disconnect deletes the active D1 row and disables next-prayer lookup immediately. Clearing local browser data does **not** disconnect Alexa. Disabling the skill alone does not automatically delete D1 in this initial version; disconnect first or reconnect later to delete. Lifecycle deletion callbacks remain future work.
- Rotating `BRIDGE_SECRET` requires changing Cloudflare and Lambda together. Rotating `IDENTITY_SECRET` breaks lookup of existing profiles: plan deletion/migration and user reconnection first, rather than silently orphaning location data.
- For rollback, retain the previous Worker version and Lambda zip. Use Cloudflare's version rollback and Lambda versions/aliases. This migration is additive; do not drop the production database as a rollback shortcut.

## Acceptance before real use

Check local-only mode sends no location requests; validate your location, timezone and mosque timetable; exercise opt-in, expiry, replay, export/readback, update and deletion; test the actual Alexa app and Echo; verify authorized audio and source authentication. Public release additionally requires rate controls, retention policy review, certification, and a project license. Automatic delivery additionally requires all [Amazon gates](ALEXA.md).

## Moving work into Documents

This fix is prepared in an isolated worktree, not the `~/Documents/azan` checkout. The original implementation is already merged. The Documents copy has uncommitted changes, including another D1 binding with the real ID; do not overwrite or automatically reset it. After approval, the owner should inspect and preserve those changes, integrate the approved configuration commit, then resolve the configuration to exactly one `DB` binding with the ID above and `migrations_dir: "migrations"`. Preserve unrelated edits and private `.dev.vars`. Do not copy `node_modules`, local D1 state, or generated bundles. Run `npm ci`, `npm run check`, `npm run db:local`, and `npm run dev` there and confirm local links use localhost. Integrating a local copy is not permission to push the production branch or deploy.
