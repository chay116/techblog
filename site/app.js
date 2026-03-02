const LANG_MODE_KEY = "blog_lang_mode";
const FILTER_OPEN_KEY = "blog_filter_open";
const SERIES_ORDER = ["compiler", "gpu", "other"];

const I18N = {
  en: {
    all: "All",
    language: "Language",
    series: "Series",
    filterPosts: "Filter posts",
    search: "Search",
    category: "Category",
    track: "Track",
    tags: "Tags",
    clearFilters: "Clear filters",
    searchPlaceholder: "Search title, summary, tags...",
    noPosts: "No posts for current filters.",
    noSummary: "No summary",
    loadErrorTitle: "Unavailable",
    loadErrorBody: "Failed to load posts data. Refresh and try again.",
    langEn: "English",
    langKo: "Korean",
    seriesCompiler: "Compiler",
    seriesGpu: "GPU",
    seriesOther: "Other",
  },
  ko: {
    all: "전체",
    language: "언어",
    series: "시리즈",
    filterPosts: "필터",
    search: "검색",
    category: "카테고리",
    track: "트랙",
    tags: "태그",
    clearFilters: "필터 초기화",
    searchPlaceholder: "제목, 요약, 태그 검색...",
    noPosts: "현재 필터에 해당하는 글이 없습니다.",
    noSummary: "요약 없음",
    loadErrorTitle: "불러오기 실패",
    loadErrorBody: "게시글 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.",
    langEn: "영어",
    langKo: "한국어",
    seriesCompiler: "컴파일러",
    seriesGpu: "GPU",
    seriesOther: "기타",
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

function formatPostCount(n) {
  return state.lang === "ko" ? `${n}개 글` : `${n} posts`;
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

  const series = params.get("series");
  state.series = series || null;

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
  if (state.lang && state.lang !== "en") params.set("lang", state.lang);
  if (state.series) params.set("series", state.series);
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
  if (!root) return;

  root.innerHTML = "";
  root.appendChild(
    createChip(
      t("langEn"),
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
      t("langKo"),
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

function renderStaticText() {
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
  if (state.series === "gpu") return "gpu";
  if (state.series === "compiler") return "compiler";
  return "home";
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

function renderSeriesFilters() {
  const root = byId("series-filters");
  if (!root) return;

  root.innerHTML = "";
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

  catRoot.innerHTML = "";
  trackRoot.innerHTML = "";
  tagRoot.innerHTML = "";

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
  const posts = filteredPosts();
  const list = byId("post-list");
  const meta = byId("meta");
  const modeTitle = byId("mode-title");
  if (!list || !meta || !modeTitle) return;

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

    const from = window.location.search || "";
    const postUrl =
      from.length > 1
        ? `./post.html?path=${encodeURIComponent(post.path)}&from=${encodeURIComponent(from)}`
        : `./post.html?path=${encodeURIComponent(post.path)}`;

    const metaBits = [post.date, post.series, post.category, post.track, post.status].filter(Boolean);
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = postUrl;
    link.textContent = post.title || "(untitled)";
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
  renderNavTabs();
  renderHomeIntro();
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
  renderNavTabs();
  renderHomeIntro();
  renderLanguageSwitch();
  renderStaticText();
  renderSeriesFilters();
  renderFilters();
  renderPosts();
  syncUrl();
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

  return {
    posts,
    categories,
    tracks,
    series: series.concat(extraSeries),
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
        state.category = state.data.categories.includes("worklog") ? "worklog" : null;
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
