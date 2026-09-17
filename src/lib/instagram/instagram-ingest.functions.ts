import { createServerFn } from "@tanstack/react-start";

import { extractRajasthanLocation, districtCoordinates } from "./rajasthan-location";
import { runRainEvidencePipeline, type InstagramCandidateInput } from "./rain-pipeline";

type InstagramMedia = {
  id?: string;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  caption?: string;
};

function env(name: string): string | undefined {
  return process.env[name];
}

async function fetchOwnMedia(token: string): Promise<InstagramMedia[]> {
  const url = new URL("https://graph.instagram.com/me/media");
  url.searchParams.set(
    "fields",
    "id,media_type,media_product_type,timestamp,permalink,caption",
  );
  url.searchParams.set("limit", "50");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    data?: InstagramMedia[];
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Instagram media API returned ${response.status}.`);
  }

  return payload.data ?? [];
}

function enrichCandidate(candidate: InstagramCandidateInput): InstagramCandidateInput {
  const location = extractRajasthanLocation({
    caption_text: candidate.caption_text,
    speech_text: candidate.speech_text,
    location_evidence: candidate.location_evidence,
  });
  const district = candidate.district ?? location.district;
  const coords = districtCoordinates(district);

  return {
    ...candidate,
    place: candidate.place ?? location.place,
    district,
    latitude: candidate.latitude ?? coords?.latitude ?? null,
    longitude: candidate.longitude ?? coords?.longitude ?? null,
    location_evidence: candidate.location_evidence ?? location.evidence,
  };
}

async function insertEvidence(
  supabaseUrl: string,
  serviceRoleKey: string,
  input: InstagramCandidateInput,
  pipeline: ReturnType<typeof runRainEvidencePipeline>,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/instagram_rain_evidence?on_conflict=source_url`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      platform: "instagram",
      external_post_id: input.external_post_id ?? null,
      source_url: input.source_url,
      posted_at: input.posted_at ?? null,
      event_date: input.event_date ?? null,
      event_time: input.event_time ?? null,
      place: input.place ?? null,
      district: input.district ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      caption_text: input.caption_text ?? null,
      speech_text: input.speech_text ?? null,
      visual_analysis: input.visual_analysis ?? null,
      location_evidence: input.location_evidence ?? null,
      rain_observed: pipeline.rain_observed,
      original_or_repost: input.original_or_repost ?? "unknown",
      verification_status: pipeline.verification_status,
      confidence: pipeline.confidence,
      rejection_reason: pipeline.rejection_reason,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase evidence insert failed (${response.status}): ${body}`);
  }
}

async function syncVerifiedObservations(supabaseUrl: string, serviceRoleKey: string): Promise<number> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_verified_instagram_observations`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Public observation sync failed (${response.status}): ${body}`);
  }

  const value = await response.json();
  return typeof value === "number" ? value : 0;
}

export const runInstagramCandidateIngestion = createServerFn({ method: "GET" }).handler(
  async () => {
    const token = env("INSTAGRAM_ACCESS_TOKEN");
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!token) {
      return { ok: false, error: "INSTAGRAM_ACCESS_TOKEN is not configured." };
    }
    if (!supabaseUrl || !serviceRoleKey) {
      return {
        ok: false,
        error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured on the server.",
      };
    }

    const media = await fetchOwnMedia(token);
    const now = Date.now();
    const recent = media.filter((item) => {
      const timestamp = item.timestamp ? Date.parse(item.timestamp) : NaN;
      return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= 24 * 60 * 60 * 1000;
    });

    let inserted = 0;
    let candidates = 0;
    let uncertain = 0;
    let rejected = 0;
    const errors: string[] = [];

    for (const item of recent) {
      if (!item.permalink) continue;
      const candidate = enrichCandidate({
        source_url: item.permalink,
        external_post_id: item.id ?? null,
        posted_at: item.timestamp ?? null,
        caption_text: item.caption ?? null,
        original_or_repost: "original",
      });
      const pipeline = runRainEvidencePipeline(candidate);
      if (pipeline.decision === "candidate") candidates++;
      else if (pipeline.decision === "uncertain") uncertain++;
      else rejected++;

      try {
        await insertEvidence(supabaseUrl, serviceRoleKey, candidate, pipeline);
        inserted++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    let syncedPublicObservations = 0;
    if (errors.length === 0) {
      try {
        syncedPublicObservations = await syncVerifiedObservations(supabaseUrl, serviceRoleKey);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      ok: errors.length === 0,
      media_seen: media.length,
      recent_24h: recent.length,
      processed: recent.filter((item) => Boolean(item.permalink)).length,
      candidates,
      uncertain,
      rejected,
      inserted,
      synced_public_observations: syncedPublicObservations,
      errors,
    };
  },
);
