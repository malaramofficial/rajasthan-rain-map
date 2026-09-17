import { createServerFn } from "@tanstack/react-start";

import { toPublicPoints } from "./projection";
import { RAJASTHAN_DISTRICTS } from "./rajasthan-districts";
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

function classifyForecast(probability: number, precipitation: number) {
  if (probability >= 70 || precipitation >= 2) {
    return { status: "high" as const, confidence: 0.85 };
  }
  if (probability >= 50 || precipitation >= 0.5) {
    return { status: "likely" as const, confidence: 0.7 };
  }
  if (probability >= 30 || precipitation >= 0.1) {
    return { status: "possible" as const, confidence: 0.55 };
  }
  return { status: "none" as const, confidence: 0.5 };
}

async function getWeatherForecast(): Promise<RainEvidence[]> {
  const latitude = RAJASTHAN_DISTRICTS.map((d) => d.latitude).join(",");
  const longitude = RAJASTHAN_DISTRICTS.map((d) => d.longitude).join(",");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "precipitation,rain,showers,weather_code");
  url.searchParams.set("hourly", "precipitation_probability,precipitation,rain");
  url.searchParams.set("forecast_hours", "6");
  url.searchParams.set("timezone", "Asia/Kolkata");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as unknown;
  const locations = Array.isArray(payload) ? payload : [payload];
  const observationDate = todayInIST();
  const evidence: RainEvidence[] = [];

  for (let i = 0; i < RAJASTHAN_DISTRICTS.length; i += 1) {
    const district = RAJASTHAN_DISTRICTS[i];
    const weather = locations[i] as {
      current?: { time?: string; precipitation?: number };
      hourly?: {
        precipitation_probability?: number[];
        precipitation?: number[];
      };
    } | undefined;

    if (!weather) continue;

    const probabilities = (weather.hourly?.precipitation_probability ?? [])
      .slice(0, 6)
      .map(Number)
      .filter(Number.isFinite);
    const precipitation = (weather.hourly?.precipitation ?? [])
      .slice(0, 6)
      .map(Number)
      .filter(Number.isFinite);

    const probability = Math.max(0, ...probabilities);
    const precipitationMm = Math.max(
      0,
      Number(weather.current?.precipitation) || 0,
      ...precipitation,
    );
    const classification = classifyForecast(probability, precipitationMm);

    if (classification.status === "none") continue;

    evidence.push({
      id: `weather-${district.district.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      observation_date: observationDate,
      event_time: weather.current?.time ?? new Date().toISOString(),
      place: district.district,
      district: district.district,
      latitude: district.latitude,
      longitude: district.longitude,
      rain_observed: false,
      forecast_status: classification.status,
      confidence: classification.confidence,
      source_url: url.toString(),
      source_type: "weather",
      original_or_repost: "unknown",
      verification_status: "verified",
    });
  }

  return evidence;
}

export const getPublicRainSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRainSnapshot> => {
    const observation_date = todayInIST();
    const updated_at = new Date().toISOString();
    const evidence: RainEvidence[] = [];
    let databaseFailed = false;
    let weatherFailed = false;

    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (url && key) {
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
        evidence.push(...((data ?? []) as unknown as RainEvidence[]));
      } catch (err) {
        databaseFailed = true;
        console.error("rain_observations read failed", err);
      }
    }

    try {
      const weatherEvidence = await getWeatherForecast();
      const observedDistricts = new Set(
        evidence.filter((item) => item.rain_observed).map((item) => item.district),
      );
      evidence.push(
        ...weatherEvidence.filter((item) => !observedDistricts.has(item.district)),
      );
    } catch (err) {
      weatherFailed = true;
      console.error("Open-Meteo forecast read failed", err);
    }

    const points = toPublicPoints(evidence);

    return {
      observation_date,
      updated_at,
      points,
      state:
        points.length > 0
          ? "ok"
          : databaseFailed || weatherFailed
            ? "error"
            : "empty",
    };
  },
);
