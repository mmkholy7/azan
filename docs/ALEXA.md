# Alexa: implemented capabilities and real blockers

Official documentation checked on **2026-11-02 UTC**. Amazon's pages and availability can change; recheck before release.

## Implemented now, locally exercised only

The Lambda entrypoint accepts official Alexa event envelopes, checks the configured application ID and a 150-second timestamp window, and responds with normal Alexa JSON. **Source authentication relies on the AWS Lambda Alexa Skills Kit trigger restricted to this skill ID**, not these two additional checks alone. There is no unauthenticated HTTP Alexa endpoint.

Implemented: launch/next-prayer answer, connection card for the Alexa app, Help/fallback explanation, user-invoked `AudioPlayer.Play`, pause/stop, replay-on-resume, session/playback-event acknowledgement, and redacted playback-failure logging. Time answers use the connected location's timezone and include the date. Bridge failures and missing audio/location are reported honestly.

There is no device selection, multi-room playback, automatic invocation, offset persistence, Fajr-specific recording, Arabic interaction model, OAuth account linking, routine trigger definition, Amazon trigger token exchange, or out-of-session dispatcher. A request accepted by an API would not establish actual speaker playback.

## Why automatic prayer-time playback is not enabled

Amazon's [Steps to Create Custom Triggers for Routines](https://developer.amazon.com/en-US/docs/alexa/routines/get-started-custom-triggers-for-routines.html) explicitly requires:

- A **published Alexa skill**, including certification.
- **Permission to participate in the developer preview**, requested from Amazon.
- Registration of the trigger definition with Amazon, development testing, and production publication.
- For `UNICAST`, customer-specific `Routines.Trigger.Create` / `Routines.Trigger.Delete` callbacks and authenticated trigger delivery.
- A customer-created routine in the Alexa app.

Therefore "run a Cloudflare cron and make every Echo play" is not a generally available custom-skill capability. `AudioPlayer.Play` is returned within a skill interaction; it is not an unrestricted push-to-speaker API. Smart-home capabilities must represent real supported devices and are not fabricated doorbell triggers here.

Alternative reminders/notifications are different UX with their own permissions and policies, not guaranteed full adhan playback. A user may try a native Alexa scheduled routine with a custom skill action if supported in their locale/device, but fixed wall-clock routine times do not follow changing daily prayer times, and this service does not create or update such routines.

## Future scheduler design, only after approval

There is **no scheduler or delivery ledger in this release**. Daily calculation event IDs (`YYYY-MM-DD:prayer`) are deterministic within one settings profile but are not globally unique delivery IDs.

After Amazon grants permission and the end-to-end routine path is proven:

1. Add explicit scheduled-audio consent, chosen prayers, household timezone, routine subscriptions and deletion callbacks. Store only approved identifiers/secrets server-side. Do not infer this consent from the current on-demand connection.
2. Precompute due UTC instants from IANA-local dates, recomputing after location/method edits and across DST. Use Cloudflare Cron for a bounded scan plus Queues for work; cron delivery is not exact-second or hard-real-time.
3. Create a durable D1 outbox with a unique key including **connection ID + routine subscription ID + settings revision + local prayer date + prayer**. Atomically claim a row before dispatch; reuse the same provider idempotency identifier on retries if the approved API supports it.
4. Define late-delivery expiry, short retry windows, per-user concurrency, exponential backoff and explicit terminal failures. Recheck revocation/consent immediately before sending. Treat ambiguous network timeouts as uncertain, not delivered; without provider idempotency, do not claim exactly-once playback.
5. Test duplicate cron invocations, overlapping workers, retries/timeouts, DST gaps/folds, setting edits, disabled skills, routine deletion, late arrivals, polar dates and real device outcomes. A provider `202` means accepted, not audible playback.

Do not ship success-shaped delivery stubs while waiting for Amazon approval. The existing health endpoint deliberately states that automatic playback is unimplemented.

## Official sources

- [Custom routines triggers: prerequisites and publication](https://developer.amazon.com/en-US/docs/alexa/routines/get-started-custom-triggers-for-routines.html)
- [Routines trigger API reference](https://developer.amazon.com/en-US/docs/alexa/routines/routines-custom-trigger-api-reference.html)
- [Host a custom skill as an AWS Lambda function](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-an-aws-lambda-function.html): Lambda permissions authenticate the Alexa source.
- [Host a custom skill as a web service](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html): HTTPS signature/certificate verification would be required for a future non-Lambda endpoint.
- [AudioPlayer interface](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html)
- [Long-form audio](https://developer.amazon.com/en-US/docs/alexa/custom-skills/use-long-form-audio.html): interface configuration, formats, trusted HTTPS and device behavior.

No Amazon developer account, skill publication, preview permission, cloud account, device test, or audio rights have been obtained by this implementation.
