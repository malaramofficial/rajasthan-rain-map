# Rajasthan Rain Tracker

Build the first MVP of a mobile-first web app called “Rajasthan Rain Map”. Public user UI must be ONLY a full-screen Rajasthan map—no search history, no reels list, no technical details, no admin controls visible. The map should support district/place rain-status markers with a very clean, minimal visual style. For now use mock/sample evidence data for 17 September 2026 so the map can be tested, but architect the app for a future backend pipeline that ingests public social-media evidence and weather/rainfall data. Important data model concepts: observation_date, event_time, place, district, latitude, longitude, rain_observed, forecast_status, confidence, source_url, source_type, original_or_repost, verification_status. Separate public map UI from hidden/admin evidence data. Do not implement Instagram scraping or credential handling. Make the code production-ready, responsive on Android, and easy to connect to Supabase later. Include a small unobtrusive “Updated” timestamp on the map only.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://rajasthan-rain-map.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cf5d8bf1-8270-42af-8582-e2fa11b2e3f3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
