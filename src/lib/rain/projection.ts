import type { PublicRainPoint, RainEvidence, RainStatus } from "./types";

const MIN_CONFIDENCE = 0.5;

function statusFor(evidence: RainEvidence): RainStatus {
  if (evidence.rain_observed) {
    return evidence.event_time ? "raining" : "recent_rain";
  }
  if (evidence.forecast_status === "rain_expected") return "forecast";
  return "dry";
}

/**
 * Strips every internal field (source_url, verification_status, confidence...)
 * and keeps only what the public map renders. Rejected or low-confidence
 * evidence never reaches the public layer.
 */
export function toPublicPoints(evidence: RainEvidence[]): PublicRainPoint[] {
  return evidence
    .filter(
      (e) => e.verification_status !== "rejected" && e.confidence >= MIN_CONFIDENCE,
    )
    .map((e) => ({
      id: e.id,
      place: e.place,
      district: e.district,
      latitude: e.latitude,
      longitude: e.longitude,
      status: statusFor(e),
    }));
}
