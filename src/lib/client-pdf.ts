/**
 * Client-side PDF generation using pdf-lib.
 * Runs entirely in the browser — no Vercel function needed, no timeout possible.
 */
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";

// ── Image helpers ──

/** Load image at full resolution as JPG 100% quality (for print PDF) */
async function loadImageFullRes(
  url: string
): Promise<{ bytes: Uint8Array; type: "jpg" } | null> {
  const jpg = await resizeViaCanvas(url, undefined, undefined, 1.0);
  return jpg ? { bytes: jpg, type: "jpg" } : null;
}

/** Load + downscale image via canvas, output as JPEG. maxW/maxH cap the dimensions. */
async function loadImageResized(
  url: string,
  maxW: number,
  maxH: number
): Promise<{ bytes: Uint8Array; type: "jpg" } | null> {
  const jpg = await resizeViaCanvas(url, maxW, maxH);
  return jpg ? { bytes: jpg, type: "jpg" } : null;
}

function resizeViaCanvas(url: string, maxW?: number, maxH?: number, quality = 0.85): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (maxW && maxH) {
        const scale = Math.min(1, maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(null); return; }
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function embedImage(doc: PDFDocument, data: { bytes: Uint8Array; type: "png" | "jpg" }) {
  return data.type === "png" ? doc.embedPng(data.bytes) : doc.embedJpg(data.bytes);
}

// ── Types ──

export interface PrintPostcard {
  imageUrl: string | null;
  contactName: string;
  contact: {
    company: string | null;
    companyEnrichments?: { companyName?: string | null }[];
  };
}

export interface ExportPostcard {
  imageUrl: string | null;
  contactName: string;
  deliveryAddress: string | null;
  template: string;
  status: string;
  contact: {
    name: string;
    company: string | null;
    title: string | null;
    linkedinUrl: string;
    profileImageUrl: string | null;
    companyEnrichments?: {
      companyName?: string | null;
      companyWebsite?: string | null;
      companyLogo?: string | null;
      openRoles?: { title: string; location?: string }[] | null;
      teamPhotos?: { name?: string; photoUrl: string; title?: string }[] | null;
    }[];
  };
}

function sortByCompany<T extends { contact: { company: string | null; companyEnrichments?: { companyName?: string | null }[] } }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ca = (a.contact.companyEnrichments?.[0]?.companyName || a.contact.company || "ZZZ").toLowerCase();
    const cb = (b.contact.companyEnrichments?.[0]?.companyName || b.contact.company || "ZZZ").toLowerCase();
    return ca.localeCompare(cb);
  });
}

function triggerDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Print PDF ──

const POSTCARD_W = 6 * 72;
const POSTCARD_H = 4.25 * 72;

export async function generateAndDownloadPrintPdf(
  postcards: PrintPostcard[],
  onProgress?: (done: number, total: number) => void
) {
  const sorted = sortByCompany(postcards.filter((p) => p.imageUrl));
  if (sorted.length === 0) throw new Error("No postcards with images");

  const doc = await PDFDocument.create();

  for (let i = 0; i < sorted.length; i++) {
    onProgress?.(i, sorted.length);
    const pc = sorted[i];
    const imgData = await loadImageFullRes(pc.imageUrl!);
    if (imgData) {
      try {
        const embedded = await embedImage(doc, imgData);
        const aspect = embedded.width / embedded.height;
        let pageW: number, pageH: number;
        if (aspect >= 1) { pageW = POSTCARD_W; pageH = POSTCARD_W / aspect; }
        else { pageH = POSTCARD_W; pageW = POSTCARD_W * aspect; }
        const page = doc.addPage([pageW, pageH]);
        page.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH });
      } catch {
        const page = doc.addPage([POSTCARD_W, POSTCARD_H]);
        page.drawRectangle({ x: 0, y: 0, width: POSTCARD_W, height: POSTCARD_H, color: rgb(0.95, 0.95, 0.95) });
        page.drawText(`[Image failed: ${pc.contactName}]`, { x: 20, y: POSTCARD_H / 2, size: 10, color: rgb(0.5, 0.5, 0.5) });
      }
    } else {
      const page = doc.addPage([POSTCARD_W, POSTCARD_H]);
      page.drawRectangle({ x: 0, y: 0, width: POSTCARD_W, height: POSTCARD_H, color: rgb(0.95, 0.95, 0.95) });
      page.drawText(`[No image: ${pc.contactName}]`, { x: 20, y: POSTCARD_H / 2, size: 10, color: rgb(0.5, 0.5, 0.5) });
    }
  }

  onProgress?.(sorted.length, sorted.length);
  const pdfBytes = await doc.save();
  triggerDownload(pdfBytes, "postcards-print-ready.pdf");
}

