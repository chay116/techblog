const PATH_TRACING_VIEW = "pathtracing";
const UNREAL_I18N = {
  en: {
    language: "Language",
    langEn: "English",
    langKo: "Korean",
    siteTitle: "Unreal Summary",
    siteSubtitle: "Folder-tree navigation for Unreal Engine notes.",
    search: "Search",
    tree: "Tree",
    searchPlaceholder: "Search title, summary, tags...",
    tracks: "Tracks",
    docs: "docs",
    browseTrack: "Browse {name} notes.",
    noSummary: "No summary",
    untitled: "(untitled)",
    all: "All",
    allPathTracing: "All PathTracing",
    searchResults: "Search Results",
    pathTracingSearch: "PathTracing Search",
    pathTracing: "PathTracing",
    unavailable: "Unavailable",
    noDocuments: "No documents for current selection.",
    loadError: "Failed to load Unreal summary data. Refresh and try again.",
    inaccessible: "Unreal documents are not accessible from this blog.",
  },
  ko: {
    language: "언어",
    langEn: "영어",
    langKo: "한국어",
    siteTitle: "언리얼 요약",
    siteSubtitle: "언리얼 엔진 노트를 폴더 트리로 탐색합니다.",
    search: "검색",
    tree: "트리",
    searchPlaceholder: "제목, 요약, 태그 검색...",
    tracks: "트랙",
    docs: "문서",
    browseTrack: "{name} 노트 둘러보기.",
    noSummary: "요약 없음",
    untitled: "(제목 없음)",
    all: "전체",
    allPathTracing: "패스 트레이싱 전체",
    searchResults: "검색 결과",
    pathTracingSearch: "패스 트레이싱 검색",
    pathTracing: "패스 트레이싱",
    unavailable: "불러오기 실패",
    noDocuments: "현재 선택에 해당하는 문서가 없습니다.",
    loadError: "언리얼 요약 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.",
    inaccessible: "이 블로그에서는 Unreal 문서를 확인할 수 없습니다.",
  },
};

function byId(id) {
  return document.getElementById(id);
}

function normalizeLang(value, fallback = "en") {
  return value === "ko" ? "ko" : fallback === "ko" ? "ko" : "en";
}

function parseQuery() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (_) {
    return new URLSearchParams();
  }
}

const state = {
  view: "all",
  dir: "",
  q: "",
  lang: typeof getBlogLang === "function" ? getBlogLang("en") : "en",
  all: [],
  tree: null,
};

function t(key) {
  const table = UNREAL_I18N[state.lang] || UNREAL_I18N.en;
  return table[key] || UNREAL_I18N.en[key] || key;
}

function formatDocsCount(count) {
  return state.lang === "ko" ? `${count}개 ${t("docs")}` : `${count} ${t("docs")}`;
}

function formatBrowseTrack(name) {
  return t("browseTrack").replace("{name}", name);
}

function currentView() {
  return state.view === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "all";
}

function currentNavMode() {
  return currentView() === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "unreal";
}

function syncUrl() {
  const params = new URLSearchParams();
  if (currentView() === PATH_TRACING_VIEW) params.set("view", PATH_TRACING_VIEW);
  if (state.lang !== "en") params.set("lang", state.lang);
  if (state.dir) params.set("dir", state.dir);
  if (state.q) params.set("q", state.q);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  try {
    window.history.replaceState(null, "", next);
  } catch (_) {
    // ignore history failures
  }
}

function makePostLink(path, from) {
  return `./post.html?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}`;
}

function makeNode(name, path) {
  return { name, path, children: new Map(), items: [], count: 0 };
}

function buildTree(posts) {
  const root = makeNode("", "");

  for (const post of posts) {
    const rel = (post.path || "").replace(/^posts\/unreal-summary\//, "");
    const parts = rel.split("/").filter(Boolean);
    const dirs = parts.slice(0, -1);

    let node = root;
    let cur = "";
    for (const dir of dirs) {
      cur = cur ? `${cur}/${dir}` : dir;
      if (!node.children.has(dir)) node.children.set(dir, makeNode(dir, cur));
      node = node.children.get(dir);
    }
    node.items.push(post);
  }

  function computeCounts(node) {
    let count = node.items.length;
    for (const child of node.children.values()) count += computeCounts(child);
    node.count = count;
    return count;
  }

  computeCounts(root);
  return root;
}

function renderLanguageSwitch() {
  if (typeof renderBlogLangSwitch !== "function") return;
  renderBlogLangSwitch({
    lang: state.lang,
    languageLabel: t("language"),
    langEn: t("langEn"),
    langKo: t("langKo"),
    onChange(next) {
      state.lang = normalizeLang(next, state.lang);
      renderAll();
    },
  });
}

function renderStaticText() {
  document.documentElement.lang = state.lang;
  document.title =
    currentView() === PATH_TRACING_VIEW ? `${t("pathTracing")} | ${t("siteTitle")}` : t("siteTitle");

  const pageTitle = byId("page-title");
  if (pageTitle) pageTitle.textContent = t("siteTitle");

  const pageSubtitle = byId("page-subtitle");
  if (pageSubtitle) pageSubtitle.textContent = t("siteSubtitle");

  const searchLabel = byId("search-label");
  if (searchLabel) searchLabel.textContent = t("search");

  const treeLabel = byId("tree-label");
  if (treeLabel) treeLabel.textContent = t("tree");

  const search = byId("search-input");
  if (search) search.placeholder = t("searchPlaceholder");
}

function renderNavTabs() {
  const mode = currentNavMode();
  if (typeof renderSharedNav === "function") {
    renderSharedNav(mode, state.lang);
    return;
  }

  const nav = byId("nav-tabs");
  if (!nav) return;
  nav.querySelectorAll(".nav-tab[data-nav]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.nav === mode);
  });
}

