// stag.js — Single Theme Ad Group (STAG) builder.
//
// Takes the clusters from cluster.js and turns each themed cluster into
// one tightly-themed ad group: keywords + match types + a few starter
// headlines. Exports to a Google Ads Editor friendly CSV.
//
// STAG (vs SKAG): one ad group per *theme*, not one per keyword. Fewer
// groups to manage, still tight enough that the ad copy matches intent.

function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {{label:string, keywords:string[]}[]} clusters
 * @param {{campaign?:string}} [opts]
 * @returns {{campaign:string, adGroup:string, theme:string, keywords:string[], headlines:string[]}[]}
 */
export function buildAdGroups(clusters, opts = {}) {
  const campaign = opts.campaign || "Search Campaign";
  return clusters
    // Core/long-tail catch-alls don't make good single-theme ad groups.
    .filter((c) => c.label !== "Other / long-tail")
    .map((c) => ({
      campaign,
      adGroup: titleCase(c.label),
      theme: c.label,
      keywords: c.keywords.slice(),
      headlines: suggestHeadlines(c.label),
    }));
}

// Starter responsive-search-ad headlines. Google's limit is 30 chars, so
// we flag anything longer for the user to trim.
export function suggestHeadlines(theme) {
  const t = titleCase(theme);
  return [t, `${t} — Compare`, `Shop ${t}`, `${t} Guide`, `Get ${t} Today`].map((h) => ({
    text: h,
    overLimit: h.length > 30,
  }));
}

const MATCH_LABELS = { broad: "Broad", phrase: "Phrase", exact: "Exact" };

/**
 * Build a Google Ads Editor import CSV (one row per keyword × match type).
 * Plain keyword + a Match Type column — the import-safe combination for
 * Google Ads Editor (no bracket/quote notation to double-apply).
 * @param {ReturnType<typeof buildAdGroups>} adGroups
 * @param {("broad"|"phrase"|"exact")[]} matchTypes
 */
export function adGroupsToGoogleCSV(adGroups, matchTypes = ["phrase", "exact"]) {
  const header = ["Campaign", "Ad Group", "Keyword", "Match Type"];
  const rows = [header];
  for (const ag of adGroups) {
    for (const kw of ag.keywords) {
      for (const mt of matchTypes) {
        rows.push([ag.campaign, ag.adGroup, kw, MATCH_LABELS[mt]]);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/**
 * Build a Microsoft Advertising bulk import CSV. Microsoft's bulk format
 * needs a Type/Status column on every row and parent Campaign/Ad Group
 * rows before their keywords. Everything is created **Paused** so nothing
 * spends until you review it in the Microsoft Ads UI.
 * @param {ReturnType<typeof buildAdGroups>} adGroups
 * @param {("broad"|"phrase"|"exact")[]} matchTypes
 */
export function adGroupsToMicrosoftCSV(adGroups, matchTypes = ["phrase", "exact"]) {
  const header = ["Type", "Status", "Campaign", "Ad Group", "Keyword", "Match Type"];
  const rows = [header];

  // Group ad groups under their campaign so the parent rows come first.
  const byCampaign = new Map();
  for (const ag of adGroups) {
    if (!byCampaign.has(ag.campaign)) byCampaign.set(ag.campaign, []);
    byCampaign.get(ag.campaign).push(ag);
  }

  for (const [campaign, ags] of byCampaign) {
    rows.push(["Campaign", "Paused", campaign, "", "", ""]);
    for (const ag of ags) {
      rows.push(["Ad Group", "Paused", campaign, ag.adGroup, "", ""]);
      for (const kw of ag.keywords) {
        for (const mt of matchTypes) {
          rows.push(["Keyword", "Paused", campaign, ag.adGroup, kw, MATCH_LABELS[mt]]);
        }
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Dispatch to the right exporter by platform key. */
export function adGroupsToCSV(platform, adGroups, matchTypes) {
  return platform === "microsoft"
    ? adGroupsToMicrosoftCSV(adGroups, matchTypes)
    : adGroupsToGoogleCSV(adGroups, matchTypes);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
