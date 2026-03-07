import { getSession } from "@/lib/auth";
import { getTeamUserIds } from "@/lib/team";
import { prisma } from "@/lib/db";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";

export const maxDuration = 300;

// Standard US postcard: 6" x 4.25" (landscape) in PDF points (72pt/inch)
const POSTCARD_W = 6 * 72; // 432pt
const POSTCARD_H = 4.25 * 72; // 306pt

async function fetchImageBytes(
  url: string
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    let bytes = new Uint8Array(buffer);

    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebP = bytes[0] === 0x52 && bytes[1] === 0x49;

    if (isPng) return { bytes, type: "png" };
    if (isJpg) return { bytes, type: "jpg" };

    if (isWebP || bytes.length > 0) {
      try {
        const pngBuffer = await sharp(Buffer.from(bytes)).png().toBuffer();
        bytes = new Uint8Array(pngBuffer);
        return { bytes, type: "png" };
      } catch {
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// POST /api/postcards/print-pdf
// Body: { postcardIds: string[] }
// Returns a print-ready PDF with each postcard image on its own page at US postcard size.
// Pages are sorted by company name A-Z.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const body = await request.json();
  const postcardIds: string[] = body.postcardIds;

  if (!Array.isArray(postcardIds) || postcardIds.length === 0) {
    return new Response("postcardIds required", { status: 400 });
  }

  const teamUserIds = await getTeamUserIds(user);

  const postcards = await prisma.postcard.findMany({
    where: {
      id: { in: postcardIds },
      contact: { userId: { in: teamUserIds } },
    },
    include: {
      contact: {
        select: {
          id: true,
          name: true,
          company: true,
          companyEnrichments: {
            where: { isLatest: true },
            take: 1,
            select: { companyName: true },
          },
        },
      },
    },
  });

  if (postcards.length === 0) {
    return new Response("No postcards found", { status: 404 });
  }

  // Sort by company name A-Z
  const sorted = postcards.sort((a, b) => {
    const compA = (
      a.contact.companyEnrichments[0]?.companyName ||
      a.contact.company ||
      "ZZZ"
    ).toLowerCase();
    const compB = (
      b.contact.companyEnrichments[0]?.companyName ||
      b.contact.company ||
      "ZZZ"
    ).toLowerCase();
    return compA.localeCompare(compB);
  });

  const doc = await PDFDocument.create();

  for (const pc of sorted) {
    const imgData = pc.imageUrl ? await fetchImageBytes(pc.imageUrl) : null;
    if (imgData) {
      try {
        const embedded =
          imgData.type === "png"
            ? await doc.embedPng(imgData.bytes)
            : await doc.embedJpg(imgData.bytes);

        // Size page to match image aspect ratio, longest edge at POSTCARD_W
        const imgAspect = embedded.width / embedded.height;
        let pageW: number, pageH: number;
        if (imgAspect >= 1) {
          pageW = POSTCARD_W;
          pageH = POSTCARD_W / imgAspect;
        } else {
          pageH = POSTCARD_W;
          pageW = POSTCARD_W * imgAspect;
        }
        const page = doc.addPage([pageW, pageH]);
        page.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH });
      } catch {
        // Fallback placeholder page
        const page = doc.addPage([POSTCARD_W, POSTCARD_H]);
        page.drawRectangle({
          x: 0, y: 0, width: POSTCARD_W, height: POSTCARD_H,
          color: rgb(0.95, 0.95, 0.95),
        });
        page.drawText(`[Image failed: ${pc.contactName}]`, {
          x: 20, y: POSTCARD_H / 2, size: 10, color: rgb(0.5, 0.5, 0.5),
        });
      }
    } else {
      const page = doc.addPage([POSTCARD_W, POSTCARD_H]);
      page.drawRectangle({
        x: 0, y: 0, width: POSTCARD_W, height: POSTCARD_H,
        color: rgb(0.95, 0.95, 0.95),
      });
      page.drawText(`[No image: ${pc.contactName}]`, {
        x: 20, y: POSTCARD_H / 2, size: 10, color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  const pdfBytes = await doc.save();

  return new Response(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="postcards-print-ready.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
