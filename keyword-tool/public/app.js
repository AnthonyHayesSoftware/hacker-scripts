import { clusterKeywords } from "./cluster.js";
import { buildAdGroups, adGroupsToGoogleCSV } from "./stag.js";

const $ = (sel) => document.querySelector(sel);

const form = $("#search-form");
const statusEl = $("#status");
const toolbar = $("#toolbar");
const resultsEl = $("#results");

let lastData = null;     // most recent API payload
let lastClusters = [];   // clusterKeywords() output for the current results

/* ------------------------------------------------------------------ *
 *  Search
 * ------------------------------------------------------------------ */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const seed = $("#seed").value.trim();
  if (!seed) return;
  const hl = $("#hl").value;
  const gl = $("#gl").value;

  setStatus(`<span class="spinner"></span> Pulling ideas for “${escapeHtml(seed)}”… (this fans out ~50 Google queries)`);
  toolbar.hidden = true;
  resultsEl.innerHTML = "";

  try {
    const params = new URLSearchParams({ q: seed, hl });
    if (gl) params.set("gl", gl);
    const res = await fetch(`/api/suggest?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    lastData = data;
    render(data);
  } catch (err) {
    setStatus(`⚠️ ${escapeHtml(err.message || String(err))}`, true);
  }
});

function setStatus(html, isError = false) {
  statusEl.hidden = false;
  statusEl.className = "status" + (isError ? " error" : "");
  statusEl.innerHTML = html;
}

/* ------------------------------------------------------------------ *
 *  Render results
 * ------------------------------------------------------------------ */
function render(data) {
  statusEl.hidden = true;

  $("#result-count").textContent = data.total;
  $("#result-seed").textContent = data.seed;
  $("#cached-flag").hidden = !data.cached;
  toolbar.hidden = false;

  const order = ["related", "questions", "comparisons", "prepositions", "alphabet"];
  resultsEl.innerHTML = "";

  if (data.total === 0) {
    setStatus("No suggestions came back — try a broader seed, or a different country/language.", true);
    toolbar.hidden = true;
    $("#views").hidden = true;
    return;
  }

  for (const bucket of order) {
    const items = data.buckets[bucket] || [];
    const card = document.createElement("div");
    card.className = "card";
    const label = data.labels[bucket] || bucket;
    card.innerHTML = `
      <h3>${escapeHtml(label)} <span class="count">${items.length}</span></h3>
      ${items.length
        ? `<ul>${items.map((s) => liFor(s, bucket)).join("")}</ul>`
        : `<div class="empty">No results for this group.</div>`}
    `;
    resultsEl.appendChild(card);
  }
  updateSelectedCount();

  // Build the clustered + ad-group views from the full flat keyword list.
  const allKw = Object.values(data.buckets).flat();
  lastClusters = clusterKeywords(allKw, data.seed);
  renderClusters();
  renderAdGroups();
  $("#views").hidden = false;
  switchView("ideas");
}

/* ------------------------------------------------------------------ *
 *  View switching (Ideas / Clusters / Ad Groups)
 * ------------------------------------------------------------------ */
function switchView(view) {
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.dataset.view !== view));
  // The select/export toolbar only applies to the Ideas view.
  toolbar.hidden = view !== "ideas";
}
$("#views").addEventListener("click", (e) => {
  if (e.target.dataset.view) switchView(e.target.dataset.view);
});

/* ------------------------------------------------------------------ *
 *  Clusters view
 * ------------------------------------------------------------------ */
function renderClusters() {
  const el = $("#clusters");
  el.innerHTML = "";
  for (const c of lastClusters) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(c.label)} <span class="count">${c.keywords.length}</span></h3>
      <ul>${c.keywords.map((s) => `<li><label><span>${escapeHtml(s)}</span></label></li>`).join("")}</ul>
      <div style="padding:8px 10px;border-top:1px solid var(--border)">
        <button class="btn claude" data-cluster="${escapeHtml(c.label)}" style="width:100%">✦ Send this cluster to Claude</button>
      </div>`;
    el.appendChild(card);
  }
}
$("#clusters").addEventListener("click", (e) => {
  const label = e.target.dataset.cluster;
  if (!label) return;
  const c = lastClusters.find((x) => x.label === label);
  if (c) openClaudeDialog(c.keywords, label === "Core / head terms" ? lastData.seed : label);
});

