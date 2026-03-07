const LANG_MODE_KEY = "blog_lang_mode";
const FILTER_OPEN_KEY = "blog_filter_open";
const READER_PROGRESS_KEY = "blog_reader_progress";
const SERIES_ORDER = ["compiler", "gpu", "other"];
const SERIES_CARD_ORDER = ["gpu", "compiler"];
const SERIES_DESCRIPTIONS = {
  en: {
    gpu: "Practical notes on GPU architecture, CUDA/Vulkan, and SASS-level analysis.",
    compiler: "Compiler fundamentals and optimization notes, from SSA to pass reasoning.",
    other: "General systems notes.",
  },
  ko: {
    gpu: "GPU 구조, CUDA/Vulkan, SASS 레벨 분석을 정리한 실전 노트입니다.",
    compiler: "SSA부터 최적화 패스 사고 방식까지 다루는 컴파일러 학습 노트입니다.",
    other: "시스템 일반 주제 노트입니다.",
  },
};

const I18N = {
  en: {
    all: "All",
    language: "Language",
    series: "Series",
    tabHome: "Home",
    tabGpu: "GPU",
    tabCompiler: "Compiler",
    tabRecent: "Recent",
    siteSubtitle: "Worklog and research notes on GPU optimization, graphics APIs, and systems engineering.",
    aboutTitle: "About This Blog",
    aboutBody: "I study GPU architecture and compiler internals, and I organize practical notes here.",
    filterPosts: "Filter posts",
    search: "Search",
    category: "Category",
    track: "Track",
    tags: "Tags",
    clearFilters: "Clear filters",
    searchPlaceholder: "Search title, summary, tags...",
    noPosts: "No posts for current filters.",
    noSummary: "No summary",
    untitled: "(untitled)",
    loadErrorTitle: "Unavailable",
    loadErrorBody: "Failed to load posts data. Refresh and try again.",
    langEn: "English",
    langKo: "Korean",
    seriesCompiler: "Compiler",
    seriesGpu: "GPU",
    seriesOther: "Other",
    bookshelf: "Bookshelf",
    startReading: "Start reading",
    continueReading: "Continue",
    openToc: "Open table of contents",
    chapter: "Chapter",
    tocTitle: "Table of Contents",
    chapterUnit: "chapters",
  },
  ko: {
    all: "전체",
    language: "언어",
    series: "시리즈",
    tabHome: "홈",
    tabGpu: "GPU",
    tabCompiler: "컴파일러",
    tabRecent: "최신",
    siteSubtitle: "GPU 최적화, 그래픽스 API, 시스템 엔지니어링 관련 작업 기록과 연구 노트입니다.",
    aboutTitle: "블로그 소개",
    aboutBody: "GPU 아키텍처와 컴파일러 내부 동작을 공부하며, 실전 중심 노트를 정리합니다.",
    filterPosts: "필터",
    search: "검색",
    category: "카테고리",
    track: "트랙",
    tags: "태그",
    clearFilters: "필터 초기화",
    searchPlaceholder: "제목, 요약, 태그 검색...",
    noPosts: "현재 필터에 해당하는 글이 없습니다.",
    noSummary: "요약 없음",
    untitled: "(제목 없음)",
    loadErrorTitle: "불러오기 실패",
    loadErrorBody: "게시글 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.",
    langEn: "영어",
    langKo: "한국어",
    seriesCompiler: "컴파일러",
    seriesGpu: "GPU",
    seriesOther: "기타",
    bookshelf: "시리즈",
    startReading: "읽기 시작",
    continueReading: "이어 읽기",
    openToc: "목차 보기",
    chapter: "챕터",
    tocTitle: "목차",
    chapterUnit: "개 챕터",
  },
};

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
  nav: "home",
  series: null,
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

function t(key) {
  const table = I18N[state.lang] || I18N.en;
  return table[key] || I18N.en[key] || key;
}

function seriesLabel(value) {
  if (value === "compiler") return t("seriesCompiler");
  if (value === "gpu") return t("seriesGpu");
  return t("seriesOther");
}

