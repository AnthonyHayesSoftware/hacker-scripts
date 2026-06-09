import { buildPrompt, PROMPTS, DEFAULT_PROMPT_ID } from "../prompts.js";

const els = {
  status: document.getElementById("status"),
  videoCard: document.getElementById("videoCard"),
  vTitle: document.getElementById("vTitle"),
  vChannel: document.getElementById("vChannel"),
  vId: document.getElementById("vId"),
  vSource: document.getElementById("vSource"),
  vLen: document.getElementById("vLen"),
  promptSelect: document.getElementById("promptSelect"),
  brandSelect: document.getElementById("brandSelect"),
  ctaSelect: document.getElementById("ctaSelect"),
  steerBox: document.getElementById("steerBox"),
  steerGrid: document.getElementById("steerGrid"),
  steerText: document.getElementById("steerText"),
  steerCopy: document.getElementById("steerCopy"),
  steerHint: document.getElementById("steerHint"),
  autoSubmit: document.getElementById("autoSubmit"),
  hint: document.getElementById("hint"),
  retryBtn: document.getElementById("retryBtn"),
  optionsBtn: document.getElementById("optionsBtn"),
  aiBtns: [...document.querySelectorAll(".ai-btn")],
};

let current = null; // { transcript, meta, source }
let lastVideoId = null;

function videoIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get("v") || "";
  } catch (_) {
    return "";
  }
}

// ---- Transcript cache -------------------------------------------------------
// Once a transcript is grabbed we keep it (keyed by video ID) so it survives
// tab switches, panel reloads and flaky re-fetches. We never re-fetch a video
// we already have, and a failed re-fetch falls back to the saved copy.
const CACHE_KEY = "transcriptCache";
const CACHE_MAX = 40;

async function cacheGet(videoId) {
  if (!videoId) return null;
  const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
  return cache[videoId] || null;
}

async function cacheSet(videoId, entry) {
  if (!videoId) return;
  const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
  cache[videoId] = { ...entry, ts: Date.now() };
  // Prune oldest if over the cap.
  const ids = Object.keys(cache);
  if (ids.length > CACHE_MAX) {
    ids
      .sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
      .slice(0, ids.length - CACHE_MAX)
      .forEach((id) => delete cache[id]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

// Resolve the active tab. From a side panel `currentWindow` can be unreliable
// (the panel's "current" window isn't always the one the user is looking at),
// so fall back to the last focused window.
async function getActiveTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// Only re-fetch when the active YouTube video actually changed (avoids
// disrupting the panel every time you flip to ChatGPT/Claude and back).
async function maybeRefresh() {
  const tab = await getActiveTab();
  if (!tab || !/youtube\.com\/watch/.test(tab.url || "")) return;
  const id = videoIdFromUrl(tab.url);
  if (id && id !== lastVideoId) loadTranscript();
}

// Populate the prompt dropdown from the templates.
for (const [id, p] of Object.entries(PROMPTS)) {
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = p.label;
  els.promptSelect.appendChild(opt);
}
els.promptSelect.value = DEFAULT_PROMPT_ID;

// ---- Brand profiles ---------------------------------------------------------
// Brands are user-defined in Options (name + style description + optional
// per-app Project URLs). The dropdown lets you pick which one an infographic
// uses; the choice is remembered. The list refreshes if Options edits it.
let brandProfiles = [];

async function loadBrands() {
  let { brandProfiles: bp = [] } = await chrome.storage.sync.get("brandProfiles");
  bp = Array.isArray(bp) ? bp : [];
  // One-time migration: fold a legacy single "brandStyle" into a profile.
  if (!bp.length) {
    const { brandStyle } = await chrome.storage.sync.get("brandStyle");
    if (brandStyle && brandStyle.trim()) {
      bp = [{ id: "default", name: "My brand", description: brandStyle.trim() }];
      await chrome.storage.sync.set({ brandProfiles: bp });
    }
  }
  brandProfiles = bp;

  const prev = els.brandSelect.value;
  els.brandSelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— No brand —";
  els.brandSelect.appendChild(none);
  for (const b of brandProfiles) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name || "(unnamed brand)";
    els.brandSelect.appendChild(opt);
  }

  const { selectedBrandId } = await chrome.storage.local.get("selectedBrandId");
  const want = brandProfiles.some((b) => b.id === prev) ? prev : selectedBrandId;
  if (want && brandProfiles.some((b) => b.id === want)) els.brandSelect.value = want;
}

els.brandSelect.addEventListener("change", () => {
  chrome.storage.local.set({ selectedBrandId: els.brandSelect.value });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.brandProfiles) loadBrands();
  if (area === "sync" && changes.ctas) loadCtas();
});
loadBrands();

// ---- Call-to-action snippets ------------------------------------------------
// User-defined CTAs (Options). The chosen one is injected into the generated
// content's close, and powers the "Lean into my CTA" steering follow-up.
let ctas = [];
async function loadCtas() {
  let { ctas: cs = [] } = await chrome.storage.sync.get("ctas");
  ctas = Array.isArray(cs) ? cs : [];
  const prev = els.ctaSelect.value;
  els.ctaSelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— No CTA —";
  els.ctaSelect.appendChild(none);
  for (const c of ctas) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name || "(unnamed CTA)";
    els.ctaSelect.appendChild(opt);
  }
  const { selectedCtaId } = await chrome.storage.local.get("selectedCtaId");
  const want = ctas.some((c) => c.id === prev) ? prev : selectedCtaId;
  if (want && ctas.some((c) => c.id === want)) els.ctaSelect.value = want;
}
els.ctaSelect.addEventListener("change", () => {
  chrome.storage.local.set({ selectedCtaId: els.ctaSelect.value });
});
loadCtas();

