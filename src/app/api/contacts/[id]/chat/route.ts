import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { chatWithClaude } from "@/lib/bedrock";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    include: {
      job: {
        select: { result: true },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Build context for Claude
  const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
  const decision = jobResult?.decision;

  const systemPrompt = `You are an AI assistant helping with address verification research for a contact. Here is the contact's information:

Name: ${contact.name}
LinkedIn: ${contact.linkedinUrl}
${contact.company ? `Company: ${contact.company}` : ""}
${contact.title ? `Title: ${contact.title}` : ""}
${contact.homeAddress ? `Home Address: ${contact.homeAddress}` : ""}
${contact.officeAddress ? `Office Address: ${contact.officeAddress}` : ""}
${contact.recommendation ? `Delivery Recommendation: ${contact.recommendation}` : ""}
${contact.confidence ? `Confidence Score: ${contact.confidence}%` : ""}
${decision?.reasoning ? `\nAgent Reasoning:\n${decision.reasoning}` : ""}
${decision?.flags?.length ? `\nFlags: ${decision.flags.join(", ")}` : ""}

Answer questions about this contact, their address verification results, or help the user decide on delivery strategy. Be concise and helpful.`;

  // Load recent chat history
  const history = await prisma.chatMessage.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const conversationMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  try {
    const assistantResponse = await chatWithClaude(
      systemPrompt,
      conversationMessages
    );

    // Save both messages
    const [userMsg, assistantMsg] = await Promise.all([
      prisma.chatMessage.create({
        data: {
          contactId: id,
          role: "user",
          content: message,
        },
      }),
      prisma.chatMessage.create({
        data: {
          contactId: id,
          role: "assistant",
          content: assistantResponse,
        },
      }),
    ]);

    return NextResponse.json({
      userMessage: userMsg,
      assistantMessage: assistantMsg,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json(
      { error: "Failed to get AI response" },
      { status: 500 }
    );
  }
}
