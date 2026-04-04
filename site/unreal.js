const PATH_TRACING_VIEW = "pathtracing";

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

function currentView() {
  return state.view === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "all";
}

function currentNavMode() {
  return currentView() === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "unreal";
}

function syncUrl() {
  const params = new URLSearchParams();
  if (currentView() === PATH_TRACING_VIEW) params.set("view", PATH_TRACING_VIEW);
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

const state = {
  view: "all",
  dir: "",
  q: "",
  all: [],
  tree: null,
};

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

function renderNavTabs() {
  const mode = currentNavMode();
  if (typeof renderSharedNav === "function") {
    renderSharedNav(mode);
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
  allBtn.textContent = currentView() === PATH_TRACING_VIEW ? "All PathTracing" : "All";
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
    sub.textContent = `${count} docs`;

    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = `Browse ${name} notes.`;

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
      link.textContent = post.title || "(untitled)";
      h3.appendChild(link);

      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = `${post.date || ""} | ${post.track || ""}`;

      const summary = document.createElement("p");
      summary.textContent = post.summary || "No summary";

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
    link.textContent = post.title || "(untitled)";
    h3.appendChild(link);

    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = metaBits.join(" | ");

    const summary = document.createElement("p");
    summary.textContent = post.summary || "No summary";

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
    title.textContent = "Tracks";
    meta.textContent = `${docs.length} docs`;
    renderTrackCards(list, docs);
    return;
  }

  const posts = filteredPosts().sort((a, b) => (a.path || "").localeCompare(b.path || ""));
  if (query) {
    title.textContent = currentView() === PATH_TRACING_VIEW ? "PathTracing Search" : "Search Results";
  } else if (state.dir) {
    title.textContent = state.dir;
  } else if (currentView() === PATH_TRACING_VIEW) {
    title.textContent = "PathTracing";
  } else {
    title.textContent = "Unreal";
  }
  meta.textContent = `${posts.length} docs`;

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No documents for current selection.";
    list.appendChild(empty);
    return;
  }

  renderPostList(list, posts);
}

function renderLoadError(message = "Failed to load Unreal summary data. Refresh and try again.") {
  renderNavTabs();

  const meta = byId("meta");
  const title = byId("dir-title");
  const list = byId("post-list");
  const tree = byId("tree");

  if (title) title.textContent = "Unavailable";
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

  renderNavTabs();
  renderTree();
  renderMain();
  syncUrl();
}

async function main() {
  try {
    const params = parseQuery();
    state.view = params.get("view") === PATH_TRACING_VIEW ? PATH_TRACING_VIEW : "all";
    state.dir = params.get("dir") || "";
    state.q = (params.get("q") || "").trim();

    const resp = await fetch("./posts.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch posts.json (${resp.status})`);
    const data = await resp.json();
    state.all = (data.posts || []).filter((post) => post.category === "unreal-summary");

    if (state.all.length === 0) {
      renderLoadError("Unreal documents are not accessible from this blog.");
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
