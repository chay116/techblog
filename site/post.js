function q(id) {
  return document.getElementById(id);
}

const READER_PROGRESS_KEY = "blog_reader_progress";

function getPathParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("path");
}

function getFromParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("from");
}

function safeStorageGetMap(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function safeStorageSetMap(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // ignore storage failures
  }
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stripMdExt(filename) {
  const s = String(filename || "");
  return s.toLowerCase().endsWith(".md") ? s.slice(0, -3) : s;
}

function safeBackHref(fromValue) {
  const raw = (fromValue || "").trim();
  if (!raw) return "./index.html";

  // Allow legacy index-only query string.
  if (raw.startsWith("?")) return `./index.html${raw}`;

  // Only allow same-site relative navigation.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return "./index.html";
  if (raw.startsWith("//")) return "./index.html";
  if (raw.startsWith("/")) return "./index.html";

  if (raw.startsWith("./")) return raw;
  if (raw.startsWith("index.html") || raw.startsWith("unreal.html") || raw.startsWith("pathtracing.html")) {
    return `./${raw}`;
  }

  return "./index.html";
}

function deriveNavMode(fromValue) {
  const raw = (fromValue || "").trim();
  if (!raw) return "home";

  let page = "index.html";
  let query = "";
  if (raw.startsWith("?")) {
    query = raw.slice(1);
  } else {
    const normalized = raw.startsWith("./") ? raw.slice(2) : raw;
    const idx = normalized.indexOf("?");
    page = idx >= 0 ? normalized.slice(0, idx) : normalized;
    query = idx >= 0 ? normalized.slice(idx + 1) : "";
  }

  try {
    const params = new URLSearchParams(query);
    if (page === "unreal.html") {
      return params.get("view") === "pathtracing" ? "pathtracing" : "unreal";
    }
    if (page === "pathtracing.html") return "pathtracing";

    const tab = params.get("tab");
    if (tab === "home" || tab === "gpu" || tab === "gpu-lab" || tab === "compiler" || tab === "recent") return tab;

    const series = params.get("series");
    if (series === "gpu" || series === "gpu-lab" || series === "compiler") return series;
    if (params.has("category") || params.has("track") || params.has("tag") || params.has("q")) return "recent";
  } catch (_) {
    // ignore malformed query strings
  }

  return "home";
}

function normalizePosix(p) {
  const parts = String(p).split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function resolveHref(currentPath, hrefPath) {
  const baseDir = String(currentPath).split("/").slice(0, -1).join("/");
  const joined = baseDir ? `${baseDir}/${hrefPath}` : hrefPath;
  return normalizePosix(joined);
}

function splitHash(href) {
  const s = String(href || "");
  const i = s.indexOf("#");
  if (i === -1) return { path: s, hash: "" };
  return { path: s.slice(0, i), hash: s.slice(i + 1) };
}

function isExternalHref(href) {
  const s = String(href || "").trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("#")) return true; // in-page anchor
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("mailto:") || s.startsWith("tel:");
}

function contentAssetHref(currentPath, href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  const resolved = resolveHref(currentPath, raw);
  return `./content/${resolved}`;
}

function normalizeMarkedLinkArgs(href, title, text2) {
  if (href && typeof href === "object") {
    const token = href;
    return {
      href: token.href || "",
      title: token.title || "",
      text: token.text || token.raw || "",
    };
  }
  return {
    href: href || "",
    title: title || "",
    text: text2 || "",
  };
}

function normalizeMarkedImageArgs(href, title, text2) {
  if (href && typeof href === "object") {
    const token = href;
    return {
      href: token.href || "",
      title: token.title || "",
      text: token.text || token.raw || "",
    };
  }
  return {
    href: href || "",
    title: title || "",
    text: text2 || "",
  };
}

function isImageOnlyParagraph(node) {
  if (!node || node.tagName !== "P") return false;
  let hasImage = false;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      if (child.textContent && child.textContent.trim()) return false;
      continue;
    }
    if (child.nodeType !== 1) return false;
    if (child.tagName === "IMG") {
      hasImage = true;
      continue;
    }
    return false;
  }
  return hasImage;
}

