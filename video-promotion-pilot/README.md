# Video Promotion Pilot (rebuild)

A lean Chrome extension (Manifest V3) that grabs a YouTube video's transcript and
hands it to **ChatGPT, Claude, or Gemini** with a ready-made research prompt
(summary + 25 key insights + action checklist).

This is the **single-video MVP** rebuild — the publishing/WordPress features of the
original are intentionally left out. Multi-tab transcript harvesting and the
"newsletter in your voice" workflow are planned next.

## How it works

1. Open a YouTube video and click the extension icon.
2. It fetches the transcript:
   - **In-page first** — reads YouTube's own caption data directly off the page
     (free, instant, no credentials).
   - **Decodo fallback** — if the page has no usable captions and you've added
     Decodo credentials in Settings, it calls Decodo's `youtube_transcript`
     scraper with retries (613s are expected and retried automatically).
3. Pick a **prompt/output** from the dropdown (summary+insights+checklist, content-idea builder, or newsletter edition).
4. Click **ChatGPT / Claude / Gemini**. The extension opens that app, drops the
   full prompt into its input box, and **also copies the prompt to your
   clipboard** as a fallback — if the app's input box ever changes and
   auto-fill misses, just paste (Ctrl+V).
5. "Auto-send" is off by default so you can review before sending.

## Install (unpacked, for development)

1. Clone/download this repo.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `video-promotion-pilot/` folder.
5. (Optional) Open the extension's **Settings** to add Decodo credentials for the
   fallback path.

## Files

| File | Role |
|---|---|
| `manifest.json` | Permissions + entry points |
| `src/background.js` | Service worker — orchestrates fetching & launching AI tabs |
| `src/transcript.js` | In-page caption extraction + Decodo fallback (with retries) |
| `src/inject.js` | Drops the prompt into the ChatGPT/Claude/Gemini editor |
| `src/prompts.js` | Prompt templates (edit these to change the output) |
| `src/sidepanel/` | The Chrome side-panel UI (opens when you click the icon) |
| `src/options/` | Settings page for Decodo credentials |

## Editing the prompt

Everything the AI is asked to do lives in `src/prompts.js`. Tweak the template
there and reload the extension (`chrome://extensions` → ↻).

## Known fragile points (by design, documented)

- **Transcript extraction** depends on YouTube's page structure; the Decodo
  fallback covers most gaps.
- **Prompt injection** targets each AI app's editor DOM, which the vendors change
  periodically. When a selector breaks, update the lists in `src/inject.js` — and
  in the meantime the clipboard fallback keeps you working.

## Roadmap

- [x] Side-panel UI (instead of a popup)
- [x] In-page transcript fetch (fast, no playback needed) with Decodo fallback
- [x] Multiple prompt templates (summary/insights/checklist, content ideas, newsletter)
- [ ] Harvest transcripts from **all** YouTube tabs in the current window
- [ ] Multi-video "deep research with E-E-A-T" prompt
- [ ] "Curated newsletter in my voice" template across many videos
