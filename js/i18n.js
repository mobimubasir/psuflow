// /js/i18n.js
(function (win) {
  const LS_KEY = "psu_lang";
  const SUPPORTED = ["en", "ar"];
  const DICTS = {};
  let current = "en";

  async function loadDict(lang) {
    if (DICTS[lang]) return DICTS[lang];
    const res = await fetch(`/lang/${lang}.json?v=3`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load /lang/${lang}.json`);
    const json = await res.json();
    DICTS[lang] = json;
    return json;
  }

  function t(key, fb) {
    const dict = DICTS[current] || {};
    return dict[key] ?? fb ?? key;
  }

  function translateEl(el) {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const val = t(key, el.textContent || "");
    if (el.tagName === "TITLE") {
      document.title = val;
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(translateEl);
    const titleEl = document.querySelector("title[data-i18n]");
    if (titleEl) translateEl(titleEl);
  }

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = "en";
    await loadDict(lang);
    current = lang;
    localStorage.setItem(LS_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";
    apply(document);
    return lang;
  }

  function getLang() { return current; }

  async function init({ langSelect = null, onApplied = null } = {}) {
    const saved = localStorage.getItem(LS_KEY);
    const initial = SUPPORTED.includes(saved) ? saved : "en";
    await setLang(initial);

    if (langSelect) {
      const sel = document.querySelector(langSelect);
      if (sel) {
        sel.value = initial;
        sel.addEventListener("change", async (e) => {
          const lang = await setLang(e.target.value);
          if (typeof onApplied === "function") onApplied(lang);
        });
      }
    }

    if (typeof onApplied === "function") onApplied(initial);
    return initial;
  }

  win.PSUi18n = { init, setLang, apply, getLang, t };
})(window);