function isCaptionParagraph(node) {
  if (!node || node.tagName !== "P") return false;
  if (node.childElementCount !== 1) return false;
  const child = node.firstElementChild;
  return child && child.tagName === "EM" && !(node.textContent || "").trim().startsWith("!");
}

function enhanceGpuSeriesArticle(container) {
  if (!container) return;
  container.classList.add("gpu-article");

  const topChildren = Array.from(container.children);
  const firstList = topChildren.find((node) => node.tagName === "UL" || node.tagName === "OL");
  if (firstList) firstList.classList.add("gpu-summary-list");

  const headings = topChildren.filter((node) => node.tagName === "H2");
  headings.forEach((heading) => {
    let next = heading.nextElementSibling;
    while (next && (next.tagName === "HR" || next.classList.contains("gpu-caption"))) {
      next = next.nextElementSibling;
    }
    if (next && next.tagName === "P" && !next.classList.contains("gpu-caption") && !next.classList.contains("gpu-lede")) {
      next.classList.add("gpu-section-lede");
    }
  });

  const paragraphs = Array.from(container.querySelectorAll(":scope > p"));
  paragraphs.forEach((p) => {
    if (isImageOnlyParagraph(p)) {
      p.classList.add("gpu-figure", "gpu-figure-wide");
      const img = p.querySelector("img");
      if (img) img.classList.add("gpu-diagram-image");
    } else if (isCaptionParagraph(p) && p.previousElementSibling && p.previousElementSibling.classList.contains("gpu-figure")) {
      p.classList.add("gpu-caption");
    }
  });

  const firstQuote = topChildren.find((node) => node.tagName === "BLOCKQUOTE");
  if (firstQuote) firstQuote.classList.add("gpu-pullquote");
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

function categoryLabel(value) {
  if (value === "gpu-series") return "GPU Series";
  if (value === "worklog") return "Notes";
  if (value === "comparison") return "Comparison";
  return value;
}

function trackLabel(value) {
  if (value === "gpu-architecture") return "GPU Architecture";
  if (value === "api-language") return "GPU Driver/API";
  if (value === "runtime-framework") return "GPU Runtime/Framework";
  return value;
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

function buildSeriesTocFallback(posts) {
  const out = {};
  const nonUnreal = (posts || []).filter((post) => post.category !== "unreal-summary");
  const seriesSet = new Set(nonUnreal.map((post) => post.series || "other"));
  const seriesList = [...seriesSet].sort();

  seriesList.forEach((series) => {
    const bySeries = nonUnreal.filter((post) => (post.series || "other") === series);
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
        track: post.track || "other",
        prev_path: idx > 0 ? langPosts[idx - 1].path : null,
        next_path: idx + 1 < langPosts.length ? langPosts[idx + 1].path : null,
      }));
    });
    out[series] = byLang;
  });
  return out;
}

function postHref(path, fromValue) {
  if (!path) return "#";
  const from = (fromValue || "").trim();
  return from
    ? `./post.html?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}`
    : `./post.html?path=${encodeURIComponent(path)}`;
}

function readerTocLink(series) {
  if (!series) return "./index.html";
  if (series === "gpu" || series === "gpu-lab" || series === "compiler") {
    return `./index.html?tab=${encodeURIComponent(series)}`;
  }
  return `./index.html?tab=recent&series=${encodeURIComponent(series)}&category=all`;
}

