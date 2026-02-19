import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
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
    return new Response("Contact not found", { status: 404 });
  }

  const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
  const decision = jobResult?.decision;

  // --- Build PDF ---
  const doc = await PDFDocument.create();
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = PageSizes.A4[0];
  const PAGE_H = PageSizes.A4[1];
  const MARGIN = 50;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  // Colors
  const BLACK = rgb(0.1, 0.1, 0.1);
  const GRAY = rgb(0.45, 0.45, 0.45);
  const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
  const WHITE = rgb(1, 1, 1);
  const BLUE = rgb(0.15, 0.35, 0.75);
  const GREEN = rgb(0.12, 0.6, 0.35);
  const AMBER = rgb(0.8, 0.5, 0.1);
  const RED = rgb(0.75, 0.15, 0.15);
  const ACCENT_BG = rgb(0.97, 0.97, 0.98);

  // State for current page and y cursor
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }

  function drawText(
    text: string,
    options: {
      size?: number;
      font?: typeof boldFont;
      color?: ReturnType<typeof rgb>;
      x?: number;
      maxWidth?: number;
    } = {}
  ) {
    const {
      size = 10,
      font = regularFont,
      color = BLACK,
      x = MARGIN,
      maxWidth = CONTENT_W,
    } = options;

    // Word-wrap
    const words = text.split(" ");
    let line = "";
    const lines: string[] = [];

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(test, size);
      if (w > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    for (const l of lines) {
      ensureSpace(size + 4);
      page.drawText(l, { x, y, size, font, color });
      y -= size + 4;
    }
  }

  function drawLabel(label: string, value: string) {
    ensureSpace(30);
    page.drawText(label.toUpperCase(), {
      x: MARGIN,
      y,
      size: 7,
      font: boldFont,
      color: GRAY,
    });
    y -= 13;
    drawText(value, { size: 10 });
    y -= 4;
  }

  function drawSectionHeader(title: string) {
    ensureSpace(30);
    y -= 8;
    // Line
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
    y -= 14;
    page.drawText(title.toUpperCase(), {
      x: MARGIN,
      y,
      size: 8,
      font: boldFont,
      color: GRAY,
    });
    y -= 14;
  }

  // Strip markdown formatting for PDF plain text
  function stripMarkdown(text: string): string {
    return text
      .replace(/#{1,6}\s+/g, "") // headers
      .replace(/\*\*(.+?)\*\*/g, "$1") // bold
      .replace(/\*(.+?)\*/g, "$1") // italic
      .replace(/`(.+?)`/g, "$1") // inline code
      .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
      .replace(/^[-*+]\s+/gm, "• ") // bullets
      .replace(/^\d+\.\s+/gm, "") // ordered list
      .replace(/\n{3,}/g, "\n\n") // collapse blank lines
      .trim();
  }

  // =====================
  // HEADER BLOCK
  // =====================
  // Blue header bar
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 110,
    width: PAGE_W,
    height: 110,
    color: BLUE,
  });

  // Logo / App name
  page.drawText("WDISTT", {
    x: MARGIN,
    y: PAGE_H - 38,
    size: 11,
    font: boldFont,
    color: rgb(0.7, 0.8, 1),
  });
  page.drawText("Address Intelligence Report", {
    x: MARGIN,
    y: PAGE_H - 54,
    size: 8,
    font: regularFont,
    color: rgb(0.7, 0.8, 1),
  });

  // Name
  const nameSize = contact.name.length > 30 ? 20 : 24;
  page.drawText(contact.name, {
    x: MARGIN,
    y: PAGE_H - 82,
    size: nameSize,
    font: boldFont,
    color: WHITE,
  });

  // Title / Company
  const subtitle = [contact.title, contact.company].filter(Boolean).join(" at ");
  if (subtitle) {
    page.drawText(subtitle, {
      x: MARGIN,
      y: PAGE_H - 100,
      size: 9,
      font: regularFont,
      color: rgb(0.8, 0.88, 1),
    });
  }

  // Date on top right
  const scanDate = contact.lastScannedAt
    ? new Date(contact.lastScannedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
  page.drawText(`Generated ${scanDate}`, {
    x: PAGE_W - MARGIN - 140,
    y: PAGE_H - 38,
    size: 8,
    font: regularFont,
    color: rgb(0.7, 0.8, 1),
  });

  y = PAGE_H - 130;

  // =====================
  // RECOMMENDATION BADGE
  // =====================
  if (contact.recommendation) {
    ensureSpace(60);
    y -= 10;

    const recColor =
      contact.recommendation === "HOME"
        ? GREEN
        : contact.recommendation === "OFFICE"
        ? BLUE
        : AMBER;
    const recBg =
      contact.recommendation === "HOME"
        ? rgb(0.9, 0.97, 0.93)
        : contact.recommendation === "OFFICE"
        ? rgb(0.93, 0.95, 0.99)
        : rgb(0.99, 0.96, 0.9);

    // Badge background
    const badgeW = 180;
    const badgeH = 40;
    page.drawRectangle({
      x: MARGIN,
      y: y - badgeH,
      width: badgeW,
      height: badgeH,
      color: recBg,
      borderColor: recColor,
      borderWidth: 1.5,
    });

    page.drawText("SEND TO", {
      x: MARGIN + 12,
      y: y - 14,
      size: 7,
      font: boldFont,
      color: GRAY,
    });
    page.drawText(contact.recommendation, {
      x: MARGIN + 12,
      y: y - 30,
      size: 16,
      font: boldFont,
      color: recColor,
    });

    // Confidence score
    if (contact.confidence !== null) {
      const confColor =
        contact.confidence >= 85 ? GREEN : contact.confidence >= 75 ? AMBER : RED;
      page.drawText(`${contact.confidence}% confidence`, {
        x: MARGIN + badgeW + 16,
        y: y - 20,
        size: 12,
        font: boldFont,
        color: confColor,
      });
    }

    y -= badgeH + 16;
  }

  // =====================
  // ADDRESSES
  // =====================
  if (contact.homeAddress || contact.officeAddress) {
    drawSectionHeader("Delivery Addresses");

    const boxH = 50;
    const boxW = contact.homeAddress && contact.officeAddress ? (CONTENT_W - 12) / 2 : CONTENT_W;

    if (contact.homeAddress) {
      ensureSpace(boxH + 10);
      const bx = MARGIN;
      page.drawRectangle({ x: bx, y: y - boxH, width: boxW, height: boxH, color: ACCENT_BG });
      page.drawText("HOME", { x: bx + 10, y: y - 14, size: 7, font: boldFont, color: GREEN });
      // Wrap address inside box
      const addr = contact.homeAddress;
      const maxW = boxW - 20;
      const words = addr.split(" ");
      let line = "";
      const aLines: string[] = [];
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (regularFont.widthOfTextAtSize(test, 9) > maxW && line) {
          aLines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) aLines.push(line);
      let ay = y - 26;
      for (const al of aLines.slice(0, 2)) {
        page.drawText(al, { x: bx + 10, y: ay, size: 9, font: regularFont, color: BLACK });
        ay -= 12;
      }
    }

    if (contact.officeAddress) {
      ensureSpace(boxH + 10);
      const bx = contact.homeAddress ? MARGIN + boxW + 12 : MARGIN;
      page.drawRectangle({ x: bx, y: y - boxH, width: boxW, height: boxH, color: ACCENT_BG });
      page.drawText("OFFICE", { x: bx + 10, y: y - 14, size: 7, font: boldFont, color: BLUE });
      const addr = contact.officeAddress;
      const maxW = boxW - 20;
      const words = addr.split(" ");
      let line = "";
      const aLines: string[] = [];
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (regularFont.widthOfTextAtSize(test, 9) > maxW && line) {
          aLines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) aLines.push(line);
      let ay = y - 26;
      for (const al of aLines.slice(0, 2)) {
        page.drawText(al, { x: bx + 10, y: ay, size: 9, font: regularFont, color: BLACK });
        ay -= 12;
      }
    }

    y -= boxH + 14;
  }

  // =====================
  // CONTACT DETAILS
  // =====================
  drawSectionHeader("Contact Details");

  if (contact.email) {
    drawLabel("Email", contact.email);
  }
  drawLabel("LinkedIn", contact.linkedinUrl);
  if (contact.lastScannedAt) {
    drawLabel("Last Scanned", scanDate);
  }

  // =====================
  // CAREER SUMMARY
  // =====================
  if (contact.careerSummary) {
    drawSectionHeader("Background");
    const plain = stripMarkdown(contact.careerSummary);
    const paragraphs = plain.split("\n\n");
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      drawText(trimmed, { size: 9, color: GRAY });
      y -= 6;
    }
  }

  // =====================
  // AI REASONING / REPORT
  // =====================
  if (decision?.reasoning) {
    drawSectionHeader("Research Report");
    const plain = stripMarkdown(decision.reasoning);
    const paragraphs = plain.split("\n\n");
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      // Check if it looks like a heading (short, ends without period)
      if (trimmed.length < 60 && !trimmed.endsWith(".") && !trimmed.startsWith("•")) {
        ensureSpace(20);
        page.drawText(trimmed, {
          x: MARGIN,
          y,
          size: 9,
          font: boldFont,
          color: BLACK,
        });
        y -= 16;
      } else {
        drawText(trimmed, { size: 9, color: GRAY });
        y -= 6;
      }
    }
  }

  // =====================
  // FOOTER on all pages
  // =====================
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const p = doc.getPage(i);
    const pw = p.getWidth();
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 8 },
      end: { x: pw - MARGIN, y: MARGIN - 8 },
      thickness: 0.5,
      color: LIGHT_GRAY,
    });
    p.drawText("WDISTT — Address Intelligence", {
      x: MARGIN,
      y: MARGIN - 20,
      size: 7,
      font: regularFont,
      color: GRAY,
    });
    p.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: pw - MARGIN - 60,
      y: MARGIN - 20,
      size: 7,
      font: regularFont,
      color: GRAY,
    });
  }

  const pdfBytes = await doc.save();

  const safeName = contact.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return new Response(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="wdistt_${safeName}_report.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