function seriesDescription(value) {
  const table = SERIES_DESCRIPTIONS[state.lang] || SERIES_DESCRIPTIONS.en;
  return table[value] || table.other || SERIES_DESCRIPTIONS.en.other;
}

function formatPostCount(n) {
  return state.lang === "ko" ? `${n}개 글` : `${n} posts`;
}

function formatChapterCount(n) {
  return state.lang === "ko" ? `${n}${t("chapterUnit")}` : `${n} ${t("chapterUnit")}`;
}

function parseQuery() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (_) {
    return new URLSearchParams();
  }
}

function inferNavMode(params, series) {
  const tab = params.get("tab");
  if (tab === "home" || tab === "gpu" || tab === "compiler" || tab === "recent") return tab;
  if (series === "gpu" || series === "compiler") return series;
  if (params.has("category") || params.has("track") || params.has("tag") || params.has("q")) return "recent";
  return "home";
}

function applyQueryToState(params) {
  const lang = params.get("lang");
  if (lang === "en" || lang === "ko") {
    state.lang = lang;
    safeStorageSet(LANG_MODE_KEY, lang);
  }

  const series = params.get("series");
  state.series = series || null;
  state.nav = inferNavMode(params, series);

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

  if (state.series && !state.data.series.includes(state.series)) state.series = null;
  if (state.category && state.category !== "all" && !state.data.categories.includes(state.category)) state.category = null;
  if (state.track && !state.data.tracks.includes(state.track)) state.track = null;
  if (state.tag && !(state.tag in state.data.tags)) state.tag = null;
}

function syncUrl() {
  const params = new URLSearchParams();
  const mode = currentNavMode();

  if (mode !== "home") params.set("tab", mode);
  if (state.lang && state.lang !== "en") params.set("lang", state.lang);

  if (mode === "recent" || mode === "gpu" || mode === "compiler") {
    if (state.series) params.set("series", state.series);
    if (mode === "recent" && state.category) params.set("category", state.category);
    if (state.track) params.set("track", state.track);
    if (state.tag) params.set("tag", state.tag);
    if (state.q) params.set("q", state.q);
  }

  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  try {
    window.history.replaceState(null, "", next);
  } catch (_) {
    // ignore history failures (e.g., restricted environments)
  }
}

function readProgressMap() {
  const raw = safeStorageGet(READER_PROGRESS_KEY, "{}");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) {
    // ignore parse failures
  }
  return {};
}

function progressKey(series, lang) {
  return `${series || "other"}:${lang || "en"}`;
}

function getProgress(series, lang) {
  const map = readProgressMap();
  const entry = map[progressKey(series, lang)];
  if (!entry || typeof entry !== "object") return null;
  if (!entry.path) return null;
  return entry;
}

function buildPostUrl(path) {
  const from = window.location.search || "";
  return from.length > 1
    ? `./post.html?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}`
    : `./post.html?path=${encodeURIComponent(path)}`;
}

function buildSeriesTocHref(series) {
  if (series === "gpu" || series === "compiler") {
    return `./index.html?tab=${encodeURIComponent(series)}`;
  }
  return `./index.html?tab=recent&series=${encodeURIComponent(series)}&category=all`;
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
  if (!root) return;

  root.setAttribute("aria-label", t("language"));
  root.innerHTML = "";
  const en = createChip(
    "EN",
    state.lang === "en",
    () => {
      state.lang = "en";
      safeStorageSet(LANG_MODE_KEY, "en");
      renderAll();
    },
    "mode-chip"
  );
  en.title = t("langEn");
  root.appendChild(en);

  const ko = createChip(
    "KO",
    state.lang === "ko",
    () => {
      state.lang = "ko";
      safeStorageSet(LANG_MODE_KEY, "ko");
      renderAll();
    },
    "mode-chip"
  );
  ko.title = t("langKo");
  root.appendChild(ko);
}

