# Janat integration boundary

Read-only inspection of `mmkholy7/janat` established that Janat uses TypeScript/Vite, localStorage preferences/logbook/Quran records, hash-based views (`home`, `calendar`, `logbook`, `quran`, `resources`), and a Cloudflare Worker routing `/api/calendar`. Its README and public site promise no account and browser-local personal activity. **That repository has not been modified.**

## Implemented in this repository

- Companion page links back to `https://janat.uably.com`.
- `src/prayers.ts` exports `settingsSchema`, `daySchedule`, `nextPrayer` and `localDate`; the companion bundles this same calculation code into the browser. No external prayer/geocoding provider is called.
- Browser preference shape:

```json
{
  "latitude": 30.044,
  "longitude": 31.236,
  "timeZone": "Africa/Cairo",
  "method": "Egyptian",
  "madhab": "standard"
}
```

Methods: `MuslimWorldLeague`, `NorthAmerica`, `Egyptian`, `UmmAlQura`, `Karachi`, `Dubai`. Madhab: `standard` or `hanafi`. A valid IANA timezone is required. Values are validated strictly; unknown fields are rejected, including accidental fasting/Quran records. Dates are Gregorian `YYYY-MM-DD` between 2000 and 2100. Invalid polar calculations return a clear unavailable error.

Browser keys on the **companion origin** are `janat.azan.local.v1` (settings) and `janat.azan.connection.v1` (secret management capability). Existing Janat keys remain untouched. No cross-origin localStorage sharing, account identity, postMessage token exchange or Janat endpoint is assumed.

## HTTP contract v1

All responses use `Cache-Control: no-store`; errors are JSON `{ "error": "..." }`, with safe validation issues where appropriate. There are no cookies or permissive CORS headers. Browser cloud operations are intentionally **same-origin on the companion**; do not give Janat the bridge secret.

| Endpoint | Authentication | Body / response |
|---|---|---|
| `GET /api/v1/health` | None | `{status:"ok", version:1, automaticPlayback:"not-implemented"}`; liveness only |
| `POST /api/v1/prayers` | None | `{settings, date?}` returns date, timezone, method, madhab, high-latitude rule, five `{id,name,at,localTime,localDate}` events. Coordinates are processed transiently, not written to D1. For a privacy-first Janat page, use browser computation instead. |
| `POST /api/v1/alexa/connect` | Server-only bridge Bearer secret | `{userId}` returns `{connectUrl,expiresInSeconds:600}`. The URL is the companion origin plus `/#connect=<256-bit token>`. A pending keyed pseudonymous identifier is stored; no location yet. |
| `POST /api/v1/alexa/next` | Server-only bridge Bearer secret | `{userId}` returns `{id,name,at,localTime,localDate,timeZone,method}` for the next prayer, or `409` if unconnected. Raw user ID is HMACed in transit processing and is not stored. |
| `PUT /api/v1/profile` | Bearer **one-time pairing token** | `{consent:true, settings}` consumes the token atomically; returns `201 {settings,manageToken}`. Replay/expiry returns `401`. |
| `GET /api/v1/profile` | Bearer management token | `{settings}`; can be used to export/read the active settings. |
| `PATCH /api/v1/profile` | Bearer management token | `{consent:true, settings}` replaces opted-in settings; returns `{settings}`. |
| `DELETE /api/v1/profile` | Bearer management token | Deletes the active connection row; returns `{deleted:true}`. Repeated deletion returns `401`, not a fabricated success. |

Use `Content-Type: application/json` for bodies, maximum 4 KiB. No token belongs in a query string. A link fragment does not travel in the HTTP request; the client immediately strips it from browser history and holds it in memory until consent. Links can still be copied/screenshotted by the user or visible to Amazon in the skill card, so treat them as sensitive.

The calculation `id` is deterministic **per profile/local date**, not a delivery receipt or globally unique scheduled-event ID. Instants (`at`) are UTC ISO-8601; render them with the supplied IANA timezone, never a fixed offset. `localDate` is the event's rendered date; the date used for astronomical calculation is the response `date`. Wrong location/timezone pairings cannot be detected automatically; ask the user to confirm them.

## Changes needed in the Janat repository, separately

1. **Smallest safe integration:** add an optional "Prayer times / Alexa" navigation/resource link to the deployed companion origin. Explain that Janat's fasting/Quran records remain local and that the separate Alexa connection stores only explicitly opted-in prayer settings. Deployment origin must be chosen first; do not hardcode a guessed live service.
2. **If a native Janat prayer view is wanted:** add a hash route such as `#prayer`, localized English/Arabic/French/Spanish copy and RTL support; add `adhan` and share the documented calculation contract (or extract an owner-licensed shared package once source licensing is chosen). Compute locally using explicit coordinates, IANA timezone, method and madhab. Geolocation must be a user action with manual fallback. Store a separate prayer preference key; do not upload existing app records.
3. Keep the **Alexa connection UI on the companion origin** for now. Janat should link to it, not iframe it, send browser records to it, or copy its bearer keys into Janat localStorage. The companion's CSP rejects framing. If one-origin integration is later desired, deliberately implement server routing/asset integration and review CSP/consent; no transparent proxy or CORS relaxation is currently supplied.
4. Preserve Janat's current calendar API, no-login paths, and "email is not connected" wording. Add distinct optional-cloud wording rather than replacing the general local-storage promise.
5. Add Janat tests for routing, no automatic coordinate upload, manual/geolocation permission failure, translations/RTL, cloud-consent wording and safe external links.

There is no new Janat account, shared-auth system, email collection, webhook, OAuth callback, or Janat production deployment in this initial implementation. The separate Janat work can start with the link-only change once the actual companion URL is approved and deployed.
