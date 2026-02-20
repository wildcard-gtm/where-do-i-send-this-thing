import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

export async function generateBackground(
  prompt: string,
  outputPath: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });

  // gpt-image-1 returns base64 by default
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
  const imageData = (response as any).data?.[0];
  if (!imageData) throw new Error("No image data returned from image generation API");

  const b64: string | undefined = imageData.b64_json;
  if (!b64) throw new Error("No base64 image in response — check gpt-image-1 model access");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(b64, "base64"));
}
