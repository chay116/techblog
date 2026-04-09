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
    const progress = getSeriesProgress(series, targetEntries);
    const showContinue = progress && progress.path !== first.path;

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

    if (progress) {
      const progressLine = document.createElement("p");
      progressLine.className = "sub";
      progressLine.textContent = `${t("continueReading")}: ${formatProgress(progress)}`;
      card.appendChild(progressLine);
    }

    const actions = document.createElement("p");
    actions.className = "series-actions";

    if (showContinue) {
      const continueLink = document.createElement("a");
      continueLink.href = buildPostUrl(progress.path);
      continueLink.textContent = t("continueReading");
      actions.appendChild(continueLink);

      const continueSep = document.createElement("span");
      continueSep.textContent = " · ";
      actions.appendChild(continueSep);
    }

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
  const show = mode === "gpu" || mode === "gpu-lab" || mode === "compiler";
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

  const progress = getSeriesProgress(state.series, targetEntries);
  const showContinue = progress && progress.path !== targetEntries[0].path;
  const topActions = document.createElement("p");
  topActions.className = "series-actions";

  if (showContinue) {
    const continueLink = document.createElement("a");
    continueLink.href = buildPostUrl(progress.path);
    continueLink.textContent = t("continueReading");
    topActions.appendChild(continueLink);

    const continueSep = document.createElement("span");
    continueSep.textContent = " · ";
    topActions.appendChild(continueSep);
  }

  const start = document.createElement("a");
  start.href = buildPostUrl(targetEntries[0].path);
  start.textContent = t("startReading");
  topActions.appendChild(start);
  root.appendChild(topActions);

  if (progress) {
    const progressLine = document.createElement("p");
    progressLine.className = "sub";
    progressLine.textContent = `${t("continueReading")}: ${formatProgress(progress)}`;
    root.appendChild(progressLine);
  }

  const list = document.createElement("ol");
  list.className = "series-toc";

  targetEntries.forEach((entry) => {
    const li = document.createElement("li");
    if (progress && progress.path === entry.path) li.classList.add("current");

    const link = document.createElement("a");
    link.href = buildPostUrl(entry.path);
    link.textContent = entry.title || t("untitled");

    const meta = document.createElement("span");
    meta.className = "sub";
    const bits = [entry.date, trackLabel(entry.track)].filter(Boolean);
    meta.textContent = bits.length > 0 ? `(${bits.join(" · ")})` : "";

    li.appendChild(link);
    li.appendChild(meta);
    list.appendChild(li);
  });

  root.appendChild(list);
}

function renderPosts() {
  let posts = filteredPosts();
  const list = byId("post-list");
  const meta = byId("meta");
  const modeTitle = byId("mode-title");
  const modeBody = byId("mode-body");
  if (!list || !meta || !modeTitle || !modeBody) return;

  if (currentNavMode() === "recent") {
    posts = posts
      .slice()
      .sort((a, b) => {
        const updatedCmp = (b.updated_at || "").localeCompare(a.updated_at || "");
        if (updatedCmp) return updatedCmp;

        const dateCmp = (b.date || "").localeCompare(a.date || "");
        if (dateCmp) return dateCmp;

        const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.NEGATIVE_INFINITY;
        const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.NEGATIVE_INFINITY;
        if (ao !== bo) return bo - ao;

        const categoryRank = (value) => {
          if (value === "gpu-series") return 0;
          if (value === "comparison") return 1;
          if (value === "worklog") return 2;
          return 3;
        };
        const categoryCmp = categoryRank(a.category) - categoryRank(b.category);
        if (categoryCmp) return categoryCmp;

        return (a.title || "").localeCompare(b.title || "") || (a.path || "").localeCompare(b.path || "");
      });
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

  const info = currentModeInfo();
  modeTitle.textContent = info.title;
  modeBody.textContent = info.body;
  modeBody.hidden = !info.body;
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

    const metaBits = [post.date, seriesLabel(post.series), categoryLabel(post.category), trackLabel(post.track), post.status].filter(Boolean);
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
  const modeBody = byId("mode-body");
  const activeFilters = byId("active-filters");
  if (modeTitle) modeTitle.textContent = t("loadErrorTitle");
  if (modeBody) {
    modeBody.textContent = "";
    modeBody.hidden = true;
  }
  if (meta) meta.textContent = "";
  if (activeFilters) {
    activeFilters.hidden = true;
    activeFilters.innerHTML = "";
  }

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
  syncSearchInputValue();
  renderSeriesFilters();
  renderFilters();
  renderActiveFilters();
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
        scheduleSearchUpdate(search.value);
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
        clearFiltersState();
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