function renderStaticText() {
  const subtitle = byId("site-subtitle");
  if (subtitle) subtitle.textContent = t("siteSubtitle");

  const homeTitle = byId("home-title");
  if (homeTitle) homeTitle.textContent = t("aboutTitle");

  const homeBody = byId("home-body");
  if (homeBody) homeBody.textContent = t("aboutBody");

  document.querySelectorAll(".nav-tab[data-i18n]").forEach((tab) => {
    const key = tab.dataset.i18n;
    if (key) tab.textContent = t(key);
  });

  const seriesLabelNode = byId("series-label");
  if (seriesLabelNode) seriesLabelNode.textContent = t("series");

  const langLabel = byId("lang-label");
  if (langLabel) langLabel.textContent = t("language");

  const filterSummary = byId("filter-summary");
  if (filterSummary) filterSummary.textContent = t("filterPosts");

  const searchLabel = byId("filter-search-label");
  if (searchLabel) searchLabel.textContent = t("search");

  const categoryLabel = byId("filter-category-label");
  if (categoryLabel) categoryLabel.textContent = t("category");

  const trackLabel = byId("filter-track-label");
  if (trackLabel) trackLabel.textContent = t("track");

  const tagsLabel = byId("filter-tags-label");
  if (tagsLabel) tagsLabel.textContent = t("tags");

  const clearBtn = byId("clear-btn");
  if (clearBtn) clearBtn.textContent = t("clearFilters");

  const search = byId("search-input");
  if (search) search.placeholder = t("searchPlaceholder");
}

function currentNavMode() {
  if (state.nav === "recent" || state.nav === "gpu" || state.nav === "compiler") return state.nav;
  return "home";
}

function applyModeState() {
  const mode = currentNavMode();

  if (mode === "gpu" || mode === "compiler") {
    state.series = mode;
    state.category = "all";
    return;
  }

  if (mode === "home") {
    state.series = null;
    state.track = null;
    state.tag = null;
    state.q = "";
    if (!state.explicitCategory && state.data && state.data.categories.includes("worklog")) {
      state.category = "worklog";
    }
  }
}

function renderLayoutMode() {
  const mode = currentNavMode();
  const showFilter = mode === "recent" || mode === "gpu" || mode === "compiler";
  const showSeriesFilter = mode === "recent";
  const showPostFeed = mode !== "home";

  const layout = document.querySelector(".layout");
  if (layout) layout.classList.toggle("no-sidebar", !showFilter);

  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.hidden = !showFilter;

  const seriesRow = document.querySelector(".series-row");
  if (seriesRow) seriesRow.hidden = !showSeriesFilter;

  const modeRow = document.querySelector(".mode-row");
  if (modeRow) modeRow.hidden = !showPostFeed;

  const postSection = document.querySelector(".post-section");
  if (postSection) postSection.hidden = !showPostFeed;
}

function renderNavTabs() {
  const nav = byId("nav-tabs");
  if (!nav) return;

  const mode = currentNavMode();
  nav.querySelectorAll(".nav-tab[data-nav]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.nav === mode);
  });
}

function renderHomeIntro() {
  const intro = byId("home-intro");
  if (!intro) return;

  intro.hidden = currentNavMode() !== "home";
}

function seriesEntries(series, lang) {
  if (!state.data || !state.data.seriesToc) return [];
  const bySeries = state.data.seriesToc[series];
  if (!bySeries || typeof bySeries !== "object") return [];
  const direct = bySeries[lang];
  if (Array.isArray(direct)) return direct;
  return [];
}

function firstAvailableSeriesEntries(series) {
  if (!state.data || !state.data.seriesToc) return [];
  const bySeries = state.data.seriesToc[series];
  if (!bySeries || typeof bySeries !== "object") return [];

  const langs = Object.keys(bySeries).sort();
  for (const lang of langs) {
    if (Array.isArray(bySeries[lang]) && bySeries[lang].length > 0) return bySeries[lang];
  }
  return [];
}

