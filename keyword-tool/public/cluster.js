// cluster.js — lightweight, dependency-free keyword clustering.
//
// This is *lexical* clustering: it groups keywords by their shared
// "head terms" (significant tokens once the seed and stopwords are
// stripped, with light stemming so "benefit"/"benefits" merge).
//
// It runs instantly in the browser with zero API cost, which is what
// the free tier needs. The function signature is deliberately simple so
// it can later be swapped for an embeddings-based clusterer (same input,
// same {label, keywords} output) without touching the UI.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "with", "without",
  "and", "or", "is", "are", "be", "by", "at", "as", "it", "its", "this",
  "that", "near", "like", "from", "your", "you", "my", "i", "me", "do",
  "does", "can", "will", "should", "would", "how", "what", "why", "where",
  "when", "who", "which", "whose", "best", "top", "good",
  "vs", "versus", "compared", "than", "v",
]);

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Very light stemmer — just enough to merge common plural/verb forms.
function stem(token) {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {string[]} keywords
 * @param {string} seed
 * @returns {{label:string, keywords:string[]}[]}
 */
export function clusterKeywords(keywords, seed) {
  const seedStems = new Set(tokenize(seed).map(stem));

  // Build, per keyword, the set of significant stems (drop seed + stopwords).
  // displayFor maps a stem back to the nicest original word to label with.
  const displayFor = new Map();
  const items = keywords.map((kw) => {
    const stems = new Set();
    for (const tok of tokenize(kw)) {
      const st = stem(tok);
      if (st.length <= 1) continue;
      if (STOPWORDS.has(tok) || STOPWORDS.has(st)) continue;
      if (seedStems.has(st)) continue;
      stems.add(st);
      if (!displayFor.has(st)) displayFor.set(st, tok);
    }
    return { kw, stems };
  });

  const clusters = [];

  // Keywords with no significant stems are the head/core terms.
  const core = items.filter((it) => it.stems.size === 0);
  if (core.length) clusters.push({ label: "Core / head terms", keywords: core.map((it) => it.kw) });

  let remaining = items.filter((it) => it.stems.size > 0);

  // Greedy: repeatedly pull out the most common remaining stem as a cluster.
  while (remaining.length) {
    const freq = new Map();
    for (const it of remaining) for (const st of it.stems) freq.set(st, (freq.get(st) || 0) + 1);

    let bestStem = null;
    let bestCount = 0;
    for (const [st, count] of freq) {
      if (count > bestCount) {
        bestCount = count;
        bestStem = st;
      }
    }

    if (!bestStem || bestCount < 2) break; // only singletons left

    const members = remaining.filter((it) => it.stems.has(bestStem));
    clusters.push({
      label: titleCase(displayFor.get(bestStem) || bestStem),
      keywords: members.map((it) => it.kw),
    });
    remaining = remaining.filter((it) => !it.stems.has(bestStem));
  }

  // Whatever's left are one-off long-tail phrases.
  if (remaining.length) {
    clusters.push({ label: "Other / long-tail", keywords: remaining.map((it) => it.kw) });
  }

  // Biggest, most useful themes first — but keep the catch-alls at the end.
  const isCatchAll = (c) => c.label === "Core / head terms" || c.label === "Other / long-tail";
  clusters.sort((a, b) => {
    if (isCatchAll(a) !== isCatchAll(b)) return isCatchAll(a) ? 1 : -1;
    return b.keywords.length - a.keywords.length;
  });

  return clusters;
}
