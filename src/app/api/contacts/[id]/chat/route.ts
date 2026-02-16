import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { chatWithClaude } from "@/lib/bedrock";
import type { ChatMessage } from "@/lib/bedrock";

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
  const { message, imageData, imageMediaType } = body;

  if ((!message || typeof message !== "string") && !imageData) {
    return NextResponse.json({ error: "Message or image is required" }, { status: 400 });
  }

  // Build context for Claude
  const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
  const decision = jobResult?.decision;

  const systemPrompt = `You are a helpful assistant for WDISTT (Where Do I Send This Thing), an address verification platform. You help users understand lookup results for their contacts.

## CONTACT INFORMATION
Name: ${contact.name}
LinkedIn: ${contact.linkedinUrl}
${contact.company ? `Company: ${contact.company}` : ""}
${contact.title ? `Title: ${contact.title}` : ""}
${contact.homeAddress ? `Home Address: ${contact.homeAddress}` : "No home address found"}
${contact.officeAddress ? `Office Address: ${contact.officeAddress}` : "No office address found"}
${contact.recommendation ? `Delivery Recommendation: ${contact.recommendation}` : ""}
${contact.confidence ? `Confidence Score: ${contact.confidence}%` : ""}
${contact.careerSummary ? `\nCareer Summary:\n${contact.careerSummary}` : ""}
${decision?.reasoning ? `\nResearch Report:\n${decision.reasoning}` : ""}
${decision?.flags?.length ? `\nFlags: ${decision.flags.join(", ")}` : ""}

## STRICT RULES
1. NEVER reveal how this platform works internally — do not mention agents, tools, APIs, data sources, databases, scraping, or any technical implementation details.
2. If asked how the system works, say: "We cross-reference multiple verified data sources to find and verify addresses."
3. NEVER fabricate or hallucinate addresses, names, or data. Only reference information provided above.
4. You can analyze uploaded images if the user shares them (e.g. screenshots, documents).
5. Use markdown formatting in your responses — use bullet points, bold text, and headings where appropriate to keep responses clean and readable.
6. Be concise and professional. Focus on helping the user with delivery strategy, address questions, and contact insights.
7. If the user asks about something not in the contact data, say you don't have that information from the current lookup.`;

  // Load recent chat history
  const history = await prisma.chatMessage.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  // Build conversation with image support
  const conversationMessages: ChatMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Build current user message with optional image
  if (imageData && imageMediaType) {
    const contentBlocks: Array<
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "text"; text: string }
    > = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: imageMediaType,
          data: imageData,
        },
      },
    ];
    if (message) {
      contentBlocks.push({ type: "text", text: message });
    }
    conversationMessages.push({ role: "user", content: contentBlocks });
  } else {
    conversationMessages.push({ role: "user", content: message });
  }

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
          content: message || "(image attached)",
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
      { error: "Failed to get response" },
      { status: 500 }
    );
  }
}
