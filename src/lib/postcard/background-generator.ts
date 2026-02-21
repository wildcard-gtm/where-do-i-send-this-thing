import OpenAI from "openai";

/**
 * Generates a background image for a postcard.
 * Tries gpt-image-1 first (higher quality), falls back to dall-e-3 if unavailable.
 * Returns base64-encoded PNG data.
 */
export async function generateBackground(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });

  // Try gpt-image-1 first
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.images.generate as any)({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
      n: 1,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b64: string | undefined = (response as any).data?.[0]?.b64_json;
    if (b64) return b64;
    throw new Error("No base64 image in gpt-image-1 response");
  } catch {
    // Fall back to dall-e-3 — returns a URL, so we fetch and convert to base64
    const response = await client.images.generate({
      model: "dall-e-3",
      prompt,
      size: "1792x1024",
      quality: "standard",
      response_format: "b64_json",
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data returned from dall-e-3");
    return b64;
  }
}
