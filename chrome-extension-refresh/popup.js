const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const totalVal = document.getElementById("totalVal");
const processedVal = document.getElementById("processedVal");
const foundVal = document.getElementById("foundVal");
const skippedVal = document.getElementById("skippedVal");

function addLog(message, type = "") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logEl.prepend(entry);
  while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
}

function updateStats(stats) {
  if (stats.total) totalVal.textContent = stats.total;
  processedVal.textContent = stats.processed || 0;
  foundVal.textContent = stats.found || 0;
  skippedVal.textContent = stats.skipped || 0;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "statusUpdate") {
    statusEl.textContent = msg.message;
    updateStats(msg.stats);

    let type = "";
    if (msg.message.includes("UPLOADED")) type = "success";
    else if (msg.message.includes("PLACEHOLDER") || msg.message.includes("skipped")) type = "warn";
    else if (msg.message.includes("failed") || msg.message.includes("Error") || msg.message.includes("no photo")) type = "error";
    addLog(msg.message, type);

    if (!msg.stats.isRunning) {
      startBtn.style.display = "block";
      stopBtn.style.display = "none";
      startBtn.disabled = false;
    }
  }
});

chrome.runtime.sendMessage({ action: "status" }, (res) => {
  if (res && res.isRunning) {
    startBtn.style.display = "none";
    stopBtn.style.display = "block";
    updateStats(res);
    statusEl.textContent = `Running... ${res.processed}/${res.total}`;
  } else if (res && res.total > 0) {
    updateStats(res);
  }
});

startBtn.addEventListener("click", () => {
  startBtn.disabled = true;
  startBtn.style.display = "none";
  stopBtn.style.display = "block";
  statusEl.textContent = "Starting...";
  addLog("Starting photo refresh for leads...");
  chrome.runtime.sendMessage({ action: "start", config: CONFIG });
});

stopBtn.addEventListener("click", () => {
  stopBtn.style.display = "none";
  startBtn.style.display = "block";
  startBtn.disabled = true;
  statusEl.textContent = "Stopping...";
  addLog("Stopping...");
  chrome.runtime.sendMessage({ action: "stop" });
});

document.getElementById("copyLogsBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "getLogs" }, (res) => {
    if (res && res.logs && res.logs.length > 0) {
      navigator.clipboard.writeText(res.logs).then(() => {
        addLog("Debug logs copied to clipboard!", "success");
      });
    } else {
      addLog("No logs available yet", "error");
    }
  });
});

chrome.storage.local.get("debugLog", (store) => {
  const logs = store.debugLog || [];
  if (logs.length > 0) {
    const recent = logs.slice(-10);
    for (const entry of recent) {
      addLog("[debug] " + entry, "");
    }
  }
});
