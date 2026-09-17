import type { PublicRainPoint, RainEvidence, RainStatus } from "./types";

const MIN_CONFIDENCE = 0.5;

function statusFor(evidence: RainEvidence): RainStatus {
  // An event_time means when the rain event happened, not that it is raining
  // at this exact second. Keep observed rain distinct from forecast rain.
  if (evidence.rain_observed) return "recent_rain";

  if (["possible", "likely", "high"].includes(evidence.forecast_status)) {
    return "forecast";
  }

  return "dry";
}

function isPlottable(e: RainEvidence): boolean {
  return (
    typeof e.latitude === "number" &&
    typeof e.longitude === "number" &&
    Number.isFinite(e.latitude) &&
    Number.isFinite(e.longitude) &&
    e.latitude >= 23 &&
    e.latitude <= 30.5 &&
    e.longitude >= 69 &&
    e.longitude <= 78.5
  );
}

/**
 * Converts internal evidence into the minimal public map shape.
 * Source URLs, confidence, verification state and other internal fields are
 * deliberately removed before data reaches the public UI.
 */
export function toPublicPoints(evidence: RainEvidence[]): PublicRainPoint[] {
  return evidence
    .filter(
      (e) =>
        e.verification_status === "verified" &&
        (e.confidence ?? 1) >= MIN_CONFIDENCE &&
        isPlottable(e),
    )
    .map((e) => ({
      id: e.id,
      place: e.place,
      district: e.district,
      latitude: e.latitude,
      longitude: e.longitude,
      status: statusFor(e),
    }))
    .filter((point) => point.status !== "dry");
}
