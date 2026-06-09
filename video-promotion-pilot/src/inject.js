// Injected into the AI app tab to drop the prompt into its input box.
// Runs in the page (MAIN world) and must be self-contained.
//
// These web apps have no official "fill my input" API, so we target their
// editor DOM. Selectors drift over time — when one breaks, add the new one to
// the relevant list. The popup also copies the prompt to the clipboard, so a
// broken selector here just means the user pastes manually (Ctrl+V).

export function fillAiPrompt(text, app, autoSubmit) {
  const SELECTORS = {
    chatgpt: ['#prompt-textarea', 'div[contenteditable="true"]', "textarea"],
    claude: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      'fieldset div[contenteditable="true"]',
    ],
    gemini: [
      "div.ql-editor[contenteditable='true']",
      "rich-textarea div[contenteditable='true']",
      'div[contenteditable="true"]',
    ],
  };
  const selectors = SELECTORS[app] || ['div[contenteditable="true"]', "textarea"];

  function findEditor() {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function setText(el, value) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // contenteditable (ProseMirror / Quill). execCommand fires the editor's own
    // input handling, which is what these frameworks listen for.
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      const ok = document.execCommand("insertText", false, value);
      if (ok) return true;
    } catch (_) {
      /* fall through */
    }
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return true;
  }

  function submit(el) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
  }

  // The editor mounts asynchronously after the SPA loads. Poll for it.
  let tries = 0;
  const maxTries = 40; // ~20s at 500ms
  const timer = setInterval(() => {
    tries++;
    const el = findEditor();
    if (el) {
      clearInterval(timer);
      setText(el, text);
      if (autoSubmit) setTimeout(() => submit(el), 400);
    } else if (tries >= maxTries) {
      clearInterval(timer);
    }
  }, 500);
}
