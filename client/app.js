/**
 * Mirrors worker SYSTEM_PROMPT for read-only display only (no secrets).
 * Avoid em-dash in UI copy.
 */
const DISPLAY_SYSTEM_PROMPT = `You draft concise architecture decision records and decision memos from raw notes.

Output ONLY structured Markdown using exactly these top-level headings in this order:
## Context
## Options
## Trade-offs
## Recommendation
## Open Questions

Rules:
- Under each heading use short bullets or tight paragraphs. No filler.
- Professional tone. No emoji. No hype.
- Do not use em-dash punctuation anywhere in the document; use hyphen or colon instead.
- If information is missing, say so under Open Questions rather than inventing facts.
- Recommendation must be actionable and scoped to what the context supports.`;

const STORAGE_KEY = "labs_ai_worker_base";

/** @type {HTMLTextAreaElement | null} */
const ctxEl = document.querySelector("#ctx");
/** @type {HTMLButtonElement | null} */
const goBtn = document.querySelector("#go");
/** @type {HTMLButtonElement | null} */
const abortBtn = document.querySelector("#abort");
/** @type {HTMLButtonElement | null} */
const dlBtn = document.querySelector("#download");
/** @type {HTMLButtonElement | null} */
const resetBtn = document.querySelector("#reset");
/** @type {HTMLParagraphElement | null} */
const statusEl = document.querySelector("#status");
/** @type {HTMLParagraphElement | null} */
const workerWarnEl = document.querySelector("#workerWarn");
/** @type {HTMLDivElement | null} */
const outEl = document.querySelector("#out");
/** @type {HTMLInputElement | null} */
const showPromptEl = document.querySelector("#showPrompt");
/** @type {HTMLDivElement | null} */
const promptPanelEl = document.querySelector("#promptPanel");

let accumulated = "";
/** @type {AbortController | null} */
let active = null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function showWorkerWarning(text) {
  if (!workerWarnEl) return;
  workerWarnEl.hidden = !text;
  workerWarnEl.textContent = text;
}

async function resolveWorkerBase() {
  const injected =
    typeof window.__WORKER_BASE__ === "string" ? window.__WORKER_BASE__.trim() : "";
  if (injected) return injected.replace(/\/+$/, "");

  try {
    const raw = await fetch("./config.json", { cache: "no-store" });
    if (raw.ok) {
      const j = await raw.json();
      if (j && typeof j.workerBase === "string" && j.workerBase.trim()) {
        return j.workerBase.trim().replace(/\/+$/, "");
      }
    }
  } catch {
    /* ignore */
  }

  const ls = localStorage.getItem(STORAGE_KEY);
  return ls ? ls.trim().replace(/\/+$/, "") : "";
}

/**
 * @param {string} rawEvent
 * @param {(t: string) => void} onText
 */
function processSseEvent(rawEvent, onText) {
  const lines = rawEvent.split("\n");
  let eventName = "";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const dataStr = dataLines.join("\n").trim();
  if (!dataStr) return;
  if (eventName === "error") {
    throw new Error(dataStr);
  }
  let payload;
  try {
    payload = JSON.parse(dataStr);
  } catch {
    return;
  }
  if (payload.type === "content_block_delta" && payload.delta) {
    const d = payload.delta;
    if (d.type === "text_delta" && typeof d.text === "string") {
      onText(d.text);
    }
  }
  if (payload.type === "message_delta" && payload.delta?.stop_reason === "error") {
    throw new Error("Model ended with error");
  }
}

async function streamDraft(workerBase, contextText) {
  const url = `${workerBase}/v1/draft`;
  active = new AbortController();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: contextText }),
    signal: active.signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${detail}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const flushText = (t) => {
    accumulated += t;
    if (outEl) outEl.textContent = accumulated;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      processSseEvent(rawEvent, flushText);
    }
  }
  if (buffer.trim()) {
    processSseEvent(buffer.trim(), flushText);
  }
}

function wirePromptToggle() {
  if (!showPromptEl || !promptPanelEl) return;
  promptPanelEl.textContent = DISPLAY_SYSTEM_PROMPT;
  showPromptEl.addEventListener("change", () => {
    const on = showPromptEl.checked;
    promptPanelEl.style.display = on ? "block" : "none";
    promptPanelEl.setAttribute("aria-hidden", on ? "false" : "true");
  });
}

function downloadMd() {
  const blob = new Blob([accumulated], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "adr-draft.md";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function main() {
  wirePromptToggle();

  const base = await resolveWorkerBase();
  if (!base) {
    showWorkerWarning(
      "Set worker URL: edit client/config.json after deploy, inject window.__WORKER_BASE__, or localStorage labs_ai_worker_base.",
    );
  } else {
    showWorkerWarning("");
  }

  goBtn?.addEventListener("click", async () => {
    const wb = (await resolveWorkerBase()) || "";
    if (!wb) {
      setStatus("Missing worker base URL.");
      return;
    }
    const text = ctxEl?.value ?? "";
    if (!text.trim()) {
      setStatus("Add context first.");
      return;
    }
    accumulated = "";
    if (outEl) outEl.textContent = "";
    setStatus("Streaming...");
    if (goBtn) goBtn.disabled = true;
    if (abortBtn) abortBtn.disabled = false;
    if (dlBtn) dlBtn.disabled = true;
    try {
      await streamDraft(wb, text);
      setStatus("Done.");
      if (dlBtn) dlBtn.disabled = !accumulated.trim();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Error: ${msg}`);
      if (dlBtn) dlBtn.disabled = !accumulated.trim();
    } finally {
      if (goBtn) goBtn.disabled = false;
      if (abortBtn) abortBtn.disabled = true;
      active = null;
    }
  });

  abortBtn?.addEventListener("click", () => {
    active?.abort();
    setStatus("Aborted.");
    if (goBtn) goBtn.disabled = false;
    if (abortBtn) abortBtn.disabled = true;
    if (dlBtn) dlBtn.disabled = !accumulated.trim();
  });

  dlBtn?.addEventListener("click", () => {
    if (!accumulated.trim()) return;
    downloadMd();
  });

  resetBtn?.addEventListener("click", () => {
    active?.abort();
    accumulated = "";
    if (ctxEl) ctxEl.value = "";
    if (outEl) outEl.textContent = "";
    setStatus("");
    if (goBtn) goBtn.disabled = false;
    if (abortBtn) abortBtn.disabled = true;
    if (dlBtn) dlBtn.disabled = true;
  });
}

main();
