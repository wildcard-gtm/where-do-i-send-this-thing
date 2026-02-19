import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    include: {
      jobs: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Build CSV
  const headers = [
    "LinkedIn URL",
    "Person Name",
    "Status",
    "Recommendation",
    "Confidence",
    "Home Address",
    "Home Confidence",
    "Office Address",
    "Office Confidence",
    "Flags",
  ];

  const rows = batch.jobs.map((job) => {
    const result = job.result ? JSON.parse(job.result) : null;
    const decision = result?.decision;

    return [
      job.linkedinUrl,
      job.personName || "",
      job.status,
      decision?.recommendation || "",
      decision?.confidence?.toString() || "",
      decision?.home_address?.address || "",
      decision?.home_address?.confidence?.toString() || "",
      decision?.office_address?.address || "",
      decision?.office_address?.confidence?.toString() || "",
      decision?.flags?.join("; ") || "",
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
      "Content-Disposition": `attachment; filename="batch-${id}-results.csv"`,
    },
  });
}
