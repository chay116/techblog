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

function filteredPosts() {
  return state.data.posts.filter((p) => {
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

  meta.textContent = `${posts.length} posts`;
  list.innerHTML = "";

  posts.forEach((p) => {
    const item = document.createElement("article");
    item.className = "post";

    const ghUrl = `https://github.com/chay116/techblog/blob/main/${p.path}`;
    item.innerHTML = `
      <h3><a href="${ghUrl}" target="_blank" rel="noreferrer">${p.title}</a></h3>
      <div class="sub">${p.date} | ${p.category} | ${p.track} | ${p.status}</div>
      <p>${p.summary || "No summary"}</p>
      <div class="tags">${p.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
    `;

    list.appendChild(item);
  });
}

function renderAll() {
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

  renderAll();
}

main();
