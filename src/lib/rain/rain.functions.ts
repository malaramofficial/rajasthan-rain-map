import { createServerFn } from "@tanstack/react-start";

import { toPublicPoints } from "./projection";
import type { PublicRainSnapshot, RainEvidence } from "./types";

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

export const getPublicRainSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRainSnapshot> => {
    const observation_date = todayInIST();
    const updated_at = new Date().toISOString();
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (!url || !key) {
      return {
        observation_date,
        updated_at,
        points: [],
        state: "empty",
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
        .eq("source_type", "instagram")
        .eq("rain_observed", true)
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
      console.error("Instagram rain observations read failed", err);
      return {
        observation_date,
        updated_at,
        points: [],
        state: "error",
      };
    }
  },
);
