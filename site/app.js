const LANG_MODE_KEY = "blog_lang_mode";
const PANEL_OPEN_KEY = "blog_filter_panel_open";
const LIST_OPEN_KEY = "blog_post_list_open";

const state = {
  lang: localStorage.getItem(LANG_MODE_KEY) || "en",
  panelOpen: localStorage.getItem(PANEL_OPEN_KEY) !== "0",
  listOpen: localStorage.getItem(LIST_OPEN_KEY) !== "0",
  category: null,
  track: null,
  tag: null,
  data: null,
};

function byId(id) {
  return document.getElementById(id);
}

function createChip(text, active, onClick, className = "chip") {
  const btn = document.createElement("button");
  btn.className = `${className} ${active ? "active" : ""}`;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderLanguageSwitch() {
  const root = byId("lang-switch");
  root.innerHTML = "";

  root.appendChild(createChip("English", state.lang === "en", () => {
    state.lang = "en";
    localStorage.setItem(LANG_MODE_KEY, "en");
    renderAll();
  }, "mode-chip"));

  root.appendChild(createChip("한국어", state.lang === "ko", () => {
    state.lang = "ko";
    localStorage.setItem(LANG_MODE_KEY, "ko");
    renderAll();
  }, "mode-chip"));
}

function renderPanelState() {
  const panel = byId("filter-panel");
  const button = byId("panel-toggle");
  panel.classList.toggle("collapsed", !state.panelOpen);
  button.textContent = state.panelOpen ? "Hide" : "Show";
}

function renderListState() {
  const list = byId("post-list");
  const button = byId("list-toggle");
  list.classList.toggle("hidden", !state.listOpen);
  button.textContent = state.listOpen ? "Hide List" : "Show List";
}

function renderFilters() {
  const catRoot = byId("category-filters");
  const trackRoot = byId("track-filters");
  const tagRoot = byId("tag-filters");

  catRoot.innerHTML = "";
  trackRoot.innerHTML = "";
  tagRoot.innerHTML = "";

  state.data.categories.forEach((c) => {
    catRoot.appendChild(createChip(c, state.category === c, () => {
      state.category = state.category === c ? null : c;
      renderAll();
    }));
  });

  state.data.tracks.forEach((t) => {
    trackRoot.appendChild(createChip(t, state.track === t, () => {
      state.track = state.track === t ? null : t;
      renderAll();
    }));
  });

  Object.entries(state.data.tags).forEach(([tag, count]) => {
    const label = `${tag} (${count})`;
    tagRoot.appendChild(createChip(label, state.tag === tag, () => {
      state.tag = state.tag === tag ? null : tag;
      renderAll();
    }));
  });
}

function filteredPosts() {
  return state.data.posts.filter((p) => {
    if ((p.lang || "en") !== state.lang) return false;
    if (state.category && p.category !== state.category) return false;
    if (state.track && p.track !== state.track) return false;
    if (state.tag && !p.tags.includes(state.tag)) return false;
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
    const postUrl = `./post.html?path=${encodeURIComponent(p.path)}`;

    item.innerHTML = `
      <h3><a href="${postUrl}">${p.title}</a></h3>
      <div class="sub">${p.date} | ${p.category} | ${p.track} | ${p.status}</div>
      <p>${p.summary || "No summary"}</p>
      <div class="tags">${p.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    `;

    list.appendChild(item);
  });
}

function renderAll() {
  renderLanguageSwitch();
  renderPanelState();
  renderListState();
  renderFilters();
  renderPosts();
}

async function main() {
  const resp = await fetch("./posts.json");
  state.data = await resp.json();

  byId("clear-btn").addEventListener("click", () => {
    state.category = null;
    state.track = null;
    state.tag = null;
    renderAll();
  });

  byId("panel-toggle").addEventListener("click", () => {
    state.panelOpen = !state.panelOpen;
    localStorage.setItem(PANEL_OPEN_KEY, state.panelOpen ? "1" : "0");
    renderAll();
  });

  byId("list-toggle").addEventListener("click", () => {
    state.listOpen = !state.listOpen;
    localStorage.setItem(LIST_OPEN_KEY, state.listOpen ? "1" : "0");
    renderAll();
  });

  renderAll();
}

main();
