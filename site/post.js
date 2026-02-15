function q(id) {
  return document.getElementById(id);
}

function getPathParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("path");
}

async function loadPostMeta(path) {
  const resp = await fetch("./posts.json");
  const data = await resp.json();
  return data.posts.find((p) => p.path === path) || null;
}

async function loadMarkdown(path) {
  const rawUrl = `https://raw.githubusercontent.com/chay116/techblog/main/${path}`;
  const resp = await fetch(rawUrl, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch markdown (${resp.status})`);
  return { text: await resp.text(), rawUrl };
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

  const meta = await loadPostMeta(path);
  if (meta) {
    document.title = meta.title;
    q("title").textContent = meta.title;
    q("meta").textContent = `${meta.date} | ${meta.category} | ${meta.track} | ${meta.status}`;
  } else {
    q("title").textContent = path;
  }

  const githubUrl = `https://github.com/chay116/techblog/blob/main/${path}`;
  q("github-link").href = githubUrl;

  try {
    const { text } = await loadMarkdown(path);
    const body = stripFrontmatter(text);
    q("markdown").innerHTML = marked.parse(body);
  } catch (err) {
    q("markdown").innerHTML = `<p>Failed to load post content.</p><pre>${String(err)}</pre>`;
  }
}

main();