function renderChapterNav(siteData, meta, currentPath, fromValue) {
  const nav = q("chapter-nav");
  const prev = q("chapter-prev");
  const toc = q("chapter-toc");
  const next = q("chapter-next");
  if (!nav || !prev || !toc || !next) return null;

  const tocMap =
    siteData && siteData.series_toc && typeof siteData.series_toc === "object"
      ? siteData.series_toc
      : buildSeriesTocFallback((siteData && siteData.posts) || []);

  const series = meta && meta.series ? meta.series : null;
  if (!series || !tocMap[series] || typeof tocMap[series] !== "object") {
    nav.hidden = true;
    return null;
  }

  const byLang = tocMap[series];
  const lang = (meta && meta.lang) || "en";
  const entries =
    Array.isArray(byLang[lang]) && byLang[lang].length > 0
      ? byLang[lang]
      : Object.values(byLang).find((arr) => Array.isArray(arr) && arr.length > 0) || [];

  const current = entries.find((entry) => entry.path === currentPath);
  if (!current) {
    nav.hidden = true;
    return null;
  }

  const fallbackFrom =
    series === "gpu" || series === "gpu-lab" || series === "compiler"
      ? `?tab=${encodeURIComponent(series)}`
      : `?tab=recent&series=${encodeURIComponent(series)}&category=all`;
  const fromForLinks = fromValue || fallbackFrom;

  toc.href = readerTocLink(series);
  if (current.prev_path) {
    prev.hidden = false;
    prev.href = postHref(current.prev_path, fromForLinks);
  } else {
    prev.hidden = true;
    prev.removeAttribute("href");
  }

  if (current.next_path) {
    next.hidden = false;
    next.href = postHref(current.next_path, fromForLinks);
  } else {
    next.hidden = true;
    next.removeAttribute("href");
  }

  nav.hidden = false;
  return current;
}

function saveReadingProgress(meta, currentPath, chapterInfo) {
  if (!meta || !meta.series || !currentPath) return;

  const key = `${meta.series}:${meta.lang || "en"}`;
  const map = safeStorageGetMap(READER_PROGRESS_KEY);
  map[key] = {
    path: currentPath,
    title: meta.title || "",
    date: meta.date || "",
    index: chapterInfo && chapterInfo.index ? chapterInfo.index : null,
    total: chapterInfo && chapterInfo.total ? chapterInfo.total : null,
    updatedAt: new Date().toISOString(),
  };
  safeStorageSetMap(READER_PROGRESS_KEY, map);
}

function isPlantUmlClassName(className) {
  const classes = String(className || "")
    .split(/\s+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return classes.some((name) =>
    ["language-plantuml", "language-puml", "language-uml", "lang-plantuml", "lang-puml", "lang-uml"].includes(name)
  );
}

async function renderPlantUmlBlocks(container) {
  if (!container) return;

  const codeNodes = Array.from(container.querySelectorAll("pre code"));
  const plantUmlNodes = codeNodes.filter((code) => isPlantUmlClassName(code.className));

  await Promise.all(
    plantUmlNodes.map(async (code) => {
      const source = (code.textContent || "").trim();
      const pre = code.closest("pre");
      if (!source || !pre) return;

      try {
        const resp = await fetch("https://kroki.io/plantuml/svg", {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: source,
        });
        if (!resp.ok) throw new Error(`PlantUML render failed (${resp.status})`);

        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);

        const figure = document.createElement("figure");
        figure.className = "plantuml";

        const img = document.createElement("img");
        img.className = "plantuml-diagram";
        img.alt = "PlantUML diagram";
        img.loading = "lazy";
        img.src = blobUrl;
        img.addEventListener("load", () => URL.revokeObjectURL(blobUrl), { once: true });
        img.addEventListener("error", () => URL.revokeObjectURL(blobUrl), { once: true });

        figure.appendChild(img);
        pre.replaceWith(figure);
      } catch (err) {
        console.warn(err);
        pre.setAttribute("data-plantuml-error", "1");
      }
    })
  );
}

