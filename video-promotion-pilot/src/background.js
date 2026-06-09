// Service worker: the brain. Orchestrates transcript fetching and launching the
// AI app tabs. The popup talks to this via chrome.runtime messages.

import {
  grabTranscriptInPage,
  forceCaptionsInPage,
  fetchTranscriptFromDecodo,
} from "./transcript.js";
import { fillAiPrompt } from "./inject.js";

const AI_APPS = {
  chatgpt: { url: "https://chatgpt.com/", label: "ChatGPT" },
  claude: { url: "https://claude.ai/new", label: "Claude" },
  gemini: { url: "https://gemini.google.com/app", label: "Gemini" },
};

// ===========================================================================
// PRIMARY TRANSCRIPT METHOD — intercept YouTube's own caption request.
//
// Why this exists: YouTube serves captions from .../api/timedtext?... URLs that
// carry a signed token (pot=) tied to the player session. We CANNOT build that
// URL ourselves — a manual fetch of the baseUrl from ytInitialPlayerResponse
// comes back 200-but-empty. The fix (same trick the working TubeWizard build
// uses): watch for the timedtext request the player itself makes, then reuse
// that exact, already-signed URL. We just have to make sure the player actually
// requests it (see forceCaptionsInPage), then read it back here.
// ===========================================================================

// videoId -> { url, t }. Most recent timedtext request we've seen per video.
const timedTextByVideo = new Map();
// The single most recent timedtext URL seen, regardless of video — fallback for
// the (rare) case where the request URL has no `v` param.
let lastTimedText = { url: null, t: 0 };

function rememberTimedText(url) {
  const entry = { url, t: Date.now() };
  lastTimedText = entry;
  try {
    const v = new URL(url).searchParams.get("v");
    if (v) timedTextByVideo.set(v, entry);
  } catch (_) {}
}

// Observational webRequest (allowed in MV3 with the "webRequest" permission).
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.url.includes("/api/timedtext")) rememberTimedText(details.url);
  },
  { urls: ["*://*.youtube.com/*"] }
);

// Parse a timedtext response body. NOTE: MV3 service workers have NO DOMParser,
// so XML is parsed with regex + manual entity decoding.
function parseTimedText(body) {
  const trimmed = (body || "").trim();
  if (!trimmed) return "";

  // json3 (preferred) — clean, no entity decoding needed.
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return (data.events || [])
        .flatMap((e) => (e.segs || []).map((s) => s.utf8 || ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    } catch (_) {
      return "";
    }
  }

  // XML (srv1/srv3/legacy): pull <text> or <p> nodes, strip tags, decode.
  const nodes =
    trimmed.match(/<text[^>]*>([\s\S]*?)<\/text>/g) ||
    trimmed.match(/<p[^>]*>([\s\S]*?)<\/p>/g) ||
    [];
  return nodes
    .map((n) => decodeEntities(n.replace(/<[^>]*>/g, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;#39;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&"); // decode &amp; LAST so the above survive
}

// Fetch a captured timedtext URL and parse it. We prefer the json3 variant of
// whatever URL the player used (cleaner), falling back to the URL as-is.
async function fetchTimedText(url) {
  const candidates = [url];
  try {
    const u = new URL(url);
    if (u.searchParams.get("fmt") !== "json3") {
      u.searchParams.set("fmt", "json3");
      candidates.unshift(u.toString());
    }
  } catch (_) {}

  for (const c of candidates) {
    try {
      const res = await fetch(c);
      if (!res.ok) continue;
      const text = parseTimedText(await res.text());
      if (text) return text;
    } catch (_) {}
  }
  return null;
}

// Wait until we've intercepted a timedtext request for this video (or any new
// one captured after `since`, for URLs that lack a `v` param).
function waitForTimedText(videoId, since, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const byVid = videoId && timedTextByVideo.get(videoId);
      if (byVid) return resolve(byVid.url);
      if (lastTimedText.url && lastTimedText.t >= since)
        return resolve(lastTimedText.url);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

// Strategy A: make the player request its captions, intercept that request,
// fetch + parse it. Returns { transcript, meta } or null. Always returns meta
// (read off the page) even if the transcript part fails, so callers can use it.
async function tryIntercept(tab, videoId) {
  let meta = null;
  const since = Date.now();

  // Nudge the player into fetching its caption track AND read page meta.
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: forceCaptionsInPage,
    });
    meta = res?.result?.meta || null;
  } catch (_) {}

  // Maybe we already had it from passive interception; otherwise wait for it.
  let url = (videoId && timedTextByVideo.get(videoId)?.url) || null;
  if (!url) url = await waitForTimedText(videoId, since, 8000);
  if (!url) return { transcript: null, meta };

  const transcript = await fetchTimedText(url);
  return { transcript, meta };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
  // Transcript extraction changes between versions, and the cache is keyed only
  // by video ID — so old (possibly bad) transcripts would be served forever.
  // Drop the cache on every install/update so the current logic always re-grabs.
  chrome.storage.local.remove("transcriptCache").catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_TRANSCRIPT") {
    handleGetTranscript(msg.tabId).then(sendResponse);
    return true; // async
  }
  if (msg?.type === "SEND_TO_AI") {
    handleSendToAI(msg).then(sendResponse);
    return true; // async
  }
});