// ---- Steering follow-ups ----------------------------------------------------
// One-click follow-up prompts the user pastes into the AI chat to refine the
// result — replicating how they'd manually steer the content after generation.
const STEER_PRESETS = [
  {
    label: "Longer & detailed",
    text: () =>
      "Make this longer and more detailed — expand each section with specifics and concrete examples, keeping the same voice.",
  },
  {
    label: "Punchier, less fluff",
    text: () =>
      "Tighten this: punchier sentences, cut the filler, lead with the strongest points. Keep it concrete and skimmable.",
  },
  {
    label: "Operator, not guru",
    text: () =>
      "Rewrite so it positions me as a hands-on operator who actually does this — practical, grounded and first-person, not a guru.",
  },
  {
    label: "Credit the creator",
    text: () =>
      `Add a clear, genuine credit to the original video creator${
        current?.meta?.channel ? " (" + current.meta.channel + ")" : ""
      } and link to the video${
        current?.meta?.url ? " (" + current.meta.url + ")" : ""
      }. Make it natural, not an afterthought.`,
  },
  {
    label: "Lean into my CTA",
    text: () => {
      const c = ctas.find((x) => x.id === els.ctaSelect.value);
      if (c && (c.text || c.url)) {
        const body = [c.text, c.url ? `Link: ${c.url}` : ""]
          .filter(Boolean)
          .join("\n");
        return `Rework the ending so it transitions naturally into this call to action (guide, don't hard-sell):\n${body}`;
      }
      return "Rework the ending so it transitions naturally into my current offer / CTA (guide, don't hard-sell).";
    },
  },
  {
    label: "Apply to my audience",
    text: () =>
      "Now apply these insights to my own audience and content plan — show how I'd use this in practice, with concrete next steps I can action this week.",
  },
];

