import { extractRajasthanLocation, districtCoordinates } from "./rajasthan-location";
import { verifyRainVisualWithOpenAI } from "./rain-ai-verifier";
import { extractExplicitEventDate, runRainEvidencePipeline, type InstagramCandidateInput } from "./rain-pipeline";

export type WorkerReelInput = {
  external_post_id: string;
  source_url: string;
  posted_at?: string | null;
  caption_text?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  username?: string | null;
};

function repostSignal(text: string | null | undefined): boolean {
  const value = (text ?? "").toLowerCase();
  return ["repost", "reposted", "credit to", "credits:", "via ", "old video", "पुराना वीडियो", "साभार"].some((term) => value.includes(term));
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

async function hashRemoteImage(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function findDuplicateEvidence(supabaseUrl: string, serviceRoleKey: string, contentHash: string) {
  const url = new URL(supabaseUrl + "/rest/v1/instagram_rain_evidence");
  url.searchParams.set("select", "id,duplicate_group_id");
  url.searchParams.set("content_hash", "eq." + contentHash);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ id?: string; duplicate_group_id?: string | null }>;
  return rows[0]?.id ? { id: rows[0].id, duplicate_group_id: rows[0].duplicate_group_id ?? null } : null;
}

async function insertEvidence(
  supabaseUrl: string,
  serviceRoleKey: string,
  input: InstagramCandidateInput,
  pipeline: { rain_observed: boolean; verification_status: "pending" | "uncertain" | "rejected" | "verified"; confidence: number; rejection_reason: string | null },
  contentHash: string | null,
  duplicateGroupId: string | null,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/instagram_rain_evidence?on_conflict=source_url`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
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
      duplicate_group_id: duplicateGroupId,
      content_hash: contentHash,
      verification_status: pipeline.verification_status,
      confidence: pipeline.confidence,
      rejection_reason: pipeline.rejection_reason,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase evidence insert failed (${response.status}): ${await response.text()}`);
}

async function syncVerifiedObservations(supabaseUrl: string, serviceRoleKey: string): Promise<number> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_verified_instagram_observations`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Public observation sync failed (${response.status}): ${await response.text()}`);
  const value = await response.json();
  return typeof value === "number" ? value : 0;
}

export async function runWorkerReelIngestion(items: WorkerReelInput[]) {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }

  let inserted = 0;
  let verified = 0;
  let uncertain = 0;
  let rejected = 0;
  let aiChecked = 0;
  let aiConfirmed = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item.external_post_id || !item.source_url) continue;

    try {
      let visualAnalysis: string | null = null;
      let rainObservedOverride = false;

      try {
        const ai = await verifyRainVisualWithOpenAI({
          imageUrl: item.thumbnail_url ?? item.media_url,
          caption: item.caption_text,
        });
        if (ai) {
          aiChecked++;
          visualAnalysis = ai.visual_analysis;
          rainObservedOverride = ai.rain_observed && ai.confidence >= 0.75;
          if (rainObservedOverride) aiConfirmed++;
        }
      } catch (error) {
        errors.push(`AI ${item.external_post_id}: ${error instanceof Error ? error.message : String(error)}`);
      }

      const candidate = enrichCandidate({
        source_url: item.source_url,
        external_post_id: item.external_post_id,
        posted_at: item.posted_at,
        event_date: extractExplicitEventDate(item.caption_text),
        caption_text: item.caption_text,
        visual_analysis: visualAnalysis,
        original_or_repost: repostSignal(item.caption) ? "repost" : "unknown",
        location_evidence: null,
      });

      const contentHash = await hashRemoteImage(item.thumbnail_url ?? item.media_url);
      const duplicate = contentHash ? await findDuplicateEvidence(supabaseUrl, serviceRoleKey, contentHash) : null;
      if (duplicate) candidate.original_or_repost = "repost";

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

      if (effectivePipeline.verification_status === "verified") verified++;
      else if (effectivePipeline.verification_status === "uncertain") uncertain++;
      else if (effectivePipeline.verification_status === "rejected") rejected++;

      await insertEvidence(
        supabaseUrl,
        serviceRoleKey,
        candidate,
        effectivePipeline,
        contentHash,
        duplicate?.duplicate_group_id ?? duplicate?.id ?? null,
      );
      inserted++;
    } catch (error) {
      errors.push(`${item.external_post_id}: ${error instanceof Error ? error.message : String(error)}`);
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
    received: items.length,
    inserted,
    verified,
    uncertain,
    rejected,
    ai_checked: aiChecked,
    ai_confirmed: aiConfirmed,
    synced_public_observations: syncedPublicObservations,
    errors,
  };
}
