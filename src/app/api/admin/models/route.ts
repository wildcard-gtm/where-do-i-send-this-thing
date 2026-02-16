import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AVAILABLE_MODELS, parseModelConfig, serializeModelConfig } from "@/lib/ai";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") return null;
  return user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Load current config from DB
  const configs = await prisma.systemPrompt.findMany({
    where: { key: { in: ["config_agent_model", "config_chat_model"] } },
  });

  const agentConfig = configs.find((c) => c.key === "config_agent_model")?.content ?? null;
  const chatConfig = configs.find((c) => c.key === "config_chat_model")?.content ?? null;

  return NextResponse.json({
    models: AVAILABLE_MODELS,
    current: {
      agent: agentConfig ? parseModelConfig(agentConfig) : null,
      chat: chatConfig ? parseModelConfig(chatConfig) : null,
    },
  });
}

export async function PUT(request: Request) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { role, provider, modelId } = await request.json();

  if (!role || !provider || !modelId) {
    return NextResponse.json({ error: "role, provider, and modelId are required" }, { status: 400 });
  }

  if (role !== "agent" && role !== "chat") {
    return NextResponse.json({ error: "role must be 'agent' or 'chat'" }, { status: 400 });
  }

  // Validate the model exists in our registry
  const valid = AVAILABLE_MODELS.some(
    (m) => m.provider === provider && m.modelId === modelId
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid model selection" }, { status: 400 });
  }

  const key = role === "agent" ? "config_agent_model" : "config_chat_model";
  const label = role === "agent" ? "Agent Model Config" : "Chat Model Config";
  const value = serializeModelConfig(provider, modelId);

  await prisma.systemPrompt.upsert({
    where: { key },
    create: { key, label, content: value },
    update: { content: value },
  });

  return NextResponse.json({ success: true, key, value });
}
