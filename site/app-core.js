const LANG_MODE_KEY = "blog_lang_mode";
const FILTER_OPEN_KEY = "blog_filter_open";
const READER_PROGRESS_KEY = "blog_reader_progress";
const SERIES_ORDER = ["compiler", "gpu", "gpu-lab", "other"];
const SERIES_CARD_ORDER = ["gpu", "gpu-lab", "compiler"];
const SERIES_DESCRIPTIONS = {
  en: {
    gpu: "Practical notes on GPU architecture, CUDA/Vulkan, and SASS-level analysis.",
    "gpu-lab": "Earlier experiments, comparisons, and lower-level CUDA/Vulkan notes kept outside the main GPU curriculum.",
    compiler: "Compiler fundamentals and optimization notes, from SSA to pass reasoning.",
    other: "General systems notes.",
  },
  ko: {
    gpu: "GPU 구조, CUDA/Vulkan, SASS 레벨 분석을 정리한 실전 노트입니다.",
    "gpu-lab": "메인 GPU 시리즈와 분리한 실험, 비교, CUDA/Vulkan 저수준 노트입니다.",
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
    tabGpuLab: "GPU Lab",
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
    activeFilters: "Active filters",
    clearFilters: "Clear filters",
    showMoreTags: "Show more tags",
    showLessTags: "Show fewer tags",
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
    seriesGpuLab: "GPU Lab",
    seriesOther: "Other",
    bookshelf: "Bookshelf",
    startReading: "Start reading",
    continueReading: "Continue",
    openToc: "Open table of contents",
    chapter: "Chapter",
    tocTitle: "Table of Contents",
    chapterUnit: "chapters",
    modeRecentTitle: "Recent Posts",
    modeRecentBody: "Latest posts across every section of the blog.",
    modeGpuTitle: "GPU Series",
    modeGpuBody: "The main learning path for GPU architecture, ordered as a compact curriculum from execution model to performance debugging.",
    modeGpuLabTitle: "GPU Lab",
    modeGpuLabBody: "Earlier experiments, comparisons, and lower-level CUDA/Vulkan notes. Use track filters to split architecture topics from driver/API work.",
    modeCompilerTitle: "Compiler Series",
    modeCompilerBody: "Compiler fundamentals and optimization notes organized as a study path.",
  },
  ko: {
    all: "전체",
    language: "언어",
    series: "시리즈",
    tabHome: "홈",
    tabGpu: "GPU",
    tabGpuLab: "GPU Lab",
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
    activeFilters: "현재 필터",
    clearFilters: "필터 초기화",
    showMoreTags: "태그 더 보기",
    showLessTags: "태그 접기",
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
    seriesGpuLab: "GPU Lab",
    seriesOther: "기타",
    bookshelf: "시리즈",
    startReading: "읽기 시작",
    continueReading: "이어 읽기",
    openToc: "목차 보기",
    chapter: "챕터",
    tocTitle: "목차",
    chapterUnit: "개 챕터",
    modeRecentTitle: "최신 글",
    modeRecentBody: "블로그 전체 섹션에서 가장 최근에 올라온 글들입니다.",
    modeGpuTitle: "GPU Series",
    modeGpuBody: "실행 모델부터 성능 디버깅까지 이어지는 메인 GPU 학습 흐름입니다.",
    modeGpuLabTitle: "GPU Lab",
    modeGpuLabBody: "이전 실험, 비교 글, 저수준 CUDA/Vulkan 노트를 모아둔 구역입니다. 트랙 필터로 아키텍처와 Driver/API를 나눠 볼 수 있습니다.",
    modeCompilerTitle: "Compiler Series",
    modeCompilerBody: "컴파일러 기초와 최적화 노트를 학습 흐름에 맞춰 정리한 시리즈입니다.",
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
  lang: typeof getBlogLang === "function" ? getBlogLang("en") : safeStorageGet(LANG_MODE_KEY, "en"),
  nav: "home",
  series: null,
  category: null,
  track: null,
  tag: null,
  q: "",
  explicitCategory: false,
  tagsExpanded: false,
  data: null,
};

function byId(id) {
  return document.getElementById(id);
}

function t(key) {
  const table = I18N[state.lang] || I18N.en;
  return table[key] || I18N.en[key] || key;
}

function persistLang(lang) {
  if (typeof setBlogLang === "function") {
    setBlogLang(lang);
    return;
  }
  safeStorageSet(LANG_MODE_KEY, lang);
}

function seriesLabel(value) {
  if (value === "compiler") return t("seriesCompiler");
  if (value === "gpu") return t("seriesGpu");
  if (value === "gpu-lab") return t("seriesGpuLab");
  return t("seriesOther");
}

function seriesDescription(value) {
  const table = SERIES_DESCRIPTIONS[state.lang] || SERIES_DESCRIPTIONS.en;
  return table[value] || table.other || SERIES_DESCRIPTIONS.en.other;
}

function categoryLabel(value) {
  if (value === "gpu-series") return "GPU Series";
  if (value === "worklog") return state.lang === "ko" ? "노트" : "Notes";
  if (value === "comparison") return state.lang === "ko" ? "비교" : "Comparison";
  return value;
}

function trackLabel(value) {
  if (value === "gpu-architecture") return "GPU Architecture";
  if (value === "api-language") return state.lang === "ko" ? "GPU Driver/API" : "GPU Driver/API";
  if (value === "runtime-framework") return state.lang === "ko" ? "GPU Runtime/Framework" : "GPU Runtime/Framework";
  return value;
}

function orderedTracks(tracks) {
  const preferred = currentNavMode() === "gpu-lab"
    ? ["gpu-architecture", "api-language", "runtime-framework", "tooling"]
    : ["gpu-architecture", "tooling", "api-language", "runtime-framework"];
  const rank = new Map(preferred.map((value, idx) => [value, idx]));
  return tracks.slice().sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return trackLabel(a).localeCompare(trackLabel(b));
  });
}

