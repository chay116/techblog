const SEARCH_DEBOUNCE_MS = 180;
const TAG_COLLAPSE_LIMIT = 18;

let searchDebounceHandle = 0;

function isFilterMode(mode = currentNavMode()) {
  return mode === "recent" || mode === "gpu" || mode === "gpu-lab" || mode === "compiler";
}

function clearSearchDebounce() {
  if (!searchDebounceHandle) return;
  window.clearTimeout(searchDebounceHandle);
  searchDebounceHandle = 0;
}

function syncSearchInputValue() {
  const search = byId("search-input");
  if (search && search.value !== state.q) search.value = state.q;
}

function scheduleSearchUpdate(nextValue) {
  clearSearchDebounce();
  searchDebounceHandle = window.setTimeout(() => {
    searchDebounceHandle = 0;
    const next = nextValue.trim();
    if (state.q === next) return;
    state.q = next;
    renderAll();
  }, SEARCH_DEBOUNCE_MS);
}

function clearFiltersState() {
  clearSearchDebounce();
  state.series = null;
  state.category = null;
  state.explicitCategory = false;
  state.track = null;
  state.tag = null;
  state.q = "";
  state.tagsExpanded = false;
  syncSearchInputValue();
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

function visibleTagEntries() {
  const entries = Object.entries(state.data.tags);
  if (entries.length <= TAG_COLLAPSE_LIMIT) {
    return { entries, hiddenCount: 0 };
  }

  if (state.tagsExpanded) {
    return { entries, hiddenCount: 0 };
  }

  if (!state.tag) {
    return {
      entries: entries.slice(0, TAG_COLLAPSE_LIMIT),
      hiddenCount: entries.length - TAG_COLLAPSE_LIMIT,
    };
  }

  const selectedIndex = entries.findIndex(([tag]) => tag === state.tag);
  if (selectedIndex < 0 || selectedIndex < TAG_COLLAPSE_LIMIT) {
    return {
      entries: entries.slice(0, TAG_COLLAPSE_LIMIT),
      hiddenCount: entries.length - TAG_COLLAPSE_LIMIT,
    };
  }

  const visible = entries.slice(0, TAG_COLLAPSE_LIMIT - 1);
  visible.push(entries[selectedIndex]);
  return {
    entries: visible,
    hiddenCount: entries.length - visible.length,
  };
}

function renderTagFilters(tagRoot) {
  const { entries, hiddenCount } = visibleTagEntries();

  entries.forEach(([tag, count]) => {
    tagRoot.appendChild(
      createChip(`${tag} (${count})`, state.tag === tag, () => {
        state.tag = state.tag === tag ? null : tag;
        renderAll();
      })
    );
  });

  if (Object.keys(state.data.tags).length <= TAG_COLLAPSE_LIMIT) return;

  const label = state.tagsExpanded
    ? t("showLessTags")
    : `${t("showMoreTags")} (${hiddenCount})`;
  tagRoot.appendChild(
    createChip(label, false, () => {
      state.tagsExpanded = !state.tagsExpanded;
      renderAll();
    }, "chip filter-toggle-chip")
  );
}

function renderFilters() {
  const catRoot = byId("category-filters");
  const trackRoot = byId("track-filters");
  const tagRoot = byId("tag-filters");
  if (!catRoot || !trackRoot || !tagRoot) return;

  const mode = currentNavMode();
  const showCategory = mode === "recent";
  const filterMode = isFilterMode(mode);

  const categoryLabelNode = byId("filter-category-label");
  if (categoryLabelNode) categoryLabelNode.hidden = !showCategory;
  catRoot.hidden = !showCategory;

  catRoot.innerHTML = "";
  trackRoot.innerHTML = "";
  tagRoot.innerHTML = "";
  if (!filterMode) return;

  if (showCategory) {
    catRoot.appendChild(
      createChip(t("all"), state.category === "all", () => {
        state.category = state.category === "all" ? null : "all";
        state.explicitCategory = state.category !== null;
        renderAll();
      })
    );

    state.data.categories.forEach((category) => {
      catRoot.appendChild(
        createChip(categoryLabel(category), state.category === category, () => {
          state.category = state.category === category ? null : category;
          state.explicitCategory = state.category !== null;
          renderAll();
        })
      );
    });
  }

  orderedTracks(state.data.tracks).forEach((track) => {
    trackRoot.appendChild(
      createChip(trackLabel(track), state.track === track, () => {
        state.track = state.track === track ? null : track;
        renderAll();
      })
    );
  });

  renderTagFilters(tagRoot);
}

function activeFilterEntries() {
  const mode = currentNavMode();
  if (!isFilterMode(mode)) return [];

  const entries = [];
  if (mode === "recent" && state.series) {
    entries.push({
      label: t("series"),
      value: seriesLabel(state.series),
      clear() {
        state.series = null;
      },
    });
  }
  if (mode === "recent" && state.category && state.category !== "all") {
    entries.push({
      label: t("category"),
      value: categoryLabel(state.category),
      clear() {
        state.category = null;
        state.explicitCategory = false;
      },
    });
  }
  if (state.track) {
    entries.push({
      label: t("track"),
      value: trackLabel(state.track),
      clear() {
        state.track = null;
      },
    });
  }
  if (state.tag) {
    entries.push({
      label: t("tags"),
      value: state.tag,
      clear() {
        state.tag = null;
      },
    });
  }
  if (state.q) {
    entries.push({
      label: t("search"),
      value: state.q,
      clear() {
        clearSearchDebounce();
        state.q = "";
        syncSearchInputValue();
      },
    });
  }
  return entries;
}

function renderActiveFilters() {
  const root = byId("active-filters");
  if (!root) return;

  const entries = activeFilterEntries();
  root.hidden = entries.length === 0;
  if (entries.length === 0) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = "";

  const head = document.createElement("div");
  head.className = "filter-active-head";

  const title = document.createElement("p");
  title.className = "filter-active-title";
  title.textContent = t("activeFilters");
  head.appendChild(title);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "filter-active-clear";
  clear.textContent = t("clearFilters");
  clear.addEventListener("click", () => {
    clearFiltersState();
    renderAll();
  });
  head.appendChild(clear);
  root.appendChild(head);

  const chips = document.createElement("div");
  chips.className = "chips";

  entries.forEach((entry) => {
    const button = createChip(`${entry.label}: ${entry.value} ×`, false, () => {
      entry.clear();
      renderAll();
    }, "chip active-chip");
    chips.appendChild(button);
  });

  root.appendChild(chips);
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