function isMermaidClassName(className) {
  const classes = String(className || "")
    .split(/\s+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return classes.some((name) => ["language-mermaid", "lang-mermaid"].includes(name));
}

let mermaidInitialized = false;

async function renderMermaidBlocks(container) {
  if (!container || typeof mermaid === "undefined") return;

  const codeNodes = Array.from(container.querySelectorAll("pre code"));
  const mermaidNodes = codeNodes.filter((code) => isMermaidClassName(code.className));
  if (mermaidNodes.length === 0) return;

  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default",
    });
    mermaidInitialized = true;
  }

  let seq = 0;
  for (const code of mermaidNodes) {
    const source = (code.textContent || "").trim();
    const pre = code.closest("pre");
    if (!source || !pre) continue;

    try {
      const frame = document.createElement("figure");
      frame.className = "diagram-frame";

      const surface = document.createElement("div");
      surface.className = "diagram-surface";

      const graph = document.createElement("div");
      const id = `mermaid-diagram-${Date.now()}-${seq++}`;
      const rendered = await mermaid.render(id, source);
      graph.innerHTML = rendered.svg;

      surface.appendChild(graph);
      frame.appendChild(surface);
      pre.replaceWith(frame);
    } catch (err) {
      const fallback = document.createElement("figure");
      fallback.className = "diagram-frame";
      fallback.innerHTML = `<pre><code>${escapeAttr(source)}</code></pre>`;
      pre.replaceWith(fallback);
      console.error(err);
    }
  }
}

