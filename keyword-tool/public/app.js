"use strict";

const $ = (sel) => document.querySelector(sel);

const form = $("#search-form");
const statusEl = $("#status");
const toolbar = $("#toolbar");
const resultsEl = $("#results");

let lastData = null; // most recent API payload

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
}

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

function openClaudeDialog() {
  const kws = selectedKeywords();
  const chosen = kws.length ? kws : allKeywords();
  if (!chosen.length) {
    alert("No keywords to send yet — run a search first.");
    return;
  }
  $("#claude-focus").value = lastData.seed;
  $("#claude-preview").value = buildBrief(lastData.seed, chosen);
  // Rebuild the brief if the user edits the focus keyword.
  $("#claude-focus").oninput = () => {
    $("#claude-preview").value = buildBrief($("#claude-focus").value.trim() || lastData.seed, chosen);
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
