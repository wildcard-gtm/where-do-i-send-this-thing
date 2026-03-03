import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AVAILABLE_MODELS, GEMINI_IMAGE_MODELS, GEMINI_ANALYSIS_MODELS, parseModelConfig, serializeModelConfig } from "@/lib/ai";

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
    where: { key: { in: ["config_agent_model", "config_chat_model", "config_fallback_model", "config_image_gen_model", "config_image_analysis_model"] } },
  });

  const agentConfig = configs.find((c) => c.key === "config_agent_model")?.content ?? null;
  const chatConfig = configs.find((c) => c.key === "config_chat_model")?.content ?? null;
  const fallbackConfig = configs.find((c) => c.key === "config_fallback_model")?.content ?? null;
  const imageGenConfig = configs.find((c) => c.key === "config_image_gen_model")?.content ?? null;
  const imageAnalysisConfig = configs.find((c) => c.key === "config_image_analysis_model")?.content ?? null;

  return NextResponse.json({
    models: AVAILABLE_MODELS,
    geminiImageModels: GEMINI_IMAGE_MODELS,
    geminiAnalysisModels: GEMINI_ANALYSIS_MODELS,
    current: {
      agent: agentConfig ? parseModelConfig(agentConfig) : null,
      chat: chatConfig ? parseModelConfig(chatConfig) : null,
      fallback: fallbackConfig ? parseModelConfig(fallbackConfig) : null,
      image_gen: imageGenConfig ?? null,
      image_analysis: imageAnalysisConfig ?? null,
    },
  });
}

export async function PUT(request: Request) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { role, provider, modelId } = await request.json();

  if (!role || !modelId) {
    return NextResponse.json({ error: "role and modelId are required" }, { status: 400 });
  }

  const validRoles = ["agent", "chat", "fallback", "image_gen", "image_analysis"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${validRoles.join(", ")}` }, { status: 400 });
  }

  // Gemini image roles store raw model IDs (no provider prefix)
  const isGeminiRole = role === "image_gen" || role === "image_analysis";

  if (isGeminiRole) {
    const registry = role === "image_gen" ? GEMINI_IMAGE_MODELS : GEMINI_ANALYSIS_MODELS;
    const valid = registry.some((m) => m.modelId === modelId);
    if (!valid) {
      return NextResponse.json({ error: "Invalid Gemini model selection" }, { status: 400 });
    }
  } else {
    if (!provider) {
      return NextResponse.json({ error: "provider is required for agent/chat/fallback models" }, { status: 400 });
    }
    const valid = AVAILABLE_MODELS.some(
      (m) => m.provider === provider && m.modelId === modelId
    );
    if (!valid) {
      return NextResponse.json({ error: "Invalid model selection" }, { status: 400 });
    }
  }

  const key =
    role === "agent" ? "config_agent_model" :
    role === "fallback" ? "config_fallback_model" :
    role === "image_gen" ? "config_image_gen_model" :
    role === "image_analysis" ? "config_image_analysis_model" :
    "config_chat_model";
  const label =
    role === "agent" ? "Agent Model Config" :
    role === "fallback" ? "Fallback Model Config" :
    role === "image_gen" ? "Image Generation Model Config" :
    role === "image_analysis" ? "Image Analysis Model Config" :
    "Chat Model Config";
  const value = isGeminiRole ? modelId : serializeModelConfig(provider, modelId);

  await prisma.systemPrompt.upsert({
    where: { key },
    create: { key, label, content: value },
    update: { content: value },
  });

  return NextResponse.json({ success: true, key, value });
}
