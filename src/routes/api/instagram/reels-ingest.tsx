import { createFileRoute } from "@tanstack/react-router";
import { extractRajasthanLocation, districtCoordinates } from "@/lib/instagram/rajasthan-location";
import { verifyRainVisualWithOpenAI } from "@/lib/instagram/rain-ai-verifier";
import { extractExplicitEventDate, runRainEvidencePipeline, type InstagramCandidateInput } from "@/lib/instagram/rain-pipeline";

const WORKER_DEVICE_ID = "rajasthan-rain-worker-01";
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeHmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

type ReelsWorkerMedia = {
  external_post_id: string;
  source_url: string;
  posted_at: string | null;
  caption_text: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  username: string | null;
};

async function hashRemoteImage(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

async function findDuplicate(supabaseUrl: string, key: string, hash: string) {
  const url = new URL(supabaseUrl + "/rest/v1/instagram_rain_evidence");
  url.searchParams.set("select", "id,duplicate_group_id");
  url.searchParams.set("content_hash", "eq." + hash);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { apikey: key, Authorization: "Bearer " + key }, cache: "no-store" });
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ id?: string; duplicate_group_id?: string | null }>;
  return rows[0]?.id ? rows[0] : null;
}

function repostSignal(text: string | null) {
  const value = (text ?? "").toLowerCase();
  return ["repost", "reposted", "credit to", "credits:", "via ", "old video", "पुराना वीडियो", "साभार"].some((term) => value.includes(term));
}

export const Route = createFileRoute("/api/instagram/reels-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Trim only surrounding whitespace. This prevents an accidental newline/space
        // in either deployment environment from producing a false HMAC mismatch.
        const expectedSecret = (process.env["REELS_WORKER_SECRET"] ?? process.env["CRON_SECRET"] ?? "").trim();
        const deviceId = request.headers.get("x-device-id");
        const timestampHeader = request.headers.get("x-timestamp");
        const signature = request.headers.get("x-signature");

        if (!expectedSecret) {
          console.error("Reels HMAC auth failed: server secret is missing");
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        if (deviceId !== WORKER_DEVICE_ID) {
          console.error("Reels HMAC auth failed: invalid device id");
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        if (!timestampHeader || !signature) {
          console.error("Reels HMAC auth failed: missing timestamp or signature");
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }

        const timestamp = Number(timestampHeader);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
          return new Response(JSON.stringify({ ok: false, error: "Request timestamp expired" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }

        const bodyText = await request.text();
        const expectedSignature = await makeHmac(expectedSecret, timestampHeader + "\n" + bodyText);
        if (!constantTimeEqual(signature, expectedSignature)) {
          console.error("Reels HMAC auth failed: invalid signature");
          return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }

        try {
          const body = JSON.parse(bodyText) as { media?: ReelsWorkerMedia[] };
          const media = Array.isArray(body.media) ? body.media.slice(0, 25) : [];
          const supabaseUrl = process.env["SUPABASE_URL"];
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is missing.");

          let recent = 0, processed = 0, aiChecked = 0, aiConfirmed = 0, verified = 0, uncertain = 0, rejected = 0, inserted = 0;
          for (const item of media) {
            const posted = item.posted_at ? Date.parse(item.posted_at) : NaN;
            if (!Number.isFinite(posted) || Date.now() - posted < 0 || Date.now() - posted > 24 * 60 * 60 * 1000) continue;
            recent++;
            if (!item.source_url || !item.external_post_id) continue;
            processed++;

            let visualAnalysis: string | null = null;
            let rainObservedOverride = false;
            try {
              const ai = await verifyRainVisualWithOpenAI({ imageUrl: item.thumbnail_url ?? null, caption: item.caption_text });
              if (ai) { aiChecked++; visualAnalysis = ai.visual_analysis; rainObservedOverride = ai.rain_observed && ai.confidence >= 0.75; if (rainObservedOverride) aiConfirmed++; }
            } catch (error) { console.error("Reels worker AI verification failed", error); }

            const location = extractRajasthanLocation({ caption_text: item.caption_text, speech_text: null, location_evidence: item.username ? `instagram_user:${item.username}` : null });
            const coords = districtCoordinates(location.district);
            const candidate: InstagramCandidateInput = {
              source_url: item.source_url, external_post_id: item.external_post_id, posted_at: item.posted_at,
              event_date: extractExplicitEventDate(item.caption_text), caption_text: item.caption_text, visual_analysis: visualAnalysis,
              original_or_repost: repostSignal(item.caption_text) ? "repost" : "unknown",
              place: location.place, district: location.district, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
              location_evidence: location.evidence ?? (item.username ? `instagram_user:${item.username}` : null),
            };
            const contentHash = await hashRemoteImage(item.thumbnail_url);
            const duplicate = contentHash ? await findDuplicate(supabaseUrl, serviceRoleKey, contentHash) : null;
            if (duplicate) candidate.original_or_repost = "repost";

            const pipeline = runRainEvidencePipeline(candidate);
            const effective = rainObservedOverride && pipeline.decision !== "rejected"
              ? { ...pipeline, rain_observed: true, verification_status: pipeline.decision === "candidate" && pipeline.reasons.includes("rajasthan_location_verified") && candidate.original_or_repost !== "repost" ? "verified" as const : pipeline.verification_status, confidence: Math.max(pipeline.confidence, 0.75) }
              : pipeline;

            const response = await fetch(supabaseUrl + "/rest/v1/instagram_rain_evidence?on_conflict=source_url", {
              method: "POST",
              headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({
                platform: "instagram", external_post_id: candidate.external_post_id, source_url: candidate.source_url,
                posted_at: candidate.posted_at, event_date: candidate.event_date, place: candidate.place, district: candidate.district,
                latitude: candidate.latitude, longitude: candidate.longitude, caption_text: candidate.caption_text, visual_analysis: candidate.visual_analysis,
                location_evidence: candidate.location_evidence, rain_observed: effective.rain_observed, original_or_repost: candidate.original_or_repost,
                duplicate_group_id: duplicate?.duplicate_group_id ?? duplicate?.id ?? null, content_hash: contentHash,
                verification_status: effective.verification_status, confidence: effective.confidence, rejection_reason: effective.rejection_reason, updated_at: new Date().toISOString(),
              }),
            });
            if (!response.ok) { rejected++; console.error("Reels evidence insert failed", await response.text()); continue; }
            inserted++;
            if (effective.verification_status === "verified") verified++; else if (effective.verification_status === "uncertain") uncertain++; else rejected++;
          }

          let synced = 0;
          if (inserted > 0) {
            const response = await fetch(supabaseUrl + "/rest/v1/rpc/sync_verified_instagram_observations", { method: "POST", headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey, "Content-Type": "application/json" }, body: "{}" });
            if (response.ok) synced = Number(await response.json()) || 0;
          }
          return new Response(JSON.stringify({ ok: true, received: media.length, recent_24h: recent, processed, ai_checked: aiChecked, ai_confirmed: aiConfirmed, verified, uncertain, rejected, inserted, synced_public_observations: synced }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        } catch (error) {
          return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Invalid request" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
      },
    },
  },
});
