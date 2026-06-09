// Transcript acquisition. Two strategies, tried in order:
//   1. In-page extraction  — free, instant, no credentials. Reads YouTube's own
//      caption data straight off the watch page.
//   2. Decodo scraper API  — reliable fallback. Needs credentials (set in the
//      Options page). Intermittent 613s are expected, so we retry.

// ---- Strategy 1: in-page ----------------------------------------------------

// All-in-one in-page grabber. Injected into the YouTube tab and run as an async
// function. Tries, in order:
//   (a) scrape YouTube's own "Show transcript" panel — the rendered text, so no
//       API/token/quota issues (most reliable);
//   (b) fetch the caption track URL from the player response (fast when it works,
//       but YouTube increasingly requires a signed token and returns empty);
// Must be fully self-contained (runs in the page context).
export async function grabTranscriptInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getPlayerResponse() {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    const player = document.querySelector("#movie_player");
    if (player && typeof player.getPlayerResponse === "function") {
      try {
        return player.getPlayerResponse();
      } catch (_) {}
    }
    return null;
  }

  const pr = getPlayerResponse();
  const details = pr?.videoDetails || {};
  const meta = {
    videoId:
      details.videoId || new URL(location.href).searchParams.get("v") || "",
    title: details.title || document.title.replace(/ - YouTube$/, ""),
    channel: details.author || "",
  };

  const diag = { tracks: 0, cap: [], segSel: {}, btn: false };

  // ---- (a) Caption track URL fetch (robust) --------------------------------
  // Try the caption URL first — it's clean and needs no UI manipulation. Fetch
  // ANONYMOUSLY first (logged-in sessions often get an empty body on the signed
  // URL). Accept json3, xml and srv3 formats; record each attempt's status.
  const decodeCaptionUrl = async (baseUrl) => {
    const base = baseUrl.replace(/&fmt=\w+/g, "");
    const attempts = [
      { url: `${base}&fmt=json3`, kind: "json", creds: "omit" },
      { url: base, kind: "xml", creds: "omit" },
      { url: `${base}&fmt=srv3`, kind: "xml", creds: "omit" },
      { url: `${base}&fmt=json3`, kind: "json", creds: "include" },
      { url: base, kind: "xml", creds: "include" },
    ];
    for (const a of attempts) {
      try {
        const res = await fetch(a.url, { credentials: a.creds });
        if (!res.ok) {
          diag.cap.push(String(res.status));
          continue;
        }
        const body = await res.text();
        if (!body) {
          diag.cap.push("empty");
          continue;
        }
        let text = "";
        if (a.kind === "json") {
          const data = JSON.parse(body);
          text = (data.events || [])
            .flatMap((e) => (e.segs || []).map((s) => s.utf8 || ""))
            .join("");
        } else {
          const xml = new DOMParser().parseFromString(body, "text/xml");
          text = [...xml.querySelectorAll("text, p")]
            .map((t) => t.textContent || "")
            .join(" ");
        }
        text = text.replace(/\s+/g, " ").trim();
        if (text) return text;
        diag.cap.push("noText");
      } catch (_) {
        diag.cap.push("err");
      }
    }
    return null;
  };

  const tracks =
    pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  diag.tracks = tracks.length;
  if (tracks.length) {
    const en = tracks.filter((t) => (t.languageCode || "").startsWith("en"));
    const track = en.find((t) => t.kind !== "asr") || en[0] || tracks[0];
    if (track?.baseUrl) {
      const text = await decodeCaptionUrl(track.baseUrl);
      if (text) return { ok: true, transcript: text, source: "caption-url", meta };
    }
  }

  // ---- (b) Scrape the transcript panel (fallback) --------------------------
  // Read segments using whichever selector the current YouTube layout uses.
  const SEG_SELECTORS = [
    "ytd-transcript-segment-renderer",
    "ytd-transcript-segment-list-renderer .segment",
    "[class*='transcript-segment']",
  ];
  const TEXT_SELECTORS = [
    ".segment-text",
    "yt-formatted-string.segment-text",
    ".ytd-transcript-segment-renderer",
  ];
  // Several regions of the watch page contain timestamp-looking text that is NOT
  // the transcript: recommended-video duration badges (e.g. "12:34"), chapter
  // markers, the player's own time display, and timestamps inside comments. The
  // layout-agnostic fallback must never wander into these, or it scrapes the
  // sidebar (related-video titles + view counts) and passes it off as a
  // transcript — exactly the failure where the AI rightly refuses the "transcript".
  const EXCLUDE_SEL =
    "#secondary, #related, ytd-watch-next-secondary-results-renderer, " +
    "ytd-compact-video-renderer, ytd-compact-radio-renderer, " +
    "ytd-thumbnail-overlay-time-status-renderer, badge-shape, " +
    "#chapters, ytd-macro-markers-list-renderer, ytd-chapter-renderer, " +
    "ytd-horizontal-card-list-renderer, " +
    "ytd-engagement-panel-section-list-renderer[target-id*='chapter'], " +
    "ytd-comments, #comments, " +
    "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer, .ytp-chrome-bottom";
  const isExcluded = (el) => !!(el && el.closest && el.closest(EXCLUDE_SEL));

  // Strict reader: only the real transcript renderers. Returns null if the
  // transcript panel hasn't rendered yet.
  const readSegments = () => {
    for (const sel of SEG_SELECTORS) {
      const segs = [...document.querySelectorAll(sel)];
      diag.segSel[sel] = segs.length;
      if (!segs.length) continue;
      const text = segs
        .map((s) => {
          for (const ts of TEXT_SELECTORS) {
            const el = s.querySelector(ts);
            if (el && el.textContent.trim()) return el.textContent.trim();
          }
          // Strip a leading timestamp like "0:14" if we fell back to textContent.
          return (s.textContent || "").replace(/^\s*\d+:\d+\s*/, "").trim();
        })
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }
    return null;
  };

  // Layout-agnostic LAST-RESORT reader: YouTube keeps renaming the transcript
  // elements, so find leaf elements that are just a timestamp (0:05, 1:03:45),
  // locate the tightest container holding the MOST of them (the transcript list),
  // and read that container's text in order, dropping the timestamps. Excluded
  // regions (recommendations, chapters, comments, player chrome) are skipped so
  // this can never grab the sidebar by mistake.
  const readGeneric = () => {
    const tsRe = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
    const tsLeaves = [...document.querySelectorAll("*")].filter(
      (el) =>
        el.children.length === 0 &&
        tsRe.test((el.textContent || "").trim()) &&
        !isExcluded(el)
    );
    diag.generic = tsLeaves.length;
    if (tsLeaves.length < 5) return null;
    // Tally how many timestamps sit under each ancestor, never climbing into an
    // excluded region; the transcript list is the tightest ancestor with most.
    const counts = new Map();
    for (const ts of tsLeaves) {
      let node = ts.parentElement;
      for (let h = 0; h < 10 && node; h++) {
        if (isExcluded(node)) break;
        counts.set(node, (counts.get(node) || 0) + 1);
        node = node.parentElement;
      }
    }
    let container = null;
    let bestCount = 0;
    let bestSize = Infinity;
    for (const [node, c] of counts) {
      const size = node.querySelectorAll("*").length;
      if (c > bestCount || (c === bestCount && size < bestSize)) {
        bestCount = c;
        bestSize = size;
        container = node;
      }
    }
    if (!container) return null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const parts = [];
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (t && !tsRe.test(t)) parts.push(t);
    }
    // Collapse consecutive exact duplicates. Chapter lists get rendered in
    // several places at once (description "Key moments", chapter teaser, chapter
    // panel), so each title shows up 2-3× in a row — never true of a transcript.
    const collapsed = parts.filter((p, i) => p !== parts[i - 1]);
    const uniqueCount = new Set(collapsed).size;
    diag.genericParts = parts.length;
    diag.genericUnique = uniqueCount;
    // Reject anything that looks like a chapter list rather than a transcript:
    // too few distinct lines, or the lines are mostly repeats. A real transcript
    // has many varied segments; a chapter list has a handful, heavily duplicated.
    if (uniqueCount < 15) {
      diag.genericReject = "too-few-unique";
      return null;
    }
    if (collapsed.length && uniqueCount / collapsed.length < 0.6) {
      diag.genericReject = "too-repetitive";
      return null;
    }
    const text = collapsed.join(" ").replace(/\s+/g, " ").trim();
    return text || null;
  };

  // Collect every plausible "Show transcript" opener, best first. The real
  // opener says "show transcript"; we rank those ahead of bare "transcript"
  // matches, and skip anything inside an already-open transcript panel (those
  // are search/segment controls, not openers — clicking them does nothing, which
  // is exactly why a single first-match could click the wrong thing and the
  // panel never opened: btn:true but no segments).
  const findTranscriptButtons = () => {
    const candidates = [
      ...document.querySelectorAll(
        "button, tp-yt-paper-button, yt-button-shape, ytd-button-renderer, " +
          "ytd-menu-service-item-renderer, a"
      ),
    ];
    const score = (b) => {
      if (
        b.closest(
          "ytd-transcript-renderer, ytd-transcript-search-panel-renderer, " +
            "ytd-transcript-segment-list-renderer"
        )
      )
        return -1;
      const label = (b.getAttribute("aria-label") || "").toLowerCase();
      const txt = (b.textContent || "").trim().toLowerCase();
      if (label.includes("show transcript") || txt === "show transcript") return 2;
      if (label === "transcript" || txt === "transcript") return 1;
      if (label.includes("transcript") || txt.includes("transcript")) return 0;
      return -1;
    };
    return candidates
      .map((b) => ({ b, s: score(b) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.b);
  };

  // Click a candidate and wait to see if the transcript panel actually renders.
  const openVia = async (btn) => {
    (btn.querySelector("button") || btn).click();
    for (let i = 0; i < 14; i++) {
      await sleep(300);
      const t = readSegments();
      if (t) return t;
    }
    return null;
  };

  let panelText = readSegments();
  if (!panelText) {
    // The "Show transcript" button lives at the END of the description, so make
    // sure it's expanded first — then poll, since it renders asynchronously.
    const expand = document.querySelector(
      "ytd-text-inline-expander #expand, tp-yt-paper-button#expand, " +
        "#expand.ytd-text-inline-expander, #description #expand"
    );
    if (expand) {
      expand.click();
      await sleep(400);
    }
    let candidates = [];
    for (let i = 0; i < 8 && !candidates.length; i++) {
      candidates = findTranscriptButtons();
      if (!candidates.length) await sleep(300);
    }
    diag.btn = candidates.length;
    // Try each candidate until one actually opens the panel (not just the first).
    for (const btn of candidates) {
      panelText = await openVia(btn);
      if (panelText) break;
    }
    // Last DOM attempt: the "⋯ more actions" overflow menu sometimes holds the
    // only "Show transcript" entry. Open it, then retry the candidates.
    if (!panelText) {
      const more = [
        ...document.querySelectorAll(
          "button, yt-button-shape, ytd-button-renderer"
        ),
      ].find((b) =>
        /more actions/i.test(b.getAttribute("aria-label") || "")
      );
      if (more) {
        (more.querySelector("button") || more).click();
        await sleep(500);
        diag.moreMenu = true;
        for (const btn of findTranscriptButtons()) {
          panelText = await openVia(btn);
          if (panelText) break;
        }
      }
    }
  }
  // Only when the real transcript panel never rendered do we fall back to the
  // heuristic reader. Marked as a distinct source so a bad scrape is obvious.
  let source = "panel";
  if (!panelText) {
    panelText = readGeneric();
    if (panelText) source = "panel-generic";
  }
  if (panelText) {
    // Long transcripts can lazy-render as you scroll. Scroll any plausible
    // transcript container to the bottom and re-read until the text stops
    // growing. We measure the transcript text length (layout-agnostic) rather
    // than a specific element count.
    const containers = [
      ...document.querySelectorAll(
        "ytd-transcript-segment-list-renderer #segments-container, #segments-container, [class*='transcript'] [class*='content'], ytd-engagement-panel-section-list-renderer #content"
      ),
    ];
    let lastLen = panelText.length;
    let stall = 0;
    for (let i = 0; i < 60; i++) {
      containers.forEach((c) => (c.scrollTop = c.scrollHeight));
      await sleep(200);
      const t = readSegments();
      if (t && t.length > lastLen) {
        panelText = t;
        lastLen = t.length;
        stall = 0;
      } else if (++stall >= 3) {
        // Stop only after a few reads with no growth (segments can render in
        // bursts, so a single no-growth read doesn't mean we're done).
        break;
      }
    }
    return { ok: true, transcript: panelText, source, meta };
  }

  const reason = tracks.length ? "all-methods-failed" : "no-captions-found";
  return { ok: false, reason, meta, diag };
}

// ---- Strategy 0 helper: force the player to fetch its captions --------------

// Injected into the YouTube tab (MAIN world). It does two jobs:
//   1. Returns the video's meta (id/title/channel) so the caller has it even
//      when the transcript comes from the intercepted caption request.
//   2. Nudges YouTube's own player into REQUESTING its caption track. We never
//      build a caption URL ourselves (those come back empty without YouTube's
//      signed token) — instead we make the player issue its own, already-signed
//      .../api/timedtext request, which the background script intercepts via
//      chrome.webRequest. Toggling CC + the internal captions module are the
//      two reliable triggers; both are no-ops if captions are already loaded.
export function forceCaptionsInPage() {
  function getPlayerResponse() {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    const p = document.querySelector("#movie_player");
    try {
      return p && typeof p.getPlayerResponse === "function"
        ? p.getPlayerResponse()
        : null;
    } catch (_) {
      return null;
    }
  }

  const pr = getPlayerResponse();
  const d = pr?.videoDetails || {};
  const meta = {
    videoId: d.videoId || new URL(location.href).searchParams.get("v") || "",
    title: d.title || document.title.replace(/ - YouTube$/, ""),
    channel: d.author || "",
  };

  const player = document.querySelector("#movie_player");
  const tracks =
    pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  // (a) Drive the internal captions module — this is what actually makes the
  //     player fetch the timedtext track.
  try {
    if (player && typeof player.loadModule === "function") {
      player.loadModule("captions");
    }
  } catch (_) {}
  try {
    if (player && typeof player.setOption === "function" && tracks.length) {
      const en =
        tracks.find((t) => (t.languageCode || "").startsWith("en")) || tracks[0];
      player.setOption("captions", "track", {
        languageCode: en.languageCode || "en",
      });
    }
  } catch (_) {}

  // (b) Belt-and-suspenders: click the CC button on if it's currently off.
  try {
    const cc = document.querySelector(".ytp-subtitles-button");
    if (cc && cc.getAttribute("aria-pressed") === "false") cc.click();
  } catch (_) {}

  return { meta, hadTracks: tracks.length > 0 };
}

// ---- Strategy 2: Decodo -----------------------------------------------------

const DECODO_ENDPOINT = "https://scraper-api.decodo.com/v2/scrape";

// Decodo intermittently returns 613 ("could not scrape"); the same request
// usually works on a retry. Expect ~60-70% first-attempt failure.
export async function fetchTranscriptFromDecodo(videoId, creds, opts = {}) {
  const { username, password } = creds || {};
  if (!username || !password) {
    return { ok: false, reason: "no-credentials" };
  }
  const cleanId = String(videoId || "").trim();
  if (!/^[\w-]{11}$/.test(cleanId)) {
    return { ok: false, reason: "bad-video-id" };
  }

  const attempts = opts.attempts ?? 3;
  const gapMs = opts.gapMs ?? 3000;
  const auth = "Basic " + btoa(`${username}:${password}`);

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(DECODO_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        // Deliberately NO transcript_origin (causes 400). language_code is safe
        // to include; Decodo tolerates a missing language gracefully.
        body: JSON.stringify({
          target: "youtube_transcript",
          query: cleanId,
          language_code: "en",
        }),
      });

      if (res.status === 400) {
        return { ok: false, reason: "validation-failed" };
      }
      if (res.status === 613 || !res.ok) {
        if (i < attempts) {
          await sleep(gapMs);
          continue;
        }
        return { ok: false, reason: `decodo-${res.status}` };
      }

      const data = await res.json().catch(() => null);
      const content = data?.results?.[0]?.content;
      if (!Array.isArray(content)) {
        if (i < attempts) {
          await sleep(gapMs);
          continue;
        }
        return { ok: false, reason: "unexpected-shape" };
      }

      const text = content
        .map(
          (seg) =>
            seg?.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text || ""
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (text) return { ok: true, text };
      if (i < attempts) await sleep(gapMs);
    } catch (err) {
      if (i < attempts) await sleep(gapMs);
      else return { ok: false, reason: "network-error" };
    }
  }
  return { ok: false, reason: "exhausted-retries" };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
