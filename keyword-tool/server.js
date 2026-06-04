import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ *
 *  Permutation engine
 *  We expand a single seed keyword into many Google Suggest queries,
 *  grouped into buckets so the UI can show "Questions", "Prepositions",
 *  etc. separately (AnswerThePublic style).
 * ------------------------------------------------------------------ */
const MODIFIERS = {
  questions: {
    label: "Questions",
    // prefix-style: "how <seed>"
    prefixes: [
      "how", "what", "why", "where", "when", "who", "which", "whose",
      "are", "is", "can", "do", "does", "will", "should", "would",
    ],
  },
  prepositions: {
    label: "Prepositions",
    // suffix-style: "<seed> for"
    suffixes: ["for", "with", "without", "to", "near", "like", "versus", "vs", "is", "in", "on", "of"],
  },
  comparisons: {
    label: "Comparisons",
    suffixes: ["vs", "or", "and", "versus", "compared to", "alternative", "alternatives"],
  },
  alphabet: {
    label: "Alphabetical",
    // suffix-style: "<seed> a" ... "<seed> z"
    suffixes: "abcdefghijklmnopqrstuvwxyz".split(""),
  },
};

function buildQueries(seed) {
  const s = seed.trim();
  const jobs = [];
  // The bare seed gives us the "Related" / core suggestions.
  jobs.push({ bucket: "related", query: s });

  for (const mod of MODIFIERS.questions.prefixes) {
    jobs.push({ bucket: "questions", query: `${mod} ${s}` });
  }
  for (const mod of MODIFIERS.prepositions.suffixes) {
    jobs.push({ bucket: "prepositions", query: `${s} ${mod}` });
  }
  for (const mod of MODIFIERS.comparisons.suffixes) {
    jobs.push({ bucket: "comparisons", query: `${s} ${mod}` });
  }
  for (const mod of MODIFIERS.alphabet.suffixes) {
    jobs.push({ bucket: "alphabet", query: `${s} ${mod}` });
  }
  return jobs;
}

/* ------------------------------------------------------------------ *
 *  Google Suggest fetch  (the whole engine is this one endpoint)
 *  client=firefox returns clean JSON: ["query", ["s1","s2",...]]
 * ------------------------------------------------------------------ */
async function fetchSuggest(query, { hl, gl }) {
  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.searchParams.set("client", "firefox");
  url.searchParams.set("q", query);
  if (hl) url.searchParams.set("hl", hl);
  if (gl) url.searchParams.set("gl", gl);

  const res = await fetch(url, {
    headers: {
      // A normal-looking UA keeps Google from serving us junk.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json,text/javascript,*/*",
    },
  });
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.[1]) ? data[1] : [];
}

/* ------------------------------------------------------------------ *
 *  Small concurrency limiter — be a good citizen, don't fire 50
 *  requests at Google at once or we get throttled / blocked.
 * ------------------------------------------------------------------ */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ *
 *  In-memory cache (24h). Good enough for a single Railway instance;
 *  swap for Redis if you scale out.
 * ------------------------------------------------------------------ */
const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.v;
}
function cacheSet(key, v) {
  CACHE.set(key, { t: Date.now(), v });
}

/* ------------------------------------------------------------------ *
 *  Naive per-IP rate limit so the free tool can't be hammered.
 * ------------------------------------------------------------------ */
const RATE = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20; // searches per minute per IP
function rateLimited(ip) {
  const now = Date.now();
  const entry = RATE.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  RATE.set(ip, entry);
  return entry.count > RATE_MAX;
}

/* ------------------------------------------------------------------ *
 *  API: /api/suggest?q=...&hl=en&gl=us
 * ------------------------------------------------------------------ */
app.get("/api/suggest", async (req, res) => {
  const seed = (req.query.q || "").toString().trim();
  const hl = (req.query.hl || "en").toString().slice(0, 5);
  const gl = (req.query.gl || "").toString().slice(0, 5);

  if (!seed) return res.status(400).json({ error: "Missing ?q= seed keyword." });
  if (seed.length > 80) return res.status(400).json({ error: "Seed keyword too long." });

  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.ip || "unknown").trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Rate limit reached. Please wait a minute and try again." });
  }

  const cacheKey = `${hl}|${gl}|${seed.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const jobs = buildQueries(seed);
    const seen = new Set([seed.toLowerCase()]);
    const buckets = {
      related: [],
      questions: [],
      prepositions: [],
      comparisons: [],
      alphabet: [],
    };

    await mapLimit(jobs, 5, async (job) => {
      let suggestions = [];
      try {
        suggestions = await fetchSuggest(job.query, { hl, gl });
      } catch {
        return; // skip a failed modifier rather than fail the whole search
      }
      for (const sug of suggestions) {
        const key = sug.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        buckets[job.bucket].push(sug);
      }
    });

    const total = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);
    const payload = {
      seed,
      hl,
      gl,
      total,
      generatedAt: new Date().toISOString(),
      buckets,
      labels: {
        related: "Related / Core",
        questions: MODIFIERS.questions.label,
        prepositions: MODIFIERS.prepositions.label,
        comparisons: MODIFIERS.comparisons.label,
        alphabet: MODIFIERS.alphabet.label,
      },
    };
    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: "Upstream suggest request failed.", detail: String(err.message || err) });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Keyword Ideas tool listening on :${PORT}`);
});
