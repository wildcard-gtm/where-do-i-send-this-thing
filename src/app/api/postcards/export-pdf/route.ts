import { getSession } from "@/lib/auth";
import { getTeamUserIds } from "@/lib/team";
import { prisma } from "@/lib/db";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import sharp from "sharp";

// Colors (matching existing PDF report)
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
const BLUE = rgb(0.15, 0.35, 0.75);
const ACCENT_BG = rgb(0.97, 0.97, 0.98);

// A4 Landscape
const PAGE_W = PageSizes.A4[1];
const PAGE_H = PageSizes.A4[0];
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface OpenRole {
  title: string;
  location?: string;
}

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
}

async function fetchImageBytes(
  url: string
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const buffer = await res.arrayBuffer();
    let bytes = new Uint8Array(buffer);

    // Trust magic bytes over content-type (Supabase may mislabel JPEG as PNG)
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebP = bytes[0] === 0x52 && bytes[1] === 0x49; // RIFF

    if (isPng) return { bytes, type: "png" };
    if (isJpg) return { bytes, type: "jpg" };

    // Convert WebP (or other unsupported formats) to PNG via sharp
    if (isWebP || contentType.includes("image/")) {
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

  if (postcards.length === 0) {
    return new Response("No postcards found", { status: 404 });
  }

  // Sort by company name A-Z
  const sorted = postcards.sort((a, b) => {
    const compA = (
      a.contact.company ||
      a.contact.companyEnrichments[0]?.companyName ||
      "ZZZ"
    ).toLowerCase();
    const compB = (
      b.contact.company ||
      b.contact.companyEnrichments[0]?.companyName ||
      "ZZZ"
    ).toLowerCase();
    return compA.localeCompare(compB);
  });

  const doc = await PDFDocument.create();
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let idx = 0; idx < sorted.length; idx++) {
    const pc = sorted[idx];
    const enrichment = pc.contact.companyEnrichments[0] || null;
    const companyName =
      enrichment?.companyName || pc.contact.company || "Unknown";
    const companyWebsite = enrichment?.companyWebsite || "";
    const openRoles =
      (enrichment?.openRoles as OpenRole[] | null) || [];
    const teamPhotos =
      (enrichment?.teamPhotos as TeamPhoto[] | null) || [];

    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    // === HEADER BAR ===
    page.drawRectangle({
      x: 0,
      y: PAGE_H - 50,
      width: PAGE_W,
      height: 50,
      color: BLUE,
    });
    page.drawText("WDISTT — Postcard Export", {
      x: MARGIN,
      y: PAGE_H - 33,
      size: 11,
      font: boldFont,
      color: rgb(0.7, 0.8, 1),
    });
    const dateStr = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const dateW = regularFont.widthOfTextAtSize(dateStr, 9);
    page.drawText(dateStr, {
      x: PAGE_W - MARGIN - dateW,
      y: PAGE_H - 33,
      size: 9,
      font: regularFont,
      color: rgb(0.7, 0.8, 1),
    });

    y = PAGE_H - 50 - 8;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
    y -= 16;

    // === POSTCARD IMAGE + PROSPECT INFO ===
    const imgTargetW = 380;
    const imgTargetH = 260;
    const infoX = MARGIN + imgTargetW + 24;
    const infoW = CONTENT_W - imgTargetW - 24;

    // Embed postcard image
    let imageEmbedded = false;
    if (pc.imageUrl) {
      const imgData = await fetchImageBytes(pc.imageUrl);
      if (imgData) {
        try {
          const embedded =
            imgData.type === "png"
              ? await doc.embedPng(imgData.bytes)
              : await doc.embedJpg(imgData.bytes);
          const scale = Math.min(
            imgTargetW / embedded.width,
            imgTargetH / embedded.height
          );
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;
          const imgX = MARGIN + (imgTargetW - drawW) / 2;
          const imgY = y - imgTargetH + (imgTargetH - drawH) / 2;
          page.drawRectangle({
            x: MARGIN,
            y: y - imgTargetH,
            width: imgTargetW,
            height: imgTargetH,
            color: ACCENT_BG,
          });
          page.drawImage(embedded, {
            x: imgX,
            y: imgY,
            width: drawW,
            height: drawH,
          });
          imageEmbedded = true;
        } catch {
          // skip
        }
      }
    }
    if (!imageEmbedded) {
      page.drawRectangle({
        x: MARGIN,
        y: y - imgTargetH,
        width: imgTargetW,
        height: imgTargetH,
        color: ACCENT_BG,
      });
      page.drawText("[No image available]", {
        x: MARGIN + imgTargetW / 2 - 50,
        y: y - imgTargetH / 2,
        size: 10,
        font: regularFont,
        color: GRAY,
      });
    }

    // === PROSPECT INFO (right side) ===
    let iy = y - 4;
    page.drawText("PROSPECT", {
      x: infoX,
      y: iy,
      size: 8,
      font: boldFont,
      color: GRAY,
    });
    iy -= 18;

    // Prospect photo
    const prospectPhotoUrl = pc.contact.profileImageUrl;
    if (prospectPhotoUrl) {
      const prospectData = await fetchImageBytes(prospectPhotoUrl);
      if (prospectData) {
        try {
          const prospectImg =
            prospectData.type === "png"
              ? await doc.embedPng(prospectData.bytes)
              : await doc.embedJpg(prospectData.bytes);
          const pScale = Math.min(
            48 / prospectImg.width,
            48 / prospectImg.height
          );
          const pw = prospectImg.width * pScale;
          const ph = prospectImg.height * pScale;
          page.drawImage(prospectImg, {
            x: infoX,
            y: iy - ph,
            width: pw,
            height: ph,
          });
          iy -= ph + 8;
        } catch {
          // skip
        }
      }
    }

    const drawInfoLabel = (label: string, value: string) => {
      page.drawText(label, {
        x: infoX,
        y: iy,
        size: 7,
        font: boldFont,
        color: GRAY,
      });
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
        page.drawText(l, {
          x: infoX,
          y: iy,
          size: 9,
          font: regularFont,
          color: BLACK,
        });
        iy -= 13;
      }
      iy -= 4;
    };

    drawInfoLabel("Name", pc.contactName);
    if (pc.contact.title) drawInfoLabel("Title", pc.contact.title);
    drawInfoLabel("Company", companyName);
    if (pc.contact.linkedinUrl) {
      const linkedinShort = pc.contact.linkedinUrl
        .replace("https://www.", "")
        .replace("https://", "")
        .slice(0, 40);
      drawInfoLabel("LinkedIn", linkedinShort);
    }
    if (pc.deliveryAddress) drawInfoLabel("Delivery", pc.deliveryAddress);
    const templateLabel =
      pc.template === "warroom" ? "War Room" : "Zoom Room";
    const statusLabel =
      pc.status.charAt(0).toUpperCase() + pc.status.slice(1);
    drawInfoLabel("Template", `${templateLabel} | ${statusLabel}`);

    y -= imgTargetH + 16;

    // === BOTTOM: Company + Open Roles + Team Members (3 columns) ===
    const col1W = CONTENT_W * 0.3;
    const col2W = CONTENT_W * 0.35;
    const col1X = MARGIN;
    const col2X = MARGIN + col1W;
    const col3X = MARGIN + col1W + col2W;

    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
    y -= 16;
    const sectionTop = y;

    // Column 1: COMPANY
    let c1y = sectionTop;
    page.drawText("COMPANY", {
      x: col1X,
      y: c1y,
      size: 8,
      font: boldFont,
      color: GRAY,
    });
    c1y -= 18;

    let logoEmbedded = false;
    const logoUrl = enrichment?.companyLogo;
    if (logoUrl) {
      const logoData = await fetchImageBytes(logoUrl);
      if (logoData) {
        try {
          const logoImg =
            logoData.type === "png"
              ? await doc.embedPng(logoData.bytes)
              : await doc.embedJpg(logoData.bytes);
          const logoScale = Math.min(
            36 / logoImg.width,
            36 / logoImg.height
          );
          const lw = logoImg.width * logoScale;
          const lh = logoImg.height * logoScale;
          page.drawImage(logoImg, {
            x: col1X,
            y: c1y - lh,
            width: lw,
            height: lh,
          });
          page.drawText(companyName, {
            x: col1X + lw + 8,
            y: c1y - 10,
            size: 10,
            font: boldFont,
            color: BLACK,
          });
          if (companyWebsite) {
            page.drawText(
              companyWebsite
                .replace("https://", "")
                .replace("http://", ""),
              {
                x: col1X + lw + 8,
                y: c1y - 24,
                size: 8,
                font: regularFont,
                color: GRAY,
              }
            );
          }
          logoEmbedded = true;
        } catch {
          // skip
        }
      }
    }
    if (!logoEmbedded) {
      page.drawText(companyName, {
        x: col1X,
        y: c1y,
        size: 10,
        font: boldFont,
        color: BLACK,
      });
      c1y -= 14;
      if (companyWebsite) {
        page.drawText(
          companyWebsite.replace("https://", "").replace("http://", ""),
          {
            x: col1X,
            y: c1y,
            size: 8,
            font: regularFont,
            color: GRAY,
          }
        );
      }
    }

    // Column 2: OPEN ROLES
    let c2y = sectionTop;
    page.drawText("OPEN ROLES", {
      x: col2X,
      y: c2y,
      size: 8,
      font: boldFont,
      color: GRAY,
    });
    c2y -= 18;
    if (openRoles.length === 0) {
      page.drawText("No roles found", {
        x: col2X,
        y: c2y,
        size: 9,
        font: regularFont,
        color: GRAY,
      });
    } else {
      for (const role of openRoles.slice(0, 6)) {
        const roleText = role.location
          ? `${role.title} (${role.location})`
          : role.title;
        const display =
          roleText.length > 45 ? roleText.slice(0, 42) + "..." : roleText;
        page.drawText(`• ${display}`, {
          x: col2X,
          y: c2y,
          size: 8,
          font: regularFont,
          color: BLACK,
        });
        c2y -= 14;
      }
      if (openRoles.length > 6) {
        page.drawText(`+ ${openRoles.length - 6} more`, {
          x: col2X,
          y: c2y,
          size: 8,
          font: regularFont,
          color: GRAY,
        });
      }
    }

    // Column 3: TEAM MEMBERS (with photos)
    let c3y = sectionTop;
    page.drawText("TEAM MEMBERS", {
      x: col3X,
      y: c3y,
      size: 8,
      font: boldFont,
      color: GRAY,
    });
    c3y -= 18;

    const PHOTO_SIZE = 28;
    const PHOTO_GAP = 6;

    if (teamPhotos.length === 0) {
      page.drawText("No team members found", {
        x: col3X,
        y: c3y,
        size: 9,
        font: regularFont,
        color: GRAY,
      });
    } else {
      for (const member of teamPhotos.slice(0, 5)) {
        let memberPhotoEmbedded = false;
        if (member.photoUrl) {
          const photoData = await fetchImageBytes(member.photoUrl);
          if (photoData) {
            try {
              const photoImg =
                photoData.type === "png"
                  ? await doc.embedPng(photoData.bytes)
                  : await doc.embedJpg(photoData.bytes);
              const ps = Math.min(
                PHOTO_SIZE / photoImg.width,
                PHOTO_SIZE / photoImg.height
              );
              const pw = photoImg.width * ps;
              const ph = photoImg.height * ps;
              page.drawImage(photoImg, {
                x: col3X,
                y: c3y - ph,
                width: pw,
                height: ph,
              });
              memberPhotoEmbedded = true;
            } catch {
              // skip photo
            }
          }
        }
        const textX = memberPhotoEmbedded
          ? col3X + PHOTO_SIZE + PHOTO_GAP
          : col3X;
        const memberName = member.name || "Team member";
        const nameDisplay =
          memberName.length > 25
            ? memberName.slice(0, 22) + "..."
            : memberName;
        page.drawText(nameDisplay, {
          x: textX,
          y: c3y - 10,
          size: 8,
          font: boldFont,
          color: BLACK,
        });
        if (member.title) {
          const titleDisplay =
            member.title.length > 28
              ? member.title.slice(0, 25) + "..."
              : member.title;
          page.drawText(titleDisplay, {
            x: textX,
            y: c3y - 22,
            size: 7,
            font: regularFont,
            color: GRAY,
          });
        }
        c3y -= PHOTO_SIZE + PHOTO_GAP;
      }
      if (teamPhotos.length > 5) {
        page.drawText(`+ ${teamPhotos.length - 5} more`, {
          x: col3X,
          y: c3y,
          size: 8,
          font: regularFont,
          color: GRAY,
        });
      }
    }

    // === FOOTER ===
    page.drawLine({
      start: { x: MARGIN, y: MARGIN - 8 },
      end: { x: PAGE_W - MARGIN, y: MARGIN - 8 },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
    page.drawText("WDISTT — Postcard Export", {
      x: MARGIN,
      y: MARGIN - 20,
      size: 7,
      font: regularFont,
      color: GRAY,
    });
    const pageLabel = `Page ${idx + 1} of ${sorted.length}`;
    const pageLabelW = regularFont.widthOfTextAtSize(pageLabel, 7);
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN - pageLabelW,
      y: MARGIN - 20,
      size: 7,
      font: regularFont,
      color: GRAY,
    });
  }

  const pdfBytes = await doc.save();

  return new Response(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="wdistt-postcard-export.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
