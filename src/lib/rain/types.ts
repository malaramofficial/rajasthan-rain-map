/**
 * Core data model for Rajasthan Rain Map.
 *
 * RainEvidence mirrors the Supabase table `public.rain_observations` and is
 * internal pipeline data. PublicRainPoint is the only shape rendered on the
 * public map.
 */

export type RainStatus = "raining" | "recent_rain" | "forecast" | "dry";

/** Must match the Supabase CHECK constraint. */
export type ForecastStatus = "none" | "possible" | "likely" | "high";

/** Must match the Supabase CHECK constraint. */
export type SourceType = "instagram" | "weather" | "manual" | "other";

export type OriginalOrRepost = "original" | "repost" | "unknown";

/** Must match the Supabase CHECK constraint. */
export type VerificationStatus = "verified" | "pending" | "rejected" | "uncertain";

/** Internal evidence record — never expose publicly. */
export interface RainEvidence {
  id: string;
  observation_date: string;
  event_time: string | null;
  place: string;
  district: string;
  latitude: number;
  longitude: number;
  rain_observed: boolean;
  forecast_status: ForecastStatus;
  confidence: number;
  source_url: string | null;
  source_type: SourceType;
  original_or_repost: OriginalOrRepost;
  verification_status: VerificationStatus;
}

/** Only safe fields allowed to reach the public map. */
export interface PublicRainPoint {
  id: string;
  place: string;
  district: string;
  latitude: number;
  longitude: number;
  status: RainStatus;
}

export type SnapshotState = "ok" | "empty" | "error";

export interface PublicRainSnapshot {
  observation_date: string;
  updated_at: string;
  points: PublicRainPoint[];
  state: SnapshotState;
}
