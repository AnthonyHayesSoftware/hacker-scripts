// Options page: simple settings + a manager for user-defined brand profiles.

const simpleFields = {
  urlChatgpt: document.getElementById("urlChatgpt"),
  urlClaude: document.getElementById("urlClaude"),
  urlGemini: document.getElementById("urlGemini"),
  decodoUsername: document.getElementById("user"),
  decodoPassword: document.getElementById("pass"),
};
const decodoEnabledEl = document.getElementById("decodoEnabled");
const brandList = document.getElementById("brandList");
const brandTemplate = document.getElementById("brandTemplate");
const ctaList = document.getElementById("ctaList");
const ctaTemplate = document.getElementById("ctaTemplate");
const savedEl = document.getElementById("saved");

const newId = () =>
  "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Render one editable brand card from a profile object (or an empty one).
function addBrandCard(brand = {}) {
  const node = brandTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = brand.id || newId();
  node.querySelector(".b-name").value = brand.name || "";
  node.querySelector(".b-desc").value = brand.description || "";
  node.querySelector(".b-voice").value = brand.voice || "";
  node.querySelector(".b-chatgpt").value = brand.projectChatgpt || "";
  node.querySelector(".b-claude").value = brand.projectClaude || "";
  node.querySelector(".b-gemini").value = brand.projectGemini || "";
  node.querySelector(".remove").addEventListener("click", () => node.remove());
  brandList.appendChild(node);
}

function collectBrands() {
  return [...brandList.querySelectorAll(".brand-card")]
    .map((node) => ({
      id: node.dataset.id,
      name: node.querySelector(".b-name").value.trim(),
      description: node.querySelector(".b-desc").value.trim(),
      voice: node.querySelector(".b-voice").value.trim(),
      projectChatgpt: node.querySelector(".b-chatgpt").value.trim(),
      projectClaude: node.querySelector(".b-claude").value.trim(),
      projectGemini: node.querySelector(".b-gemini").value.trim(),
    }))
    // Drop fully-empty cards so a stray "Add brand" click doesn't save noise.
    .filter(
      (b) =>
        b.name ||
        b.description ||
        b.voice ||
        b.projectChatgpt ||
        b.projectClaude ||
        b.projectGemini
    );
}

// Render one editable CTA card from a CTA object (or an empty one).
function addCtaCard(cta = {}) {
  const node = ctaTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = cta.id || newId();
  node.querySelector(".c-name").value = cta.name || "";
  node.querySelector(".c-text").value = cta.text || "";
  node.querySelector(".c-url").value = cta.url || "";
  node.querySelector(".remove").addEventListener("click", () => node.remove());
  ctaList.appendChild(node);
}

function collectCtas() {
  return [...ctaList.querySelectorAll(".brand-card")]
    .map((node) => ({
      id: node.dataset.id,
      name: node.querySelector(".c-name").value.trim(),
      text: node.querySelector(".c-text").value.trim(),
      url: node.querySelector(".c-url").value.trim(),
    }))
    .filter((c) => c.name || c.text || c.url);
}

// ---- Load ----
chrome.storage.sync
  .get([
    ...Object.keys(simpleFields),
    "decodoEnabled",
    "brandProfiles",
    "brandStyle",
    "ctas",
  ])
  .then((s) => {
    for (const [key, el] of Object.entries(simpleFields)) el.value = s[key] || "";
    decodoEnabledEl.checked = !!s.decodoEnabled;

    let profiles = Array.isArray(s.brandProfiles) ? s.brandProfiles : [];
    // Migrate a legacy single brandStyle into a profile on first open.
    if (!profiles.length && s.brandStyle && s.brandStyle.trim()) {
      profiles = [{ id: newId(), name: "My brand", description: s.brandStyle.trim() }];
    }
    profiles.forEach(addBrandCard);

    (Array.isArray(s.ctas) ? s.ctas : []).forEach(addCtaCard);
  });

document.getElementById("addBrand").addEventListener("click", () => addBrandCard());
document.getElementById("addCta").addEventListener("click", () => addCtaCard());

document.getElementById("clearCache").addEventListener("click", async () => {
  await chrome.storage.local.remove("transcriptCache");
  const el = document.getElementById("cacheCleared");
  el.textContent = "Cleared ✓";
  setTimeout(() => (el.textContent = ""), 2000);
});

// Snapshot the current form state — shared by Save and Export so a backup
// always reflects exactly what's on screen, including unsaved edits.
function currentSettings() {
  const data = {};
  for (const [key, el] of Object.entries(simpleFields)) data[key] = el.value.trim();
  data.decodoEnabled = decodoEnabledEl.checked;
  data.brandProfiles = collectBrands();
  data.ctas = collectCtas();
  return data;
}

// ---- Save ----
document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set(currentSettings());
  savedEl.textContent = "Saved ✓";
  setTimeout(() => (savedEl.textContent = ""), 2000);
});

// ---- Backup & restore ----
const backupMsg = document.getElementById("backupMsg");
function flashBackup(text, ok = true) {
  backupMsg.textContent = text;
  backupMsg.style.color = ok ? "#1d6b3a" : "#b42318";
  setTimeout(() => (backupMsg.textContent = ""), 4000);
}

document.getElementById("exportBtn").addEventListener("click", () => {
  const payload = {
    _app: "Video Promotion Pilot",
    _type: "vpp-settings-backup",
    _version: 1,
    _exportedAt: new Date().toISOString(),
    settings: currentSettings(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `vpp-settings-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flashBackup("Exported ✓");
});

document.getElementById("importBtn").addEventListener("click", () =>
  document.getElementById("importFile").click()
);

document.getElementById("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = ""; // allow re-importing the same file later
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // Accept either the wrapped backup or a bare settings object.
    const settings = parsed && parsed.settings ? parsed.settings : parsed;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("not a settings file");
    }
    // Never let a backup smuggle in cache or unknown junk — keep known keys only.
    const allowed = [
      ...Object.keys(simpleFields),
      "decodoEnabled",
      "brandProfiles",
      "brandStyle",
      "ctas",
    ];
    const clean = {};
    for (const k of allowed) if (k in settings) clean[k] = settings[k];
    await chrome.storage.sync.set(clean);
    flashBackup("Imported ✓ — reloading…");
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    flashBackup("Import failed — not a valid backup file", false);
  }
});
