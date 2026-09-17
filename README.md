# Rajasthan Rain Map

Mobile-first Rajasthan rain observation map. The public UI is intentionally minimal: a full-screen Rajasthan map and a small updated timestamp. Evidence and automation remain server-side.

## Current pipeline

`Authorized Instagram API -> 24h posted-time filter -> rain evidence checks -> Rajasthan location extraction -> evidence database -> verification -> public observation sync -> map`

### Important verification rules

- `posted_at` is the Instagram publication time; it is **not** automatically treated as the rain event time.
- A Reel older than 24 hours is rejected by the ingestion pipeline.
- Explicit old/archive wording is rejected.
- Missing or conflicting event-date evidence stays `uncertain`.
- A Rajasthan place/district name is treated as a location clue; the current MVP maps it to a district-centre coordinate rather than pretending it is an exact GPS location.
- Reposts remain non-public until duplicate/repost review is completed.
- Only `verified` observations for the current India date can reach the public map.
- The evidence table is private; public map data contains no Reel URLs, captions, speech, or internal reasoning.

## Automation

Production exposes a protected `/api/instagram/scan` endpoint. Vercel Cron is configured in `vercel.json` to call it daily. The endpoint requires the standard Vercel `CRON_SECRET` authorization header.

The current authorized Instagram token is stored server-side as `INSTAGRAM_ACCESS_TOKEN`. It is never rendered into the browser.

## Discovery limitation

The current token has been validated and the account-media endpoint is available for the connected professional account. This does **not** by itself provide arbitrary public Instagram Reel/hashtag discovery. Public discovery must use an officially supported Meta API flow and permissions. The ingestion layer is deliberately separated from the verification layer so the discovery adapter can be replaced without rewriting the rain-verification logic.

## Database

Supabase stores two layers:

- `instagram_rain_evidence`: private ingestion/evidence queue.
- `rain_observations`: public-map projection. A secured database function syncs verified Instagram evidence into this table.

## Development

```sh
npm i
npm run build
```

The project uses TanStack Start, React, Leaflet, and Supabase JS.