/* ------------------------------------------------------------------ *
 *  Ad Groups view (STAG)
 * ------------------------------------------------------------------ */
function selectedMatchTypes() {
  return [...document.querySelectorAll(".mt:checked")].map((c) => c.value);
}
function currentAdGroups() {
  return buildAdGroups(lastClusters, { campaign: $("#stag-campaign").value.trim() || "Search Campaign" });
}
function renderAdGroups() {
  const el = $("#adgroups-list");
  el.innerHTML = "";
  for (const ag of currentAdGroups()) {
    const card = document.createElement("div");
    card.className = "adgroup";
    const heads = ag.headlines
      .map((h) => `<code class="${h.overLimit ? "over" : ""}" title="${h.overLimit ? "Over 30 chars — trim it" : ""}">${escapeHtml(h.text)}</code>`)
      .join("");
    card.innerHTML = `
      <h3>${escapeHtml(ag.adGroup)} <span class="count">${ag.keywords.length} kw</span></h3>
      <div class="headlines"><div>Starter headlines:</div>${heads}</div>
      <ul>${ag.keywords.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>`;
    el.appendChild(card);
  }
}
$("#stag-campaign").addEventListener("input", renderAdGroups);
$("#stag-export").addEventListener("click", () => {
  const mts = selectedMatchTypes();
  if (!mts.length) return alert("Pick at least one match type.");
  const csv = adGroupsToGoogleCSV(currentAdGroups(), mts);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slug(lastData.seed)}-adgroups.csv`);
});

function liFor(suggestion, bucket) {
  return `<li><label>
    <input type="checkbox" class="kw" data-bucket="${escapeHtml(bucket)}" value="${escapeHtml(suggestion)}" />
    <span>${escapeHtml(suggestion)}</span>
  </label></li>`;
}

/* ------------------------------------------------------------------ *
 *  Selection + toolbar actions
 * ------------------------------------------------------------------ */
resultsEl.addEventListener("change", (e) => {
  if (e.target.classList.contains("kw")) updateSelectedCount();
});

function selectedKeywords() {
  return [...document.querySelectorAll(".kw:checked")].map((c) => c.value);
}
function allKeywords() {
  return [...document.querySelectorAll(".kw")].map((c) => c.value);
}
function updateSelectedCount() {
  const n = selectedKeywords().length;
  $("#selected-count").textContent = `${n} selected`;
}

toolbar.addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  switch (act) {
    case "select-all":
      document.querySelectorAll(".kw").forEach((c) => (c.checked = true));
      updateSelectedCount();
      break;
    case "clear":
      document.querySelectorAll(".kw").forEach((c) => (c.checked = false));
      updateSelectedCount();
      break;
    case "copy":
      copyText(exportRows().map((r) => r.keyword).join("\n"));
      flash(e.target, "Copied!");
      break;
    case "csv":
      downloadCSV();
      break;
    case "xlsx":
      downloadXLSX();
      break;
    case "claude":
      openClaudeDialog();
      break;
  }
});

/** Rows for export: selected if any are checked, otherwise everything. */
function exportRows() {
  const checked = [...document.querySelectorAll(".kw:checked")];
  const source = checked.length ? checked : [...document.querySelectorAll(".kw")];
  return source.map((c) => ({ keyword: c.value, group: lastData.labels[c.dataset.bucket] || c.dataset.bucket }));
}

/* ------------------------------------------------------------------ *
 *  Exports
 * ------------------------------------------------------------------ */
function downloadCSV() {
  const rows = exportRows();
  const csv = ["Keyword,Group", ...rows.map((r) => `${csvCell(r.keyword)},${csvCell(r.group)}`)].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slug(lastData.seed)}-keywords.csv`);
}

