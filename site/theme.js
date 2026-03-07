const BLOG_THEME_KEY = "blog_theme";

function getStoredTheme() {
  try {
    const value = localStorage.getItem(BLOG_THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch (_) {
    return null;
  }
}

function getSystemTheme() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

function resolveTheme() {
  return getStoredTheme() || getSystemTheme();
}

function syncHighlightTheme(theme) {
  const light = document.getElementById("hljs-theme-light");
  const dark = document.getElementById("hljs-theme-dark");
  if (!light || !dark) return;

  const useDark = theme === "dark";
  light.disabled = useDark;
  dark.disabled = !useDark;
}

function syncThemeToggle(theme) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const isDark = theme === "dark";
  btn.textContent = isDark ? "Light" : "Dark";
  btn.setAttribute("aria-pressed", isDark ? "true" : "false");
}

function applyTheme(theme) {
  const target = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", target);
  syncThemeToggle(target);
  syncHighlightTheme(target);
}

function persistTheme(theme) {
  try {
    localStorage.setItem(BLOG_THEME_KEY, theme);
  } catch (_) {
    // ignore storage failures
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  persistTheme(next);
}

function initTheme() {
  applyTheme(resolveTheme());

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", toggleTheme);
  }

  try {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", () => {
        if (!getStoredTheme()) applyTheme(getSystemTheme());
      });
    }
  } catch (_) {
    // ignore media listener failures
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme, { once: true });
} else {
  initTheme();
}