function renderBookshelf() {
  const root = byId("bookshelf");
  if (!root) return;

  const show = currentNavMode() === "home";
  root.hidden = !show;
  if (!show || !state.data) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = t("bookshelf");
  root.appendChild(title);

  const cards = document.createElement("div");
  cards.className = "series-cards";

  const ordered = SERIES_CARD_ORDER.concat(
    state.data.series.filter((entry) => !SERIES_CARD_ORDER.includes(entry))
  );

  ordered.forEach((series) => {
    const entries = seriesEntries(series, state.lang);
    const fallback = firstAvailableSeriesEntries(series);
    const targetEntries = entries.length > 0 ? entries : fallback;
    if (targetEntries.length === 0) return;

    const first = targetEntries[0];

    const card = document.createElement("article");
    card.className = "series-card";

    const h3 = document.createElement("h3");
    h3.textContent = seriesLabel(series);
    card.appendChild(h3);

    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = seriesDescription(series);
    card.appendChild(desc);

    const count = document.createElement("p");
    count.className = "sub";
    count.textContent = formatChapterCount(targetEntries.length);
    card.appendChild(count);

    const actions = document.createElement("p");
    actions.className = "series-actions";

    const start = document.createElement("a");
    start.href = buildPostUrl(first.path);
    start.textContent = t("startReading");
    actions.appendChild(start);

    const sep = document.createElement("span");
    sep.textContent = " · ";
    actions.appendChild(sep);

    const toc = document.createElement("a");
    toc.href = buildSeriesTocHref(series);
    toc.textContent = t("openToc");
    actions.appendChild(toc);

    card.appendChild(actions);
    cards.appendChild(card);
  });

  root.appendChild(cards);
}

function renderSeriesReader() {
  const root = byId("series-reader");
  if (!root) return;

  const mode = currentNavMode();
  const show = mode === "gpu" || mode === "compiler";
  root.hidden = !show;
  if (!show || !state.data) {
    root.innerHTML = "";
    return;
  }

  const entries = seriesEntries(state.series, state.lang);
  const targetEntries = entries.length > 0 ? entries : firstAvailableSeriesEntries(state.series);
  root.innerHTML = "";

  if (targetEntries.length === 0) return;

  const heading = document.createElement("h3");
  heading.textContent = `${seriesLabel(state.series)} ${t("tocTitle")}`;
  root.appendChild(heading);

  const topActions = document.createElement("p");
  topActions.className = "series-actions";

  const start = document.createElement("a");
  start.href = buildPostUrl(targetEntries[0].path);
  start.textContent = t("startReading");
  topActions.appendChild(start);
  root.appendChild(topActions);

  const list = document.createElement("ol");
  list.className = "series-toc";

  targetEntries.forEach((entry) => {
    const li = document.createElement("li");

    const link = document.createElement("a");
    link.href = buildPostUrl(entry.path);
    link.textContent = entry.title || t("untitled");

    const meta = document.createElement("span");
    meta.className = "sub";
    const bits = [entry.date, entry.track].filter(Boolean);
    meta.textContent = bits.length > 0 ? `(${bits.join(" · ")})` : "";

    li.appendChild(link);
    li.appendChild(meta);
    list.appendChild(li);
  });

  root.appendChild(list);
}

function renderSeriesFilters() {
  const root = byId("series-filters");
  if (!root) return;

  root.innerHTML = "";
  if (currentNavMode() !== "recent") return;

  root.appendChild(
    createChip(t("all"), !state.series, () => {
      state.series = null;
      renderAll();
    })
  );

  state.data.series.forEach((series) => {
    root.appendChild(
      createChip(seriesLabel(series), state.series === series, () => {
        state.series = state.series === series ? null : series;
        renderAll();
      })
    );
  });
}

