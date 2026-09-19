type AiVerification = {
  rain_observed: boolean;
  confidence: number;
  visual_analysis: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeResult(value: unknown): AiVerification | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<AiVerification>;
  if (typeof parsed.rain_observed !== "boolean") return null;
  return {
    rain_observed: parsed.rain_observed,
    confidence: clamp(Number(parsed.confidence ?? 0)),
    visual_analysis: String(parsed.visual_analysis ?? "").slice(0, 1000),
  };
}

async function verifyWithPublicOpenSourceSpace(imageUrl: string): Promise<AiVerification | null> {
  const base = process.env["RAIN_OPEN_SOURCE_SPACE_URL"] ?? "https://pyedward-weatherai.hf.space";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const start = await fetch(base + "/gradio_api/call/classify_weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [{ path: imageUrl }] }),
      signal: controller.signal,
    });
    if (!start.ok) {
      console.warn(`Open-source weather Space submit failed: HTTP ${start.status}`);
      return null;
    }

    const startPayload = await start.json() as { event_id?: string };
    if (!startPayload.event_id) {
      console.warn("Open-source weather Space returned no event_id");
      return null;
    }

    const resultResponse = await fetch(
      base + "/gradio_api/call/classify_weather/" + encodeURIComponent(startPayload.event_id),
      { headers: { Accept: "text/event-stream" }, signal: controller.signal },
    );
    if (!resultResponse.ok) {
      console.warn(`Open-source weather Space result failed: HTTP ${resultResponse.status}`);
      return null;
    }

    const streamText = await resultResponse.text();
    const dataLines = streamText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const line of dataLines.reverse()) {
      try {
        const data = JSON.parse(line) as unknown;
        const first = Array.isArray(data) ? data[0] : data;
        if (first && typeof first === "object") {
          const scores = first as Record<string, unknown>;
          const rainScore = Number(scores["rain/storm"] ?? scores["rain/strom"] ?? 0);
          if (Number.isFinite(rainScore)) {
            return {
              rain_observed: rainScore >= 0.75,
              confidence: clamp(rainScore),
              visual_analysis: `Open-source weather classifier: rain/storm score ${rainScore.toFixed(3)}.`,
            };
          }
        }
      } catch {
        // Ignore non-JSON SSE lines.
      }
    }
    return null;
  } catch (error) {
    console.warn(
      "Open-source weather Space verification failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyWithOpenAI(input: {
  imageUrl: string;
}): Promise<AiVerification | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;

  const model = process.env["RAIN_VISION_MODEL"] ?? "gpt-5.6-luna";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: "You verify whether this Instagram rain post visually shows rain happening now. Return JSON only with rain_observed (boolean), confidence (0 to 1), and visual_analysis (short factual description). Do not infer rain from caption alone. If the image is ambiguous, use false and low confidence.",
            },
            { type: "input_image", image_url: input.imageUrl },
          ],
        }],
        text: { format: { type: "json_object" } },
      }),
    });
  } catch (error) {
    console.error("Reels AI verification request failed:", error instanceof Error ? error.message : String(error));
    return null;
  }

  clearTimeout(timer);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Reels AI OpenAI API error: status=${response.status} model=${model} body=${errorBody.slice(0, 500)}`);
    return null;
  }

  try {
    const payload = await response.json() as { output_text?: string };
    if (!payload.output_text) return null;
    return normalizeResult(JSON.parse(payload.output_text));
  } catch (error) {
    console.error("Reels AI OpenAI response parsing failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function verifyRainVisualWithOpenAI(input: {
  imageUrl?: string | null;
  caption?: string | null;
}): Promise<AiVerification | null> {
  if (!input.imageUrl) {
    console.warn("Reels AI verification skipped: thumbnail_url is missing");
    return null;
  }

  // First use the open-source weather classifier. OpenAI remains only as fallback.
  const openSource = await verifyWithPublicOpenSourceSpace(input.imageUrl);
  if (openSource) {
    console.log(
      `Reels AI verification: open-source weather classifier used, rain=${openSource.rain_observed}, confidence=${openSource.confidence.toFixed(3)}`,
    );
    return openSource;
  }

  const openAi = await verifyWithOpenAI({ imageUrl: input.imageUrl });
  if (openAi) return openAi;

  console.warn("Reels AI verification unavailable: open-source Space and OpenAI fallback both unavailable");
  return null;
}
