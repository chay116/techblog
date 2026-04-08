const BLOG_LANG_KEY = "blog_lang_mode";
const BLOG_LANGS = new Set(["en", "ko"]);

const SHARED_NAV_LABELS = {
  en: {
    home: "Home",
    gpu: "GPU",
    "gpu-lab": "GPU Lab",
    compiler: "Compiler",
    unreal: "Unreal",
    pathtracing: "PathTracing",
    recent: "Recent",
  },
  ko: {
    home: "홈",
    gpu: "GPU",
    "gpu-lab": "GPU Lab",
    compiler: "컴파일러",
    unreal: "언리얼",
    pathtracing: "패스 트레이싱",
    recent: "최신",
  },
};

function normalizeBlogLang(value, fallback = "en") {
  return BLOG_LANGS.has(value) ? value : fallback;
}

function getBlogLang(fallback = "en") {
  try {
    return normalizeBlogLang(localStorage.getItem(BLOG_LANG_KEY), fallback);
  } catch (_) {
    return fallback;
  }
}

function setBlogLang(lang) {
  const next = normalizeBlogLang(lang);
  try {
    localStorage.setItem(BLOG_LANG_KEY, next);
  } catch (_) {
    // ignore storage failures
  }
  return next;
}

function navLabel(key, lang = getBlogLang()) {
  const table = SHARED_NAV_LABELS[lang] || SHARED_NAV_LABELS.en;
  return table[key] || SHARED_NAV_LABELS.en[key] || key;
}

function getSharedNavItems(lang = getBlogLang()) {
  return [
    { key: "home", href: "./index.html", label: navLabel("home", lang) },
    { key: "gpu", href: "./index.html?tab=gpu", label: navLabel("gpu", lang) },
    { key: "gpu-lab", href: "./index.html?tab=gpu-lab", label: navLabel("gpu-lab", lang) },
    { key: "compiler", href: "./index.html?tab=compiler", label: navLabel("compiler", lang) },
    { key: "unreal", href: "./unreal.html", label: navLabel("unreal", lang) },
    { key: "pathtracing", href: "./unreal.html?view=pathtracing", label: navLabel("pathtracing", lang) },
    { key: "recent", href: "./index.html?tab=recent", label: navLabel("recent", lang) },
  ];
}

function renderSharedNav(activeKey, lang = getBlogLang()) {
  const nav = document.getElementById("nav-tabs");
  if (!nav) return;

  nav.innerHTML = "";
  getSharedNavItems(lang).forEach((item) => {
    const link = document.createElement("a");
    link.href = item.href;
    link.className = `nav-tab${item.key === activeKey ? " active" : ""}`;
    link.dataset.nav = item.key;
    link.textContent = item.label;
    nav.appendChild(link);
  });
}

function renderBlogLangSwitch({
  rootId = "lang-switch",
  lang = getBlogLang(),
  languageLabel = "Language",
  langEn = "English",
  langKo = "Korean",
  onChange,
} = {}) {
  const root = document.getElementById(rootId);
  if (!root) return;

  const selected = normalizeBlogLang(lang, getBlogLang());
  root.setAttribute("aria-label", languageLabel);
  root.innerHTML = "";

  const makeButton = (code, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-chip ${selected === code ? "active" : ""}`;
    button.textContent = code.toUpperCase();
    button.title = title;
    button.addEventListener("click", () => {
      const next = setBlogLang(code);
      if (typeof onChange === "function") onChange(next);
    });
    return button;
  };

  root.appendChild(makeButton("en", langEn));
  root.appendChild(makeButton("ko", langKo));
}

window.getBlogLang = getBlogLang;
window.setBlogLang = setBlogLang;
window.renderBlogLangSwitch = renderBlogLangSwitch;
window.renderSharedNav = renderSharedNav;
