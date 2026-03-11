/**
 * Shared PDF generation helpers used by both the export-pdf/print-pdf API routes
 * and the background PDF export system.
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import sharp from "sharp";
import { prisma } from "@/lib/db";

// === Export PDF constants ===
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
const BLUE = rgb(0.15, 0.35, 0.75);
const ACCENT_BG = rgb(0.97, 0.97, 0.98);

const PAGE_W = PageSizes.A4[1];
const PAGE_H = PageSizes.A4[0];
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// === Print PDF constants ===
const POSTCARD_W = 6 * 72;
const POSTCARD_H = 4.25 * 72;

interface OpenRole {
  title: string;
  location?: string;
}

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
}

export async function fetchImageBytes(
  url: string
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const buffer = await res.arrayBuffer();
    let bytes = new Uint8Array(buffer);

    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebP = bytes[0] === 0x52 && bytes[1] === 0x49;

    if (isPng) return { bytes, type: "png" };
    if (isJpg) return { bytes, type: "jpg" };

    if (isWebP || contentType.includes("image/") || bytes.length > 0) {
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

// Numerical-first then A-Z sort for company names
export function companySort(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const aNum = /^\d/.test(aLower);
  const bNum = /^\d/.test(bLower);
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  if (aNum && bNum) {
    const aVal = parseFloat(aLower);
    const bVal = parseFloat(bLower);
    if (aVal !== bVal) return aVal - bVal;
  }
  return aLower.localeCompare(bLower);
}

/** Postcard type returned from the DB query used by export PDF */
type ExportPostcard = Awaited<ReturnType<typeof fetchPostcardsForExport>>[number];

/** Fetch postcards with full enrichment data (for export PDF) */
export async function fetchPostcardsForExport(
  postcardIds: string[],
  teamUserIds: string[]
) {
  return prisma.postcard.findMany({
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
          title: true,
          linkedinUrl: true,
          profileImageUrl: true,
          companyEnrichments: {
            where: { isLatest: true },
            take: 1,
            select: {
              companyName: true,
              companyWebsite: true,
              companyLogo: true,
              openRoles: true,
              teamPhotos: true,
            },
          },
        },
      },
    },
  });
}

