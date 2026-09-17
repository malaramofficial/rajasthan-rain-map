/**
 * Core data model for Rajasthan Rain Map.
 *
 * `RainEvidence` is the INTERNAL (admin / pipeline) record. It is never sent to
 * the public map. A future backend pipeline (Supabase table `rain_evidence`)
 * will write rows in exactly this shape.
 *
 * `PublicRainPoint` is the sanitised projection that the public map consumes.
 */

export type RainStatus = "raining" | "recent_rain" | "forecast" | "dry";

export type ForecastStatus = "rain_expected" | "no_rain_expected" | "unknown";

export type SourceType = "social_post" | "weather_api" | "news" | "manual";

export type OriginalOrRepost = "original" | "repost" | "unknown";

export type VerificationStatus = "verified" | "pending" | "rejected";

/** Internal evidence record — admin/pipeline only. Never expose publicly. */
export interface RainEvidence {
  id: string;
  /** ISO date (YYYY-MM-DD) the observation belongs to. */
  observation_date: string;
  /** ISO datetime of the actual event, when known. */
  event_time: string | null;
  place: string;
  district: string;
  latitude: number;
  longitude: number;
  rain_observed: boolean;
  forecast_status: ForecastStatus;
  /** 0..1 */
  confidence: number;
  source_url: string | null;
  source_type: SourceType;
  original_or_repost: OriginalOrRepost;
  verification_status: VerificationStatus;
}

/** What the public full-screen map is allowed to know. */
export interface PublicRainPoint {
  id: string;
  place: string;
  district: string;
  latitude: number;
  longitude: number;
  status: RainStatus;
}

export interface PublicRainSnapshot {
  observation_date: string;
  /** ISO datetime the snapshot was generated. */
  updated_at: string;
  points: PublicRainPoint[];
}