function flashSteer(msg) {
  els.steerHint.textContent = msg;
  els.steerHint.classList.remove("hidden");
  setTimeout(() => els.steerHint.classList.add("hidden"), 2500);
}
async function copySteer(text) {
  try {
    await navigator.clipboard.writeText(text);
    flashSteer("Copied — paste into the AI chat (Ctrl+V).");
  } catch (_) {
    flashSteer("Couldn't copy — select the text manually.");
  }
}
for (const preset of STEER_PRESETS) {
  const b = document.createElement("button");
  b.className = "steer-btn";
  b.type = "button";
  b.textContent = preset.label;
  b.addEventListener("click", () => copySteer(preset.text()));
  els.steerGrid.appendChild(b);
}
els.steerCopy.addEventListener("click", () => {
  const t = els.steerText.value.trim();
  if (t) copySteer(t);
});

// Remember the chosen prompt across tab switches / panel reloads.
chrome.storage.local.get("selectedPrompt").then((s) => {
  if (s.selectedPrompt && PROMPTS[s.selectedPrompt]) {
    els.promptSelect.value = s.selectedPrompt;
  }
});
els.promptSelect.addEventListener("change", () => {
  chrome.storage.local.set({ selectedPrompt: els.promptSelect.value });
});

// Auto-send defaults ON and is remembered.
els.autoSubmit.checked = true;
chrome.storage.local.get("autoSubmit").then((s) => {
  if (typeof s.autoSubmit === "boolean") els.autoSubmit.checked = s.autoSubmit;
});
els.autoSubmit.addEventListener("change", () => {
  chrome.storage.local.set({ autoSubmit: els.autoSubmit.checked });
});

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `status ${kind || ""}`;
}

function setButtonsEnabled(on) {
  els.aiBtns.forEach((b) => (b.disabled = !on));
}

const SOURCE_LABELS = {
  intercept: "Caption request (intercepted)",
  panel: "Transcript panel",
  "panel-generic": "Transcript panel (heuristic)",
  "caption-url": "Caption URL",
  "in-page": "In-page",
  decodo: "Decodo",
  cache: "Saved (cached)",
};

function render(entry, { fromCache } = {}) {
  current = entry;
  lastVideoId = entry.meta?.videoId || null;
  const m = entry.meta || {};
  els.vTitle.textContent = m.title || "—";
  els.vChannel.textContent = m.channel || "—";
  els.vId.textContent = m.videoId || "—";
  els.vSource.textContent =
    (fromCache ? "Saved (cached)" : SOURCE_LABELS[entry.source]) ||
    entry.source ||
    "—";
  els.vLen.textContent = entry.transcript.length.toLocaleString();
  els.videoCard.classList.remove("hidden");
  setStatus(
    fromCache ? "Transcript ready (saved earlier)." : "Transcript loaded successfully!",
    "ok"
  );
  setButtonsEnabled(true);
}

// Guards against overlapping calls during fast tab-hopping: only the most
// recent loadTranscript() is allowed to mutate the UI.
let loadToken = 0;

// force=true bypasses the cache and re-grabs from YouTube (manual Re-fetch).
async function loadTranscript(force = false) {
  const myToken = ++loadToken;
  const stale = () => myToken !== loadToken;

  els.hint.classList.add("hidden");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (stale()) return;
  const vid = videoIdFromUrl(tab?.url || "");

  // Already have it saved? Use it immediately and don't touch YouTube again.
  if (!force && vid) {
    const cached = await cacheGet(vid);
    if (stale()) return;
    if (cached) {
      render(cached, { fromCache: true });
      return;
    }
  }

  setButtonsEnabled(false);
  setStatus("Fetching transcript…", "loading");
  els.videoCard.classList.add("hidden");
  const slowTimer = setTimeout(() => {
    if (!stale()) setStatus("Still working… (retrying as the page finishes loading)", "loading");
  }, 4000);

  let res;
  try {
    res = await Promise.race([
      chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT", tabId: tab?.id }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("timeout-no-reply")), 90000)
      ),
    ]);
  } catch (err) {
    res = undefined;
  }
  clearTimeout(slowTimer);
  if (stale()) return;

  if (res?.ok) {
    render(res);
    cacheSet(res.meta?.videoId || vid, {
      transcript: res.transcript,
      meta: res.meta,
      source: res.source,
    });
    return;
  }

  // Fetch failed — fall back to a saved copy so we never lose a known-good
  // transcript (this is the "hold it once found" behaviour).
  const cached = await cacheGet(vid);
  if (stale()) return;
  if (cached) {
    render(cached, { fromCache: true });
    return;
  }

  current = null;
  if (res === undefined) {
    setStatus("Couldn't reach the page. Click ↻ Re-fetch.", "error");
  } else if (res?.reason === "not-a-youtube-video") {
    setStatus("Open a YouTube video tab, then click ↻ Re-fetch.", "error");
  } else if (res?.reason === "no-transcript") {
    setStatus(
      `No transcript found. ${res.detail || ""}`,
      "error"
    );
  } else {
    setStatus(`Couldn't get transcript: ${res?.reason || "error"}`, "error");
  }
}

