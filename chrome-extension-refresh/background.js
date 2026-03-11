// Background service worker — refreshes photos for specific leads from leads.js
// Uses existing /api/photos/upload endpoint. Skips placeholders locally.
importScripts("leads.js");

let isRunning = false;
let shouldStop = false;
let processed = 0;
let found = 0;
let skipped = 0;
let total = 0;
let lastTabId = null; // keep previous tab open until next one is ready

async function dlog(msg, data) {
  const entry = `${new Date().toISOString().slice(11, 19)} ${msg}${data ? " " + JSON.stringify(data) : ""}`;
  console.log("[PhotoRefresh]", msg, data || "");
  try {
    const store = await chrome.storage.local.get("debugLog");
    const logs = store.debugLog || [];
    logs.push(entry);
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    await chrome.storage.local.set({ debugLog: logs });
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "start") {
    if (!isRunning) startPhotoRefresh(msg.config);
    sendResponse({ ok: true });
  } else if (msg.action === "stop") {
    shouldStop = true;
    sendResponse({ ok: true });
  } else if (msg.action === "status") {
    sendResponse({ isRunning, processed, found, skipped, total, shouldStop });
  } else if (msg.action === "getLogs") {
    chrome.storage.local.get("debugLog", (store) => {
      sendResponse({ logs: (store.debugLog || []).join("\n") });
    });
    return true;
  } else if (msg.action === "clearLogs") {
    chrome.storage.local.set({ debugLog: [] });
    sendResponse({ ok: true });
  }
  return true;
});