function renderFilters() {
  const catRoot = byId("category-filters");
  const trackRoot = byId("track-filters");
  const tagRoot = byId("tag-filters");
  if (!catRoot || !trackRoot || !tagRoot) return;

  const mode = currentNavMode();
  const showCategory = mode === "recent";
  const isFilterMode = mode === "recent" || mode === "gpu" || mode === "compiler";

  const categoryLabel = byId("filter-category-label");
  if (categoryLabel) categoryLabel.hidden = !showCategory;
  catRoot.hidden = !showCategory;

  catRoot.innerHTML = "";
  trackRoot.innerHTML = "";
  tagRoot.innerHTML = "";
  if (!isFilterMode) return;

  if (showCategory) {
    catRoot.appendChild(
      createChip(t("all"), state.category === "all", () => {
        state.category = state.category === "all" ? null : "all";
        renderAll();
      })
    );

    state.data.categories.forEach((category) => {
      catRoot.appendChild(
        createChip(category, state.category === category, () => {
          state.category = state.category === category ? null : category;
          renderAll();
        })
      );
    });
  }

  state.data.tracks.forEach((track) => {
    trackRoot.appendChild(
      createChip(track, state.track === track, () => {
        state.track = state.track === track ? null : track;
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
  return state.data.posts.filter((post) => {
    if ((post.lang || "en") !== state.lang) return false;
    if (state.series && post.series !== state.series) return false;
    if (state.category && state.category !== "all" && post.category !== state.category) return false;
    if (state.track && post.track !== state.track) return false;
    if (state.tag && !(post.tags || []).includes(state.tag)) return false;

    if (q) {
      const haystack = [
        post.title || "",
        post.summary || "",
        post.series || "",
        post.category || "",
        post.track || "",
        ...(post.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

function renderPosts() {
  let posts = filteredPosts();
  const list = byId("post-list");
  const meta = byId("meta");
  const modeTitle = byId("mode-title");
  if (!list || !meta || !modeTitle) return;

  if (currentNavMode() === "recent") {
    posts = posts
      .slice()
      .sort(
        (a, b) =>
          (b.date || "").localeCompare(a.date || "") ||
          (a.title || "").localeCompare(b.title || "") ||
          (a.path || "").localeCompare(b.path || "")
      );
  } else if (state.series) {
    const entries = seriesEntries(state.series, state.lang);
    const targetEntries = entries.length > 0 ? entries : firstAvailableSeriesEntries(state.series);
    const orderMap = new Map(targetEntries.map((entry, idx) => [entry.path, idx]));
    posts = posts.slice().sort((a, b) => {
      const ia = orderMap.has(a.path) ? orderMap.get(a.path) : Number.MAX_SAFE_INTEGER;
      const ib = orderMap.has(b.path) ? orderMap.get(b.path) : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return (a.date || "").localeCompare(b.date || "") || (a.title || "").localeCompare(b.title || "");
    });
  }

  modeTitle.textContent = state.lang === "ko" ? t("langKo") : t("langEn");
  meta.textContent = formatPostCount(posts.length);
  list.innerHTML = "";

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("noPosts");
    list.appendChild(empty);
    return;
  }

  posts.forEach((post) => {
    const item = document.createElement("article");
    item.className = "post";
    const postUrl = buildPostUrl(post.path);

    const metaBits = [post.date, post.series, post.category, post.track, post.status].filter(Boolean);
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = postUrl;
    link.textContent = post.title || t("untitled");
    h3.appendChild(link);

    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = metaBits.join(" · ");

    const summary = document.createElement("p");
    summary.textContent = post.summary || t("noSummary");

    item.appendChild(h3);
    item.appendChild(sub);
    item.appendChild(summary);
    list.appendChild(item);
  });
}

function renderLoadError() {
  applyModeState();
  renderNavTabs();
  renderLayoutMode();
  renderHomeIntro();
  renderBookshelf();
  renderSeriesReader();
  renderLanguageSwitch();
  renderStaticText();

  const list = byId("post-list");
  const meta = byId("meta");
  const modeTitle = byId("mode-title");
  if (modeTitle) modeTitle.textContent = t("loadErrorTitle");
  if (meta) meta.textContent = "";

  if (list) {
    list.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("loadErrorBody");
    list.appendChild(p);
  }
}

function renderAll() {
  applyModeState();
  renderNavTabs();
  renderLayoutMode();
  renderHomeIntro();
  renderBookshelf();
  renderSeriesReader();
  renderLanguageSwitch();
  renderStaticText();
  renderSeriesFilters();
  renderFilters();
  renderPosts();
  syncUrl();
}

function chapterSortKey(post) {
  const parsedOrder = Number(post.order);
  const order = Number.isFinite(parsedOrder) ? parsedOrder : null;
  const date = post.date || "";
  const title = post.title || "";
  const path = post.path || "";
  if (order !== null) return [0, order, date, title, path];
  return [1, date, title, path];
}

function compareSortKey(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? "";
    const bv = b[i] ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function buildSeriesTocFallback(posts, seriesList) {
  const out = {};
  seriesList.forEach((series) => {
    const bySeries = posts.filter((post) => post.series === series);
    if (bySeries.length === 0) return;

    const byLang = {};
    const langs = [...new Set(bySeries.map((post) => post.lang || "en"))].sort();
    langs.forEach((lang) => {
      const langPosts = bySeries.filter((post) => (post.lang || "en") === lang);
      langPosts.sort((a, b) => compareSortKey(chapterSortKey(a), chapterSortKey(b)));
      byLang[lang] = langPosts.map((post, idx) => ({
        index: idx + 1,
        total: langPosts.length,
        path: post.path,
        title: post.title || "",
        date: post.date || "",
        lang: post.lang || "en",
        category: post.category || "other",
        track: post.track || "other",
        status: post.status || "wip",
        book: post.book || `${seriesLabel(series)} Series`,
        part: post.part || post.track || "General",
        chapter: post.chapter || post.title || "",
        order: Number.isFinite(Number(post.order)) ? Number(post.order) : null,
        prev_path: idx > 0 ? langPosts[idx - 1].path : null,
        next_path: idx + 1 < langPosts.length ? langPosts[idx + 1].path : null,
      }));
    });
    out[series] = byLang;
  });
  return out;
}

function normalizeData(rawData) {
  const data = rawData || {};
  const posts = (data.posts || []).filter((post) => post.category !== "unreal-summary");

  const categories = [...new Set(posts.map((post) => post.category).filter(Boolean))].sort();
  const tracks = [...new Set(posts.map((post) => post.track).filter(Boolean))].sort();

  const seriesSet = new Set(posts.map((post) => post.series || "other"));
  const series = SERIES_ORDER.filter((entry) => seriesSet.has(entry));
  const extraSeries = [...seriesSet].filter((entry) => !SERIES_ORDER.includes(entry)).sort();

  const tagCounts = {};
  posts.forEach((post) => {
    (post.tags || []).forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  const seriesToc =
    data.series_toc && typeof data.series_toc === "object"
      ? data.series_toc
      : buildSeriesTocFallback(posts, series.concat(extraSeries));

  return {
    posts,
    categories,
    tracks,
    series: series.concat(extraSeries),
    seriesToc,
    tags: Object.fromEntries(
      Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    ),
  };
}

async function main() {
  try {
    const resp = await fetch("./posts.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch posts.json (${resp.status})`);

    state.data = normalizeData(await resp.json());

    const params = parseQuery();
    applyQueryToState(params);
    validateStateAgainstData();
    applyModeState();

    const search = byId("search-input");
    if (search) {
      search.value = state.q;
      search.addEventListener("input", () => {
        state.q = search.value.trim();
        renderAll();
      });
    }

    const details = byId("filter-details");
    if (details) {
      details.open = safeStorageGet(FILTER_OPEN_KEY, "0") === "1";
      details.addEventListener("toggle", () => {
        safeStorageSet(FILTER_OPEN_KEY, details.open ? "1" : "0");
      });
    }

    const clearBtn = byId("clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.series = null;
        state.category = null;
        state.track = null;
        state.tag = null;
        state.q = "";

        const search2 = byId("search-input");
        if (search2) search2.value = "";

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