async function handleGetTranscript(tabId) {
  let tab;
  if (tabId) {
    tab = await chrome.tabs.get(tabId).catch(() => null);
  } else {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !/youtube\.com\/watch/.test(tab.url || "")) {
    return { ok: false, reason: "not-a-youtube-video" };
  }

  const meta = {
    videoId: videoIdFromUrl(tab.url),
    title: tab.title?.replace(/ - YouTube$/, "") || "",
    channel: "",
    url: tab.url,
  };

  // ---- Strategy A: intercept the player's own caption request (primary) ----
  try {
    const intercepted = await tryIntercept(tab, meta.videoId);
    if (intercepted.meta) {
      meta.videoId = intercepted.meta.videoId || meta.videoId;
      meta.title = intercepted.meta.title || meta.title;
      meta.channel = intercepted.meta.channel || meta.channel;
    }
    if (intercepted.transcript) {
      return {
        ok: true,
        source: "intercept",
        transcript: intercepted.transcript,
        meta,
      };
    }
  } catch (_) {}

  // ---- Strategy B: in-page scrape (fallback) -------------------------------
  // The caption data and the transcript panel both load asynchronously, so a
  // single attempt can run too early and find nothing. Retry a few times,
  // re-reading fresh page state each time, until one succeeds.
  let pageResult = null;
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: grabTranscriptInPage,
      });
      pageResult = res?.result;
    } catch (err) {
      pageResult = { ok: false, reason: "scripting-failed", meta: {} };
    }
    if (pageResult?.ok && pageResult.transcript) break;
    if (i < attempts - 1) await sleep(1500);
  }

  if (pageResult?.meta) {
    meta.videoId = pageResult.meta.videoId || meta.videoId;
    meta.title = pageResult.meta.title || meta.title;
    meta.channel = pageResult.meta.channel || meta.channel;
  }
  if (pageResult?.ok && pageResult.transcript) {
    return {
      ok: true,
      source: pageResult.source || "in-page",
      transcript: pageResult.transcript,
      meta,
    };
  }

  // ---- Strategy C: Decodo fallback — disabled by default -------------------
  const { decodoEnabled, decodoUsername, decodoPassword } =
    await chrome.storage.sync.get([
      "decodoEnabled",
      "decodoUsername",
      "decodoPassword",
    ]);
  const decodo = decodoEnabled
    ? await fetchTranscriptFromDecodo(meta.videoId, {
        username: decodoUsername,
        password: decodoPassword,
      })
    : { ok: false, reason: "disabled" };
  if (decodo.ok) {
    return { ok: true, source: "decodo", transcript: decodo.text, meta };
  }

  const diagStr = pageResult?.diag
    ? ` | diag: ${JSON.stringify(pageResult.diag)}`
    : "";
  return {
    ok: false,
    reason: "no-transcript",
    detail: `intercept: miss, in-page: ${pageResult?.reason || "?"}, decodo: ${decodo.reason}${diagStr}`,
    meta,
  };
}

async function handleSendToAI({ app, prompt, autoSubmit, url }) {
  const target = AI_APPS[app];
  if (!target) return { ok: false, reason: "unknown-app" };

  // Destination priority: the selected brand profile's Project URL (passed in
  // from the side panel) > the global custom URL in Options > the app default.
  // Opening a Project's new chat means its saved files/branding apply to output.
  let dest = (url || "").trim();
  if (!dest) {
    const urlKey = { chatgpt: "urlChatgpt", claude: "urlClaude", gemini: "urlGemini" }[app];
    const stored = await chrome.storage.sync.get([urlKey]);
    dest = (stored[urlKey] || "").trim();
  }
  if (!dest) dest = target.url;

  const tab = await chrome.tabs.create({ url: dest });

  // Wait for the tab to finish loading, then inject.
  await waitForTabComplete(tab.id);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: fillAiPrompt,
      args: [prompt, app, !!autoSubmit],
    });
  } catch (err) {
    return { ok: false, reason: "inject-failed", detail: String(err) };
  }
  return { ok: true };
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // SPAs keep loading after "complete"; give the editor a moment regardless.
    setTimeout(finish, timeoutMs);
  });
}

function videoIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get("v") || "";
  } catch (_) {
    return "";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
