# Android / Termux quick start

This worker needs a real Chromium browser profile. Termux is only the launcher; Chromium must be available through a compatible Android GUI setup such as Termux:X11.

1. Install Termux + Termux:X11 from trusted official sources.
2. In Termux, install git, golang and the Chromium/X11 packages available for your setup.
3. Clone this repository and enter reels-worker/.
4. Set the three server variables and INSTAGRAM_HEADLESS=false.
5. Run: go mod tidy && go run .
6. The first run opens Chromium. Log into Instagram manually in that profile, then open /reels/.
7. Keep the Reels feed active. The worker passively captures feed GraphQL responses and sends candidates to the server.

Security: never put an Instagram password or OTP in environment variables or source code. The worker only uses the browser session you create manually.

If Android Chromium cannot launch, use the same worker on an always-on Linux machine/VPS with the persistent instagram-profile directory mounted.
