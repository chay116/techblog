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

function syncUrl() {
  const params = new URLSearchParams();
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
  dir: "",
  q: "",
  all: [],
  tree: null,
};

function makeNode(name, path) {
  return { name, path, children: new Map(), items: [], count: 0 };
}

function buildTree(posts) {
  const root = makeNode("", "");

  for (const p of posts) {
    const rel = (p.path || "").replace(/^posts\/unreal-summary\//, "");
    const parts = rel.split("/").filter(Boolean);
    const dirs = parts.slice(0, -1);

    let node = root;
    let cur = "";
    for (const d of dirs) {
      cur = cur ? `${cur}/${d}` : d;
      if (!node.children.has(d)) node.children.set(d, makeNode(d, cur));
      node = node.children.get(d);
    }
    node.items.push(p);
  }

  function computeCounts(n) {
    let cnt = n.items.length;
    for (const child of n.children.values()) cnt += computeCounts(child);
    n.count = cnt;
    return cnt;
  }

  computeCounts(root);
  return root;
}

function setDir(dir) {
  state.dir = dir;
  renderAll();
}

function renderTree() {
  const rootEl = byId("tree");
  rootEl.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `tree-root-btn ${state.dir === "" ? "active" : ""}`;
  allBtn.textContent = "All";
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
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
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

function isMatch(p, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    p.title || "",
    p.summary || "",
    p.track || "",
    p.path || "",
    ...(p.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function filteredPosts() {
  const q = state.q.trim();
  const dir = state.dir;

  return state.all.filter((p) => {
    if (q && !isMatch(p, q)) return false;
    if (!dir) return true;
    const rel = (p.path || "").replace(/^posts\/unreal-summary\//, "");
    return rel.startsWith(`${dir}/`);
  });
}

function renderMain() {
  const list = byId("post-list");
  const meta = byId("meta");
  const title = byId("dir-title");

  const q = state.q.trim();

  list.innerHTML = "";

  if (!state.dir && !q) {
    title.textContent = "Tracks";

    const counts = new Map();
    const rootItems = [];
    for (const p of state.all) {
      const rel = (p.path || "").replace(/^posts\/unreal-summary\//, "");
      const parts = rel.split("/").filter(Boolean);
      if (parts.length < 2) {
        rootItems.push(p);
        continue;
      }
      const top = parts[0];
      counts.set(top, (counts.get(top) || 0) + 1);
    }

    const tracks = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    meta.textContent = `${state.all.length} docs`;

    tracks.forEach(([name, count]) => {
      const item = document.createElement("article");
      item.className = "post";
      item.innerHTML = `
        <h3><button class="tree-track-btn" type="button">${name}</button></h3>
        <p class="sub">${count} docs</p>
        <p class="muted">Browse ${name} notes.</p>
      `;
      item.querySelector("button").addEventListener("click", () => setDir(name));
      list.appendChild(item);
    });

    if (rootItems.length) {
      const hr = document.createElement("hr");
      hr.className = "sep";
      list.appendChild(hr);

      rootItems
        .slice()
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
        .forEach((p) => {
          const item = document.createElement("article");
          item.className = "post";
          const from = `./unreal.html${window.location.search || ""}`;
          const postUrl = `./post.html?path=${encodeURIComponent(p.path)}&from=${encodeURIComponent(from)}`;
          item.innerHTML = `
            <h3><a href="${postUrl}">${p.title}</a></h3>
            <p class="sub">${p.date || ""} · ${p.track || ""}</p>
            <p>${p.summary || "No summary"}</p>
          `;
          list.appendChild(item);
        });
    }
    return;
  }

  const posts = filteredPosts().sort((a, b) => (a.path || "").localeCompare(b.path || ""));
  title.textContent = q ? "Search Results" : state.dir;
  meta.textContent = `${posts.length} docs`;

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No documents for current selection.";
    list.appendChild(empty);
    return;
  }

  const from = `./unreal.html${window.location.search || ""}`;
  posts.forEach((p) => {
    const item = document.createElement("article");
    item.className = "post";
    const postUrl = `./post.html?path=${encodeURIComponent(p.path)}&from=${encodeURIComponent(from)}`;

    const rel = (p.path || "").replace(/^posts\/unreal-summary\//, "");
    const metaBits = [p.date, rel].filter(Boolean);

    item.innerHTML = `
      <h3><a href="${postUrl}">${p.title}</a></h3>
      <p class="sub">${metaBits.join(" · ")}</p>
      <p>${p.summary || "No summary"}</p>
    `;
    list.appendChild(item);
  });
}

function renderAll() {
  const search = byId("search-input");
  if (search && search.value.trim() !== state.q) {
    search.value = state.q;
  }
  renderTree();
  renderMain();
  syncUrl();
}

async function main() {
  const params = parseQuery();
  state.dir = params.get("dir") || "";
  state.q = (params.get("q") || "").trim();

  const resp = await fetch("./posts.json");
  const data = await resp.json();
  state.all = (data.posts || []).filter((p) => p.category === "unreal-summary");
  state.tree = buildTree(state.all);

  const search = byId("search-input");
  if (search) {
    search.value = state.q;
    search.addEventListener("input", () => {
      state.q = search.value.trim();
      renderAll();
    });
  }

  renderAll();
}

main();

