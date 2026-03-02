import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface EnrichmentContext {
  companyName: string;
  companyMission?: string | null;
  companyValues?: string[] | null;
  openRoles?: Array<{ title: string; location: string; level: string }> | null;
  officeLocations?: string[] | null;
}

interface PostcardCopy {
  headline: string;
  description: string;
  imagePrompt: string;
}

async function ask(prompt: string, maxTokens = 150): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any).responses.create({
    model: "gpt-5.2",
    input: [{ role: "user", content: prompt }],
    max_output_tokens: maxTokens,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((res as any).output?.[0]?.content?.[0]?.text ?? "").trim();
}

export async function generatePostcardCopy(ctx: EnrichmentContext): Promise<PostcardCopy> {
  const roleList = (ctx.openRoles ?? []).map((r) => r.title).join(", ");
  const locations = (ctx.officeLocations ?? []).join(", ");
  const values = (ctx.companyValues ?? []).join(", ");

  const contextBlock = [
    `Company: ${ctx.companyName}`,
    ctx.companyMission ? `Mission: ${ctx.companyMission}` : null,
    values ? `Values: ${values}` : null,
    locations ? `Office locations: ${locations}` : null,
    roleList ? `Open roles they are actively hiring for: ${roleList}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const [headline, description, imagePrompt] = await Promise.all([
    ask(`${contextBlock}

We are a recruiting agency that sources top-tier tech talent. Write ONE punchy postcard headline (5–9 words) to grab the attention of their hiring team. Must feel like you deeply understand their world — not generic. Do NOT list role names or job titles. Write a single memorable thought or provocative statement. No quotes, no trailing punctuation. Return the headline text only.`, 60),

    ask(`${contextBlock}

We are a recruiting agency. Write exactly 2 short sentences for a physical postcard. ABSOLUTE MAX 20 words total — if you go over, rewrite shorter. First sentence: one sharp insight about their hiring challenge. Second sentence: we can source that talent. No role names listed. No filler. Return only the 2 sentences, nothing else.`, 60),

    ask(`${contextBlock}

Write a gpt-image-1 generation prompt for the LEFT side of a recruitment postcard. It should be a professional editorial photograph visually capturing the spirit of this company's industry and world. Requirements:
- Portrait orientation, vertical composition
- One professional person visible from behind, side, or mid-torso — no visible face
- Natural cinematic lighting, shallow depth of field
- Scene specific to their industry/niche — not generic office stock
- No text, no logos, no words, no numbers anywhere
- Under 80 words

Return the image generation prompt only.`, 150),
  ]);

  return { headline, description, imagePrompt };
}