async function sendTo(app) {
  if (!current) return;
  const promptId = els.promptSelect.value || DEFAULT_PROMPT_ID;

  // Resolve the selected brand and its Project URL for this app (if any).
  const brand = brandProfiles.find((b) => b.id === els.brandSelect.value) || null;
  const projKey = {
    chatgpt: "projectChatgpt",
    claude: "projectClaude",
    gemini: "projectGemini",
  }[app];
  const projectUrl = brand && brand[projKey] ? String(brand[projKey]).trim() : "";

  const cta = ctas.find((c) => c.id === els.ctaSelect.value) || null;
  const ctaText = cta
    ? [cta.text, cta.url ? `Link: ${cta.url}` : ""].filter(Boolean).join("\n")
    : "";

  const prompt = buildPrompt(promptId, {
    title: current.meta.title,
    channel: current.meta.channel,
    url: current.meta.url,
    transcript: current.transcript,
    brand: brand && brand.description ? brand.description : "",
    voice: brand && brand.voice ? brand.voice : "",
    hasProject: !!projectUrl,
    cta: ctaText,
  });

  try {
    await navigator.clipboard.writeText(prompt);
    els.hint.classList.remove("hidden");
  } catch (_) {
    /* injection should still work */
  }

  // When a brand has no Project to carry its look, nudge the user to attach a
  // style sample image in the chat (only meaningful for the infographic prompt).
  els.hint.textContent =
    promptId === "infographic" && brand && !projectUrl
      ? "Prompt + brand style copied. Tip: attach a sample image of your brand in the chat so the look matches."
      : "Prompt copied to clipboard too — if the box isn't filled, just paste (Ctrl+V).";

  await chrome.runtime.sendMessage({
    type: "SEND_TO_AI",
    app,
    prompt,
    autoSubmit: els.autoSubmit.checked,
    url: projectUrl,
  });
}

els.aiBtns.forEach((b) =>
  b.addEventListener("click", () => sendTo(b.dataset.app))
);
els.retryBtn.addEventListener("click", () => loadTranscript(true));
els.optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

// The side panel stays open across navigation — refresh only when the active
// YouTube video changes, so flipping to the AI tab and back doesn't reset things.
// We listen broadly because no single tab event reliably fires for every way a
// video can change (switching tabs, opening one in a new tab, YouTube's in-page
// SPA navigation). maybeRefresh() is a no-op unless the video ID actually moved,
// so over-listening is cheap and keeps the panel from getting stuck on a stale
// video.
chrome.tabs.onActivated.addListener(() => maybeRefresh());
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // `info.url` catches YouTube's client-side navigation within the same tab;
  // `complete` catches a fresh page load. Either way, only the active tab.
  if ((info.status === "complete" || info.url) && tab.active) maybeRefresh();
});
chrome.windows.onFocusChanged.addListener(() => maybeRefresh());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) maybeRefresh();
});

loadTranscript();
