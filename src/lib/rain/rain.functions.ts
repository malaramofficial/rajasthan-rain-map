import { createServerFn } from "@tanstack/react-start";

import { MOCK_EVIDENCE } from "./mock-evidence";
import { toPublicPoints } from "./projection";
import type { PublicRainSnapshot, RainEvidence } from "./types";

/** Today's date (YYYY-MM-DD) in India Standard Time. */
function todayInIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const SELECT_COLUMNS = [
  "id",
  "observation_date",
  "event_time",
  "place",
  "district",
  "latitude",
  "longitude",
  "rain_observed",
  "forecast_status",
  "confidence",
  "source_url",
  "source_type",
  "original_or_repost",
  "verification_status",
].join(", ");

/**
 * Public read for the full-screen map.
 *
 * Reads verified rows for today from `public.rain_observations` through the
 * publishable (anon) key, so row-level security still applies. Until the
 * Supabase project is linked, it falls back to the bundled sample data so the
 * map is never blank in development.
 *
 * The projection layer guarantees nothing internal (source_url, confidence,
 * verification_status, ...) ever reaches the browser.
 */
export const getPublicRainSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRainSnapshot> => {
    const observation_date = todayInIST();
    const updated_at = new Date().toISOString();

    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (!url || !key) {
      // Not connected yet — sample data keeps the map testable.
      return {
        observation_date,
        updated_at,
        points: toPublicPoints(MOCK_EVIDENCE),
        state: "ok",
      };
    }

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key, {
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          fetch: (input, init) => {
            const h = new Headers(init?.headers);
            if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
              h.delete("Authorization");
            }
            h.set("apikey", key);
            return fetch(input, { ...init, headers: h });
          },
        },
      });

      const { data, error } = await supabase
        .from("rain_observations")
        .select(SELECT_COLUMNS)
        .eq("verification_status", "verified")
        .eq("observation_date", observation_date)
        .limit(2000);

      if (error) throw error;

      const points = toPublicPoints((data ?? []) as unknown as RainEvidence[]);
      return {
        observation_date,
        updated_at,
        points,
        state: points.length > 0 ? "ok" : "empty",
      };
    } catch (err) {
      console.error("rain_observations read failed", err);
      return { observation_date, updated_at, points: [], state: "error" };
    }
  },
);
