// Prompt templates. Keep these easy to read and tweak — this is the heart of
// what the tool actually does. {{title}}, {{channel}}, {{url}} and {{transcript}}
// are filled in before the prompt is sent to the AI app.

export const DEFAULT_PROMPT_ID = "summary_insights_checklist";

// Default, brand-neutral newsletter voice. Each brand profile can supply its own
// voice (Options → brand → "Writing / newsletter voice"); when set, it replaces
// this. Kept generic so the tool ships ready to resell, not tied to one brand.
export const DEFAULT_NEWSLETTER_VOICE = `WRITING VOICE (match this closely):
- Open with a warm personal greeting, then a contrarian, high-energy hook.
- Punchy, confident, short sentences. Specific numbers and concrete examples over vague claims.
- Per video section: a bold benefit-driven title, a 1-2 sentence hook, then a "What you'll discover:" list of 3 specific bullets, then a "🎥 Watch the video here" link.
- Include a short "📌 TL;DR" near the top summarising the whole edition.
- Close with a clear call-to-action, then a friendly sign-off and a "P.S." with one time-sensitive nudge.
- Neutral spelling is fine. Never invent facts beyond the transcript(s); always credit the original creator.`;

export const PROMPTS = {
  summary_insights_checklist: {
    label: "Summary + 25 insights + checklist",
    build: ({ title, channel, url, transcript }) => `You are an expert content analyst. Below is the transcript of a YouTube video.

VIDEO TITLE: ${title || "(unknown)"}
CHANNEL: ${channel || "(unknown)"}
URL: ${url || "(unknown)"}

Please produce, using only the information in the transcript:

1. SUMMARY — a tight, well-structured summary of the video (200-350 words).
2. 25 KEY INSIGHTS — the 25 most valuable, specific, non-obvious takeaways. Make each one a complete, standalone sentence. No filler.
3. ACTION CHECKLIST — a practical, do-this-now checklist a viewer can follow to implement what the video teaches. Use checkbox bullets ("- [ ] ...").

Lean on the creator's own expertise and examples (this preserves their E-E-A-T). Do not invent facts that are not supported by the transcript.

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---`,
  },

  content_ideas: {
    label: "Content idea builder",
    build: ({ title, channel, url, transcript }) => `You are a content strategist. Using the YouTube video transcript below, generate a batch of content ideas I can create from it.

VIDEO TITLE: ${title || "(unknown)"}
CHANNEL: ${channel || "(unknown)"}
URL: ${url || "(unknown)"}

Produce:
1. 10 SHORT-FORM HOOKS — punchy opening lines for Reels/Shorts/TikToks based on the strongest moments.
2. 5 ARTICLE / BLOG ANGLES — each with a working title and a one-line premise.
3. 5 SOCIAL POSTS — ready-to-post LinkedIn/X posts in a confident, practical voice.
4. 3 EMAIL SUBJECT LINES + a one-line angle for each.
5. 1 INFOGRAPHIC BRIEF — the single most "save-able" framework from the video, described as a visual brief (sections, labels, flow) ready to paste into an image generator.

Base everything strictly on the transcript and preserve the creator's expertise/examples (E-E-A-T). Don't invent facts.

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---`,
  },

  infographic: {
    label: "Infographic (smart structure + generate image)",
    build: ({ title, channel, url, transcript, brand, hasProject }) => {
      // The brand block changes depending on how the user carries their identity:
      //  - a ChatGPT/Claude Project (brand lives in the project's files) -> defer to it;
      //  - a saved text brand description -> inject it;
      //  - nothing -> generic editorial style, honour any attached reference image.
      const brandBlock = hasProject
        ? `BRAND & DESIGN RULES:\nFollow this project's saved brand identity, style guide and design rules exactly.`
        : brand
        ? `BRAND & DESIGN RULES (follow exactly):\n${brand}`
        : `BRAND & DESIGN RULES:\nNo brand profile is set. Use a clean, modern, high-contrast editorial style. If a style reference image is attached to this chat, copy ONLY its visual identity (layout, palette, typography, icon style) — never its wording or sections.`;
      return `You are an expert infographic editor and content strategist. Analyze the content below and DERIVE the most effective infographic structure from the story itself — do not force a fixed template.

VIDEO TITLE: ${title || "(unknown)"}
CHANNEL: ${channel || "(unknown)"}
URL: ${url || "(unknown)"}

If one or more images are attached to this chat, treat them as STYLE REFERENCES ONLY: copy their visual identity (layout style, typography hierarchy, colour palette, character/illustration style, icon style) and NEVER their headings, sections, content or wording.

STEP 1 — Analyze the content. Identify: the central message; the biggest misconception; the most important insights; the most actionable advice; the strongest "save-worthy" information.

STEP 2 — Design the structure. Choose the section layout that best communicates THIS specific content. Draw from patterns such as: Myth vs Reality, Warning Signs, Why It Happens, Common Mistakes, What Actually Works, Step-by-Step Process, Action Plan, Checklist, Timeline, Before vs After, Quick Rules — or any combination. Different content should produce a different structure.

STEP 3 — Generate the infographic image. Make it 1080×1350 (portrait), mobile-readable, highly shareable, save-worthy and social-friendly, educational rather than promotional. Keep all wording faithful to the content — do not invent facts beyond the transcript.

${brandBlock}

--- CONTENT START ---
${transcript}
--- CONTENT END ---`;
    },
  },

  newsletter_single: {
    label: "Newsletter edition (single video, my voice)",
    build: ({ title, channel, url, transcript, voice }) => `You are writing one edition of a newsletter, curating a single useful video for busy readers.

VIDEO TITLE: ${title || "(unknown)"}
CHANNEL: ${channel || "(unknown)"}
URL: ${url || "(unknown)"}

${voice || DEFAULT_NEWSLETTER_VOICE}

Write a complete newsletter edition with:
- A subject line + 1-line preview.
- The intro greeting with a contrarian hook (as the voice above dictates).
- A "📌 TL;DR".
- One feature section for this video: bold benefit title, hook, "What you'll discover:" (3 bullets), and the 🎥 watch link (${url || "the video"}).
- A "Your Checklist" of do-this-now steps using "- [ ]" boxes.
- A closing call-to-action, a sign-off, and a P.S. (follow the voice above).

Use only what's in the transcript; don't invent facts. Keep the creator's authority (${channel || "the creator"}) front and centre (E-E-A-T).

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---`,
  },
};

export function buildPrompt(promptId, vars) {
  const prompt = PROMPTS[promptId] || PROMPTS[DEFAULT_PROMPT_ID];
  let out = prompt.build(vars);
  // A chosen CTA is woven into the close of text content. (The infographic's CTA
  // comes from its brand footer, so we don't append it there.)
  if (vars.cta && promptId !== "infographic") {
    out += `\n\nCALL TO ACTION — weave this in as the closing call-to-action, in the writer's own voice (guide, don't hard-sell). Use it instead of any other default offer mentioned above:\n${vars.cta}`;
  }
  return out;
}
