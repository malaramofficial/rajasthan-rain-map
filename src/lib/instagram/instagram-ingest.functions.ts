import { createServerFn } from "@tanstack/react-start";

import { extractRajasthanLocation, districtCoordinates } from "./rajasthan-location";
import { discoverHashtagMedia, type DiscoveredInstagramMedia } from "./instagram-discovery";
import { verifyRainVisualWithOpenAI } from "./rain-ai-verifier";
import { extractExplicitEventDate, runRainEvidencePipeline, type InstagramCandidateInput } from "./rain-pipeline";

type InstagramMedia = DiscoveredInstagramMedia;

function env(name: string): string | undefined { return process.env[name]; }

async function fetchOwnMedia(token: string): Promise<InstagramMedia[]> {
  const url = new URL("https://graph.instagram.com/me/media");
  url.searchParams.set("fields", "id,media_type,media_product_type,timestamp,permalink,caption,media_url,thumbnail_url");
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const payload = (await response.json()) as { data?: InstagramMedia[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Instagram media API returned ${response.status}.`);
  return payload.data ?? [];
}

async function loadStoredMetaConnection(supabaseUrl: string, serviceRoleKey: string): Promise<{ pageAccessToken: string; instagramUserId: string } | null> {
  const url = new URL(`${supabaseUrl}/rest/v1/instagram_meta_connections`);
  url.searchParams.set("select", "page_access_token,instagram_user_id");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Meta connection lookup failed (${response.status}): ${await response.text()}`);
  const rows = (await response.json()) as Array<{ page_access_token?: string; instagram_user_id?: string }>;
  const row = rows[0];
  return row?.page_access_token && row.instagram_user_id ? { pageAccessToken: row.page_access_token, instagramUserId: row.instagram_user_id } : null;
}

function isRecent24h(timestamp: string | null | undefined, now = Date.now()): boolean {
  if (!timestamp) return false;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && now - value >= 0 && now - value <= 24 * 60 * 60 * 1000;
}

function repostSignal(text: string | null | undefined): boolean {
  const value = (text ?? "").toLowerCase();
  return ["repost", "reposted", "credit to", "credits:", "via ", "old video", "पुराना वीडियो", "साभार"].some((term) => value.includes(term));
}

function enrichCandidate(candidate: InstagramCandidateInput): InstagramCandidateInput {
  const location = extractRajasthanLocation({ caption_text: candidate.caption_text, speech_text: candidate.speech_text, location_evidence: candidate.location_evidence });
  const district = candidate.district ?? location.district;
  const coords = districtCoordinates(district);
  return { ...candidate, place: candidate.place ?? location.place, district, latitude: candidate.latitude ?? coords?.latitude ?? null, longitude: candidate.longitude ?? coords?.longitude ?? null, location_evidence: candidate.location_evidence ?? location.evidence };
}

async function insertEvidence(supabaseUrl: string, serviceRoleKey: string, input: InstagramCandidateInput, pipeline: ReturnType<typeof runRainEvidencePipeline>) {
  const response = await fetch(`${supabaseUrl}/rest/v1/instagram_rain_evidence?on_conflict=source_url`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      platform: "instagram", external_post_id: input.external_post_id ?? null, source_url: input.source_url,
      posted_at: input.posted_at ?? null, event_date: input.event_date ?? null, event_time: input.event_time ?? null,
      place: input.place ?? null, district: input.district ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
      caption_text: input.caption_text ?? null, speech_text: input.speech_text ?? null, visual_analysis: input.visual_analysis ?? null,
      location_evidence: input.location_evidence ?? null, rain_observed: pipeline.rain_observed,
      original_or_repost: input.original_or_repost ?? "unknown", verification_status: pipeline.verification_status,
      confidence: pipeline.confidence, rejection_reason: pipeline.rejection_reason, updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase evidence insert failed (${response.status}): ${await response.text()}`);
}

async function syncVerifiedObservations(supabaseUrl: string, serviceRoleKey: string): Promise<number> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_verified_instagram_observations`, {
    method: "POST", headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" }, body: "{}",
  });
  if (!response.ok) throw new Error(`Public observation sync failed (${response.status}): ${await response.text()}`);
  const value = await response.json(); return typeof value === "number" ? value : 0;
}

export const runInstagramCandidateIngestion = createServerFn({ method: "GET" }).handler(async () => {
  const instagramToken = env("INSTAGRAM_ACCESS_TOKEN");
  const configuredFacebookToken = env("META_FACEBOOK_ACCESS_TOKEN");
  const configuredIgUserId = env("META_IG_USER_ID");
  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if ((!instagramToken && !configuredFacebookToken) || !supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: !supabaseUrl || !serviceRoleKey ? "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured on the server." : "No Instagram discovery token is configured on the server." };
  }

  let facebookToken = configuredFacebookToken;
  let igUserId = configuredIgUserId;
  if ((!facebookToken || !igUserId) && supabaseUrl && serviceRoleKey) {
    const stored = await loadStoredMetaConnection(supabaseUrl, serviceRoleKey);
    facebookToken ??= stored?.pageAccessToken;
    igUserId ??= stored?.instagramUserId;
  }

  let media: InstagramMedia[] = [];
  let discoveryMode: "facebook_hashtags" | "instagram_own_media" = "instagram_own_media";
  if (facebookToken && igUserId) { discoveryMode = "facebook_hashtags"; media = await discoverHashtagMedia(facebookToken, igUserId); }
  else if (instagramToken) media = await fetchOwnMedia(instagramToken);

  const recent = media.filter((item) => isRecent24h(item.timestamp)).sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? "")).slice(0, 40);
  let inserted = 0, candidates = 0, uncertain = 0, rejected = 0, aiChecked = 0, aiConfirmed = 0;
  const errors: string[] = [];

  for (const item of recent) {
    if (!item.permalink) continue;
    let visualAnalysis: string | null = null;
    let rainObservedOverride = false;
    try {
      const ai = await verifyRainVisualWithOpenAI({ imageUrl: item.thumbnail_url ?? item.media_url, caption: item.caption });
      if (ai) { aiChecked++; visualAnalysis = ai.visual_analysis; rainObservedOverride = ai.rain_observed && ai.confidence >= 0.75; if (rainObservedOverride) aiConfirmed++; }
    } catch (error) { errors.push(`AI ${item.id}: ${error instanceof Error ? error.message : String(error)}`); }

    const candidate = enrichCandidate({
      source_url: item.permalink, external_post_id: item.id, posted_at: item.timestamp, event_date: extractExplicitEventDate(item.caption), caption_text: item.caption,
      visual_analysis: visualAnalysis,
      original_or_repost: repostSignal(item.caption) ? "repost" : "unknown",
      location_evidence: item.discovery_hashtag ?? null,
    });
    const pipeline = runRainEvidencePipeline(candidate);
    const canAutoVerify =
      rainObservedOverride &&
      pipeline.decision !== "rejected" &&
      candidate.original_or_repost !== "repost" &&
      pipeline.reasons.includes("rajasthan_location_verified") &&
      !pipeline.reasons.includes("event_date_differs_from_post_date");

    const effectivePipeline = rainObservedOverride && pipeline.decision !== "rejected"
      ? {
          ...pipeline,
          decision: canAutoVerify ? "candidate" : pipeline.decision,
          rain_observed: true,
          verification_status: canAutoVerify ? "verified" : pipeline.verification_status,
          confidence: Math.max(pipeline.confidence, canAutoVerify ? 0.8 : 0.75),
          reasons: [...pipeline.reasons, "ai_visual_rain_confirmed", ...(canAutoVerify ? ["auto_verified_visual_rain"] : [])],
        }
      : pipeline;
    if (effectivePipeline.decision === "candidate") candidates++; else if (effectivePipeline.decision === "uncertain") uncertain++; else rejected++;
    try { await insertEvidence(supabaseUrl, serviceRoleKey, candidate, effectivePipeline); inserted++; }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }

  let syncedPublicObservations = 0;
  if (errors.length === 0) {
    try { syncedPublicObservations = await syncVerifiedObservations(supabaseUrl, serviceRoleKey); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { ok: errors.length === 0, discovery_mode: discoveryMode, media_seen: media.length, recent_24h: recent.length, processed: recent.filter((item) => Boolean(item.permalink)).length, ai_checked: aiChecked, ai_confirmed: aiConfirmed, candidates, uncertain, rejected, inserted, synced_public_observations: syncedPublicObservations, errors };
});
