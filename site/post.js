function q(id) {
  return document.getElementById(id);
}

function getPathParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("path");
}

function getFromParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("from");
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  if (raw.startsWith("index.html") || raw.startsWith("unreal.html")) return `./${raw}`;

  return "./index.html";
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

async function loadSiteData() {
  const resp = await fetch("./posts.json");
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

async function main() {
  const path = getPathParam();
  if (!path) {
    q("title").textContent = "Invalid post path";
    return;
  }

  const from = getFromParam();
  const backLink = q("back-link");
  if (backLink) {
    try {
      const decoded = from ? decodeURIComponent(from) : "";
      backLink.href = safeBackHref(decoded);
    } catch (_) {
      backLink.href = "./index.html";
    }
  }

  const siteData = await loadSiteData();
  const posts = siteData.posts || [];
  const pathSet = new Set(posts.map((p) => p.path));
  const meta = posts.find((p) => p.path === path) || null;

  if (meta) {
    document.title = meta.title;
    q("title").textContent = meta.title;
    q("meta").textContent = `${meta.date} · ${meta.category} · ${meta.track} · ${meta.status}`;
  } else {
    q("title").textContent = path;
  }

  const githubUrl = `https://github.com/chay116/techblog/blob/main/${path}`;
  q("github-link").href = githubUrl;

  try {
    const { text } = await loadMarkdown(path);
    const body = stripFrontmatter(text);

    const renderer = {
      link(href, title, text2) {
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
            if (pathSet.has(resolved)) {
              const fromValue = from || "";
              const postUrl = `./post.html?path=${encodeURIComponent(resolved)}${
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
    };

    marked.use({ renderer });
    q("markdown").innerHTML = marked.parse(body);
  } catch (err) {
    q("markdown").innerHTML = `<p>Failed to load post content.</p><pre>${String(err)}</pre>`;
  }
}

main();