async function loadSiteData() {
  const resp = await fetch("./posts.json", { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch posts.json (${resp.status})`);
  return resp.json();
}

async function loadMarkdown(path) {
  const localUrl = `./content/${path}`;
  try {
    const resp = await fetch(localUrl, { cache: "no-store" });
    if (resp.ok) return { text: await resp.text(), sourceUrl: localUrl };
  } catch (_) {
    // ignore local fetch failures
  }

  const rawUrl = `https://raw.githubusercontent.com/chay116/techblog/main/${path}`;
  const resp = await fetch(rawUrl, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch markdown (${resp.status})`);
  return { text: await resp.text(), sourceUrl: rawUrl };
}

function stripFrontmatter(md) {
  if (!md.startsWith("---\n")) return md;
  const idx = md.indexOf("\n---\n", 4);
  if (idx === -1) return md;
  return md.slice(idx + 5);
}

function buildBasenameIndex(posts) {
  const map = new Map(); // basename -> string[] (paths)
  for (const p of posts) {
    const path = p.path || "";
    const base = path.split("/").pop() || "";
    if (!base) continue;
    const arr = map.get(base) || [];
    arr.push(path);
    map.set(base, arr);
  }
  return map;
}

function mapBrokenPath(resolvedPath) {
  const aliases = {
    // Animation
    "posts/unreal-summary/Animation/AnimGraph/Compilation.md":
      "posts/unreal-summary/Animation/AnimGraph_Compilation_And_Execution_Deep_Dive.md",
    "posts/unreal-summary/Animation/Blending/AnimationBlending.md":
      "posts/unreal-summary/Animation/Blending/BlendSystem.md",
    "posts/unreal-summary/Animation/Blending/BoneTransformation.md":
      "posts/unreal-summary/Animation/Skeletal_Mesh_Skinning_Deep_Dive.md",

    // Niagara
    "posts/unreal-summary/Niagara/VM_Execution.md": "posts/unreal-summary/Niagara/SimulationPipeline.md",
    "posts/unreal-summary/Niagara/Script_Compilation.md": "posts/unreal-summary/Niagara/Compiler.md",
    "posts/unreal-summary/Niagara/Rendering_Overview.md": "posts/unreal-summary/Niagara/Rendering.md",
    "posts/unreal-summary/Niagara/GPU_Compute.md":
      "posts/unreal-summary/Niagara/GPU_Simulation_Pipeline_Deep_Dive.md",
    "posts/unreal-summary/Niagara/Advanced_DataInterface_Implementation.md":
      "posts/unreal-summary/Niagara/Core/DataInterface.md",
    "posts/unreal-summary/Niagara/EffectType_and_Scalability.md": "posts/unreal-summary/Niagara/Optimization.md",
    "posts/unreal-summary/Niagara/DataInterface_System.md": "posts/unreal-summary/Niagara/Core/DataInterface.md",
    "posts/unreal-summary/Niagara/Core/VectorVM.md": "posts/unreal-summary/VectorVM/Overview.md",
    "posts/unreal-summary/Niagara/Core/NiagaraShader.md": "posts/unreal-summary/Shader/Compilation.md",
    "posts/unreal-summary/Niagara/Core/NiagaraSystemInstance.md":
      "posts/unreal-summary/Niagara/System_and_Emitter_Lifecycle.md",
    "posts/unreal-summary/Niagara/Core/Scalability.md": "posts/unreal-summary/Niagara/Optimization.md",
    "posts/unreal-summary/Niagara/Advanced/DataInterface_Advanced.md": "posts/unreal-summary/Niagara/Core/DataInterface.md",

    // Physics
    "posts/unreal-summary/Physics/Chaos_Physics_Solver_And_Constraints_Deep_Dive.md":
      "posts/unreal-summary/Physics/Chaos_Solver_Deep_Dive.md",
    "posts/unreal-summary/Physics/Chaos_Collision_Detection_Deep_Dive.md":
      "posts/unreal-summary/Physics/Collision_And_SceneQuery.md",
    "posts/unreal-summary/Physics/Chaos_Deep_Dive.md": "posts/unreal-summary/Physics/Chaos_Solver_Deep_Dive.md",
    "posts/unreal-summary/Physics/PBDSolver.md": "posts/unreal-summary/Physics/Chaos_Solver_Deep_Dive.md",

    // Lumen + RDG
    "posts/unreal-summary/Lumen/Lumen_Overview.md": "posts/unreal-summary/Lumen/Architecture.md",
    "posts/unreal-summary/Lumen/Lumen_Advanced.md": "posts/unreal-summary/Lumen/Architecture.md",
    "posts/unreal-summary/Lumen/RDG_Overview.md": "posts/unreal-summary/Rendering/RenderGraph/Architecture.md",
    "posts/unreal-summary/Rendering/Lumen/Lumen_Overview.md": "posts/unreal-summary/Lumen/Architecture.md",
    "posts/unreal-summary/Rendering/Lumen/Lumen_Advanced.md": "posts/unreal-summary/Lumen/Architecture.md",
    "posts/unreal-summary/Rendering/Lumen/Architecture.md": "posts/unreal-summary/Lumen/Architecture.md",
    "posts/unreal-summary/Rendering/Lumen/HZB_ScreenTracing.md": "posts/unreal-summary/Lumen/HZB_ScreenTracing.md",
    "posts/unreal-summary/Rendering/Lumen/HardwareRayTracing.md": "posts/unreal-summary/Lumen/HardwareRayTracing.md",
    "posts/unreal-summary/Rendering/Lumen/HitLighting.md": "posts/unreal-summary/Lumen/HitLighting.md",
    "posts/unreal-summary/Rendering/Lumen/Optimization.md": "posts/unreal-summary/Lumen/Optimization.md",
    "posts/unreal-summary/Rendering/Lumen/RadianceCache.md": "posts/unreal-summary/Lumen/RadianceCache.md",
    "posts/unreal-summary/Rendering/Lumen/SurfaceCache.md": "posts/unreal-summary/Lumen/SurfaceCache.md",
    "posts/unreal-summary/Rendering/Lumen/RDG_Overview.md": "posts/unreal-summary/Rendering/RenderGraph/Architecture.md",
    "posts/unreal-summary/Rendering/Lumen/Lumen_RadianceCache_Deep_Dive.md":
      "posts/unreal-summary/Lumen/RadianceCache.md",
    "posts/unreal-summary/Rendering/Lumen/Lumen_Optimization.md": "posts/unreal-summary/Lumen/Optimization.md",

    // Legacy/root aliases
    "posts/unreal-summary/AnimGraph_Compilation_And_Execution_Deep_Dive.md":
      "posts/unreal-summary/Animation/AnimGraph_Compilation_And_Execution_Deep_Dive.md",
    "posts/unreal-summary/VectorVM/Compiler.md": "posts/unreal-summary/Niagara/Compiler.md",
    "posts/unreal-summary/VectorVM/SimulationPipeline.md": "posts/unreal-summary/Niagara/SimulationPipeline.md",
    "posts/unreal-summary/VectorVM/Core/NiagaraScript.md":
      "posts/unreal-summary/Niagara/Core/NiagaraScript.md",
  };

  return aliases[resolvedPath] || null;
}

function renderError(message) {
  const title = q("title");
  const meta = q("meta");
  const body = q("markdown");
  const nav = q("chapter-nav");
  if (title) title.textContent = "Unavailable";
  if (meta) meta.textContent = "";
  if (body) body.innerHTML = `<p>${escapeAttr(message)}</p>`;
  if (nav) nav.hidden = true;
}

async function main() {
  try {
    const path = getPathParam();
    if (!path) {
      renderError("Invalid post path");
      return;
    }

    const from = getFromParam();
    let fromDecoded = "";
    try {
      fromDecoded = from ? decodeURIComponent(from) : "";
    } catch (_) {}

    const backLink = q("back-link");
    if (backLink) {
      try {
        backLink.href = safeBackHref(fromDecoded);
      } catch (_) {
        backLink.href = "./index.html";
      }
    }

    // Sync nav-tabs active state based on incoming filter context.
    const navMode = deriveNavMode(fromDecoded);
    const navTabs = q("nav-tabs");
    if (navTabs) {
      const tabs = navTabs.querySelectorAll(".nav-tab[data-nav]");
      tabs.forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.nav === navMode);
      });
    }

    const siteData = await loadSiteData();
    const posts = siteData.posts || [];
    const pathSet = new Set(posts.map((p) => p.path));
    if (!pathSet.has(path)) {
      renderError("Unknown post path");
      return;
    }

    const basenameIndex = buildBasenameIndex(posts);
    const meta = posts.find((p) => p.path === path) || null;
    if (!meta) {
      renderError("Post metadata not found");
      return;
    }

    document.body.classList.toggle("gpu-series-page", meta.category === "gpu-series");
    document.body.dataset.series = meta.series || "";
    document.body.dataset.track = meta.track || "";

    document.title = meta.title;
    q("title").textContent = meta.title;
    q("meta").textContent = `${meta.date} · ${categoryLabel(meta.category)} · ${trackLabel(meta.track)} · ${meta.status}`;

    const githubUrl = `https://github.com/chay116/techblog/blob/main/${path}`;
    q("github-link").href = githubUrl;

    const chapterInfo = renderChapterNav(siteData, meta, path, from || "");
    saveReadingProgress(meta, path, chapterInfo);

    const { text } = await loadMarkdown(path);
    const body = stripFrontmatter(text);

    const renderer = {
      link(href, title, text2) {
        const normalized = normalizeMarkedLinkArgs(href, title, text2);
        href = normalized.href;
        title = normalized.title;
        text2 = normalized.text;

        const safeText = text2 || "";
        const safeTitle = title ? ` title="${escapeAttr(title)}"` : "";

        if (!href) return safeText;

        // Open external links in a new tab.
        const lower = String(href).toLowerCase().trim();
        const ext = lower.startsWith("http://") || lower.startsWith("https://");

        if (!isExternalHref(href)) {
          const { path: hrefPath, hash } = splitHash(href);
          if (hrefPath && hrefPath.endsWith(".md")) {
            const resolved = resolveHref(path, hrefPath);
            let targetPath = resolved;

            if (!pathSet.has(targetPath)) {
              const mapped = mapBrokenPath(targetPath);
              if (mapped && pathSet.has(mapped)) {
                targetPath = mapped;
              } else {
                const basename = targetPath.split("/").pop() || "";
                const candidates = basename ? basenameIndex.get(basename) || [] : [];

                // If there's exactly one doc with this basename, prefer it unless it's too generic.
                const deny = new Set(["Compilation.md", "Overview.md"]);
                if (basename && candidates.length === 1 && !deny.has(basename)) {
                  targetPath = candidates[0];
                } else {
                  // Last resort: send the user to a search page rather than a 404.
                  const q = stripMdExt(basename || hrefPath);
                  if ((meta && meta.category === "unreal-summary") || path.startsWith("posts/unreal-summary/")) {
                    const searchUrl = `./unreal.html?q=${encodeURIComponent(q)}`;
                    return `<a href="${searchUrl}"${safeTitle}>${safeText}</a>`;
                  }
                  const searchUrl = `./index.html?category=all&q=${encodeURIComponent(q)}`;
                  return `<a href="${searchUrl}"${safeTitle}>${safeText}</a>`;
                }
              }
            }

            if (pathSet.has(targetPath)) {
              const fromValue = from || "";
              const postUrl = `./post.html?path=${encodeURIComponent(targetPath)}${
                fromValue ? `&from=${encodeURIComponent(fromValue)}` : ""
              }${hash ? `#${encodeURIComponent(hash)}` : ""}`;
              return `<a href="${postUrl}"${safeTitle}>${safeText}</a>`;
            }

            // Fall back to GitHub blob if it's a repo-relative markdown not indexed as a post.
            const blobUrl = `https://github.com/chay116/techblog/blob/main/${resolved}${hash ? `#${hash}` : ""}`;
            return `<a href="${blobUrl}" target="_blank" rel="noreferrer"${safeTitle}>${safeText}</a>`;
          }
        }

        const safeHref = escapeAttr(href);
        if (ext) {
          return `<a href="${safeHref}" target="_blank" rel="noreferrer"${safeTitle}>${safeText}</a>`;
        }
        return `<a href="${safeHref}"${safeTitle}>${safeText}</a>`;
      },
      image(href, title, text2) {
        const normalized = normalizeMarkedImageArgs(href, title, text2);
        href = normalized.href;
        title = normalized.title;
        text2 = normalized.text;

        const alt = escapeAttr(text2 || "");
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        if (!href) return `<img alt="${alt}"${titleAttr} />`;

        const lower = String(href).toLowerCase().trim();
        const ext = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:");
        const src = ext ? escapeAttr(href) : escapeAttr(contentAssetHref(path, href));
        return `<img src="${src}" alt="${alt}" loading="lazy"${titleAttr} />`;
      },
    };

    marked.use({ renderer, gfm: true, breaks: false });
    const container = q("markdown");
    if (container) {
      container.classList.toggle("gpu-article", meta.category === "gpu-series");
      container.innerHTML = marked.parse(body);
      const firstHeading = container.querySelector("h1");
      if (firstHeading && meta && meta.title && firstHeading.textContent.trim() !== meta.title.trim()) {
        firstHeading.textContent = meta.title;
      }
      await renderMermaidBlocks(container);
      await renderPlantUmlBlocks(container);
      if (meta.category === "gpu-series") {
        enhanceGpuSeriesArticle(container);
      }
    }

    // Apply syntax highlighting to all code blocks
    if (typeof hljs !== "undefined") {
      document.querySelectorAll("#markdown pre code").forEach((block) => {
        hljs.highlightElement(block);
      });
    }
  } catch (err) {
    console.error(err);
    renderError(`Failed to load post content: ${String(err)}`);
  }
}

main();
