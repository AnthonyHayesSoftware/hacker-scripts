# Keyword Ideas — free content & SEO idea generator

A free, self-hostable keyword idea tool in the spirit of AnswerThePublic /
Keyword Sheeter. It fans out a single seed keyword into ~50 Google **Suggest**
queries (questions, prepositions, comparisons, A–Z, related), dedupes the
results, and lets you:

- Browse ideas grouped by intent
- Select keywords and **export to CSV / Excel (.xlsx)**
- **Send to Claude Project** — generate a content brief from a keyword cluster
  and open it in a new Claude chat (or copy/paste), ready to become a fully
  optimised, *scored* article (traditional SEO **and** AI search).

Now includes, all free and client-side (zero API cost):
- **Keyword clustering** — groups suggestions into themed clusters.
- **STAG ad-group builder** — turns clusters into single-theme ad groups with
  match types and starter headlines, exportable as a **Google Ads** *or*
  **Microsoft Ads** bulk CSV. The same themed structure also fits Amazon &
  Apple Search Ads and Performance Max asset groups.
- **Claude Project starter** — a one-click downloadable kit (instructions +
  SEO/GEO scoring rubrics + brief template) to set up your Claude Project.

The architecture leaves clear seams for the paid features (embeddings-based
clustering, SERP-overlap clusters, search volume/difficulty, cannibalization).

## Run locally

```bash
cd keyword-tool
npm install
npm start
# open http://localhost:3000
```

No API keys required — the Suggest endpoint is public. A small per-IP rate
limit (20 searches/min) and a 24h in-memory cache keep us from getting
throttled by Google.

## How it works

- **`server.js`** — Express app. Serves the static frontend and exposes
  `GET /api/suggest?q=<seed>&hl=en&gl=us`. It:
  - builds the permutation set (`buildQueries`),
  - fetches Google Suggest with a concurrency limit of 5 (`mapLimit`),
  - dedupes into buckets, caches the payload for 24h.
  - The browser can't call Google's Suggest endpoint directly (CORS), which is
    exactly why this needs a tiny server — hence Railway, not a single HTML file.
- **`public/`** — the UI. `app.js` handles search, selection, exports and the
  Send-to-Claude brief builder.

> **Non-developer? See [`DEPLOY.md`](./DEPLOY.md)** for a click-by-click,
> no-code checklist. The quick version is below.

## Deploy to Railway (on a subdomain)

1. Push this repo (or this folder) to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**. If the repo root is
   the monorepo, set the service **Root Directory** to `keyword-tool`.
3. Nixpacks auto-detects Node and runs `npm start` (see `railway.json`).
   Railway sets `PORT` automatically; the server reads it.
4. **Custom subdomain:** Service → **Settings → Networking → Custom Domain**,
   enter e.g. `keywords.yoursite.com`. Railway gives you a CNAME target.
5. At your DNS provider, add a **CNAME** record:
   `keywords` → `<the target Railway shows>`. TLS is issued automatically.

## The Send-to-Claude workflow

The button builds a content brief from the selected keyword cluster and opens
`https://claude.ai/new?q=<prompt>` (a fresh chat with the prompt prefilled),
with a copy/paste fallback.

For best results, set up a **Claude Project** once:

- **Project instructions:** your house style + "always return an SEO score and
  an AI-search (GEO/AEO) score out of 100 with top fixes."
- **Knowledge files:** your SEO scoring rubric, brand voice guide, and any
  internal-linking map.

Then every brief you send becomes a fully optimised, scored article in your
own Project (runs on your Claude subscription, not an API bill).

## Roadmap (paid / pro seams already in place)

| Feature | Data source | Tier | Status |
|---|---|---|---|
| Suggest scraping, exports, Claude brief | Free / your infra | Free | ✅ Done |
| Keyword **clustering** (lexical) | Client-side, no API | Free | ✅ Done |
| **STAG** builder + Google **&** Microsoft Ads CSV | Cluster output | Free | ✅ Done |
| Claude **Project starter** kit download | Static bundle | Free | ✅ Done |
| Embeddings-based semantic clustering | Embeddings API ($) | Pro | Seam ready |
| SERP-overlap clustering, competitor keywords | SERP API ($) | Pro | Planned |
| Search **volume** / difficulty / CPC | DataForSEO etc. ($) | Pro | Planned |
| Keyword **cannibalization** | Google Search Console API (free) | Pro | Planned |

### Code map for the new features
- `public/cluster.js` — `clusterKeywords(keywords, seed)`; swap this one file
  for an embeddings call to upgrade to true semantic clustering.
- `public/stag.js` — `buildAdGroups()` + `adGroupsToGoogleCSV()`.
- `public/claude-project-starter/` — the downloadable kit (also browseable in
  the repo); the in-app button zips it client-side with JSZip.