function formatPostCount(n) {
  return state.lang === "ko" ? `${n}개 글` : `${n} posts`;
}

function formatChapterCount(n) {
  return state.lang === "ko" ? `${n}${t("chapterUnit")}` : `${n} ${t("chapterUnit")}`;
}

function currentModeInfo() {
  const mode = currentNavMode();
  if (mode === "gpu") {
    return { title: t("modeGpuTitle"), body: t("modeGpuBody") };
  }
  if (mode === "gpu-lab") {
    return { title: t("modeGpuLabTitle"), body: t("modeGpuLabBody") };
  }
  if (mode === "compiler") {
    return { title: t("modeCompilerTitle"), body: t("modeCompilerBody") };
  }
  if (mode === "recent") {
    return { title: t("modeRecentTitle"), body: t("modeRecentBody") };
  }
  return { title: state.lang === "ko" ? t("langKo") : t("langEn"), body: "" };
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
  if (tab === "home" || tab === "gpu" || tab === "gpu-lab" || tab === "compiler" || tab === "recent") return tab;
  if (series === "gpu" || series === "gpu-lab" || series === "compiler") return series;
  if (params.has("category") || params.has("track") || params.has("tag") || params.has("q")) return "recent";
  return "home";
}

function applyQueryToState(params) {
  const lang = params.get("lang");
  if (lang === "en" || lang === "ko") {
    state.lang = lang;
    persistLang(lang);
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

  if (mode === "recent" || mode === "gpu" || mode === "gpu-lab" || mode === "compiler") {
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

function getSeriesProgress(series, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const lang = entries[0].lang || state.lang;
  const progress = getProgress(series, lang);
  if (!progress) return null;
  return entries.some((entry) => entry.path === progress.path) ? progress : null;
}

function formatProgress(progress) {
  if (!progress) return "";
  if (progress.index && progress.total) {
    return state.lang === "ko"
      ? `${t("chapter")} ${progress.index}/${progress.total}`
      : `Chapter ${progress.index}/${progress.total}`;
  }
  return progress.title || "";
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
  if (typeof renderBlogLangSwitch === "function") {
    renderBlogLangSwitch({
      lang: state.lang,
      languageLabel: t("language"),
      langEn: t("langEn"),
      langKo: t("langKo"),
      onChange(next) {
        state.lang = next;
        persistLang(next);
        renderAll();
      },
    });
    return;
  }

  const root = byId("lang-switch");
  if (!root) return;

  root.setAttribute("aria-label", t("language"));
  root.innerHTML = "";
  const en = createChip(
    "EN",
    state.lang === "en",
    () => {
      state.lang = "en";
      persistLang("en");
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
      persistLang("ko");
      renderAll();
    },
    "mode-chip"
  );
  ko.title = t("langKo");
  root.appendChild(ko);
}

function renderStaticText() {
  document.documentElement.lang = state.lang;

  const subtitle = byId("site-subtitle");
  if (subtitle) subtitle.textContent = t("siteSubtitle");

  const homeTitle = byId("home-title");
  if (homeTitle) homeTitle.textContent = t("aboutTitle");

  const homeBody = byId("home-body");
  if (homeBody) homeBody.textContent = t("aboutBody");

  const seriesLabelNode = byId("series-label");
  if (seriesLabelNode) seriesLabelNode.textContent = t("series");

  const filterSummary = byId("filter-summary");
  if (filterSummary) filterSummary.textContent = t("filterPosts");

  const searchLabel = byId("filter-search-label");
  if (searchLabel) searchLabel.textContent = t("search");

  const categoryLabelNode = byId("filter-category-label");
  if (categoryLabelNode) categoryLabelNode.textContent = t("category");

  const trackLabelNode = byId("filter-track-label");
  if (trackLabelNode) trackLabelNode.textContent = t("track");

  const tagsLabel = byId("filter-tags-label");
  if (tagsLabel) tagsLabel.textContent = t("tags");

  const clearBtn = byId("clear-btn");
  if (clearBtn) clearBtn.textContent = t("clearFilters");

  const search = byId("search-input");
  if (search) search.placeholder = t("searchPlaceholder");
}

function currentNavMode() {
  if (state.nav === "recent" || state.nav === "gpu" || state.nav === "gpu-lab" || state.nav === "compiler") return state.nav;
  return "home";
}

function applyModeState() {
  const mode = currentNavMode();

  if (mode === "gpu" || mode === "gpu-lab" || mode === "compiler") {
    state.series = mode;
    state.category = mode === "gpu" ? "gpu-series" : "all";
    return;
  }

  if (mode === "home") {
    state.series = null;
    state.track = null;
    state.tag = null;
    state.q = "";
    state.tagsExpanded = false;
    if (!state.explicitCategory && state.data && state.data.categories.includes("worklog")) {
      state.category = "worklog";
    }
  }
}

function renderLayoutMode() {
  const mode = currentNavMode();
  const showFilter = mode === "recent" || mode === "gpu" || mode === "gpu-lab" || mode === "compiler";
  const showSeriesFilter = mode === "recent";
  const showPostFeed = mode !== "home";

  const layout = document.querySelector(".layout");
  if (layout) layout.classList.toggle("no-sidebar", !showFilter);

  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.hidden = !showFilter;

  const seriesRow = document.querySelector(".series-row");
  if (seriesRow) seriesRow.hidden = !showSeriesFilter;

  const postSection = document.querySelector(".post-section");
  if (postSection) postSection.hidden = !showPostFeed;
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

function renderHomeIntro() {
  const intro = byId("home-intro");
  if (!intro) return;
  intro.hidden = currentNavMode() !== "home";
}