function downloadXLSX() {
  if (typeof XLSX === "undefined") {
    alert("Excel library is still loading — try again in a second, or use CSV.");
    return;
  }
  const rows = exportRows();
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({ Keyword: r.keyword, Group: r.group })));
  ws["!cols"] = [{ wch: 50 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Keywords");
  XLSX.writeFile(wb, `${slug(lastData.seed)}-keywords.xlsx`);
}

/* ------------------------------------------------------------------ *
 *  Send to Claude Project
 *  Builds a content brief and deep-links a new Claude chat with the
 *  prompt prefilled (paste into your Project), or copy/paste fallback.
 * ------------------------------------------------------------------ */
const dialog = $("#claude-dialog");

function openClaudeDialog(keywords, focus) {
  // Called with explicit args from a cluster, or with none from the toolbar
  // (then it uses the current selection, falling back to everything).
  let chosen = keywords;
  if (!chosen) {
    const kws = selectedKeywords();
    chosen = kws.length ? kws : allKeywords();
  }
  if (!chosen.length) {
    alert("No keywords to send yet — run a search first.");
    return;
  }
  const focusKw = focus || lastData.seed;
  $("#claude-focus").value = focusKw;
  $("#claude-preview").value = buildBrief(focusKw, chosen);
  // Rebuild the brief if the user edits the focus keyword.
  $("#claude-focus").oninput = () => {
    $("#claude-preview").value = buildBrief($("#claude-focus").value.trim() || focusKw, chosen);
  };
  dialog.showModal();
}

function buildBrief(focus, keywords) {
  return [
    `You are my SEO content strategist. Using the knowledge files and instructions in this Project, write a content brief and then a full article.`,
    ``,
    `PRIMARY KEYWORD: ${focus}`,
    ``,
    `KEYWORD CLUSTER (group these into H2/H3 sections by intent; ignore irrelevant ones):`,
    ...keywords.map((k) => `- ${k}`),
    ``,
    `Deliverables:`,
    `1. A content brief: search intent, suggested title (with the primary keyword), meta description, and an H2/H3 outline that maps each cluster keyword to a section.`,
    `2. A list of questions to answer for featured snippets and AI Overviews.`,
    `3. Entities / related topics to mention for topical authority.`,
    `4. The full article, written to the brief.`,
    `5. An optimisation score out of 100 for BOTH traditional SEO and AI search (GEO/AEO), with the top fixes to raise each score.`,
  ].join("\n");
}

$("#claude-open").addEventListener("click", () => {
  const text = $("#claude-preview").value;
  // claude.ai/new?q= opens a fresh chat with the prompt prefilled.
  const url = `https://claude.ai/new?q=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener");
  dialog.close();
});

$("#claude-copy").addEventListener("click", () => {
  copyText($("#claude-preview").value);
  flash($("#claude-copy"), "Copied!");
});

/* ------------------------------------------------------------------ *
 *  Claude Project starter bundle
 *  Fetches the static starter files and zips them in-browser so the
 *  user can drop them straight into a new Claude Project.
 * ------------------------------------------------------------------ */
const STARTER_FILES = [
  "claude-project-starter/README.md",
  "claude-project-starter/project-instructions.md",
  "claude-project-starter/knowledge/seo-scoring-rubric.md",
  "claude-project-starter/knowledge/ai-search-geo-aeo-rubric.md",
  "claude-project-starter/knowledge/brand-voice-template.md",
  "claude-project-starter/knowledge/content-brief-template.md",
];

$("#starter-btn").addEventListener("click", async (e) => {
  if (typeof JSZip === "undefined") {
    alert("Zip library is still loading — try again in a second.");
    return;
  }
  flash(e.target, "Building…");
  try {
    const zip = new JSZip();
    await Promise.all(
      STARTER_FILES.map(async (path) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Missing ${path}`);
        zip.file(path.replace(/^claude-project-starter\//, ""), await res.text());
      })
    );
    const blob = await zip.generateAsync({ type: "blob" });
    triggerDownload(blob, "claude-project-starter.zip");
  } catch (err) {
    alert(`Could not build the bundle: ${err.message}`);
  }
});

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function flash(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => (btn.textContent = old), 1200);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "keywords";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
