import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ??
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0";

export function createBedrockClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing AWS credentials. Set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env"
    );
  }

  return new BedrockRuntimeClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function chatWithClaude(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const client = createBedrockClient();

  const claudeMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: [{ type: "text" as const, text: m.content }],
  }));

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2048,
      system: systemPrompt,
      messages: claudeMessages,
    }),
  });

  const response = await client.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));

  const textBlock = result.content?.find(
    (b: { type: string }) => b.type === "text"
  );
  return textBlock?.text || "I couldn't generate a response.";
}
