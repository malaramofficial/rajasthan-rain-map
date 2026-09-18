type AiVerification = {
  rain_observed: boolean;
  confidence: number;
  visual_analysis: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function verifyRainVisualWithOpenAI(input: {
  imageUrl?: string | null;
  caption?: string | null;
}): Promise<AiVerification | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.warn("Reels AI verification skipped: OPENAI_API_KEY is missing");
    return null;
  }
  if (!input.imageUrl) {
    console.warn("Reels AI verification skipped: thumbnail_url is missing");
    return null;
  }

  const model = process.env["RAIN_VISION_MODEL"] ?? "gpt-5.6-luna";

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
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "You verify whether this Instagram rain post visually shows rain happening now. Return JSON only with rain_observed (boolean), confidence (0 to 1), and visual_analysis (short factual description). Do not infer rain from caption alone. If the image is ambiguous, use false and low confidence.",
              },
              { type: "input_image", image_url: input.imageUrl },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
  } catch (error) {
    console.error(
      "Reels AI verification request failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Reels AI OpenAI API error: status=${response.status} model=${model} body=${errorBody.slice(0, 500)}`,
    );
    return null;
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (error) {
    console.error(
      "Reels AI OpenAI response JSON parse failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  const text = typeof payload?.output_text === "string" ? payload.output_text : "";
  if (!text) {
    console.error("Reels AI OpenAI response missing output_text");
    return null;
  }

  try {
    const parsed = JSON.parse(text) as Partial<AiVerification>;
    if (typeof parsed.rain_observed !== "boolean") {
      console.error("Reels AI response missing boolean rain_observed");
      return null;
    }
    return {
      rain_observed: parsed.rain_observed,
      confidence: clamp(Number(parsed.confidence ?? 0)),
      visual_analysis: String(parsed.visual_analysis ?? "").slice(0, 1000),
    };
  } catch (error) {
    console.error(
      "Reels AI response output_text JSON parse failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
