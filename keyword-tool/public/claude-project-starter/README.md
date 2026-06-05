# Claude Project Starter — SEO Content Engine

This bundle turns a plain Claude Project into a repeatable machine that takes a
keyword cluster and returns an optimised, **scored** article — for both
traditional SEO and AI search (GEO/AEO).

## What's in here

| File | Where it goes in Claude |
|---|---|
| `project-instructions.md` | Paste into the Project's **custom instructions** |
| `knowledge/seo-scoring-rubric.md` | Upload as a **Project knowledge** file |
| `knowledge/ai-search-geo-aeo-rubric.md` | Upload as a **Project knowledge** file |
| `knowledge/brand-voice-template.md` | Fill in, then upload as **Project knowledge** |
| `knowledge/content-brief-template.md` | Upload as **Project knowledge** (the brief format) |

## One-time setup (5 minutes)

1. Go to **claude.ai → Projects → Create project**. Name it e.g. "SEO Content Engine".
2. Open **Set project instructions** and paste the contents of
   `project-instructions.md`.
3. Open **Add content / knowledge** and upload the four files in `knowledge/`.
   Edit `brand-voice-template.md` first so it describes *your* brand.
4. Done. The Project now knows your house style, your scoring rubrics, and the
   brief format it should follow.

## Daily use

1. In the Keyword Ideas tool, pick a cluster and click **✦ Send to Claude
   Project** (or **Send this cluster to Claude** on the Clusters tab).
2. It opens a new chat with a content brief prefilled. Make sure you're in
   **this Project**, then send.
3. Claude returns the brief, the article, and two scores (SEO + AI search) with
   the top fixes to raise each.

> Tip: keep one Project per site/brand so the voice and internal-linking map
> stay consistent.