/** Fetch postcards with minimal data (for print PDF) */
export async function fetchPostcardsForPrint(
  postcardIds: string[],
  teamUserIds: string[]
) {
  return prisma.postcard.findMany({
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
}

/** Sort postcards by company name (numerical first, then A-Z) */
export function sortPostcardsByCompany<
  T extends { contact: { company: string | null; companyEnrichments: { companyName: string | null }[] } }
>(postcards: T[]): T[] {
  return [...postcards].sort((a, b) => {
    const compA =
      a.contact.company ||
      a.contact.companyEnrichments[0]?.companyName ||
      "ZZZ";
    const compB =
      b.contact.company ||
      b.contact.companyEnrichments[0]?.companyName ||
      "ZZZ";
    return companySort(compA, compB);
  });
}

/**
 * Generate export-style PDF pages for a chunk of postcards.
 * Returns a PDFDocument with the generated pages.
 */
export async function generateExportPdfChunk(
  postcards: ExportPostcard[],
  pageStart: number,
  totalPages: number
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let idx = 0; idx < postcards.length; idx++) {
    const pc = postcards[idx];
    const enrichment = pc.contact.companyEnrichments[0] || null;
    const companyName =
      enrichment?.companyName || pc.contact.company || "Unknown";
    const companyWebsite = enrichment?.companyWebsite || "";
    const openRoles = (enrichment?.openRoles as OpenRole[] | null) || [];
    const teamPhotos = (enrichment?.teamPhotos as TeamPhoto[] | null) || [];

    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    // === HEADER BAR ===
    page.drawRectangle({
      x: 0, y: PAGE_H - 50, width: PAGE_W, height: 50, color: BLUE,
    });
    page.drawText("WDISTT — Postcard Export", {
      x: MARGIN, y: PAGE_H - 33, size: 11, font: boldFont,
      color: rgb(0.7, 0.8, 1),
    });
    const dateStr = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    const dateW = regularFont.widthOfTextAtSize(dateStr, 9);
    page.drawText(dateStr, {
      x: PAGE_W - MARGIN - dateW, y: PAGE_H - 33, size: 9,
      font: regularFont, color: rgb(0.7, 0.8, 1),
    });

    y = PAGE_H - 50 - 8;
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5, color: LIGHT_GRAY,
    });
    y -= 16;

    // === POSTCARD IMAGE + PROSPECT INFO ===
    const imgTargetW = 380;
    const imgTargetH = 260;
    const infoX = MARGIN + imgTargetW + 24;
    const infoW = CONTENT_W - imgTargetW - 24;

    let imageEmbedded = false;
    if (pc.imageUrl) {
      const imgData = await fetchImageBytes(pc.imageUrl);
      if (imgData) {
        try {
          const embedded = imgData.type === "png"
            ? await doc.embedPng(imgData.bytes)
            : await doc.embedJpg(imgData.bytes);
          const scale = Math.min(imgTargetW / embedded.width, imgTargetH / embedded.height);
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;
          const imgX = MARGIN + (imgTargetW - drawW) / 2;
          const imgY = y - imgTargetH + (imgTargetH - drawH) / 2;
          page.drawRectangle({
            x: MARGIN, y: y - imgTargetH, width: imgTargetW, height: imgTargetH,
            color: ACCENT_BG,
          });
          page.drawImage(embedded, { x: imgX, y: imgY, width: drawW, height: drawH });
          imageEmbedded = true;
        } catch { /* skip */ }
      }
    }
    if (!imageEmbedded) {
      page.drawRectangle({
        x: MARGIN, y: y - imgTargetH, width: imgTargetW, height: imgTargetH,
        color: ACCENT_BG,
      });
      page.drawText("[No image available]", {
        x: MARGIN + imgTargetW / 2 - 50, y: y - imgTargetH / 2,
        size: 10, font: regularFont, color: GRAY,
      });
    }

    // === PROSPECT INFO (right side) ===
    let iy = y - 4;
    page.drawText("PROSPECT", { x: infoX, y: iy, size: 8, font: boldFont, color: GRAY });
    iy -= 18;

    const prospectPhotoUrl = pc.contact.profileImageUrl;
    if (prospectPhotoUrl) {
      const prospectData = await fetchImageBytes(prospectPhotoUrl);
      if (prospectData) {
        try {
          const prospectImg = prospectData.type === "png"
            ? await doc.embedPng(prospectData.bytes)
            : await doc.embedJpg(prospectData.bytes);
          const pScale = Math.min(48 / prospectImg.width, 48 / prospectImg.height);
          const pw = prospectImg.width * pScale;
          const ph = prospectImg.height * pScale;
          page.drawImage(prospectImg, { x: infoX, y: iy - ph, width: pw, height: ph });
          iy -= ph + 8;
        } catch { /* skip */ }
      }
    }

    const drawInfoLabel = (label: string, value: string) => {
      page.drawText(label, { x: infoX, y: iy, size: 7, font: boldFont, color: GRAY });
      iy -= 12;
      const words = value.split(" ");
      let line = "";
      const lines: string[] = [];
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (regularFont.widthOfTextAtSize(test, 9) > infoW && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      for (const l of lines) {
        page.drawText(l, { x: infoX, y: iy, size: 9, font: regularFont, color: BLACK });
        iy -= 13;
      }
      iy -= 4;
    };

    drawInfoLabel("Name", pc.contactName);
    if (pc.contact.title) drawInfoLabel("Title", pc.contact.title);
    drawInfoLabel("Company", companyName);
    if (pc.contact.linkedinUrl) {
      const linkedinShort = pc.contact.linkedinUrl
        .replace("https://www.", "").replace("https://", "").slice(0, 40);
      drawInfoLabel("LinkedIn", linkedinShort);
    }
    if (pc.deliveryAddress) drawInfoLabel("Delivery", pc.deliveryAddress);
    const templateLabel = pc.template === "warroom" ? "War Room" : "Zoom Room";
    const statusLabel = pc.status.charAt(0).toUpperCase() + pc.status.slice(1);
    drawInfoLabel("Template", `${templateLabel} | ${statusLabel}`);

    y -= imgTargetH + 16;

    // === BOTTOM: Company + Open Roles + Team Members ===
    const col1W = CONTENT_W * 0.3;
    const col2W = CONTENT_W * 0.35;
    const col1X = MARGIN;
    const col2X = MARGIN + col1W;
    const col3X = MARGIN + col1W + col2W;

    page.drawLine({
      start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5, color: LIGHT_GRAY,
    });
    y -= 16;
    const sectionTop = y;

    // Column 1: COMPANY
    let c1y = sectionTop;
    page.drawText("COMPANY", { x: col1X, y: c1y, size: 8, font: boldFont, color: GRAY });
    c1y -= 18;

    let logoEmbedded = false;
    const logoUrl = enrichment?.companyLogo;
    if (logoUrl) {
      const logoData = await fetchImageBytes(logoUrl);
      if (logoData) {
        try {
          const logoImg = logoData.type === "png"
            ? await doc.embedPng(logoData.bytes)
            : await doc.embedJpg(logoData.bytes);
          const logoScale = Math.min(36 / logoImg.width, 36 / logoImg.height);
          const lw = logoImg.width * logoScale;
          const lh = logoImg.height * logoScale;
          page.drawImage(logoImg, { x: col1X, y: c1y - lh, width: lw, height: lh });
          page.drawText(companyName, {
            x: col1X + lw + 8, y: c1y - 10, size: 10, font: boldFont, color: BLACK,
          });
          if (companyWebsite) {
            page.drawText(
              companyWebsite.replace("https://", "").replace("http://", ""),
              { x: col1X + lw + 8, y: c1y - 24, size: 8, font: regularFont, color: GRAY }
            );
          }
          logoEmbedded = true;
        } catch { /* skip */ }
      }
    }
    if (!logoEmbedded) {
      page.drawText(companyName, { x: col1X, y: c1y, size: 10, font: boldFont, color: BLACK });
      c1y -= 14;
      if (companyWebsite) {
        page.drawText(
          companyWebsite.replace("https://", "").replace("http://", ""),
          { x: col1X, y: c1y, size: 8, font: regularFont, color: GRAY }
        );
      }
    }

    // Column 2: OPEN ROLES
    let c2y = sectionTop;
    page.drawText("OPEN ROLES", { x: col2X, y: c2y, size: 8, font: boldFont, color: GRAY });
    c2y -= 18;
    if (openRoles.length === 0) {
      page.drawText("No roles found", { x: col2X, y: c2y, size: 9, font: regularFont, color: GRAY });
    } else {
      for (const role of openRoles.slice(0, 6)) {
        const roleText = role.location ? `${role.title} (${role.location})` : role.title;
        const display = roleText.length > 45 ? roleText.slice(0, 42) + "..." : roleText;
        page.drawText(`• ${display}`, { x: col2X, y: c2y, size: 8, font: regularFont, color: BLACK });
        c2y -= 14;
      }
      if (openRoles.length > 6) {
        page.drawText(`+ ${openRoles.length - 6} more`, {
          x: col2X, y: c2y, size: 8, font: regularFont, color: GRAY,
        });
      }
    }

    // Column 3: TEAM MEMBERS
    let c3y = sectionTop;
    page.drawText("TEAM MEMBERS", { x: col3X, y: c3y, size: 8, font: boldFont, color: GRAY });
    c3y -= 18;

    const PHOTO_SIZE = 28;
    const PHOTO_GAP = 6;

    if (teamPhotos.length === 0) {
      page.drawText("No team members found", { x: col3X, y: c3y, size: 9, font: regularFont, color: GRAY });
    } else {
      for (const member of teamPhotos.slice(0, 5)) {
        let memberPhotoEmbedded = false;
        if (member.photoUrl) {
          const photoData = await fetchImageBytes(member.photoUrl);
          if (photoData) {
            try {
              const photoImg = photoData.type === "png"
                ? await doc.embedPng(photoData.bytes)
                : await doc.embedJpg(photoData.bytes);
              const ps = Math.min(PHOTO_SIZE / photoImg.width, PHOTO_SIZE / photoImg.height);
              page.drawImage(photoImg, {
                x: col3X, y: c3y - photoImg.height * ps,
                width: photoImg.width * ps, height: photoImg.height * ps,
              });
              memberPhotoEmbedded = true;
            } catch { /* skip */ }
          }
        }
        const textX = memberPhotoEmbedded ? col3X + PHOTO_SIZE + PHOTO_GAP : col3X;
        const memberName = member.name || "Team member";
        const nameDisplay = memberName.length > 25 ? memberName.slice(0, 22) + "..." : memberName;
        page.drawText(nameDisplay, { x: textX, y: c3y - 10, size: 8, font: boldFont, color: BLACK });
        if (member.title) {
          const titleDisplay = member.title.length > 28 ? member.title.slice(0, 25) + "..." : member.title;
          page.drawText(titleDisplay, { x: textX, y: c3y - 22, size: 7, font: regularFont, color: GRAY });
        }
        c3y -= PHOTO_SIZE + PHOTO_GAP;
      }
      if (teamPhotos.length > 5) {
        page.drawText(`+ ${teamPhotos.length - 5} more`, {
          x: col3X, y: c3y, size: 8, font: regularFont, color: GRAY,
        });
      }
    }

    // === FOOTER ===
    page.drawLine({
      start: { x: MARGIN, y: MARGIN - 8 }, end: { x: PAGE_W - MARGIN, y: MARGIN - 8 },
      thickness: 0.5, color: LIGHT_GRAY,
    });
    page.drawText("WDISTT — Postcard Export", {
      x: MARGIN, y: MARGIN - 20, size: 7, font: regularFont, color: GRAY,
    });
    const pageNum = pageStart + idx + 1;
    const pageLabel = `Page ${pageNum} of ${totalPages}`;
    const pageLabelW = regularFont.widthOfTextAtSize(pageLabel, 7);
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN - pageLabelW, y: MARGIN - 20,
      size: 7, font: regularFont, color: GRAY,
    });
  }

  return doc;
}

/**
 * Generate print-style PDF pages for a chunk of postcards.
 * Returns a PDFDocument with the generated pages.
 */
export async function generatePrintPdfChunk(
  postcards: Awaited<ReturnType<typeof fetchPostcardsForPrint>>
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();

  for (const pc of postcards) {
    const imgData = pc.imageUrl ? await fetchImageBytes(pc.imageUrl) : null;
    if (imgData) {
      try {
        const embedded = imgData.type === "png"
          ? await doc.embedPng(imgData.bytes)
          : await doc.embedJpg(imgData.bytes);

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

  return doc;
}
