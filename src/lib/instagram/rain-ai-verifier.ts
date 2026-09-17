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
  if (!apiKey || !input.imageUrl) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env["RAIN_VISION_MODEL"] ?? "gpt-5.6-luna",
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

  if (!response.ok) return null;
  const payload = await response.json();
  const text = typeof payload?.output_text === "string" ? payload.output_text : "";
  try {
    const parsed = JSON.parse(text) as Partial<AiVerification>;
    if (typeof parsed.rain_observed !== "boolean") return null;
    return {
      rain_observed: parsed.rain_observed,
      confidence: clamp(Number(parsed.confidence ?? 0)),
      visual_analysis: String(parsed.visual_analysis ?? "").slice(0, 1000),
    };
  } catch {
    return null;
  }
}