function isPathTracingDoc(post) {
  const path = String(post.path || "");
  const title = String(post.title || "").toLowerCase();
  const tags = (post.tags || []).map((tag) => String(tag).toLowerCase());

  return (
    path.endsWith("/Rendering/RayTracing/PathTracing.md") ||
    tags.includes("pathtracing") ||
    tags.includes("path-tracing") ||
    title.includes("path tracing")
  );
}

function visibleDocs() {
  if (currentView() === PATH_TRACING_VIEW) {
    return state.all.filter((post) => isPathTracingDoc(post));
  }
  return state.all;
}

function dirExists(dir, posts) {
  if (!dir) return true;
  return posts.some((post) => {
    const rel = (post.path || "").replace(/^posts\/unreal-summary\//, "");
    return rel.startsWith(`${dir}/`);
  });
}

function setDir(dir) {
  state.dir = dir;
  renderAll();
}

function renderTree() {
  const rootEl = byId("tree");
  if (!rootEl) return;

  rootEl.innerHTML = "";
  if (!state.tree) return;

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `tree-root-btn ${state.dir === "" ? "active" : ""}`;
  allBtn.textContent = currentView() === PATH_TRACING_VIEW ? t("allPathTracing") : t("all");
  allBtn.addEventListener("click", () => setDir(""));
  rootEl.appendChild(allBtn);

  function shouldOpen(nodePath) {
    if (!nodePath) return true;
    if (!state.dir) return false;
    return state.dir === nodePath || state.dir.startsWith(`${nodePath}/`);
  }

  function renderFolder(node) {
    const details = document.createElement("details");
    details.className = "tree-folder";
    details.open = shouldOpen(node.path);

    const summary = document.createElement("summary");
    summary.className = "tree-summary";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tree-folder-btn ${state.dir === node.path ? "active" : ""}`;
    btn.textContent = node.name;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDir(node.path);
    });

    const count = document.createElement("span");
    count.className = "tree-count";
    count.textContent = String(node.count);

    summary.appendChild(btn);
    summary.appendChild(count);
    details.appendChild(summary);

    const inner = document.createElement("div");
    inner.className = "tree-children";

    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) inner.appendChild(renderFolder(child));

    details.appendChild(inner);
    return details;
  }

  const top = [...state.tree.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const node of top) rootEl.appendChild(renderFolder(node));
}

function isMatch(post, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [post.title || "", post.summary || "", post.track || "", post.path || "", ...(post.tags || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function filteredPosts() {
  const posts = visibleDocs();
  const query = state.q.trim();
  const dir = state.dir;

  return posts.filter((post) => {
    if (query && !isMatch(post, query)) return false;
    if (!dir) return true;
    const rel = (post.path || "").replace(/^posts\/unreal-summary\//, "");
    return rel.startsWith(`${dir}/`);
  });
}

function renderTrackCards(list, posts) {
  const counts = new Map();
  const rootItems = [];

  for (const post of posts) {
    const rel = (post.path || "").replace(/^posts\/unreal-summary\//, "");
    const parts = rel.split("/").filter(Boolean);
    if (parts.length < 2) {
      rootItems.push(post);
      continue;
    }
    const top = parts[0];
    counts.set(top, (counts.get(top) || 0) + 1);
  }

  const tracks = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  tracks.forEach(([name, count]) => {
    const item = document.createElement("article");
    item.className = "post";

    const h3 = document.createElement("h3");
    const btn = document.createElement("button");
    btn.className = "tree-track-btn";
    btn.type = "button";
    btn.textContent = name;
    btn.addEventListener("click", () => setDir(name));
    h3.appendChild(btn);

    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = formatDocsCount(count);

    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = formatBrowseTrack(name);

    item.appendChild(h3);
    item.appendChild(sub);
    item.appendChild(desc);
    list.appendChild(item);
  });

  if (rootItems.length === 0) return;

  const hr = document.createElement("hr");
  hr.className = "sep";
  list.appendChild(hr);

  rootItems
    .slice()
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    .forEach((post) => {
      const item = document.createElement("article");
      item.className = "post";
      const from = `./unreal.html${window.location.search || ""}`;
      const postUrl = makePostLink(post.path, from);

      const h3 = document.createElement("h3");
      const link = document.createElement("a");
      link.href = postUrl;
      link.textContent = post.title || t("untitled");
      h3.appendChild(link);

      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = [post.date || "", post.track || ""].filter(Boolean).join(" / ");

      const summary = document.createElement("p");
      summary.textContent = post.summary || t("noSummary");

      item.appendChild(h3);
      item.appendChild(sub);
      item.appendChild(summary);
      list.appendChild(item);
    });
}

function renderPostList(list, posts) {
  const from = `./unreal.html${window.location.search || ""}`;

  posts.forEach((post) => {
    const item = document.createElement("article");
    item.className = "post";
    const postUrl = makePostLink(post.path, from);

    const rel = (post.path || "").replace(/^posts\/unreal-summary\//, "");
    const metaBits = [post.date, rel].filter(Boolean);

    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = postUrl;
    link.textContent = post.title || t("untitled");
    h3.appendChild(link);

    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = metaBits.join(" / ");

    const summary = document.createElement("p");
    summary.textContent = post.summary || t("noSummary");

    item.appendChild(h3);
    item.appendChild(sub);
    item.appendChild(summary);
    list.appendChild(item);
  });
}

function renderMain() {
  const list = byId("post-list");
  const meta = byId("meta");
  const title = byId("dir-title");
  if (!list || !meta || !title) return;

  const query = state.q.trim();
  const docs = visibleDocs();
  list.innerHTML = "";

  if (currentView() === "all" && !state.dir && !query) {
    title.textContent = t("tracks");
    meta.textContent = formatDocsCount(docs.length);
    renderTrackCards(list, docs);
    return;
  }

  const posts = filteredPosts().sort((a, b) => (a.path || "").localeCompare(b.path || ""));
  if (query) {
    title.textContent = currentView() === PATH_TRACING_VIEW ? t("pathTracingSearch") : t("searchResults");
  } else if (state.dir) {
    title.textContent = state.dir;
  } else if (currentView() === PATH_TRACING_VIEW) {
    title.textContent = t("pathTracing");
  } else {
    title.textContent = t("siteTitle");
  }
  meta.textContent = formatDocsCount(posts.length);

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("noDocuments");
    list.appendChild(empty);
    return;
  }

  renderPostList(list, posts);
}

function renderLoadError(message = t("loadError")) {
  renderStaticText();
  renderLanguageSwitch();
  renderNavTabs();

  const meta = byId("meta");
  const title = byId("dir-title");
  const list = byId("post-list");
  const tree = byId("tree");

  if (title) title.textContent = t("unavailable");
  if (meta) meta.textContent = "";
  if (tree) tree.innerHTML = "";
  if (list) {
    list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = message;
    list.appendChild(p);
  }
}

function renderAll() {
  const docs = visibleDocs();
  if (!dirExists(state.dir, docs)) state.dir = "";
  state.tree = buildTree(docs);

  const search = byId("search-input");
  if (search && search.value.trim() !== state.q) {
    search.value = state.q;
  }

  renderStaticText();
  renderLanguageSwitch();
  renderNavTabs();
  renderTree();
  renderMain();
  syncUrl();
}

async function main() {
  try {
    const params = parseQuery();
    const queryLang = params.get("lang");
    if (queryLang === "en" || queryLang === "ko") {
      state.lang = normalizeLang(queryLang, state.lang);
      if (typeof setBlogLang === "function") setBlogLang(state.lang);
    }

    state.view = params.get("view") === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "all";
    state.dir = params.get("dir") || "";
    state.q = (params.get("q") || "").trim();

    const resp = await fetch("./posts.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch posts.json (${resp.status})`);
    const data = await resp.json();
    state.all = (data.posts || []).filter((post) => post.category === "unreal-summary");

    if (state.all.length === 0) {
      renderLoadError(t("inaccessible"));
      return;
    }

    const search = byId("search-input");
    if (search) {
      search.value = state.q;
      search.addEventListener("input", () => {
        state.q = search.value.trim();
        renderAll();
      });
    }

    renderAll();
  } catch (err) {
    console.error(err);
    renderLoadError();
  }
}

main();