// ── Export PDF ──

const PAGE_W = PageSizes.A4[1];
const PAGE_H = PageSizes.A4[0];
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
const BLUE = rgb(0.15, 0.35, 0.75);
const ACCENT_BG = rgb(0.97, 0.97, 0.98);

export async function generateAndDownloadExportPdf(
  postcards: ExportPostcard[],
  onProgress?: (done: number, total: number) => void
) {
  const sorted = sortByCompany(postcards.filter((p) => p.imageUrl));
  if (sorted.length === 0) throw new Error("No postcards with images");

  const doc = await PDFDocument.create();
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let idx = 0; idx < sorted.length; idx++) {
    onProgress?.(idx, sorted.length);
    const pc = sorted[idx];
    const enrichment = pc.contact.companyEnrichments?.[0] || null;
    const companyName = enrichment?.companyName || pc.contact.company || "Unknown";
    const companyWebsite = enrichment?.companyWebsite || "";
    const openRoles = (enrichment?.openRoles as { title: string; location?: string }[] | null) || [];
    const teamPhotos = (enrichment?.teamPhotos as { name?: string; photoUrl: string; title?: string }[] | null) || [];

    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    // Header bar
    page.drawRectangle({ x: 0, y: PAGE_H - 50, width: PAGE_W, height: 50, color: BLUE });
    page.drawText("WDISTT — Postcard Export", { x: MARGIN, y: PAGE_H - 33, size: 11, font: boldFont, color: rgb(0.7, 0.8, 1) });
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const dateW = regularFont.widthOfTextAtSize(dateStr, 9);
    page.drawText(dateStr, { x: PAGE_W - MARGIN - dateW, y: PAGE_H - 33, size: 9, font: regularFont, color: rgb(0.7, 0.8, 1) });

    y = PAGE_H - 50 - 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: LIGHT_GRAY });
    y -= 16;

    // Postcard image + prospect info
    const imgTargetW = 380;
    const imgTargetH = 260;
    const infoX = MARGIN + imgTargetW + 24;
    const infoW = CONTENT_W - imgTargetW - 24;

    let imageEmbedded = false;
    if (pc.imageUrl) {
      const imgData = await loadImageResized(pc.imageUrl, imgTargetW * 2, imgTargetH * 2);
      if (imgData) {
        try {
          const embedded = await embedImage(doc, imgData);
          const scale = Math.min(imgTargetW / embedded.width, imgTargetH / embedded.height);
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;
          page.drawRectangle({ x: MARGIN, y: y - imgTargetH, width: imgTargetW, height: imgTargetH, color: ACCENT_BG });
          page.drawImage(embedded, {
            x: MARGIN + (imgTargetW - drawW) / 2,
            y: y - imgTargetH + (imgTargetH - drawH) / 2,
            width: drawW, height: drawH,
          });
          imageEmbedded = true;
        } catch { /* skip */ }
      }
    }
    if (!imageEmbedded) {
      page.drawRectangle({ x: MARGIN, y: y - imgTargetH, width: imgTargetW, height: imgTargetH, color: ACCENT_BG });
      page.drawText("[No image available]", { x: MARGIN + imgTargetW / 2 - 50, y: y - imgTargetH / 2, size: 10, font: regularFont, color: GRAY });
    }

    // Prospect info (right side)
    let iy = y - 4;
    page.drawText("PROSPECT", { x: infoX, y: iy, size: 8, font: boldFont, color: GRAY });
    iy -= 18;

    if (pc.contact.profileImageUrl) {
      const prospectData = await loadImageResized(pc.contact.profileImageUrl, 96, 96);
      if (prospectData) {
        try {
          const prospectImg = await embedImage(doc, prospectData);
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
        if (regularFont.widthOfTextAtSize(test, 9) > infoW && line) { lines.push(line); line = w; }
        else line = test;
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
      drawInfoLabel("LinkedIn", pc.contact.linkedinUrl.replace("https://www.", "").replace("https://", "").slice(0, 40));
    }
    if (pc.deliveryAddress) drawInfoLabel("Delivery", pc.deliveryAddress);
    const templateLabel = pc.template === "warroom" ? "War Room" : "Zoom Room";
    const statusLabel = pc.status.charAt(0).toUpperCase() + pc.status.slice(1);
    drawInfoLabel("Template", `${templateLabel} | ${statusLabel}`);

    y -= imgTargetH + 16;

    // Bottom: Company + Open Roles + Team Members
    const col1W = CONTENT_W * 0.3;
    const col2W = CONTENT_W * 0.35;
    const col1X = MARGIN;
    const col2X = MARGIN + col1W;
    const col3X = MARGIN + col1W + col2W;

    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: LIGHT_GRAY });
    y -= 16;
    const sectionTop = y;

    // Col 1: Company
    let c1y = sectionTop;
    page.drawText("COMPANY", { x: col1X, y: c1y, size: 8, font: boldFont, color: GRAY });
    c1y -= 18;
    let logoEmbedded = false;
    if (enrichment?.companyLogo) {
      const logoData = await loadImageResized(enrichment.companyLogo, 72, 72);
      if (logoData) {
        try {
          const logoImg = await embedImage(doc, logoData);
          const ls = Math.min(36 / logoImg.width, 36 / logoImg.height);
          const lw = logoImg.width * ls, lh = logoImg.height * ls;
          page.drawImage(logoImg, { x: col1X, y: c1y - lh, width: lw, height: lh });
          page.drawText(companyName, { x: col1X + lw + 8, y: c1y - 10, size: 10, font: boldFont, color: BLACK });
          if (companyWebsite) {
            page.drawText(companyWebsite.replace("https://", "").replace("http://", ""), {
              x: col1X + lw + 8, y: c1y - 24, size: 8, font: regularFont, color: GRAY,
            });
          }
          logoEmbedded = true;
        } catch { /* skip */ }
      }
    }
    if (!logoEmbedded) {
      page.drawText(companyName, { x: col1X, y: c1y, size: 10, font: boldFont, color: BLACK });
      c1y -= 14;
      if (companyWebsite) {
        page.drawText(companyWebsite.replace("https://", "").replace("http://", ""), {
          x: col1X, y: c1y, size: 8, font: regularFont, color: GRAY,
        });
      }
    }

    // Col 2: Open Roles
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
        page.drawText(`+ ${openRoles.length - 6} more`, { x: col2X, y: c2y, size: 8, font: regularFont, color: GRAY });
      }
    }

    // Col 3: Team Members
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
          const photoData = await loadImageResized(member.photoUrl, 56, 56);
          if (photoData) {
            try {
              const photoImg = await embedImage(doc, photoData);
              const ps = Math.min(PHOTO_SIZE / photoImg.width, PHOTO_SIZE / photoImg.height);
              page.drawImage(photoImg, { x: col3X, y: c3y - photoImg.height * ps, width: photoImg.width * ps, height: photoImg.height * ps });
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
        page.drawText(`+ ${teamPhotos.length - 5} more`, { x: col3X, y: c3y, size: 8, font: regularFont, color: GRAY });
      }
    }

    // Footer
    page.drawLine({ start: { x: MARGIN, y: MARGIN - 8 }, end: { x: PAGE_W - MARGIN, y: MARGIN - 8 }, thickness: 0.5, color: LIGHT_GRAY });
    page.drawText("WDISTT — Postcard Export", { x: MARGIN, y: MARGIN - 20, size: 7, font: regularFont, color: GRAY });
    const pageLabel = `Page ${idx + 1} of ${sorted.length}`;
    const pageLabelW = regularFont.widthOfTextAtSize(pageLabel, 7);
    page.drawText(pageLabel, { x: PAGE_W - MARGIN - pageLabelW, y: MARGIN - 20, size: 7, font: regularFont, color: GRAY });
  }

  onProgress?.(sorted.length, sorted.length);
  const pdfBytes = await doc.save();
  triggerDownload(pdfBytes, "wdistt-postcard-export.pdf");
}
