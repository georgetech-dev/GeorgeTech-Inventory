const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DescriptionRequest = {
  mode?: "brief" | "fitting";
  imageBase64?: string;
  mimeType?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "Gemini is not configured" }, 503);

    const { mode = "brief", imageBase64, mimeType = "image/jpeg" } = await request.json() as DescriptionRequest;
    if (!imageBase64) return json({ error: "An image is required" }, 400);
    if (!mimeType.startsWith("image/")) return json({ error: "Unsupported image type" }, 400);

    const prompt = mode === "fitting"
      ? "Inspect this inventory-item photograph. Write a concise factual description of the item. Include every clearly visible manufacturer, model number, part number, size, rating, or marking. Then list appliance makes and models it fits only when compatibility can be confidently established from visible evidence. Never guess. If compatibility cannot be confirmed from the photograph, say so briefly. Return plain text suitable for an inventory description field."
      : "Inspect this inventory-item photograph and write a brief, factual plain-text description suitable for an inventory record. Mention the item type, visible material, colour, condition, size, brand, and visible markings where identifiable. Never invent details and do not use markdown.";

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: mode === "fitting" ? 500 : 220 },
        }),
      },
    );

    const payload = await geminiResponse.json();
    if (!geminiResponse.ok) {
      console.error("Gemini request failed", payload);
      return json({ error: payload?.error?.message || "Gemini request failed" }, geminiResponse.status);
    }

    const description = payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("\n")
      .trim();
    if (!description) return json({ error: "Gemini returned no description" }, 502);
    return json({ description });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
