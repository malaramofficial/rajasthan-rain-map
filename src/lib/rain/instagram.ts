export const INSTAGRAM_EVIDENCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface InstagramRainCandidate {
  source_url: string;
  posted_at: string | null;
  event_date: string | null;
  event_time: string | null;
  place: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  caption_text?: string | null;
  speech_text?: string | null;
  visual_analysis?: string | null;
  location_evidence?: string | null;
  rain_observed: boolean;
  original_or_repost: "original" | "repost" | "unknown";
  duplicate_group_id?: string | null;
}

export interface InstagramEvidenceDecision {
  eligible: boolean;
  reason:
    | "missing_posted_at"
    | "future_post"
    | "older_than_24h"
    | "within_24h";
}

/**
 * A Reel can enter the rain-evidence pipeline only when Instagram says it was
 * posted within the previous 24 hours. A recent upload is only eligibility;
 * it is NOT proof that the rain itself happened recently.
 */
export function checkInstagramEvidenceWindow(
  postedAt: string | null,
  referenceTime = new Date(),
): InstagramEvidenceDecision {
  if (!postedAt) {
    return { eligible: false, reason: "missing_posted_at" };
  }

  const postedMs = Date.parse(postedAt);
  const referenceMs = referenceTime.getTime();

  if (!Number.isFinite(postedMs)) {
    return { eligible: false, reason: "missing_posted_at" };
  }

  if (postedMs > referenceMs) {
    return { eligible: false, reason: "future_post" };
  }

  return postedMs > referenceMs - INSTAGRAM_EVIDENCE_WINDOW_MS
    ? { eligible: true, reason: "within_24h" }
    : { eligible: false, reason: "older_than_24h" };
}

export function isRajasthanCoordinate(
  latitude: number | null,
  longitude: number | null,
): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 23 &&
    latitude <= 30.5 &&
    longitude >= 69 &&
    longitude <= 78.5
  );
}

/**
 * Final gate before writing an Instagram candidate into the public
 * rain_observations table. Old Reels, repost-only candidates, non-rain videos,
 * and candidates without usable Rajasthan coordinates are rejected here.
 */
export function canPublishInstagramObservation(
  candidate: InstagramRainCandidate,
  referenceTime = new Date(),
): boolean {
  const window = checkInstagramEvidenceWindow(candidate.posted_at, referenceTime);

  return (
    window.eligible &&
    candidate.rain_observed &&
    candidate.original_or_repost !== "repost" &&
    isRajasthanCoordinate(candidate.latitude, candidate.longitude)
  );
}
