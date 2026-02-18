const LANG_MODE_KEY = "blog_lang_mode";
const FILTER_OPEN_KEY = "blog_filter_open";

function safeStorageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    // ignore storage failures
  }
}

const state = {
  lang: safeStorageGet(LANG_MODE_KEY, "en"),
  category: null,
  track: null,
  tag: null,
  q: "",
  explicitCategory: false,
  data: null,
};

function byId(id) {
  return document.getElementById(id);
}

function parseQuery() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (_) {
    return new URLSearchParams();
  }
}

function applyQueryToState(params) {
  const lang = params.get("lang");
  if (lang === "en" || lang === "ko") {
    state.lang = lang;
    safeStorageSet(LANG_MODE_KEY, lang);
  }

  state.explicitCategory = params.has("category");
  const category = params.get("category");
  state.category = category || null;

  const track = params.get("track");
  state.track = track || null;

  const tag = params.get("tag");
  state.tag = tag || null;

  const q = params.get("q");
  state.q = q ? q.trim() : "";
}

function validateStateAgainstData() {
  if (!state.data) return;

  if (state.category && state.category !== "all" && !state.data.categories.includes(state.category)) state.category = null;
  if (state.track && !state.data.tracks.includes(state.track)) state.track = null;
  if (state.tag && !(state.tag in state.data.tags)) state.tag = null;
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.lang && state.lang !== "en") params.set("lang", state.lang);
  if (state.category) params.set("category", state.category);
  if (state.track) params.set("track", state.track);
  if (state.tag) params.set("tag", state.tag);
  if (state.q) params.set("q", state.q);

  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  try {
    window.history.replaceState(null, "", next);
  } catch (_) {
    // ignore history failures (e.g., restricted environments)
  }
}

function createChip(text, active, onClick, className = "chip") {
  const btn = document.createElement("button");
  btn.className = `${className} ${active ? "active" : ""}`;
  btn.textContent = text;
  btn.type = "button";
  btn.addEventListener("click", onClick);
  return btn;
}

function renderLanguageSwitch() {
  const root = byId("lang-switch");
  root.innerHTML = "";

  root.appendChild(
    createChip(
      "English",
      state.lang === "en",
      () => {
        state.lang = "en";
        safeStorageSet(LANG_MODE_KEY, "en");
        renderAll();
      },
      "mode-chip"
    )
  );

  root.appendChild(
    createChip(
      "한국어",
      state.lang === "ko",
      () => {
        state.lang = "ko";
        safeStorageSet(LANG_MODE_KEY, "ko");
        renderAll();
      },
      "mode-chip"
    )
  );
}

function renderFilters() {
  const catRoot = byId("category-filters");
  const trackRoot = byId("track-filters");
  const tagRoot = byId("tag-filters");

  catRoot.innerHTML = "";
  trackRoot.innerHTML = "";
  tagRoot.innerHTML = "";

  state.data.categories.forEach((c) => {
    catRoot.appendChild(
      createChip(c, state.category === c, () => {
        state.category = state.category === c ? null : c;
        renderAll();
      })
    );
  });

  state.data.tracks.forEach((t) => {
    trackRoot.appendChild(
      createChip(t, state.track === t, () => {
        state.track = state.track === t ? null : t;
        renderAll();
      })
    );
  });

  Object.entries(state.data.tags).forEach(([tag, count]) => {
    tagRoot.appendChild(
      createChip(`${tag} (${count})`, state.tag === tag, () => {
        state.tag = state.tag === tag ? null : tag;
        renderAll();
      })
    );
  });
}

function filteredPosts() {
  const q = state.q.trim().toLowerCase();
  return state.data.posts.filter((p) => {
    if ((p.lang || "en") !== state.lang) return false;
    if (state.category && state.category !== "all" && p.category !== state.category) return false;
    if (state.track && p.track !== state.track) return false;
    if (state.tag && !(p.tags || []).includes(state.tag)) return false;
    if (q) {
      const hay = [
        p.title || "",
        p.summary || "",
        p.category || "",
        p.track || "",
        ...(p.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderPosts() {
  const posts = filteredPosts();
  const list = byId("post-list");
  const meta = byId("meta");
  const modeTitle = byId("mode-title");

  modeTitle.textContent = state.lang === "ko" ? "한국어" : "English";
  meta.textContent = `${posts.length} posts`;
  list.innerHTML = "";

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No posts for current filters.";
    list.appendChild(empty);
    return;
  }

  posts.forEach((p) => {
    const item = document.createElement("article");
    item.className = "post";

    const from = window.location.search || "";
    const postUrl =
      from.length > 1
        ? `./post.html?path=${encodeURIComponent(p.path)}&from=${encodeURIComponent(from)}`
        : `./post.html?path=${encodeURIComponent(p.path)}`;

    const metaBits = [p.date, p.category, p.track, p.status].filter(Boolean);
    const metaText = metaBits.join(" · ");

    item.innerHTML = `
      <h3><a href="${postUrl}">${p.title}</a></h3>
      <p class="sub">${metaText}</p>
      <p>${p.summary || "No summary"}</p>
    `;

    list.appendChild(item);
  });
}

function renderAll() {
  renderLanguageSwitch();
  renderFilters();
  renderPosts();
  syncUrl();
}

async function main() {
  const resp = await fetch("./posts.json");
  state.data = await resp.json();

  const params = parseQuery();
  applyQueryToState(params);
  validateStateAgainstData();

  // Default view: Worklog only, unless category was explicitly set in the URL.
  if (!state.explicitCategory && !state.category && state.data.categories.includes("worklog")) {
    state.category = "worklog";
  }

  const search = byId("search-input");
  if (search) {
    search.value = state.q;
    search.addEventListener("input", () => {
      state.q = search.value.trim();
      renderAll();
    });
  }

  const details = byId("filter-details");
  details.open = safeStorageGet(FILTER_OPEN_KEY, "0") === "1";
  details.addEventListener("toggle", () => {
    safeStorageSet(FILTER_OPEN_KEY, details.open ? "1" : "0");
  });

  byId("clear-btn").addEventListener("click", () => {
    state.category = state.data.categories.includes("worklog") ? "worklog" : null;
    state.track = null;
    state.tag = null;
    state.q = "";
    const search2 = byId("search-input");
    if (search2) search2.value = "";
    renderAll();
  });

  renderAll();
}

main();
