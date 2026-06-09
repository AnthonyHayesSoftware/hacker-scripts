# HANDOFF — Video Promotion Pilot (VPP)

A Chrome extension (Manifest V3) that grabs a YouTube video's transcript and
hands it to ChatGPT / Claude / Gemini in a fresh tab, pre-filled with a chosen
prompt (research summary, 25 insights + checklist, infographic brief, written
content) shaped by your **brand profiles** and **CTAs**.

This doc is the running context for the project so we never have to reconstruct
it from scratch again.

---

## 1. What it does (user flow)

1. You're on a `youtube.com/watch` page. Open the **side panel**.
2. Hit **Get transcript** → the transcript loads and is cached per video.
3. Pick a **brand profile**, a **CTA**, and a **prompt**.
4. Click an AI app (ChatGPT / Claude / Gemini) → a new tab opens at that app
   (or the brand's Project URL) with the prompt + transcript pre-filled, ready
   to send.

All settings live in this browser profile only — nothing is sent anywhere except
the services you point it at.

---

## 2. The transcript saga (why the engine looks the way it does)

This was the hard part. History, so we don't repeat dead ends:

- **Original method:** read `ytInitialPlayerResponse.captions…captionTracks[].baseUrl`
  and `fetch()` it, plus scrape the on-page transcript panel DOM.
- **What broke:** YouTube now signs the `…/api/timedtext` caption URLs with a
  per-session **PoToken (`pot=`)**. A manual `fetch()` of the bare `baseUrl`
  returns **HTTP 200 with an empty body**. The DOM-panel scrape was also flaky
  and failed outright on some videos (e.g. `ArOEZ_OcvLI`).
- **Options weighed:**
  - *Server-side* (yt-dlp / a proxy / Decodo paid API) — robust but needs
    infrastructure and/or cost.
  - *Client-side webRequest interception* — **chosen.** Free, no backend, and
    it's the method the working "TubeWizard" extension uses.

### The winning approach (v0.12.0+)

We can't *build* a valid signed caption URL — but the YouTube player itself
requests one. So we **watch for the player's own request and reuse that exact,
already-signed URL.**

- `chrome.webRequest.onCompleted` listens on `*://*.youtube.com/*` and caches any
  `…/api/timedtext` URL, keyed by video id (`v` param), plus a "most recent seen"
  fallback for URLs that lack `v`.
- On **Get transcript**, `forceCaptionsInPage` is injected (MAIN world) to:
  1. read page meta (videoId / title / channel), and
  2. **nudge the player into requesting its caption track** — drives the internal
     captions module (`loadModule("captions")` + `setOption("captions","track",…)`)
     and clicks the CC button on if it's currently off.
- The background waits up to ~8s for the interception, then **re-fetches the
  captured signed URL** and parses it.
- **Parsing runs in the service worker, which has NO `DOMParser`.** So:
  - `json3` responses (preferred — we even rewrite the URL to `fmt=json3`) are
    parsed as JSON.
  - XML (srv1/srv3/legacy) is parsed with **regex + manual HTML-entity decoding**.

### Fallback chain (in order)

1. **Strategy A — intercept** (`source: "intercept"`) — primary, described above.
2. **Strategy B — in-page scrape** (`source: "in-page"`/`panel`/…) — the legacy
   method, retried up to 4× with 1.5s gaps. Kept as a safety net.
3. **Strategy C — Decodo** (`source: "decodo"`) — paid API, **off by default**,
   only runs if enabled in Options.

The transcript cache is **cleared on every install/update** (`onInstalled`)
because extraction logic changes between builds and the cache is keyed only by
video id — otherwise a bad old transcript would be served forever.

---

## 3. Settings persistence (Backup & restore — v0.12.1)

**Problem:** loading a *freshly unzipped folder* is a brand-new extension to
Chrome (new internal ID) → empty `chrome.storage` → brand profiles/CTAs gone.

**Fixes:**
- **Day-to-day:** update the **same folder** in place and click ↻ reload. Same
  folder = stable ID = `chrome.storage` preserved (and `storage.sync` even
  follows you across machines when signed into Chrome).
- **Safety net:** **Options → Backup & restore → Export / Import**. Export writes
  all settings to `vpp-settings-YYYY-MM-DD.json`; Import reads it back and
  reloads. Import only accepts known keys (won't smuggle in stale cache).

---

## 4. Architecture & contracts

```
manifest.json            MV3; permissions: tabs, scripting, storage, activeTab,
                         clipboardWrite, sidePanel, webRequest
src/background.js        Service worker. webRequest interception + transcript
                         orchestration (A→B→C) + SEND_TO_AI tab launcher.
src/transcript.js        forceCaptionsInPage (trigger + meta), grabTranscriptInPage
                         (legacy scrape), fetchTranscriptFromDecodo.
src/inject.js            fillAiPrompt — types the prompt into ChatGPT/Claude/Gemini.
src/sidepanel/           The UI (sidepanel.html/.js/.css). Talks to background.
src/options/             Settings page (brand profiles, CTAs, URLs, Decodo,
                         Backup & restore).
src/prompts.js           The built-in prompt templates.
```

### Message contract (side panel ⇄ background)

- `→ { type: "GET_TRANSCRIPT", tabId }`
  `← { ok: true, source, transcript, meta: { videoId, title, channel, url } }`
  `← { ok: false, reason, detail, meta }`
  - `source` values map to labels in `sidepanel.js` `SOURCE_LABELS`
    (`intercept` → "Caption request (intercepted)", etc.).
- `→ { type: "SEND_TO_AI", app, prompt, autoSubmit, url }`
  `← { ok: true }` / `{ ok: false, reason, detail }`

### Storage map

- `chrome.storage.sync`: `brandProfiles[]`, `brandStyle` (legacy single),
  `ctas[]`, `urlChatgpt`, `urlClaude`, `urlGemini`, `decodoEnabled`,
  `decodoUsername`, `decodoPassword`.
- `chrome.storage.local`: `selectedBrandId`, `selectedCtaId`, `selectedPrompt`,
  `autoSubmit`, `transcriptCache` (cleared on install/update).

---

## 5. Test results (2026-06-04, v0.12.x)

| Video ID      | Title                                            | Result                    |
|---------------|--------------------------------------------------|---------------------------|
| `D-jpozVTfxQ` | Alex Hormozi's Facebook Ads Strategy for 2026    | ✓ intercept (10,984 ch)   |
| `ArOEZ_OcvLI` | This One AI Prompt Makes Claude Write Content    | ✓ (was failing repeatedly)|
| `avzQDFnm68Q` | This Finally Fixes the Annoying Thing About Claude| ✓ intercept (17,408 ch)  |

The intercept engine fixed the previously-failing video.

---

## 6. Known limitations / future ideas

- The CC button may briefly turn **on** when grabbing (it's the trigger). Could
  auto-restore its prior state after capture if it's distracting.
- Interception relies on the timedtext URL carrying the `v` param; a
  "most-recent-seen" fallback covers the rare case it doesn't.
- A service-worker restart drops the in-memory interception cache — fine, because
  we re-trigger the request on demand.
- Possible future: auto-restore CC state; per-video language selection; a "force
  refresh" button in the side panel.

---

## 7. Loading / updating

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (the one containing `manifest.json`).
3. To update: replace the files **in the same folder** and click ↻ reload (keeps
   your settings). Or load fresh and re-import your settings backup.
