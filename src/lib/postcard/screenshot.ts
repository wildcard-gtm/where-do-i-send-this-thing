import fs from "fs/promises";
import path from "path";

export async function screenshotPostcard(
  postcardId: string,
  outputPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const renderUrl = `${appUrl}/postcard-render/${postcardId}`;

  // Use @sparticuz/chromium on Vercel, regular playwright in dev
  if (process.env.VERCEL || process.env.AWS_REGION) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: playwrightCore } = await import("playwright-core");

    const executablePath = await chromium.executablePath();
    const browser = await playwrightCore.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto(renderUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: outputPath, fullPage: false });
    await browser.close();
  } else {
    // Local dev: use playwright directly
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto(renderUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: outputPath, fullPage: false });
    await browser.close();
  }
}
