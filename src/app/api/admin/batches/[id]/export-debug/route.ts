import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") return null;
  return user;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdmin();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }

  const { id } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id },
    include: {
      jobs: {
        orderBy: { createdAt: "asc" },
        include: {
          events: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!batch) {
    return new Response(JSON.stringify({ error: "Batch not found" }), { status: 404 });
  }

  const headers = [
    "LinkedIn URL",
    "Person Name",
    "Status",
    "Recommendation",
    "Confidence",
    "Home Address",
    "Office Address",
    "Flags",
    "AI Reasoning",
    "Iterations",
    "Total Tool Calls",
    "Tool Calls (name+input)",
    "Tool Result Summaries",
    "Tool Raw Data",
    "Started At",
    "Finished At",
    "Duration (s)",
  ];

  const rows = batch.jobs.map((job) => {
    const result = job.result ? JSON.parse(job.result) : null;
    const decision = result?.decision ?? null;

    // Parse AgentEvents for debug columns
    const toolCallStarts: string[] = [];
    const toolResultSummaries: string[] = [];
    const toolRawData: string[] = [];
    let iterationCount = 0;

    for (const event of job.events) {
      const data = event.data ? JSON.parse(event.data) : {};

      if (event.type === "iteration_start") {
        iterationCount++;
      } else if (event.type === "tool_call_start") {
        const name = data.toolName ?? "unknown";
        const input = JSON.stringify(data.input ?? {});
        toolCallStarts.push(`${name}(${input})`);
      } else if (event.type === "tool_call_result") {
        const name = data.toolName ?? "unknown";
        toolResultSummaries.push(`${name}: ${data.summary ?? ""}`);
        if (data.data !== undefined) {
          toolRawData.push(JSON.stringify(data.data));
        }
      }
    }

    const firstEvent = job.events[0];
    const lastEvent = job.events[job.events.length - 1];
    const startedAt = firstEvent ? firstEvent.createdAt.toISOString() : "";
    const finishedAt = lastEvent ? lastEvent.createdAt.toISOString() : "";
    const durationSeconds =
      firstEvent && lastEvent
        ? Math.round((lastEvent.createdAt.getTime() - firstEvent.createdAt.getTime()) / 1000)
        : "";

    return [
      job.linkedinUrl,
      job.personName ?? "",
      job.status,
      decision?.recommendation ?? "",
      decision?.confidence?.toString() ?? "",
      decision?.home_address?.address ?? "",
      decision?.office_address?.address ?? "",
      decision?.flags?.join("; ") ?? "",
      decision?.reasoning ?? "",
      iterationCount.toString(),
      toolCallStarts.length.toString(),
      toolCallStarts.join(" → "),
      toolResultSummaries.join(" | "),
      toolRawData.join(" || "),
      startedAt,
      finishedAt,
      durationSeconds.toString(),
    ];
  });

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="batch-${id}-debug.csv"`,
    },
  });
}
