const state = {
  category: null,
  track: null,
  tag: null,
  data: null,
};

function byId(id) {
  return document.getElementById(id);
}

function createChip(text, active, onClick) {
  const btn = document.createElement("button");
  btn.className = `chip ${active ? "active" : ""}`;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
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

function baseFilteredPosts() {
  return state.data.posts.filter((p) => {
    if (state.category && p.category !== state.category) return false;
    if (state.track && p.track !== state.track) return false;
    if (state.tag && !p.tags.includes(state.tag)) return false;
    return true;
  });
}

function renderPostList(listId, metaId, lang) {
  const posts = baseFilteredPosts().filter((p) => (p.lang || "en") === lang);
  const list = byId(listId);
  const meta = byId(metaId);

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
  renderFilters();
  renderPostList("post-list-ko", "meta-ko", "ko");
  renderPostList("post-list-en", "meta-en", "en");
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

  renderAll();
}

main();