async function startPhotoRefresh(config) {
  isRunning = true;
  shouldStop = false;
  processed = 0;
  found = 0;
  skipped = 0;
  total = LEADS.length;

  lastTabId = null;
  broadcastStatus(`Starting refresh for ${total} leads...`);

  try {
    for (const lead of LEADS) {
      if (shouldStop) {
        broadcastStatus("Stopped by user");
        break;
      }

      processed++;
      broadcastStatus(`${processed}/${total}: Opening ${lead.name} (${lead.company})...`);
      await dlog("Processing:", `${lead.name} — ${lead.linkedinUrl}`);

      const result = await extractAndDownloadPhoto(lead.linkedinUrl, config);

      if (result === "placeholder") {
        skipped++;
        broadcastStatus(`${processed}/${total}: ${lead.name} — PLACEHOLDER, skipped (${skipped} skipped)`);
        await dlog("Skipped placeholder:", lead.name);
      } else if (result && result.base64) {
        broadcastStatus(`${processed}/${total}: Uploading ${lead.name}...`);

        const body = {
          key: config.API_KEY,
          type: lead.type,
          contactId: lead.contactId,
          imageBase64: result.base64,
          contentType: result.contentType,
        };
        if (lead.type === "team") {
          body.enrichmentId = lead.enrichmentId;
          body.teamIndex = lead.teamIndex;
        }

        const uploadRes = await fetch(`${config.APP_URL}/api/photos/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (uploadRes.ok) {
          found++;
          broadcastStatus(`${processed}/${total}: ${lead.name} — UPLOADED (${found} total)`);
          await dlog("Uploaded:", lead.name);
        } else {
          const err = await uploadRes.json().catch(() => ({}));
          broadcastStatus(`${processed}/${total}: ${lead.name} — upload failed: ${err.error || uploadRes.status}`);
          await dlog("Upload failed:", `${lead.name}: ${err.error || uploadRes.status}`);
        }
      } else {
        broadcastStatus(`${processed}/${total}: ${lead.name} — no photo found`);
        await dlog("No photo found:", lead.name);
      }

      if (!shouldStop) {
        // Random delay 10-30s to avoid LinkedIn rate limits
        const delay = 10000 + Math.floor(Math.random() * 20000);
        await dlog("Waiting:", `${(delay / 1000).toFixed(1)}s`);
        await sleep(delay);
      }
    }

    // Close the last tab
    if (lastTabId) {
      try { chrome.tabs.remove(lastTabId); } catch {}
      lastTabId = null;
    }

    broadcastStatus(`Done! Uploaded ${found}/${total}, skipped ${skipped} placeholders`);
  } catch (err) {
    broadcastStatus(`Error: ${err.message}`);
    await dlog("Fatal error:", err.message);
  }

  // Clean up tab on error/stop too
  if (lastTabId) {
    try { chrome.tabs.remove(lastTabId); } catch {}
    lastTabId = null;
  }

  isRunning = false;
}

async function extractAndDownloadPhoto(linkedinUrl, config) {
  let url = linkedinUrl;
  if (!url.startsWith("http")) url = "https://" + url;
  if (!url.includes("linkedin.com")) return null;

  // Close the PREVIOUS tab now that we're opening a new one
  if (lastTabId) {
    try { chrome.tabs.remove(lastTabId); } catch {}
    lastTabId = null;
  }

  await dlog("Opening tab:", url);
  const tab = await chrome.tabs.create({ url, active: true });
  lastTabId = tab.id; // keep this tab open until next lead

  try {
    await waitForTabLoad(tab.id, config.PAGE_LOAD_WAIT || 3000);
    await sleep(4000);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: grabPhotoViaCanvas,
    });

    const imageData = results?.[0]?.result;
    await dlog("grabPhotoViaCanvas result:", imageData
      ? (imageData === "placeholder" ? "PLACEHOLDER" : `${imageData.contentType}, ${imageData.base64?.length} chars`)
      : "null");

    if (imageData === "placeholder") return "placeholder";
    if (!imageData || !imageData.base64) return null;

    return imageData;
  } catch (err) {
    await dlog("Extract FAILED:", err.message);
    return null;
  }
}

// Runs IN the LinkedIn page — finds profile photo, checks for placeholder locally
function grabPhotoViaCanvas() {
  const selectors = [
    'img.pv-top-card-profile-picture__image--show',
    'img.pv-top-card-profile-picture__image',
    'button.pv-top-card-profile-picture__container img',
    'div.pv-top-card__non-self-photo-wrapper img',
    '.pv-top-card--photo img',
    'img[src*="profile-displayphoto"]',
    'img[src*="media.licdn.com/dms/image"]',
  ];

  // URL patterns that indicate a placeholder / default avatar
  const placeholderPatterns = [
    'static.licdn.com/aero-v1/sc/h/',
    'static.licdn.com/sc/h/',
    '/ghost-',
    '/default-avatar',
    'data:image/gif',
    'data:image/svg',
    '/blank-profile',
  ];

  // Letter-initial avatar pattern: LinkedIn generates these for people without photos
  // They look like colored circles with the person's initial
  const letterAvatarPatterns = [
    'dms/image/v2/D',     // LinkedIn CDN path for generated avatars
    'shrink_100_100',     // tiny thumbnails are usually placeholders
  ];

  for (const selector of selectors) {
    const imgs = document.querySelectorAll(selector);
    for (const img of imgs) {
      const src = img.src || '';
      if (!src) continue;

      // Check known placeholder URL patterns
      if (placeholderPatterns.some(p => src.includes(p))) return "placeholder";

      // Skip tiny images
      if (img.naturalWidth < 50 || img.naturalHeight < 50) continue;

      // Must be from LinkedIn CDN
      if (!(src.includes('media.licdn.com') || src.includes('profile-displayphoto'))) continue;

      // Draw to canvas and check if it's a real photo vs letter placeholder
      return new Promise((resolve) => {
        const newImg = new Image();
        newImg.crossOrigin = 'anonymous';
        newImg.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = newImg.naturalWidth;
            canvas.height = newImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(newImg, 0, 0);

            // Color uniqueness check — placeholders/letter avatars have very few unique colors
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            const colorSet = new Set();
            // Sample every ~100th pixel for speed
            const step = Math.max(4, Math.floor(pixels.length / 4000) * 4);
            for (let i = 0; i < pixels.length; i += step) {
              // Quantize to reduce noise (group similar colors)
              const r = Math.floor(pixels[i] / 8) * 8;
              const g = Math.floor(pixels[i + 1] / 8) * 8;
              const b = Math.floor(pixels[i + 2] / 8) * 8;
              colorSet.add(`${r},${g},${b}`);
            }

            // Real human photos: 100+ unique quantized colors
            // Letter placeholders: 5-40 unique quantized colors
            if (colorSet.size < 50) {
              resolve("placeholder");
              return;
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            const base64 = dataUrl.split(',')[1];
            resolve(base64 && base64.length > 1000 ? { base64, contentType: 'image/jpeg' } : null);
          } catch {
            resolve(null);
          }
        };
        newImg.onerror = () => resolve(null);
        newImg.src = src + (src.includes('?') ? '&' : '?') + '_cors=1';
      });
    }
  }
  return null;
}

function waitForTabLoad(tabId, timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout + 5000);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function broadcastStatus(message) {
  chrome.runtime.sendMessage({
    action: "statusUpdate",
    message,
    stats: { isRunning, processed, found, skipped, total },
  }).catch(() => {});
}
