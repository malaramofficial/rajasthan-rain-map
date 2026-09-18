# Rajasthan Rain Map — Instagram Reels Worker

यह worker Instagram के खुले Reels feed को एक वास्तविक Chromium browser में passive तरीके से पढ़ता है और केवल Reel metadata को protected Rajasthan Rain Map ingest endpoint पर भेजता है।

## जरूरी बातें
- Instagram password/OTP को code में न डालें।
- अलग Instagram test/professional account/profile इस्तेमाल करना बेहतर है।
- Worker केवल feed capture करता है; like/comment/repost automation इस project में इस्तेमाल नहीं किया गया है।
- Meta Public Content Access approval के बिना arbitrary public hashtag discovery उपलब्ध नहीं है; इसलिए यह worker logged-in browser के Reels feed को fallback discovery source की तरह उपयोग करता है।
- Server 24-hour posting filter और rain/location verification दोबारा करता है।

## Environment

```
INSTAGRAM_CHROME_PROFILE=./instagram-profile
RAINS_MAP_INGEST_URL=https://rajasthan-rain-map.vercel.app/api/instagram/reels-ingest
REELS_WORKER_SECRET=<same secret configured on Vercel>
```

अगर Vercel पर अलग `REELS_WORKER_SECRET` नहीं है, तो server route अभी `CRON_SECRET` को fallback के रूप में स्वीकार करता है।

## Run

```
go mod tidy
go run .
```

Browser खुलेगा। उसमें Instagram login करें (यदि profile पहले से logged in नहीं है), फिर `/reels/` खोलकर feed चलने दें। Captured Reels server pipeline में जाएंगे।

## Data flow

Instagram browser → Reels GraphQL response capture → 24h filter → AI rain check → Rajasthan location extraction → event-date check → duplicate/repost check → Supabase evidence → verified public observation → map.
