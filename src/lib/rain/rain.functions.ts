import { createServerFn } from "@tanstack/react-start";

import { toPublicPoints } from "./projection";
import type { PublicRainPoint, PublicRainSnapshot, RainEvidence } from "./types";
import { RAJASTHAN_DISTRICTS } from "./rajasthan-districts";

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

      const observedPoints = toPublicPoints((data ?? []) as unknown as RainEvidence[]);

      // The public map must remain useful even when no Instagram observation has
      // been verified yet. Fetch a lightweight forecast for every Rajasthan
      // district headquarters in one Open-Meteo request. Forecast points are
      // intentionally represented differently from observed-rain points.
      let forecastPoints: PublicRainPoint[] = [];
      try {
        const latitudes = RAJASTHAN_DISTRICTS.map((d) => d.latitude).join(",");
        const longitudes = RAJASTHAN_DISTRICTS.map((d) => d.longitude).join(",");
        const forecastUrl =
          "https://api.open-meteo.com/v1/forecast" +
          `?latitude=${latitudes}&longitude=${longitudes}` +
          "&current=precipitation,rain" +
          "&hourly=precipitation_probability,precipitation" +
          "&forecast_days=1&timezone=Asia%2FKolkata";

        const response = await fetch(forecastUrl, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);

        const payload = (await response.json()) as Array<{
          current?: { precipitation?: number; rain?: number };
          hourly?: {
            precipitation_probability?: number[];
            precipitation?: number[];
          };
        }>;

        const observedDistricts = new Set(observedPoints.map((p) => p.district));

        forecastPoints = RAJASTHAN_DISTRICTS.flatMap((district, index) => {
          const item = payload[index];
          if (!item) return [];

          const currentRain = Number(item.current?.rain ?? 0);
          const currentPrecipitation = Number(item.current?.precipitation ?? 0);
          const probabilities = item.hourly?.precipitation_probability ?? [];
          const precipitation = item.hourly?.precipitation ?? [];
          const nextSixProbability = Math.max(...probabilities.slice(0, 6), 0);
          const nextSixPrecipitation = precipitation.slice(0, 6).reduce(
            (sum, value) => sum + Number(value || 0),
            0,
          );

          // Show only meaningful rain signals; dry districts stay visually clean.
          const shouldShow =
            currentRain > 0 ||
            currentPrecipitation > 0 ||
            nextSixProbability >= 50 ||
            nextSixPrecipitation >= 0.2;

          if (!shouldShow || observedDistricts.has(district.district)) return [];

          return [{
            id: `forecast-${district.district}`,
            place: district.district,
            district: district.district,
            latitude: district.latitude,
            longitude: district.longitude,
            status: "forecast" as const,
          }];
        });
      } catch (forecastError) {
        console.error("Public weather forecast read failed", forecastError);
      }

      const points = [...observedPoints, ...forecastPoints];
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
